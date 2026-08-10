// actions/lib/engine.js
//
// Implements the triggerWorkflowRun / approveStep behavior described in the
// assignment:
//   1. Verify caller is owner/editor in the workflow's org
//   2. Check org quota isn't exhausted
//   3. Create workflow_run, execute steps in order (llm_call / http_request
//      make real external calls, with retry)
//   4. On approval_gate: set run to paused, stop. approveStep resumes it
//      after checking the approver's role in code (Layer 2).
//   5. step_runs / workflow_run updated throughout -> subscription reflects
//      it live
//   6. Increment org quota usage on completion

const { hasuraRequest } = require('./hasura');
const { callLLM } = require('./llm');
const { callHttp } = require('./http');

const MAX_ATTEMPTS = 2; // "at least one retry on failure" => 1 initial + 1 retry

// ---------------------------------------------------------------------------
// Role check helper — the ONLY source of truth for "is this user allowed to
// act on this org" from the handler's point of view. Queried fresh on every
// call; never trust a role claim passed in from the client.
// ---------------------------------------------------------------------------
async function getCallerRoleInOrg(userId, orgId) {
  const query = `
    query ($userId: uuid!, $orgId: uuid!) {
      org_members(where: {user_id: {_eq: $userId}, org_id: {_eq: $orgId}}, limit: 1) {
        role
      }
    }`;
  const data = await hasuraRequest(query, { userId, orgId });
  return data.org_members[0]?.role || null;
}

async function getWorkflow(workflowId) {
  const query = `
    query ($id: uuid!) {
      workflows_by_pk(id: $id) {
        id org_id
        steps(order_by: {step_order: asc}) { id step_order name type config }
      }
    }`;
  const data = await hasuraRequest(query, { id: workflowId });
  return data.workflows_by_pk;
}

async function checkAndReserveQuota(orgId) {
  const query = `
    query ($orgId: uuid!) {
      organizations_by_pk(id: $orgId) { quota_limit quota_used quota_period_start }
    }`;
  const data = await hasuraRequest(query, { orgId });
  const org = data.organizations_by_pk;
  if (!org) { const e = new Error('org not found'); e.status = 404; throw e; }

  // roll the quota over if we've entered a new calendar month since it was last used
  const periodStart = new Date(org.quota_period_start);
  const now = new Date();
  const newPeriod = periodStart.getUTCFullYear() !== now.getUTCFullYear() || periodStart.getUTCMonth() !== now.getUTCMonth();
  if (newPeriod) {
    await hasuraRequest(
      `mutation ($orgId: uuid!) {
        update_organizations_by_pk(pk_columns: {id: $orgId}, _set: {quota_used: 0, quota_period_start: "now()"}) { id }
      }`,
      { orgId }
    );
    return; // freshly reset, definitely under quota
  }

  if (org.quota_used >= org.quota_limit) {
    const e = new Error('org quota exhausted for this period');
    e.status = 429;
    throw e;
  }
}

async function incrementQuota(orgId) {
  await hasuraRequest(
    `mutation ($orgId: uuid!) {
      update_organizations_by_pk(pk_columns: {id: $orgId}, _inc: {quota_used: 1}) { id }
    }`,
    { orgId }
  );
}

async function createRun({ workflowId, orgId, triggerType, triggeredByUserId }) {
  const mutation = `
    mutation ($workflowId: uuid!, $orgId: uuid!, $triggerType: String!, $triggeredBy: uuid) {
      insert_workflow_runs_one(object: {
        workflow_id: $workflowId, org_id: $orgId, trigger_type: $triggerType,
        triggered_by: $triggeredBy, status: "running", started_at: "now()"
      }) { id }
    }`;
  const data = await hasuraRequest(mutation, {
    workflowId, orgId, triggerType, triggeredBy: triggeredByUserId,
  });
  return data.insert_workflow_runs_one.id;
}

async function createStepRun({ runId, step, input }) {
  const mutation = `
    mutation ($runId: uuid!, $stepId: uuid!, $order: Int!, $type: String!, $input: jsonb) {
      insert_step_runs_one(object: {
        workflow_run_id: $runId, workflow_step_id: $stepId, step_order: $order,
        type: $type, status: "running", input: $input, started_at: "now()", attempt_count: 1
      }) { id }
    }`;
  const data = await hasuraRequest(mutation, {
    runId, stepId: step.id, order: step.step_order, type: step.type, input,
  });
  return data.insert_step_runs_one.id;
}

