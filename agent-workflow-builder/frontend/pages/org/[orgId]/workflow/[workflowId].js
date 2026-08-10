import { useRouter } from 'next/router';
import { useQuery, useMutation, useSubscription } from '@apollo/client';
import { useState } from 'react';
import {
  GET_ORG_WORKFLOWS,
  GET_MY_ORGS,
  UPSERT_STEP,
  DELETE_STEP,
  CREATE_TRIGGER,
  TRIGGER_WORKFLOW_RUN,
  APPROVE_STEP,
  STEP_RUNS_SUBSCRIPTION,
} from '../../../../graphql/operations';

const STEP_TYPES = ['llm_call', 'http_request', 'db_write', 'notify', 'conditional_branch', 'approval_gate'];
const OWNER_ONLY_TYPES = ['db_write', 'notify']; // mirrors the Hasura check permission

export default function WorkflowBuilder() {
  const router = useRouter();
  const { orgId, workflowId } = router.query;

  const { data, loading, error, refetch } = useQuery(GET_ORG_WORKFLOWS, { variables: { orgId }, skip: !orgId });
  const { data: myOrgs } = useQuery(GET_MY_ORGS);
  const [upsertStep] = useMutation(UPSERT_STEP);
  const [deleteStep] = useMutation(DELETE_STEP);
  const [createTrigger] = useMutation(CREATE_TRIGGER);
  const [triggerRun] = useMutation(TRIGGER_WORKFLOW_RUN);

  const [activeRunId, setActiveRunId] = useState(null);
  const [runError, setRunError] = useState(null);

  const myRole = myOrgs?.org_members.find((m) => m.org.id === orgId)?.role;
  const canEdit = myRole === 'owner' || myRole === 'editor';
  const canRun = canEdit; // viewers can't trigger runs
  const isOwner = myRole === 'owner';

  if (!orgId || !workflowId || loading) return <p style={{ padding: 40 }}>Loading…</p>;
  if (error) return <p style={{ padding: 40 }}>Error: {error.message}</p>;

  const workflow = data.workflows.find((w) => w.id === workflowId);
  if (!workflow) return <p style={{ padding: 40 }}>Workflow not found (or you don't have access).</p>;

  async function addStep(type) {
    if (OWNER_ONLY_TYPES.includes(type) && !isOwner) {
      alert(`Only an org owner can add a "${type}" step.`);
      return;
    }
    const nextOrder = workflow.steps.length;
    await upsertStep({
      variables: {
        object: {
          workflow_id: workflowId,
          step_order: nextOrder,
          name: `${type} #${nextOrder + 1}`,
          type,
          config: defaultConfigFor(type),
        },
      },
    });
    refetch();
  }

  async function removeStep(stepId) {
    await deleteStep({ variables: { id: stepId } });
    refetch();
  }

  async function handleRun() {
    setRunError(null);
    try {
      const res = await triggerRun({ variables: { workflow_id: workflowId } });
      setActiveRunId(res.data.triggerWorkflowRun.run_id);
    } catch (e) {
      setRunError(e.message);
    }
  }

  const webhookTrigger = workflow.triggers.find((t) => t.type === 'webhook');

  return (
    <div className="shell">
      <div className="row space-between">
        <h1>{workflow.name}</h1>
        {canRun && (
          <button className="run-btn" onClick={handleRun}>
            ▶ Run
          </button>
        )}
      </div>
      {runError && <p className="error">{runError}</p>}

      <section>
        <h2>Triggers</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {workflow.triggers.map((t) => (
            <span key={t.id} className="pill">
              {t.type}
              {t.type === 'webhook' && ' (POST to /webhooks/:workflow_id?secret=…)'}
            </span>
          ))}
          {canEdit && (
            <button onClick={() => createTrigger({ variables: { workflow_id: workflowId, type: 'scheduled', config: { cron: '*/15 * * * *' } } }).then(() => refetch())}>
              + scheduled trigger
            </button>
          )}
          {isOwner && (
            <button onClick={() => createTrigger({ variables: { workflow_id: workflowId, type: 'webhook', config: {} } }).then(() => refetch())}>
              + webhook trigger (owner only)
            </button>
          )}
        </div>
      </section>

      <section>
        <div className="row space-between">
          <h2>Steps</h2>
          {canEdit && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {STEP_TYPES.map((t) => (
                <button
                  key={t}
                  className={OWNER_ONLY_TYPES.includes(t) && !isOwner ? 'disabled-btn' : ''}
                  onClick={() => addStep(t)}
                  title={OWNER_ONLY_TYPES.includes(t) ? 'Owner-only step type' : ''}
                >
                  + {t}
                </button>
              ))}
            </div>
          )}
        </div>

        <ol className="step-list">
          {workflow.steps.map((s) => (
            <li key={s.id} className="step-item">
              <span className={`step-type type-${s.type}`}>{s.type}</span>
              <span>{s.name}</span>
              {canEdit && <button className="remove-btn" onClick={() => removeStep(s.id)}>remove</button>}
            </li>
          ))}
          {workflow.steps.length === 0 && <p className="muted">No steps yet — add some above.</p>}
        </ol>
      </section>

      {(activeRunId || workflow.latest_run?.workflow_run_id) && (
        <RunProgress runId={activeRunId || workflow.latest_run.workflow_run_id} canApprove={canEdit} />
      )}
    </div>
  );
}

