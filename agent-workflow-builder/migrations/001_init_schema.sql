-- ============================================================================
-- AI Agent Workflow Builder — core schema
-- Assumes nhost's auth.users table already exists (uuid pk).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- organizations
-- ----------------------------------------------------------------------------
create table public.organizations (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  quota_limit       integer not null default 1000,       -- calls allowed per period
  quota_used        integer not null default 0,           -- calls used this period
  quota_period_start date not null default date_trunc('month', now()),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- org_members — join table between auth.users and organizations, carries role
-- ----------------------------------------------------------------------------
create table public.org_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner', 'editor', 'viewer')),
  created_at  timestamptz not null default now(),
  unique (org_id, user_id)
);

create index idx_org_members_user on public.org_members(user_id);
create index idx_org_members_org on public.org_members(org_id);

-- ----------------------------------------------------------------------------
-- workflows
-- ----------------------------------------------------------------------------
create table public.workflows (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_workflows_org on public.workflows(org_id);

-- ----------------------------------------------------------------------------
-- workflow_steps — ordered nodes in a workflow
-- ----------------------------------------------------------------------------
create table public.workflow_steps (
  id            uuid primary key default gen_random_uuid(),
  workflow_id   uuid not null references public.workflows(id) on delete cascade,
  step_order    integer not null,
  name          text not null,
  type          text not null check (type in (
                  'llm_call', 'http_request', 'db_write',
                  'notify', 'conditional_branch', 'approval_gate'
                )),
  -- config shape depends on `type`, e.g.
  --   llm_call:            { prompt, model, temperature }
  --   http_request:        { url, method, headers, body }
  --   db_write:            { table, values }
  --   notify:              { channel: 'slack'|'email', target, message }
  --   conditional_branch:  { condition_field, operator, value, on_true_step_id, on_false_step_id }
  --   approval_gate:       { required_role: 'owner'|'editor' }
  config        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workflow_id, step_order)
);

create index idx_workflow_steps_workflow on public.workflow_steps(workflow_id);

-- ----------------------------------------------------------------------------
-- workflow_triggers
-- ----------------------------------------------------------------------------
create table public.workflow_triggers (
  id              uuid primary key default gen_random_uuid(),
  workflow_id     uuid not null references public.workflows(id) on delete cascade,
  type            text not null check (type in ('manual', 'webhook', 'scheduled', 'database_event')),
  -- config shape depends on `type`, e.g.
  --   webhook:         { } (secret stored separately below)
  --   scheduled:       { cron: "*/15 * * * *" }
  --   database_event:  { table: "leads", schema: "public" }
  config          jsonb not null default '{}'::jsonb,
  webhook_secret  text default encode(gen_random_bytes(24), 'hex'), -- only used for type = 'webhook'; authenticates inbound calls, never exposed over GraphQL
  is_enabled      boolean not null default true,
  created_at      timestamptz not null default now()
);

create index idx_workflow_triggers_workflow on public.workflow_triggers(workflow_id);

-- ----------------------------------------------------------------------------
-- workflow_runs — one per execution
-- ----------------------------------------------------------------------------
create table public.workflow_runs (
  id            uuid primary key default gen_random_uuid(),
  workflow_id   uuid not null references public.workflows(id) on delete cascade,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  status        text not null default 'pending' check (status in (
                  'pending', 'running', 'paused', 'completed', 'failed', 'cancelled'
                )),
  trigger_type  text not null check (trigger_type in ('manual', 'webhook', 'scheduled', 'database_event')),
  triggered_by  uuid references auth.users(id), -- null for non-manual triggers
  started_at    timestamptz,
  finished_at   timestamptz,
  error         text,
  created_at    timestamptz not null default now()
);

create index idx_workflow_runs_workflow on public.workflow_runs(workflow_id);
create index idx_workflow_runs_org on public.workflow_runs(org_id);

-- ----------------------------------------------------------------------------
-- step_runs — one per step per run
-- ----------------------------------------------------------------------------
create table public.step_runs (
  id                uuid primary key default gen_random_uuid(),
  workflow_run_id   uuid not null references public.workflow_runs(id) on delete cascade,
  workflow_step_id  uuid not null references public.workflow_steps(id) on delete cascade,
  step_order        integer not null,
  type              text not null,
  status            text not null default 'pending' check (status in (
                      'pending', 'running', 'succeeded', 'failed', 'paused', 'skipped'
                    )),
  input             jsonb,
  output            jsonb,
  error             text,
  attempt_count     integer not null default 0,
  approved_by       uuid references auth.users(id),
  approved_at       timestamptz,
  started_at        timestamptz,
  finished_at       timestamptz
);

create index idx_step_runs_run on public.step_runs(workflow_run_id);

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();
create trigger trg_workflows_updated_at before update on public.workflows
  for each row execute function public.set_updated_at();
create trigger trg_workflow_steps_updated_at before update on public.workflow_steps
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- aggregation: org usage this month + most-recent-run helper view
-- (used as a Hasura computed field / plain tracked view)
-- ----------------------------------------------------------------------------
create view public.org_usage_summary as
select
  o.id as org_id,
  o.quota_limit,
  o.quota_used,
  round(o.quota_used::numeric / nullif(o.quota_limit, 0) * 100, 1) as quota_used_pct,
  count(distinct wr.id) filter (
    where wr.created_at >= date_trunc('month', now())
  ) as runs_this_month,
  avg(extract(epoch from (wr.finished_at - wr.started_at)))
    filter (where wr.finished_at is not null) as avg_run_duration_seconds
from public.organizations o
left join public.workflow_runs wr on wr.org_id = o.id
group by o.id, o.quota_limit, o.quota_used;

-- latest run per workflow, used to power "most recent run status" in the
-- workflows list query via an object relationship
create view public.workflow_latest_run as
select distinct on (wr.workflow_id)
  wr.workflow_id,
  wr.id as workflow_run_id,
  wr.status,
  wr.started_at,
  wr.finished_at
from public.workflow_runs wr
order by wr.workflow_id, wr.created_at desc;

-- ----------------------------------------------------------------------------
-- demo table used to exercise the "database event" trigger type: inserting a
-- row here (e.g. a new lead coming from a form) can auto-start any workflow
-- whose workflow_triggers row has type='database_event' and
-- config->>'table' = 'leads' for the same org.
-- ----------------------------------------------------------------------------
create table public.leads (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  email       text,
  source      text,
  created_at  timestamptz not null default now()
);

create index idx_leads_org on public.leads(org_id);

-- ----------------------------------------------------------------------------
-- helper function: reset quota if a new period has started (called by the
-- Action handler before it checks/increments usage)
-- ----------------------------------------------------------------------------
create or replace function public.reset_quota_if_new_period(p_org_id uuid)
returns void as $$
begin
  update public.organizations
  set quota_used = 0,
      quota_period_start = date_trunc('month', now())
  where id = p_org_id
    and quota_period_start < date_trunc('month', now());
end;
$$ language plpgsql;