async function updateStepRun(stepRunId, patch) {
  const mutation = `
    mutation ($id: uuid!, $set: step_runs_set_input!) {
      update_step_runs_by_pk(pk_columns: {id: $id}, _set: $set) { id status }
    }`;
  await hasuraRequest(mutation, { id: stepRunId, set: patch });
}

async function incrementAttempt(stepRunId) {
  await hasuraRequest(
    `mutation ($id: uuid!) { update_step_runs_by_pk(pk_columns: {id: $id}, _inc: {attempt_count: 1}) { id } }`,
    { id: stepRunId }
  );
}

async function updateRun(runId, patch) {
  const mutation = `
    mutation ($id: uuid!, $set: workflow_runs_set_input!) {
      update_workflow_runs_by_pk(pk_columns: {id: $id}, _set: $set) { id status }
    }`;
  await hasuraRequest(mutation, { id: runId, set: patch });
}

// ---------------------------------------------------------------------------
// Step executors
// ---------------------------------------------------------------------------
async function executeStep(step, context) {
  switch (step.type) {
    case 'llm_call': {
      const prompt = interpolate(step.config.prompt, context);
      const output = await callLLM({ prompt, model: step.config.model, temperature: step.config.temperature });
      return output; // { text, raw }
    }
    case 'http_request': {
      const url = interpolate(step.config.url, context);
      const body = step.config.body ? JSON.parse(interpolate(JSON.stringify(step.config.body), context)) : undefined;
      const output = await callHttp({
        url, method: step.config.method || 'GET', headers: step.config.headers, body,
      });
      return output;
    }
    case 'db_write': {
      // Saves a result into our own tables. We use `leads` as the generic
      // demo sink here; swap the table via step.config.table in a real deployment.
      const mutation = `
        mutation ($orgId: uuid!, $name: String!, $email: String, $source: String) {
          insert_leads_one(object: {org_id: $orgId, name: $name, email: $email, source: $source}) { id }
        }`;
      const values = step.config.values || {};
      const data = await hasuraRequest(mutation, {
        orgId: context.orgId,
        name: interpolate(values.name || 'workflow-output', context),
        email: values.email ? interpolate(values.email, context) : null,
        source: 'workflow',
      });
      return data.insert_leads_one;
    }
    case 'notify': {
      // Implemented as an Event Trigger in the real deployment: this step
      // just writes the pending notification row / calls the configured
      // webhook; Hasura's Event Trigger on that insert does the actual
      // Slack/email send asynchronously. Here we call the same handler path
      // directly so the demo doesn't require a second running process.
      const message = interpolate(step.config.message || '', context);
      await callHttp({
        url: step.config.target, // e.g. a Slack Incoming Webhook URL
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { text: message },
      }).catch((e) => { throw e; }); // still counts toward step-level retry
      return { sent: true, message };
    }
    case 'conditional_branch': {
      const prev = context.previousOutput;
      const fieldVal = getPath(prev, step.config.condition_field);
      const result = compare(fieldVal, step.config.operator, step.config.value);
      return { condition_result: result, branch: result ? 'true' : 'false' };
    }
    case 'approval_gate': {
      return null; // handled specially in runWorkflow — pauses instead of "executing"
    }
    default:
      throw new Error(`unknown step type: ${step.type}`);
  }
}

function interpolate(template, context) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const val = getPath(context, path);
    return val === undefined ? '' : typeof val === 'string' ? val : JSON.stringify(val);
  });
}

