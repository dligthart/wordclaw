# Features

WordClaw now describes its capabilities in product tiers so the supported runtime is clearly separated from incubating ideas.

## Tier 1: Core Product

### Structured Content

- **Content Types** — Define reusable JSON schemas that content items must conform to. Schemas are validated on creation and enforced on every content write. Content types can now be `collection` or `singleton`, which makes globals first-class instead of a convention layered on top of normal collections.
- **Content Items** — Versioned content entities with workflow-aware statuses, a current working copy row, and a derived publication state of `draft`, `published`, or `changed`. Every update auto-increments the version and stores an immutable snapshot.
- **Localization and Globals** — Schemas can declare `x-wordclaw-localization`, fields can opt into `x-wordclaw-localized`, and all core read surfaces can resolve locale plus fallback across both collections and singleton globals.
- **Content Runtime Queries** — Schema-aware field filters, scalar field sorting, grouped projections, cursor pagination, and `draft=false` published-snapshot reads let agents build targeted list and leaderboard-style reads without shipping a separate query layer.
- **Reverse References** — Content items and assets expose usage graphs derived from current rows plus historical versions, so operators can inspect impact before deleting, purging, or restructuring linked records.
- **Preview Tokens** — Short-lived, domain-scoped preview tokens expose one content item or global through dedicated preview paths without turning draft access into a general-purpose bypass.
- **Schema Manifests** — Optional editor-oriented manifests compile into canonical JSON Schema so supervisors can model fields, arrays, groups, references, and constrained block sets without hand-authoring raw schemas for every routine change.
- **Guided Schema Bootstrap** — `content guide` and `guide_task("author-content")` can now return starter schema-manifest patterns for `memory`, `task-log`, and `checkpoint` models before a content type exists, along with semantic-indexing notes for retrieval-friendly field design.
- **Generated Client Artifacts** — The CLI can generate runtime helpers, TypeScript types, Zod validators, and a small client wrapper from live content schemas plus capability metadata.
- **Public Write Lanes and Lifecycle Policies** — Schemas can explicitly allow bounded public writes and TTL-based lifecycle archival for ephemeral session-like content.
- **Reusable Forms** — First-class form definitions map bounded public intake flows onto content types, optional workflow transitions, optional L402 payment enforcement, and job-backed webhook follow-ups.
- **Media Assets** — Domain-scoped asset records with schema-aware references, multipart upload, `local` or S3-compatible storage backends, `public`/`signed`/`entitled` delivery modes, and restore/purge lifecycle controls.
- **Batch Operations** — Create, update, or delete multiple items in a single call in atomic or partial mode.
- **Version History and Rollback** — Browse the full history of any content item and restore prior versions without losing auditability.
- **Background Jobs** — Queue outbound webhook delivery, scheduled content-state transitions, and future deferred work through one domain-scoped jobs subsystem with retries and worker health visibility.

### Governance and Safety

- **Policy Engine** — A centralized authorization layer that maps identities, operations, and resources into one strict evaluation geometry.
- **Dry-Run Mode** — Supported write paths can be simulated before mutation (`?mode=dry_run` for REST and `dryRun: true` for GraphQL/MCP where implemented).
- **Workflow and Approvals** — Human supervisors can review pending or drafted content and approve or reject critical transitions.
- **Audit Logging** — Mutations record action, entity, actor, and request trace data for inspection and forensics.
- **Idempotency** — Replayed POST/PUT/DELETE requests can return cached responses instead of creating duplicate writes.
- **Multi-Tenant Isolation** — Domains scope content, keys, and workflows to prevent cross-tenant overlap.
- **Request Tracing and Rate Limiting** — Every request carries an `x-request-id`, and actor-aware rate limiting protects the runtime with separate buckets for API keys, supervisor sessions, and IP fallback traffic.

### Payments and Entitlements

