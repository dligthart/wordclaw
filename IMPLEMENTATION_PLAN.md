# WordClaw - AI-Native Content Runtime

## Executive Summary

WordClaw should be positioned as an **AI-native content runtime**, not only a headless CMS.
The goal is to give autonomous agents a deterministic, safe, and monetizable way to read, create, update, and distribute structured content.

## Problem

Most CMS platforms optimize for human editors, while agents require:

- Deterministic machine contracts (predictable success + error structures)
- Actionable next-step guidance for autonomous workflows
- Safe execution modes (dry-run, rollback, audit trail)
- Protocol-native interoperability (MCP + API contracts)
- Built-in policy and payment primitives for autonomous commerce

## Improved Product Concept

### Positioning

WordClaw is the **control plane for agent-driven content operations**.

### Who It Serves

- AI product teams orchestrating autonomous content workflows
- Platform teams exposing safe content operations to internal agents
- Multi-channel publishing teams requiring governance and traceability

### Core Value Proposition

- Faster agent integration: predictable contracts and MCP tools
- Safer autonomy: simulation, policy, rollback, and auditability
- Better economics: usage metering and x402/L402-ready paid operations

## Product Principles

- Determinism first: every route/tool should have stable machine contracts
- Safe by default: writes must support dry-run, traceability, and rollback
- Protocol-native: REST, GraphQL, and MCP must expose equivalent capabilities
- Policy-aware: authn/authz, quotas, approvals, and cost controls are first-class
- Agent UX over human UI: optimize payload shape and decision guidance

## Differentiators

- AI-guided response envelope (`recommendedNextAction`, `availableActions`, priority)
- Unified multi-interface surface (REST + GraphQL + MCP)
- Version history + rollback designed for autonomous edits
- Audit logs optimized for supervision and forensic replay
- Roadmap path to paywalled autonomous operations (x402/L402)

## Scope Definition

### In Scope (MVP+)

- Content type + content item lifecycle
- Deterministic route/tool contracts
- Dry-run, rollback, audit logs
- MCP tool/resource/prompt surface
- Basic operator documentation and verification suite

### Out of Scope (Until Product-Market Validation)

- Full WYSIWYG-focused editorial UI
- Complex multi-tenant enterprise IAM
- Heavy media pipeline/asset transformation
- Marketplace ecosystem

## Conceptual Architecture

### Control Plane

- Schema governance (content types)
- Policy enforcement (auth, quotas, approvals)
- Cost/metering rules

### Data Plane

- Content CRUD
- Versioning and rollback
- Audit logs

### Agent Plane

- REST and GraphQL interfaces
- MCP tools/resources/prompts
- Agent guidance metadata

## Delivery Roadmap (Improved)

### Phase 1: Core Runtime Foundation
**Status: ✅ Implemented**

Objective: reliable data model and CRUD baseline.

Deliverables:

- Type-safe backend runtime and DB integration
- Content types + content items schema
- Baseline REST CRUD

Exit Criteria:

- CRUD passes automated and verification-script checks
- clean migrations and reproducible local setup

### Phase 2: Agent Contract Layer
**Status: ✅ Implemented**

Objective: deterministic machine contracts and safer request handling.

Deliverables:

- Standard response envelope and structured errors
- Dry-run for write operations
- Rate limiting and remediation semantics

Exit Criteria:

- Contract tests for success/error envelopes
- no ambiguous 500s for common client mistakes

### Phase 3: MCP Runtime Surface
**Status: ✅ Implemented**

Objective: first-class tool protocol for agent interoperability.

Deliverables:

- MCP tools for content lifecycle
- MCP resources and prompts for guided workflows
- parity checks between REST and MCP capabilities

Exit Criteria:

- MCP tool list and calls verified by automated scripts
- key operations support dry-run + clear errors

### Phase 4: Operational Safety and Governance
**Status: ✅ Implemented**

Objective: make autonomous edits reversible and auditable.

Deliverables:

- Version history and rollback semantics
- Audit logging for create/update/delete/rollback
- Supervisor-oriented observability endpoints