function getPath(obj, path) {
  if (!path) return undefined;
  return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

function compare(a, operator, b) {
  switch (operator) {
    case 'eq': return a === b;
    case 'neq': return a !== b;
    case 'contains': return typeof a === 'string' && a.includes(b);
    case 'gt': return Number(a) > Number(b);
    case 'lt': return Number(a) < Number(b);
    default: return Boolean(a);
  }
}

// ---------------------------------------------------------------------------
// runWorkflow — entrypoint used by every trigger type
// ---------------------------------------------------------------------------
async function runWorkflow({ workflowId, triggerType, triggeredByUserId, requireCallerRole, payload }) {
  const workflow = await getWorkflow(workflowId);
  if (!workflow) { const e = new Error('workflow not found'); e.status = 404; throw e; }

  // 1. verify caller is owner/editor in the workflow's org (manual trigger only —
  //    webhook/scheduled/database_event are authenticated by other means upstream)
  if (requireCallerRole) {
    const role = await getCallerRoleInOrg(requireCallerRole.userId, workflow.org_id);
    if (!role || !requireCallerRole.roles.includes(role)) {
      const e = new Error('forbidden: caller is not owner/editor in this org');
      e.status = 403;
      throw e;
    }
  }

  // 2. quota check
  await checkAndReserveQuota(workflow.org_id);

  // 3. create the run
  const runId = await createRun({
    workflowId, orgId: workflow.org_id, triggerType, triggeredByUserId,
  });

  const context = { orgId: workflow.org_id, trigger: payload || {}, previousOutput: null, steps: {} };

  const finalStatus = await runStepsFrom({ workflow, runId, context, fromIndex: 0 });
  return { runId, status: finalStatus };
}

// Executes workflow.steps starting at fromIndex, updating step_runs/workflow_run
// as it goes. Returns the final workflow_run status ('completed' | 'failed' | 'paused').
async function runStepsFrom({ workflow, runId, context, fromIndex }) {
  const steps = workflow.steps;

  for (let i = fromIndex; i < steps.length; i++) {
    const step = steps[i];

    if (step.type === 'approval_gate') {
      const stepRunId = await createStepRun({ runId, step, input: context.previousOutput });
      await updateStepRun(stepRunId, { status: 'paused' });
      await updateRun(runId, { status: 'paused' });
      return 'paused';
    }

    const stepRunId = await createStepRun({ runId, step, input: context.previousOutput });

    let lastError = null;
    let output = null;
    let succeeded = false;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) await incrementAttempt(stepRunId);
      try {
        output = await executeStep(step, context);
        succeeded = true;
        break;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 500 * attempt)); // small backoff before retry
        }
      }
    }

    if (!succeeded) {
      await updateStepRun(stepRunId, {
        status: 'failed', error: String(lastError?.message || lastError), finished_at: 'now()',
      });
      await updateRun(runId, { status: 'failed', error: `step "${step.name}" failed: ${lastError?.message}` });
      return 'failed';
    }

    await updateStepRun(stepRunId, { status: 'succeeded', output, finished_at: 'now()' });
    context.previousOutput = output;
    context.steps[step.name] = output;

    // conditional_branch changes control flow based on the LLM/HTTP output
    // that fed it; here we simply continue to the next step in order (the
    // branch result is recorded in output.branch), but a fuller
    // implementation would jump to on_true_step_id / on_false_step_id from
    // step.config and skip the steps in between.
    if (step.type === 'conditional_branch' && step.config.on_false_step_id && !output.condition_result) {
      const targetIdx = steps.findIndex((s) => s.id === step.config.on_false_step_id);
      if (targetIdx !== -1) { i = targetIdx - 1; continue; }
    }
  }

  await updateRun(runId, { status: 'completed', finished_at: 'now()' });
  await incrementQuota(workflow.org_id); // 6. increment usage on completion
  return 'completed';
}

// ---------------------------------------------------------------------------
// approveStep — Layer 2 check happens here, in code, because "resume a
// paused execution" is a decision, not a plain row mutation.
// ---------------------------------------------------------------------------
async function resumeFromApproval({ stepRunId, approverUserId }) {
  const query = `
    query ($id: uuid!) {
      step_runs_by_pk(id: $id) {
        id status workflow_run_id workflow_step_id
        workflow_run { id workflow_id org_id status }
      }
    }`;
  const data = await hasuraRequest(query, { id: stepRunId });
  const stepRun = data.step_runs_by_pk;
  if (!stepRun) { const e = new Error('step run not found'); e.status = 404; throw e; }
  if (stepRun.status !== 'paused') {
    const e = new Error('this step is not awaiting approval'); e.status = 409; throw e;
  }

  const orgId = stepRun.workflow_run.org_id;
  const role = await getCallerRoleInOrg(approverUserId, orgId);
  if (!role || !['owner', 'editor'].includes(role)) {
    const e = new Error('forbidden: approver must be owner/editor in this org');
    e.status = 403;
    throw e;
  }

  await updateStepRun(stepRunId, {
    status: 'succeeded', approved_by: approverUserId, approved_at: 'now()', finished_at: 'now()',
  });
  await updateRun(stepRun.workflow_run.id, { status: 'running' });

  const workflow = await getWorkflow(stepRun.workflow_run.workflow_id);
  const resumeIndex = workflow.steps.findIndex((s) => s.id === stepRun.workflow_step_id) + 1;
  const context = { orgId, trigger: {}, previousOutput: { approved: true }, steps: {} };

  const finalStatus = await runStepsFrom({
    workflow, runId: stepRun.workflow_run.id, context, fromIndex: resumeIndex,
  });
  return { status: finalStatus };
}

module.exports = { runWorkflow, resumeFromApproval };
