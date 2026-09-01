# AI Agent Workflow Builder

A mini n8n for chaining AI agent steps, built on nhost (Postgres + Hasura +
Auth) with a Next.js frontend and a standalone Action-handler service that
does the actual workflow execution.

## Verified quality

- Production frontend build passes for all routes.
- Action handler has automated tests for authentication, validation,
  correlation IDs, workflow expressions and outbound HTTP execution.
- Both Node workspaces currently report zero dependency vulnerabilities.
- Pull requests run backend tests, dependency audits and the frontend build.

## Architecture

```
Next.js (frontend/)         nhost project
  - Apollo Client   ───────▶   Hasura GraphQL (queries/mutations/subscriptions,
    (queries, mutations,        permissions — Layer 1: org+role scoping)
     graphql-ws subscriptions)        │
                                       │ Hasura Actions / Event Triggers
                                       ▼
                          Action handler (actions/, plain Node/Express)
                            - triggerWorkflowRun, approveStep
                            - webhook / scheduled / database-event entrypoints
                            - Layer 2: step-level + approval-gate gating
                            - real LLM + HTTP calls, retry, quota bookkeeping
                            - writes workflow_runs / step_runs with the
                              admin secret -> Hasura fans this out over the
                              live subscription
```

The Action handler is a separate deployable service (Railway/Render/Fly/
an nhost Run service all work) because it needs to make outbound calls to
arbitrary APIs, hold retry/backoff logic, and use the Hasura **admin**
secret — none of that belongs behind a user's JWT.

## Repo layout

```
migrations/                 Postgres schema (run this first)
hasura/metadata/            Table tracking, relationships, permissions (Layer 1 +
                             the DB-enforceable half of Layer 2), Actions, Event Trigger
actions/                    The Action handler service (Node/Express)
  server.js                 HTTP routes: Actions, webhook trigger, scheduled
                             trigger, database-event trigger
  lib/engine.js              Core run/resume state machine
  lib/hasura.js              Admin-secret GraphQL client
  lib/llm.js / lib/http.js   External call implementations
functions/                  Scheduled-trigger cron entrypoint
frontend/                   Next.js app
WRITEUP.md                  ~1 page design write-up
```

## 1. Set up nhost + Postgres

1. Create a free nhost project at https://app.nhost.io.
2. Run `migrations/001_init_schema.sql` against your nhost Postgres
   instance (via the Hasura console's SQL tab, or `psql`).
3. In the Hasura console, track all new tables/views (`organizations`,
   `org_members`, `workflows`, `workflow_steps`, `workflow_triggers`,
   `workflow_runs`, `step_runs`, `leads`, `org_usage_summary`,
   `workflow_latest_run`).
4. Recreate the relationships and permissions described in
   `hasura/metadata/*.yaml` through the console (or adapt them into a
   `hasura metadata apply` config-v3 export if you're using the Hasura CLI —
   the files here are grouped by table for readability rather than as a
   literal CLI export).
5. Set the JWT/auth so every signed-in user gets Hasura role `user`
   (this is nhost's default behavior — no change needed) with
   `X-Hasura-User-Id` set to their `auth.users.id`.

## 2. Deploy the Action handler

```bash
cd actions
cp .env.example .env    # fill in HASURA_GRAPHQL_URL, HASURA_ADMIN_SECRET,
                         # ACTIONS_WEBHOOK_SECRET, and (optionally) GROQ_API_KEY
npm install
npm start                # or deploy to Railway/Render/Fly — anything that can
                          # reach your Hasura instance over HTTPS
```

- `GROQ_API_KEY` unset → `llm_call` steps use a disclosed stub response with
  an artificial 800ms delay instead of a real call (per the assignment's
  explicit allowance). Get a free key at https://console.groq.com to make it
  real.
- `ACTIONS_WEBHOOK_SECRET` must match the value you configure as
  `ACTIONS_WEBHOOK_SECRET` in Hasura's env vars (used in `actions.yaml`'s
  `value_from_env`) so the handler can reject calls that didn't come from
  Hasura.

## 3. Wire up Hasura Actions / Event Trigger

In the Hasura console:
- **Actions** → import the two mutations from `hasura/metadata/actions.graphql`,
  point their handlers at `https://<your-actions-host>/actions/triggerWorkflowRun`
  and `.../actions/approveStep`, and add the `x-webhook-secret` header as in
  `hasura/metadata/actions.yaml`.
- **Event Triggers** → create one on `public.leads` (or whatever table you
  want to demo the "database event" trigger against) for `INSERT`, pointed
  at `.../events/database-event`, per `hasura/metadata/event_triggers.yaml`.
- **Scheduled trigger** → deploy `functions/scheduled-trigger.js` as an nhost
  cron function (or point any external cron — cron-job.org, GitHub Actions,
  Vercel Cron — at `.../scheduled/run-due` on an interval with the
  `x-webhook-secret` header set).

## 4. Run the frontend

```bash
cd frontend
cp .env.local.example .env.local   # fill in your nhost subdomain/region + Hasura URL
npm install
npm run dev
```

Deploy to Vercel with the same three env vars set in the project settings.

## 5. Seed two demo orgs

After signing up 2+ users through the app's auth screen (so they exist in
`auth.users`), run something like:

```sql
insert into organizations (name, quota_limit) values ('Org A', 1000) returning id;
insert into organizations (name, quota_limit) values ('Org B', 1000) returning id;

-- then, using the returned org ids and the auth.users ids of the accounts you signed up:
insert into org_members (org_id, user_id, role) values
  ('<org-a-id>', '<user-1-id>', 'owner'),
  ('<org-a-id>', '<user-2-id>', 'editor'),
  ('<org-b-id>', '<user-3-id>', 'owner');
```

## Notes / trade-offs given the scope of this assignment

- `conditional_branch` in `actions/lib/engine.js` supports jumping to a
  configured `on_false_step_id`; the true-branch simply falls through to the
  next step in order. A production version would support both
  `on_true_step_id` and `on_false_step_id` symmetrically.
- `notify` is executed synchronously inline (a direct HTTP POST to e.g. a
  Slack incoming webhook URL) rather than through a genuinely separate
  Hasura Event Trigger pipeline, to keep the demo to one running process —
  the comment in `engine.js` notes where the async Event-Trigger path would
  plug in instead.
- The scheduled trigger's "is it due" check is simplified (every enabled
  `scheduled` trigger fires each time `/scheduled/run-due` is hit); a real
  deployment would store `next_run_at` and parse the cron expression with a
  library like `cron-parser`.
- Hasura metadata is provided as grouped, readable YAML per table rather
  than a literal `hasura metadata export` tree, since that's generated by
  the CLI/console as you build — these files are the reference for what to
  configure.
