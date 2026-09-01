// actions/server.js
//
// This is the "Action handler" backend referenced throughout the assignment.
// Deploy it anywhere that can reach your Hasura instance (Railway, Render,
// Fly.io, or as an nhost Run service). It talks to Hasura exclusively with
// the admin secret — it is the *only* thing in the system allowed to write
// workflow_runs / step_runs / quota, which is what makes those writes
// trustworthy for the frontend's live subscription to display.

const express = require('express');
const crypto = require('crypto');
const { hasuraRequest } = require('./lib/hasura');
const { runWorkflow, resumeFromApproval } = require('./lib/engine');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  const requestId = req.header('x-request-id') || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Shared secret Hasura sends on every Action/Event-Trigger call so this
// service can reject requests that didn't actually come from Hasura.
function requireWebhookSecret(req, res, next) {
  if (req.header('x-webhook-secret') !== process.env.ACTIONS_WEBHOOK_SECRET) {
    return res.status(401).json({ message: 'unauthorized' });
  }
  next();
}

// ---------------------------------------------------------------------------
// Hasura Action: triggerWorkflowRun(workflow_id)
// Called for the "manual" trigger path directly from the frontend (via
// Hasura, forwarding the user's JWT), AND internally (see /internal/trigger
// below) by the webhook/scheduled/event entrypoints.
// ---------------------------------------------------------------------------
app.post('/actions/triggerWorkflowRun', requireWebhookSecret, async (req, res) => {
  try {
    const userId = req.body?.session_variables?.['x-hasura-user-id'];
    const { workflow_id } = req.body?.input || {};

    if (!userId) return res.status(401).json({ message: 'no authenticated user' });
    if (!workflow_id) return res.status(400).json({ message: 'workflow_id is required' });

    const result = await runWorkflow({
      workflowId: workflow_id,
      triggerType: 'manual',
      triggeredByUserId: userId,
      // step 1 of the spec: verify caller is owner/editor in the workflow's org
      requireCallerRole: { userId, roles: ['owner', 'editor'] },
    });

    res.json({ run_id: result.runId, status: result.status });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------------------
// Hasura Action: approveStep(step_run_id)
// This is where Layer 2's "mid-execution decision" gating lives: the
// approver's role is checked here, in code, not via a Hasura permission,
// because approving is not a plain row read/write — it's "resume a paused
// state machine," which only the handler understands.
// ---------------------------------------------------------------------------
app.post('/actions/approveStep', requireWebhookSecret, async (req, res) => {
  try {
    const userId = req.body?.session_variables?.['x-hasura-user-id'];
    const { step_run_id } = req.body?.input || {};
    if (!userId) return res.status(401).json({ message: 'no authenticated user' });
    if (!step_run_id) return res.status(400).json({ message: 'step_run_id is required' });

    const result = await resumeFromApproval({ stepRunId: step_run_id, approverUserId: userId });
    res.json({ step_run_id, status: result.status });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------------------
// Webhook trigger entrypoint — external systems POST here to start a run.
//   POST /webhooks/:workflow_id?secret=<workflow_triggers.webhook_secret>
// The secret is compared against the row's stored webhook_secret (fetched
// with the admin secret; never exposed over GraphQL to the `user` role).
// ---------------------------------------------------------------------------
app.post('/webhooks/:workflow_id', async (req, res) => {
  try {
    const { workflow_id } = req.params;
    const providedSecret = req.query.secret || req.header('x-webhook-secret-token');

    const trigger = await getWebhookTrigger(workflow_id);
    if (!trigger || !trigger.is_enabled) {
      return res.status(404).json({ message: 'no active webhook trigger for this workflow' });
    }
    if (!providedSecret || !timingSafeEqual(providedSecret, trigger.webhook_secret)) {
      return res.status(401).json({ message: 'invalid webhook secret' });
    }

    const result = await runWorkflow({
      workflowId: workflow_id,
      triggerType: 'webhook',
      triggeredByUserId: null,
      requireCallerRole: null, // authenticated by secret instead of a user role
      payload: req.body,
    });

    res.json({ run_id: result.runId, status: result.status });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// ---------------------------------------------------------------------------
// Scheduled trigger entrypoint — hit by an nhost/cron scheduler on an
// interval (see functions/scheduled-trigger.js). Iterates every enabled
// `scheduled` workflow_trigger and starts a run for each that's due.
// ---------------------------------------------------------------------------
app.post('/scheduled/run-due', requireWebhookSecret, async (req, res) => {
  const due = await getDueScheduledTriggers();
  const results = [];
  for (const t of due) {
    try {
      const result = await runWorkflow({
        workflowId: t.workflow_id,
        triggerType: 'scheduled',
        triggeredByUserId: null,
        requireCallerRole: null,
      });
      results.push({ workflow_id: t.workflow_id, run_id: result.runId });
    } catch (err) {
      results.push({ workflow_id: t.workflow_id, error: err.message });
    }
  }
  res.json({ started: results });
});

// ---------------------------------------------------------------------------
// Database-event trigger entrypoint — Hasura Event Trigger POSTs here on
// every insert into a watched table (e.g. `leads`). Looks up any
// `database_event` workflow_triggers matching that table + org and starts
// a run for each.
// ---------------------------------------------------------------------------
app.post('/events/database-event', requireWebhookSecret, async (req, res) => {
  try {
    const { event, table } = req.body;
    const newRow = event?.data?.new;
    if (!table?.name || !newRow?.org_id) {
      return res.status(400).json({ message: 'valid table and event.data.new.org_id are required' });
    }
    const triggers = await getDatabaseEventTriggers({ table: table.name, orgId: newRow.org_id });

    const started = [];
    for (const t of triggers) {
      const result = await runWorkflow({
        workflowId: t.workflow_id,
        triggerType: 'database_event',
        triggeredByUserId: null,
        requireCallerRole: null,
        payload: newRow,
      });
      started.push(result.runId);
    }
    res.json({ started });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function getWebhookTrigger(workflowId) {
  const query = `
    query ($workflowId: uuid!) {
      workflow_triggers(where: {workflow_id: {_eq: $workflowId}, type: {_eq: "webhook"}}, limit: 1) {
        id workflow_id webhook_secret is_enabled
      }
    }`;
  const data = await hasuraRequest(query, { workflowId });
  return data.workflow_triggers[0];
}

async function getDueScheduledTriggers() {
  // Simplified: in production, store `next_run_at` and compare it against
  // a parsed cron expression (e.g. with `cron-parser`). This returns every
  // enabled scheduled trigger; the caller (an external cron invoking
  // /scheduled/run-due) controls the actual cadence.
  const query = `
    query {
      workflow_triggers(where: {type: {_eq: "scheduled"}, is_enabled: {_eq: true}}) {
        id workflow_id config
      }
    }`;
  const data = await hasuraRequest(query, {});
  return data.workflow_triggers;
}

async function getDatabaseEventTriggers({ table, orgId }) {
  const query = `
    query ($table: String!, $orgId: uuid!) {
      workflow_triggers(
        where: {
          type: {_eq: "database_event"},
          is_enabled: {_eq: true},
          config: {_contains: {table: $table}},
          workflow: {org_id: {_eq: $orgId}}
        }
      ) {
        id workflow_id
      }
    }`;
  const data = await hasuraRequest(query, { table, orgId });
  return data.workflow_triggers;
}

const PORT = process.env.PORT || 4000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Action handler listening on :${PORT}`));
}

module.exports = { app, timingSafeEqual };