function defaultConfigFor(type) {
  switch (type) {
    case 'llm_call': return { prompt: 'Summarize: {{trigger.text}}', model: 'llama-3.1-8b-instant' };
    case 'http_request': return { url: 'https://api.example.com/endpoint', method: 'GET' };
    case 'db_write': return { values: { name: 'result-{{trigger.id}}' } };
    case 'notify': return { target: 'https://hooks.slack.com/services/…', message: 'Workflow finished' };
    case 'conditional_branch': return { condition_field: 'text', operator: 'contains', value: 'urgent' };
    case 'approval_gate': return { required_role: 'owner' };
    default: return {};
  }
}

function RunProgress({ runId, canApprove }) {
  const { data, loading } = useSubscription(STEP_RUNS_SUBSCRIPTION, { variables: { workflow_run_id: runId } });
  const [approveStep, { loading: approving }] = useMutation(APPROVE_STEP);

  if (loading && !data) return <p className="muted">Connecting to live run status…</p>;

  const run = data?.workflow_runs_by_pk;
  const steps = data?.step_runs || [];

  return (
    <section>
      <h2>Run status {run && <span className={`badge ${badgeColor(run.status)}`}>{run.status}</span>}</h2>
      {run?.status === 'paused' && (
        <p className="paused-banner">⏸ Paused — awaiting approval to continue.</p>
      )}
      {run?.error && <p className="error">{run.error}</p>}

      <ol className="step-list">
        {steps.map((sr) => (
          <li key={sr.id} className="step-item">
            <span className={`step-type type-${sr.type}`}>{sr.type}</span>
            <span className={`badge ${badgeColor(sr.status)}`}>{sr.status}</span>
            <span className="muted">attempt {sr.attempt_count}</span>
            {sr.error && <span className="error">{sr.error}</span>}
            {sr.status === 'paused' && canApprove && (
              <button disabled={approving} onClick={() => approveStep({ variables: { step_run_id: sr.id } })}>
                ✓ Approve
              </button>
            )}
            {sr.status === 'paused' && !canApprove && <span className="muted">waiting for an owner/editor to approve…</span>}
            {sr.approved_by && <span className="muted">approved by {sr.approved_by}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function badgeColor(status) {
  return { completed: 'green', succeeded: 'green', failed: 'red', paused: 'orange', running: 'blue', pending: 'grey' }[status] || 'grey';
}