Exit Criteria:

- rollback success + failure modes covered by tests
- audit events emitted consistently

### Phase 5: Packaging and Adoption Readiness
**Status: ✅ Implemented**

Objective: make onboarding and deployment reproducible.

Deliverables:

- containerized runtime and migration workflow
- clear docs for setup, test modes, and verification scripts
- licensing and contribution hygiene

Exit Criteria:

- fresh-clone setup succeeds without tribal knowledge
- default test workflow stable in CI and local environments

### Phase 6: x402/L402 Payment Protocol & System Hardening
**Status: ✅ Implemented & Deployed**

Objective: enable programmable paid operations for agents.

Deliverables:
- x402/L402 protocol assessment and compatibility design.
- `402 Payment Required` middleware for premium routes (Dynamic pricing via `x-proposed-price`).
- Mock Lightning Provider for testing agent interactions.
- Agent interactive testing sandbox UI available at `/ui/agent-sandbox` to demonstrate and validate machine-actionable remediations.
- Decoupled `verifyPayment` status polling.
- Comprehensive security patches resolving malformed signatures (500 crashes), unauthenticated setup scripts, and decoupled webhook execution times.

**Next Steps (RFC 0003):** 
Integration with a production Lightning Node (LND/LNbits) will transition this from a mock deployment to a live settlement ecosystem. 

## Phase 7: Agent Usability Hardening

Objective: remove friction for autonomous agents operating at scale — batch throughput, reliable retries, real-time event integration, and improved discoverability.

### 7.0 Agent Identity & Authentication
Status: ✅ Implemented

Completed:
- Added DB-backed `api_keys` model + migration (`drizzle/0004_agent_hardening.sql`)
- Reworked auth to validate hashed keys from DB, enforce scope/expiry/revocation, and touch `last_used_at`
- Retained env-key fallback for local/dev flows
- Added admin key-management routes:
  - `POST /api/auth/keys`
  - `GET /api/auth/keys`
  - `DELETE /api/auth/keys/:id`
  - `PUT /api/auth/keys/:id`
- Added MCP key tools:
  - `create_api_key`
  - `list_api_keys`
  - `revoke_api_key`
- Audit writes now pass authenticated key identity when available

### 7.1 Batch Operations
Status: ✅ Implemented

Completed across REST + GraphQL + MCP:
- Create batch:
  - `POST /api/content-items/batch`
  - `createContentItemsBatch`
  - `create_content_items_batch`
- Update batch:
  - `PUT /api/content-items/batch`
  - `updateContentItemsBatch`
  - `update_content_items_batch`
- Delete batch:
  - `DELETE /api/content-items/batch`
  - `deleteContentItemsBatch`
  - `delete_content_items_batch`
- Dry-run and atomic transaction modes implemented
- Partial-success envelopes implemented in non-atomic mode

### 7.2 Pagination on List Endpoints
Status: ✅ Implemented

Completed:
- REST:
  - `GET /api/content-types` supports `limit`, `offset` + meta `{ total, limit, offset, hasMore }`
  - `GET /api/content-items` supports `limit`, `offset` + same meta
  - `GET /api/audit-logs` supports cursor pagination + `{ total, hasMore, nextCursor }`
- GraphQL:
  - `contentTypes(limit, offset)`
  - `contentItems(..., limit, offset)`
  - `auditLogs(..., limit, cursor)`
- MCP:
  - `list_content_types(limit, offset)`
  - `get_content_items(..., limit, offset)`
  - `get_audit_logs(limit, cursor)`

### 7.3 Idempotency Keys
Status: ✅ Implemented

Completed:
- Added `src/middleware/idempotency.ts`
- Accepts `Idempotency-Key` on POST/PUT/DELETE
- Caches first response by `method:path:key` for 5 minutes
- Replays cached response on duplicate request
- Sets `X-Idempotent-Replayed: true` on replay
- Added middleware tests in `src/middleware/__tests__/idempotency.test.ts`

