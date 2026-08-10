# Design Write-up

## Schema reasoning

The schema follows the ownership chain the assignment specifies:
`organizations → org_members → workflows → workflow_steps / workflow_triggers`,
and separately `workflows → workflow_runs → step_runs`. `org_members` is a
pure join table carrying `role` as data rather than identity, which matters:
a person can be an `owner` in one org and a `viewer` in another, and the
schema (and every permission built on it) has to support that per-org
distinction rather than a single global role.

`workflow_steps` and `step_runs` are separate tables on purpose — `steps` is
the workflow's definition (the ordered plan), `step_runs` is an execution
log (one row per step per run, with `status`, `attempt_count`,
`approved_by`/`approved_at`). This keeps the definition editable without
touching history, and lets the live subscription filter cheaply on
`workflow_run_id`. `config` is JSONB on both `workflow_steps` and
`workflow_triggers` because step/trigger shape genuinely varies by `type`
(an `http_request`'s config has nothing in common with an
`approval_gate`'s) — a fully normalized schema would mean a table per step
type for little benefit at this scale.

Two Postgres views back the "one aggregation" requirement and the
"most recent run status" join: `org_usage_summary` (quota %, run count this
month, average run duration) and `workflow_latest_run` (a `distinct on`
picking the newest run per workflow), both wired in as relationships so the
frontend's workflow-list query gets them for free.

## The two permission layers, and why they're enforced differently

**Layer 1 (org + role scoping)** lives entirely in Hasura row-level
permissions. Every table's `select`/`insert`/`update`/`delete` permission
for the single Hasura role `user` filters through an `_exists`/relationship
lookup against `org_members` for `X-Hasura-User-Id`, so an `editor` in Org A
literally cannot construct a query that returns Org B's rows — there's no
row satisfying the filter, not even by guessing a UUID. Role granularity
(`owner` vs `editor` vs `viewer`) is expressed as an additional `role: {_in:
[...]}` clause layered on top of the same org-membership check, e.g.
`workflows` insert requires `role in (owner, editor)`.

**Layer 2 (step-level gating)** splits across two mechanisms, deliberately:

- *Creating* an owner-only step (`db_write`, `notify`) or a `webhook`
  trigger is still a plain row insert, so it's enforced the same way as
  Layer 1 — a Hasura check permission with an `_or` branch: safe types need
  `owner`/`editor`, dangerous types need `owner`. This is a database
  permission because "can I write this row" is exactly what row-level
  permissions are for.
- *Clearing an `approval_gate`* is not a row read or write — it's "resume a
  paused execution," a decision with side effects (advance a state machine,
  make further external calls, mutate quota). That can't be expressed as a
  declarative row filter, so `approveStep`'s Action handler re-queries the
  approver's live role from `org_members` in code before it does anything,
  and rejects with 403 if it isn't `owner`/`editor` — the same source of
  truth as Layer 1, just checked imperatively at the one point where a
  database permission genuinely can't reach.

## Approval-gate pause/resume

`workflow_runs.status` and `step_runs.status` both support `paused`. When
the engine (`actions/lib/engine.js`) reaches an `approval_gate` step, it
creates that step's `step_runs` row with `status: paused`, sets the run to
`paused`, and returns — no more steps execute. The frontend's
`step_runs` subscription (filtered to `workflow_run_id`) reflects this
immediately, no polling. `approveStep(step_run_id)` checks the caller's
role, marks that step run `succeeded` with `approved_by`/`approved_at`,
flips the run back to `running`, then calls the same step-execution loop
starting from the index *after* the approved step — so resume isn't a
special code path, it's the identical loop the initial run used, just
given a different starting index and a context object seeded with
`{ approved: true }`.