- **Offer / Entitlement Licensing** — Offer purchases create entitlements in `pending_payment`, then activate on successful payment verification.
- **Offer-First Read Gating** — If active offers exist for an item, reads require entitlement resolution before content is returned.
- **Lightning Network (L402)** — The core runtime supports HTTP `402 Payment Required` challenges with Macaroon and preimage verification.
- **Supervisor Payment Operations** — The default control plane includes payment diagnostics and L402 readiness tracking for operators.

### Primary Agent Surfaces

- **REST API** — The main HTTP contract, documented at `/documentation`, with agent-oriented guidance metadata in responses.
- **MCP Server** — The primary agent-native tool surface for MCP-compatible clients, including remote Streamable HTTP sessions and reactive runtime subscriptions.
- **AI-Friendly Errors** — Auth and validation failures include deterministic remediation guidance so agents can recover programmatically.

### Supervisor Control Plane

The built-in SvelteKit UI under `/ui` is positioned as an oversight surface, not a full human-first CMS:

- **Dashboard** — System health and activity telemetry.
- **Agent Provisioning** — Configure tenant AI providers and workforce agents through a dedicated operator workspace instead of mixing those controls into API-key management.
- **Audit Log Viewer** — Searchable history of mutations and raw payloads.
- **Content Browser** — Oversight for globals and collections with publication-state visibility, localized reads, rollback access, and scoped preview actions.
- **Schema Manager** — Visual schema administration for content models.
- **Forms Workspace** — Configure reusable public forms, inspect their sanitized public contract, and send test submissions through the same REST path external clients use.
- **Jobs Workspace** — Inspect worker health, browse queued/running/completed jobs, enqueue generic background work, and schedule content status changes without dropping to the CLI.
- **Approval Queue** — Review and decide pending workflow items.
- **API Keys and Tenant Bootstrap** — Provision, rotate, and revoke API credentials for agents and operator integrations, onboard a tenant by creating its domain plus first admin key in one step, and hand off platform- or tenant-scoped supervisor access for that tenant.
- **Asset Library** — Upload assets, inspect delivery policy, preview image content, and manage delete/restore/purge lifecycle without dropping to the CLI.

Current hardening work is focused on reducing duplicate route-local UI code, standardizing shared page patterns, and increasing UI test coverage for core operator flows.

## Tier 2: Optional Modules

### Native Vector RAG and Semantic Search

WordClaw natively supports Retrieval-Augmented Generation (RAG) by embedding content directly into Postgres. For a detailed walkthrough of how this works and how agents can utilize it, read the [Native Vector RAG Guide](../guides/native-vector-rag.md).

- **Auto-Enabled** — Simply provide an `OPENAI_API_KEY` in your `.env` to automatically enable vector capabilities.
- **Automated Embeddings** — Published content can be chunked and embedded into `pgvector`.
- **Semantic Search** — Agents can query the CMS using natural-language relevance without external vector infrastructure.

## Tier 3: Compatibility and Incubating

### GraphQL Compatibility Surface

- The current runtime still exposes GraphQL.
- Product focus is shifting toward REST and MCP as the primary agent surfaces.
- New product framing should not require GraphQL to lead or define the core concept.

### Experimental / Non-Core Areas

- **Historical Payment-Rail Experiments** — AP2 and related agent-payment expansion work remain documented in RFC history, not as part of the supported runtime path.
- **Revenue Attribution and Payouts** — Runtime artifacts remain available, but the accounting and payout narrative is quarantined to non-core RFC history rather than the default product roadmap.
- **Marketplace and Buyer-Side Platformization** — Marketplace demos, buyer-facing catalog expansion, and broader distribution suites remain reference material, not the core supported WordClaw path.
- **Autonomous-Run Platformization** — Broader agent-orchestration ambitions remain under active review rather than default scope, and the runtime surfaces stay behind `ENABLE_EXPERIMENTAL_AGENT_RUNS`.

## Integrations

- **Webhooks** — Register callback URLs with event subscriptions such as `content_item.create`, `audit.*`, or `*`.
- **Signed Delivery** — Payloads are signed with HMAC-SHA256 using a per-webhook secret.
- **Retry Semantics** — Delivery is non-blocking with automatic retries and exponential backoff.
