# AI Agent Workflow Builder

[![Quality Gates](https://github.com/ajayajay01508-boop/ai-agent-workflow-builder/actions/workflows/quality.yml/badge.svg)](https://github.com/ajayajay01508-boop/ai-agent-workflow-builder/actions/workflows/quality.yml)

A multi-tenant workflow platform for composing and running AI, HTTP, database, notification, conditional and human-approval steps. It combines a Next.js control plane with Nhost authentication, Hasura GraphQL, PostgreSQL and a hardened Node.js execution service.

## Engineering highlights

- Organization-scoped RBAC enforced in both Hasura permissions and action handlers
- Six workflow step types with retries, quota accounting and pause/resume approval gates
- Webhook, scheduled and database-event trigger paths
- GraphQL queries, mutations and subscriptions for live execution status
- Correlation IDs, constant-time webhook-secret checks and defensive validation
- Seven automated action-handler tests plus production frontend-build and dependency-audit gates

## System design

```text
Next.js + Apollo + Nhost Auth
              │ GraphQL / subscriptions
              ▼
        Hasura + PostgreSQL
              │ actions / events
              ▼
      Node.js execution engine
       ├─ LLM calls
       ├─ HTTP integrations
       ├─ database writes
       ├─ notifications
       └─ approval pause/resume
```

## Repository guide

The implementation lives in [`agent-workflow-builder/`](agent-workflow-builder/):

- [`README.md`](agent-workflow-builder/README.md) — setup, deployment and architecture
- [`TESTING.md`](agent-workflow-builder/TESTING.md) — verified scenarios and remaining external-integration checks
- [`WRITEUP.md`](agent-workflow-builder/WRITEUP.md) — schema and permission-design rationale
- [`demo/`](agent-workflow-builder/demo/) — recorded walkthrough and transcript
- [`migrations/`](agent-workflow-builder/migrations/) — PostgreSQL schema
- [`hasura/metadata/`](agent-workflow-builder/hasura/metadata/) — permission and action references
- [`actions/`](agent-workflow-builder/actions/) — workflow execution service
- [`frontend/`](agent-workflow-builder/frontend/) — Next.js product interface

## Verify locally

```bash
npm ci --prefix agent-workflow-builder/actions
npm test --prefix agent-workflow-builder/actions

npm ci --prefix agent-workflow-builder/frontend
NEXT_PUBLIC_NHOST_SUBDOMAIN=test \
NEXT_PUBLIC_NHOST_REGION=ap-south-1 \
NEXT_PUBLIC_HASURA_GRAPHQL_URL=https://example.invalid/v1/graphql \
npm run build --prefix agent-workflow-builder/frontend
```

The repository distinguishes automated/local validation from the external checks that require a real Nhost/Hasura deployment and provider credentials. No live-integration behavior is claimed without that evidence.

## License

MIT
