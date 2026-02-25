# Features

## Content Management

- **Content Types** — Define reusable JSON schemas that content items must conform to. Schemas are validated on creation and enforced on every content write.
- **Content Items** — Versioned content entities with `draft`, `published`, and `archived` status. Every update auto-increments the version and stores an immutable snapshot.
- **Batch Operations** — Create, update, or delete multiple items in a single call. Supports two modes:
  - **Atomic** — All-or-nothing transaction; rolls back on first error.
  - **Partial** — Best-effort; returns per-item success/failure results.
- **Version History** — Browse the full history of any content item.
- **Rollback** — Restore a content item to any previous version. Creates a new version entry so history is never lost.

## Human Supervisor Web Interface

A built-in SvelteKit control plane served under `/ui` providing robust human oversight over agent-driven operations:

- **Dashboard** — System health and activity telemetry at a glance.
- **Audit Log Viewer** — Searchable, paginated history of all agent mutations with raw payload inspection.
- **Content Browser** — Read-only oversight of all content models and items, featuring a 1-click **Rollback** mechanism.
- **Schema Manager** — Visual JSON schema editor with a live dry-run Validation Sandbox for content types.
- **Agent Sandbox** — Interactive API testing environment tailored for exploring WordClaw's structured AI-friendly responses, including `remediation` metadata.
- **Agent Keys** — Provision, rotate, and securely revoke API keys for individual LLM agents.
- **Approval Queue** — Review pending or drafted content payloads and approve (publish) or reject them.
- **UI Safety & Accessibility** — Consistent `Toast` notifications, standardized `ConfirmDialog` gates for destructive actions, responsive `DataTable` data layouts, and WCAG AA compliant focus management.

## Policy Engine & Context Geometry

A centralized authorization layer ensuring that any rule mapping identities to actions applies equally across all interfaces:
- **Protocol Agnostic** — Transforms REST headers, GraphQL context, and MCP tool signatures into one strict `OperationContext` validation geometry.
- **Fail-Closed Mutations** — Non-idempotent write operations instantly rollback and deny access upon encountering internal policy evaluation errors.
- **Simulation** — Agents can dry-run permission checks (`policyEvaluate`) to verify if their current credentials satisfy the required operation scopes before executing mutations.

## Protocol Parity

Every operation is available through three interfaces:

| Protocol  | Transport      | Playground           |
|-----------|----------------|----------------------|
| REST      | HTTP           | Swagger at `/documentation` |
| GraphQL   | HTTP           | GraphiQL at `/graphql`     |
| MCP       | stdio          | Any MCP-compatible client  |

Parity is enforced by an automated [capability matrix test](../src/contracts/capability-parity.test.ts) that fails CI if any protocol falls behind.

## Dry-Run Mode

All write operations support a dry-run flag (`?mode=dry_run` for REST, `dryRun: true` for GraphQL/MCP). The server validates input and simulates execution — including schema validation, conflict detection, and version computation — without persisting any changes.

## Native Vector RAG & Semantic Search

By bringing `pgvector` into the primary PostgreSQL database alongside WordClaw's Policy Engine, we provide an all-in-one Agentic Database layer.
- **Automated Embeddings**: When a content item is published, a background service chunks the JSON payload and generates vector embeddings (e.g. OpenAI `text-embedding-3-small`).
- **Semantic Search**: Agents can query the CMS using natural language and semantic relevance (`GET /api/search/semantic`), completely removing the need to manage parallel LangChain / Pinecone infrastructure.

## Multi-Tenant Data Isolation

WordClaw natively supports secure domain-level data segregation. Resources like API keys, content types, and items belong to explicit domains. All REST, GraphQL, and MCP APIs filter strictly by the `domainId` detected from the authenticated request, guaranteeing non-overlapping data environments.

## Authentication & Authorization

- **Scope-based** — Fine-grained permissions: `content:read`, `content:write`, `audit:read`, `admin`.
- **Dual key sources** — Environment variables for development, database-managed keys for production with expiration, rotation, and revocation.
- **AI-friendly errors** — Auth failures include a `remediation` field telling agents exactly which scope they need.
- **Native Data Ingestion** — AI agents can supply native JSON objects directly to the APIs or fall back to stringified formats.

## Audit Logging

Every mutation is recorded with:

- Action performed (`create`, `update`, `delete`, `rollback`)
- Entity type and ID
- Change payload
- Actor (API key ID)
- Request ID for cross-referencing

Audit logs use cursor-based pagination for efficient traversal.

## Webhooks

- Register callback URLs with event pattern subscriptions (e.g. `content_item.create`, `audit.*`, `*`).
- Payloads are signed with HMAC-SHA256 using a per-webhook secret (`x-wordclaw-signature` header).
- Delivery is non-blocking with automatic retries and exponential backoff.

## Idempotency

Send an `Idempotency-Key` header on any POST/PUT/DELETE. If the same key is seen within the TTL window (default 5 minutes), the server returns the cached response with `x-idempotent-replayed: true` — no duplicate writes occur.

## Agentic Monetization (L402)

WordClaw implements a unified Paid Content Consumption Contract (RFC 0015):
- **Offer / Entitlement Licensing**: Rather than solely pay-per-request gates, users buy logical Entitlements (`active`, `exhausted`, `expired`) attached to a purchase payment hash.
- **Lightning Network (L402)**: Standard HTTP 402 payment gates utilizing Macaroon tokens and preimages verified against provider states.

## Revenue Attribution & Agent Payouts

- **Contribution Tracking** — Log agent interactions (authoring, editing, distributing) against specific content items using weighted roles.
- **Automated Revenue Splits** — When offers are purchased, the system automatically divides the net revenue (gross minus fees) among contributing agents based on predetermined allocation ratios (e.g., 70/10/20).
- **Dispute & Auto-Clear Ledger** — Revenue allocations enter a `pending` state, allowing supervisors time to dispute funds. A background worker automatically advances undisputed funds to `cleared` after a set period (7 days).
- **Lightning Payouts** — Automatically batches cleared funds per agent and executes batched transfers to their registered Lightning Addresses once balances exceed the configured 500-satoshi threshold.

## Rate Limiting

Per-IP request throttling via the Fastify rate-limit plugin. Returns `429 Too Many Requests` with `Retry-After` headers when limits are exceeded.

## Request Tracing

Every response includes an `x-request-id` header. If the client sends one, it is propagated; otherwise the server generates a UUID. The same ID appears in audit logs for end-to-end traceability.
