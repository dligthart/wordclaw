# Features

WordClaw now describes its capabilities in product tiers so the supported runtime is clearly separated from optional modules and incubating ideas.

## Tier 1: Core Product

### Structured Content

- **Content Types** — Define reusable JSON schemas that content items must conform to. Schemas are validated on creation and enforced on every content write.
- **Content Items** — Versioned content entities with `draft`, `published`, and `archived` status. Every update auto-increments the version and stores an immutable snapshot.
- **Batch Operations** — Create, update, or delete multiple items in a single call in atomic or partial mode.
- **Version History and Rollback** — Browse the full history of any content item and restore prior versions without losing auditability.

### Governance and Safety

- **Policy Engine** — A centralized authorization layer that maps identities, operations, and resources into one strict evaluation geometry.
- **Dry-Run Mode** — Supported write paths can be simulated before mutation (`?mode=dry_run` for REST and `dryRun: true` for GraphQL/MCP where implemented).
- **Workflow and Approvals** — Human supervisors can review pending or drafted content and approve or reject critical transitions.
- **Audit Logging** — Mutations record action, entity, actor, and request trace data for inspection and forensics.
- **Idempotency** — Replayed POST/PUT/DELETE requests can return cached responses instead of creating duplicate writes.
- **Multi-Tenant Isolation** — Domains scope content, keys, and workflows to prevent cross-tenant overlap.
- **Request Tracing and Rate Limiting** — Every request carries an `x-request-id`, and per-IP throttling protects the runtime.

### Primary Agent Surfaces

- **REST API** — The main HTTP contract, documented at `/documentation`, with agent-oriented guidance metadata in responses.
- **MCP Server** — The primary agent-native tool surface for MCP-compatible clients.
- **AI-Friendly Errors** — Auth and validation failures include deterministic remediation guidance so agents can recover programmatically.

### Supervisor Control Plane

The built-in SvelteKit UI under `/ui` is positioned as an oversight surface, not a full human-first CMS:

- **Dashboard** — System health and activity telemetry.
- **Audit Log Viewer** — Searchable history of mutations and raw payloads.
- **Content Browser** — Read-only oversight with rollback access.
- **Schema Manager** — Visual schema administration for content models.
- **Approval Queue** — Review and decide pending workflow items.
- **Agent Keys** — Provision, rotate, and revoke API credentials.

## Tier 2: Optional Modules

### Native Vector RAG and Semantic Search

- **Automated Embeddings** — Published content can be chunked and embedded into `pgvector`.
- **Semantic Search** — Agents can query the CMS using natural-language relevance without external vector infrastructure.

### L402 Monetization

- **Offer / Entitlement Licensing** — Offer purchases create entitlements in `pending_payment`, then activate on successful payment verification.
- **Offer-First Read Gating** — If active offers exist for an item, reads require entitlement resolution.
- **Lightning Network (L402)** — Runtime-supported payment rail using HTTP 402 challenges and Macaroon + preimage verification.

## Tier 3: Compatibility and Incubating

### GraphQL Compatibility Surface

- The current runtime still exposes GraphQL.
- Product focus is shifting toward REST and MCP as the primary agent surfaces.
- New product framing should not require GraphQL to lead or define the core concept.

### Experimental / Non-Core Areas

- **AP2** — Documented as an RFC-stage expansion path, not a supported runtime payment rail today.
- **Revenue Attribution and Payouts** — Present in the runtime, but no longer treated as central to the default product story.
- **Autonomous-Run Platformization** — Broader agent-orchestration ambitions remain under active review rather than default scope.
- **Marketplace-Style Demos** — Useful for exploration, but not representative of the core supported WordClaw path.

## Integrations

- **Webhooks** — Register callback URLs with event subscriptions such as `content_item.create`, `audit.*`, or `*`.
- **Signed Delivery** — Payloads are signed with HMAC-SHA256 using a per-webhook secret.
- **Retry Semantics** — Delivery is non-blocking with automatic retries and exponential backoff.
