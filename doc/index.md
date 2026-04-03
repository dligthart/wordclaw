---
layout: home
hero:
  name: "WordClaw"
  text: "Governed Content Runtime"
  tagline: "Current docs track v1.51.0 on main as of 2026-04-03"
  actions:
    - theme: brand
      text: Get Started
      link: /tutorials/getting-started
    - theme: alt
      text: Current State
      link: /reference/current-state
    - theme: alt
      text: View on GitHub
      link: https://github.com/dligthart/wordclaw
features:
  - title: Discover Before You Mutate
    details: Inspect `capabilities`, `deployment-status`, actor identity, workspace context, and task recipes before an agent chooses a write path.
  - title: Governed Content Runtime
    details: Collections and singletons, localization, preview tokens, reverse references, workflow approvals, public write lanes, reusable forms, background jobs, audit trails, and multi-domain isolation.
  - title: Content + Asset Read Models
    details: Field-aware filters, grouped projections, publication-state reads, TTL lifecycle archival, and schema-aware assets with local or S3-compatible delivery.
  - title: Agent-Native Surfaces
    details: REST and MCP are the required primary contracts, GraphQL remains a compatibility layer, and remote MCP subscriptions keep long-lived agents reactive.
  - title: Paid and Protected Access
    details: Offer and entitlement flows plus L402 support are built into the runtime for machine-to-machine paid content and asset access.
  - title: Supervisor Control Plane
    details: The built-in SvelteKit UI covers audits, schemas, approvals, content inspection, forms, jobs, assets, payments, agent provisioning, and API-key operations, with shared design-system hardening underway.
---

## System State

| Area | Status | Highlights |
| --- | --- | --- |
| Provisioning and deployment | Shipped | First-tenant onboarding, fail-fast production startup validation, Docker deployment, and the new Fly.io deployment path are part of the current operator story. |
| Core governed runtime | Shipped | Structured content, globals, localization, preview tokens, forms, jobs, public write lanes, workflow review, auditability, and tenant isolation are live on `main`. |
| Asset and delivery layer | Shipped | Local and S3-compatible storage, multipart and direct upload, derivative variants, signed delivery, and entitlement-gated asset access are live on `main`. |
| Supervisor UI | Rolling out | Broad route coverage, shared shell, feedback primitives, and table foundations are live. Current work is reducing duplicate UI code, standardizing page patterns, and expanding UI test coverage. |
| Reactive agent contract | Rolling out | Remote MCP sessions, topic subscriptions, filter-aware recipes, and task-guidance follow-up suggestions are live and currently being hardened around the most valuable topics and demos. |
| Native vector RAG | Rolling out | `OPENAI_API_KEY` auto-enablement, embedding status reporting, and semantic search are available, with ongoing work focused on simpler operator experience. |
| Experimental modules | Opt-in only | Agent-run/delegation surfaces and older monetization/platform experiments remain behind feature flags or in RFC history, not the default supported path. |

Start with [Current State](/reference/current-state) when you want the shortest, dated snapshot of what ships today.

## Quick Paths

- [Run WordClaw locally](/tutorials/getting-started) to start the API, database, supervisor UI, and MCP surface.
- [Read the current product snapshot](/reference/current-state) for the dated shipped-vs-rolling-out status.
- [Check capability parity](/reference/capability-parity) when you need exact REST, MCP, and GraphQL coverage.
- [Review runtime configuration](/reference/runtime-configuration) before changing auth, embeddings, assets, previews, or payments.
- [Deploy on Fly.io](/guides/fly-deployment) when you want the published GHCR image plus Fly Managed Postgres.
- [Connect an external agent with MCP](/guides/mcp-integration) to inspect tools, resources, prompts, actor identity, and workspace context.
- [Use WordClaw as durable memory and RAG for Claude Code and OpenClaw](/guides/claude-openclaw-memory-rag) when you want agent memory outside the chat transcript.
- [Start with the Codex integration guide](/guides/codex-integration/README) when you want a Codex-native authoring or review workflow.
- [Start with the OpenClaw integration guide](/guides/openclaw-integration/README) when you want the same contract exposed to OpenClaw-based agents.
- [Use the Native Vector RAG guide](/guides/native-vector-rag) when you want semantic search without external vector infrastructure.
- [See runnable demos](/guides/demos) for example frontends, agent clients, and paid-content flows.
- [Start with the LangGraph MCP starter](/guides/langgraph-mcp-starter) to attach a LangGraph agent without writing a custom SDK.

## Adoption Paths

### Deploy the runtime

Use the local Docker path when you want the fastest trial loop:

```bash
docker compose --profile app up --build
```

That gives you:

- REST API on `http://localhost:4000/api`
- Swagger docs on `http://localhost:4000/documentation`
- MCP endpoint on `http://localhost:4000/mcp`

If `GET /api/deployment-status` reports `domainCount: 0`, bootstrap the first domain before authoring:

```bash
npx tsx src/cli/index.ts domains create \
  --name "Local Development" \
  --hostname local.development
```

### Explore from the CLI

```bash
npx tsx src/cli/index.ts capabilities status
npx tsx src/cli/index.ts mcp call guide_task --json '{"taskId":"discover-deployment"}'
npx tsx src/cli/index.ts domains list
npx tsx src/cli/index.ts mcp inspect --mcp-transport http --api-key writer
npx tsx src/cli/index.ts workspace guide
npx tsx src/cli/index.ts content guide
```

### Explore from LangGraph

```bash
npx tsx demos/langgraph-mcp-starter/index.ts inspect --transport http --mcp-url http://localhost:4000/mcp --api-key writer
```