### 7.4 Request ID Tracing
Status: ✅ Implemented

Completed:
- Added request ID generation (`X-Request-ID` passthrough or generated UUID)
- Echoes `X-Request-ID` in all responses
- Error payloads include `context.requestId`
- Audit service accepts and persists requestId context in `details`

### 7.5 Enhanced Health Endpoint
Status: ✅ Implemented

Completed:
- `/health` now executes DB ping (`SELECT 1`)
- Returns:
  - `200` with `{ status: "ok", services: { database: "ok" }, timestamp }`
  - `503` with `{ status: "degraded", services: { database: "down" }, timestamp }`

### 7.6 GraphQL Schema Descriptions
Status: ✅ Implemented

Completed:
- Added SDL descriptions for all major types, fields, queries, mutations, and batch inputs in `src/graphql/schema.ts`

### 7.7 Advanced List Filtering
Status: ✅ Implemented

Completed:
- REST filtering on `GET /api/content-items`:
  - `contentTypeId`, `status`, `createdAfter`, `createdBefore`
- GraphQL filtering on `contentItems(...)` with matching args
- MCP filtering on `get_content_items(...)` with matching args
- Deterministic invalid-date error handling

### 7.8 Webhook / Event Stream Support
Status: ✅ Implemented

Completed:
- Added `webhooks` model + migration
- Added webhook service with HMAC signatures and retries
- Added webhook REST management:
  - `POST /api/webhooks`
  - `GET /api/webhooks`
  - `GET /api/webhooks/:id`
  - `PUT /api/webhooks/:id`
  - `DELETE /api/webhooks/:id`
- Audit events now emit through event bus and deliver to active webhooks
- Added authenticated websocket stream endpoint:
  - `GET /ws/events` (websocket upgrade)
- Signature header on webhook delivery:
  - `x-wordclaw-signature`

---

## Phase 8: Human Supervisor Web Interface
**Status: ✅ Implemented**

Objective: give human operators a purpose-built interface for oversight, governance, and intervention — distinct from a content editor. Agents do the work; supervisors observe, approve, and intervene.

**Current state**: No frontend exists. Human-facing surfaces are GraphiQL (`/graphql`) and Swagger UI (`/documentation`) — developer tools, not operator tools.

**Scope**: This is a *supervisor control plane*, not a WYSIWYG content editor. Priority is observability, governance, and safety controls.

**Tech stack recommendation**: SvelteKit (lightweight, SSR, TypeScript-native) served on a separate port or as a static build served by Fastify from `/ui`. Consumes the existing REST API exclusively — no direct DB access.

---

### 8.1 Dashboard (Home)

Single-screen overview for an operator arriving after agent activity:

- **System health strip**: API status, DB connectivity, rate limit headroom
- **Activity summary**: operations in last 24h (creates/updates/deletes/rollbacks), grouped by agent key
- **Recent audit events**: live-updating feed of the last 20 events with entity type, action, agent, and timestamp
- **Alert indicators**: flagged events (rollbacks, auth failures, rate limit hits, schema validation failures)

---

### 8.2 Audit Log Viewer

Full audit trail with supervisor-grade filtering and inspection:

- Paginated table: timestamp, action, entity type, entity ID, agent key, details
- Filter bar: by action type, entity type, agent key, date range
- Expandable row: full `details` JSON, linked entity (click to view content item/type)
- Export to CSV/JSON for compliance reporting
- Real-time tail mode (WebSocket stream once 7.8 is implemented)

---

### 8.3 Agent Key Management

Depends on Phase 7.0 (agent identity & DB-backed keys):

- Table: key name, prefix, scopes, created, last used, status (active/revoked/expired)
- **Create key**: form with name, scope checkboxes, optional expiry — displays full key once
- **Revoke key**: single-click with confirmation modal, immediate effect
- **Rotate key**: atomic revoke + replace, displays new key once
- Activity sparkline per key (operations over last 7 days)

---

### 8.4 Content Browser

Read-only inspection surface for supervisor review (not a content editor):

