# Testing Record

This isn't a claim that "it works" — it's what was actually run, against
real Postgres and the real, unmodified `actions/` code, before this repo
was submitted.

## How it was tested

- `migrations/001_init_schema.sql` was run against a real local Postgres 16
  instance (not just eyeballed).
- The **real, unedited** `actions/server.js` + `actions/lib/*` were started
  as a live Node process and driven entirely over HTTP with `curl`.
- Since no live nhost/Hasura project was available in this environment, a
  small mock GraphQL endpoint (`mock-hasura.js`, not part of the
  deliverable) stood in for Hasura — it does no permission enforcement of
  its own, it just executes the equivalent SQL against the same real
  Postgres DB. This validates the action handler's own logic (role checks,
  quota, retries, pause/resume) but **does not** validate Hasura's
  row-level permission YAML in `hasura/metadata/` — that still needs to be
  applied to a real Hasura instance and checked by hand (see "Not yet
  verified" below).
- `http_request`/`notify` steps were pointed at a small local mock external
  API to test success, retry-then-succeed, and retry-exhausted-then-fail
  without depending on network access.
- The frontend was `npm install`'d and `next build`'d with dummy env vars
  to catch type/syntax errors ahead of a real deploy.

## Results

### Schema (real Postgres)
- Migration applies cleanly, no errors.
- All 6 step types and 4 trigger types insert successfully.
- Invalid `step type` / invalid `role` correctly rejected by CHECK
  constraints.
- Duplicate `(org_id, user_id)` membership correctly rejected by the
  UNIQUE constraint.
- `workflow_triggers.webhook_secret` auto-generates on insert and is never
  selected by the `user`-role permission (see `tables_workflow_triggers.yaml`).
- `paused` → approved → `completed` state transitions persist correctly on
  both `workflow_runs` and `step_runs`.
- `org_usage_summary` and `workflow_latest_run` views compute correctly
  against seeded data.

### Action handler (real code, real HTTP, mock Hasura + mock external API)
| # | Scenario | Expected | Result |
|---|---|---|---|
| 1 | Viewer calls `triggerWorkflowRun` | 403 | ✅ |
| 2 | User with no membership in the org calls `triggerWorkflowRun` | 403 | ✅ |
| 3 | Wrong `x-webhook-secret` on the Action call itself | 401 | ✅ |
| 4 | Owner triggers full chain: `llm_call → http_request → conditional_branch → db_write → notify → approval_gate` | all 5 pre-gate steps `succeeded`, run `paused` at the gate | ✅ |
| 5 | Cross-org user calls `approveStep` | 403 | ✅ |
| 6 | Same-org viewer calls `approveStep` | 403 | ✅ |
| 7 | Same-org editor calls `approveStep` | 200, run resumes to `completed` | ✅ |
| 8 | Re-approving an already-resolved step | 409 | ✅ |
| 9 | Quota incremented on completion | `quota_used` 0 → 1 | ✅ |
| 10 | Flaky endpoint (fails once, then succeeds) | step `succeeded`, `attempt_count = 2` | ✅ |
| 11 | Always-failing endpoint | retried once, then run `failed` with error recorded | ✅ |
| 12 | Quota already exhausted | 429, **no** `workflow_run` row created | ✅ |
| 13 | Webhook trigger, wrong secret | 401 | ✅ |
| 14 | Webhook trigger, correct secret | 200, run started | ✅ |
| 15 | `/scheduled/run-due` | starts every enabled scheduled trigger | ✅ |
| 16 | DB-event trigger fires for Org A's `leads` insert | run started for Org A's workflow | ✅ |
| 17 | Same event shape but `org_id` = Org B (no trigger configured there) | `started: []` | ✅ |

### Frontend
- `npm install` succeeds.
- `next build` compiles all 4 routes (`/`, `/org/[orgId]`,
  `/org/[orgId]/workflow/[workflowId]`, `/404`) with no type or syntax
  errors and prerenders them statically.

## Not yet verified — do this before your live walkthrough

1. **Hasura's actual permission enforcement.** Everything above proves the
   action handler's own role checks work; it does not prove the
   `hasura/metadata/*.yaml` permission rules behave correctly once applied
   to a real Hasura instance. Apply them, then manually confirm:
   - An Org B `editor`'s `GetOrgWorkflows` query with Org A's `orgId`
     returns an empty `workflows` array (not an error — an empty result,
     which is what proves the row simply doesn't match the filter).
   - A non-owner's insert of a `db_write`/`notify` step, or a `webhook`
     trigger, is rejected by Hasura itself with a `permission-denied`
     error — not merely hidden by the frontend UI.
   - Guessing a valid Org A `workflow_id`/`step_run_id` while authenticated
     as an Org B user still returns nothing.
2. **Live GraphQL subscription over a real Hasura websocket** — only
   confirmed by code review here, not by a live socket.
3. **Real LLM calls** — tested against a local mock, not the actual Groq
   API. Set `GROQ_API_KEY` and confirm a real `llm_call` step against it.
4. **The frontend against a real nhost project** — build-checked only;
   not run against real auth/GraphQL yet.
