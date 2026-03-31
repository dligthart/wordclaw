# Current State

Updated: 2026-03-31  
Tracking: `v1.40.0` on `main` (latest changelog entry dated 2026-03-31)

WordClaw's supported product path is now a governed content runtime for AI agents and human supervisors. REST and MCP are the primary surfaces. GraphQL remains available as a compatibility layer, but it no longer defines the product.

## What Ships On `main`

### Deployment Discovery and Operator Preflight

- `GET /api/capabilities` publishes the live contract for transports, modules, auth posture, actor profiles, task recipes, dry-run support, content-runtime queries, asset storage, and reactive MCP support.
- `GET /api/deployment-status` reports current readiness for bootstrap, REST, MCP, supervisor UI, embeddings, asset storage, reactive sessions, and background workers.
- `GET /api/identity`, `GET /api/workspace-context`, and `GET /api/workspace-target` give agents a concrete actor-aware target before they mutate runtime state.
- `POST /api/onboard` can create a tenant domain plus its first admin key in one step when the operator needs bootstrap and credential issuance together.
- CLI and MCP guidance flows such as `guide_task("discover-deployment")`, `workspace guide`, and `content guide` package that discovery into concrete next actions.
- Production startup now fails fast with a combined validation error for missing required env vars, and the deployment docs include both Docker and Fly.io operator paths.

### Governed Content Runtime

- Structured content types support collections and singleton globals.
- Reads support localization, publication-state awareness, preview tokens, and working-copy versus published snapshots.
- The runtime includes field-aware filters, grouped projections, cursor pagination, reverse-reference inspection, and TTL lifecycle archival for session-like models.
- Public write lanes allow bounded end-user or session writes without exposing broad supervisor credentials.
- Reusable forms map public intake flows onto content types, workflow transitions, optional payment gates, and webhook follow-up.
- Background jobs handle webhook delivery, scheduled content transitions, and other deferred domain-scoped work.

### Assets, Delivery, and Protected Access

- Assets are first-class records with schema-aware references.
- Storage works with `local` and S3-compatible providers.
- Upload flows include multipart uploads, direct-provider upload handoffs, and completion tokens.
- Delivery modes include `public`, `signed`, and `entitled`.
- Asset lifecycle controls include delete, restore, purge, and derivative variant inspection.

### Governance, UI, and Supervision

- Workflow approvals, dry-run mutation paths, idempotency, audit logging, and request tracing are part of the core runtime contract.
- The supervisor UI now covers schemas, content inspection, approvals, forms, jobs, assets, payments, audits, and API-key management.
- Supervisor access now supports both platform-scoped and tenant-scoped sessions, with tenant-scoped supervisors pinned to one domain.
- Request-rate limiting is actor-aware, so API credentials and supervisor sessions no longer collide in one shared IP bucket.
- Multi-domain isolation remains the tenant boundary for content, credentials, workflows, and delivery policy.

### Paid Content and Agent Access

- Offer and entitlement flows are built into the runtime for protected content and assets.
- L402 remains part of the supported paid-access path.
- REST and MCP are the required primary operational surfaces.
- Remote MCP subscriptions let long-lived agents react to runtime events instead of polling.

## Rolling Out / Actively Hardening

### Reactive MCP Sessions

- Remote sessions, topic subscriptions, filter-aware recipes, and task-guidance follow-up examples are live on `main`.
- Current work is focused on hardening the reactive contract around the most valuable topics and demos rather than creating a separate event system.

### Native Vector RAG Simplification

- Semantic search and embedding sync are already available.
- The current push is operator ergonomics: easier enablement, clearer readiness reporting, and fewer manual steps when `OPENAI_API_KEY` is configured.

## Experimental / Opt-In Only

- Agent-run and delegation surfaces remain behind `ENABLE_EXPERIMENTAL_AGENT_RUNS`.
- Older monetization and payout expansion work, including AP2-related experiments, remains historical or optional rather than core product scope.
- Marketplace, recommender, and broader platformization ideas remain in RFC history or proposal mode.

## Recent Additions In March 2026

- `v1.40.0` on 2026-03-31: actor-aware rate limits and safer supervisor domain switching.
- `v1.39.0` on 2026-03-31: production provisioning DX improvements and clearer deployment guards.
- `v1.38.0` on 2026-03-31: tenant onboarding flow for domain plus first admin credential bootstrap.
- `v1.37.0` on 2026-03-29: Codex WordClaw skill and Codex-facing integration path.
- `v1.35.0` on 2026-03-17: asset derivative variants.
- `v1.34.0` on 2026-03-16: direct-provider asset upload flows.
- `v1.31.0` on 2026-03-16: TTL-based lifecycle archival.
- `v1.30.0` on 2026-03-16: public write lanes.
- `v1.29.0` on 2026-03-16: capability manifest exposes the content-runtime query contract.
- `v1.12.0` through `v1.10.0` on 2026-03-12 to 2026-03-13: reactive MCP follow-up discovery, task guidance, and subscription recipes.

## Best Pages For Exact Capability Checks

- [Features](../concepts/features.md) for the tiered product definition.
- [Capability Parity](./capability-parity.md) for exact REST, MCP, and GraphQL surface coverage.
- [API Reference](./api-reference.md) for concrete HTTP examples and discovery flow.
- [Roadmap](./roadmap.md) for what is shipped, rolling out, proposed, or explicitly non-core.
- [Fly Deployment](../guides/fly-deployment.md) and [Docker Deployment](../guides/docker-deployment.md) for current production operator paths.
- [MCP Integration](../guides/mcp-integration.md), [Codex Integration](../guides/codex-integration/README.md), and [OpenClaw Integration](../guides/openclaw-integration/README.md) for agent-attachment workflows.

## Runtime Verification Sequence

When you need the live state from a running deployment rather than this repository snapshot, start here:

```bash
curl http://localhost:4000/api/capabilities
curl http://localhost:4000/api/deployment-status
curl -H "x-api-key: writer" http://localhost:4000/api/identity
curl -H "x-api-key: writer" "http://localhost:4000/api/workspace-context?intent=authoring"
curl -H "x-api-key: writer" "http://localhost:4000/api/workspace-target?intent=authoring"
```