- Content type list: name, slug, item count, last modified
- Content type detail: rendered JSON Schema, list of items
- Content item list: paginated, filterable by status and date
- Content item detail: rendered data fields, version history timeline, rollback button (with confirmation)
- Diff view between versions: side-by-side or unified diff of JSON data

---

### 8.5 Approval Queue

Depends on approval workflow hooks (Strategic Next Step in existing plan):

- List of pending operations flagged for human review before execution
- Each entry: requesting agent, operation type, target entity, proposed payload, dry-run preview
- Supervisor actions: **Approve** (executes operation), **Reject** (returns deterministic error to agent), **Edit & Approve** (modify payload before execution)
- Audit event emitted on approve/reject with supervisor identity

---

### 8.6 Schema Manager

Visual interface for content type schema governance:

- List and create content types with guided JSON Schema builder
- Schema field editor: add/remove/edit fields with type, required, description
- Live validation preview: paste sample data, see validation result immediately
- Schema change impact: show how an update would affect existing items (dry-run)

---

### 8.7 Supervisor Authentication

Separate auth from agent API keys:

- Session-based login (username + password) stored in DB — not API key
- `supervisors` table: `id`, `email`, `password_hash`, `created_at`, `last_login_at`
- JWT session tokens with configurable expiry
- All supervisor actions attributed in audit log with `supervisorId` (distinct from `userId`/agent key)
- Optional: TOTP/2FA for high-risk operations (rollback, key revocation)

---

### Delivery Notes

- Phase 8 depends on Phase 7.0 (agent keys) for the key management views
- Phase 8.5 (approval queue) depends on the approval workflow hooks noted in Strategic Next Step
- Phases 8.1–8.4 can be built independently against the existing REST API
- UI must itself authenticate via an admin-scoped API key or the supervisor session — no unauthenticated access
- All supervisor actions must produce audit log entries (attribution, not just agent ops)

---

## Quality and Reliability Strategy

- Contract tests for critical route behavior and error mapping
- Integration smoke tests gated for live-stack environments
- Verification scripts for dry-run, versioning, MCP, and audit behavior
- Build must remain green before merging roadmap increments

## Success Metrics

### Product Metrics

- Time-to-first-agent-operation from fresh clone
- Percentage of agent requests resolved without human intervention
- Failure-to-remediation ratio for non-2xx responses

### Engineering Metrics

- Contract test pass rate
- Migration reproducibility on clean databases
- MCP/REST capability parity coverage

### Business Metrics (Phase 6+)

- Paid-operation conversion rate
- Revenue per automated workflow
- Payment-failure recovery rate

## Key Risks and Mitigations

- Contract drift between REST, GraphQL, and MCP:
  mitigate with parity test matrix and release gates.
- Schema/migration drift:
  mitigate with migration checks on fresh DB in CI.
- Unsafe autonomous writes:
  mitigate with dry-run defaults, approvals, rollback, and audit trails.
- Payment protocol complexity:
  mitigate via provider abstraction and phased x402 rollout.

## Strategic Next Step

Build a **policy and approvals layer** on top of the parity baseline:

- Route/tool-level policy contracts (who/what/when) with deterministic denial reasons
- Approval workflow for high-risk write operations
- Quota and cost-governor hooks to prepare paid/limited autonomous execution

## Current Roadmap & Feature Proposals (RFCs)

As of **February 2026**, the core WordClaw runtime and Phase 6 safety metrics are complete and stable. All future feature additions and structural API changes are managed via the **RFC Methodology**. 

Active Proposals (`doc/rfc/`):
1. **RFC 0001:** Blog Valuation & Third-Party Metrics Integration (Ahrefs/Stripe).
2. **RFC 0002:** Agent Usability & API Improvements (Native JSON, nested routes, custom AI-friendly schema error wrappers).
3. **RFC 0003:** Production Lightning Network Settlement Plan.

To propose a new feature, duplicate `doc/rfc/0000-rfc-template.md` and submit it for discussion.
