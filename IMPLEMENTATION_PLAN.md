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

Objective: reliable data model and CRUD baseline.

Deliverables:

- Type-safe backend runtime and DB integration
- Content types + content items schema
- Baseline REST CRUD

Exit Criteria:

- CRUD passes automated and verification-script checks
- clean migrations and reproducible local setup

### Phase 2: Agent Contract Layer

Objective: deterministic machine contracts and safer request handling.

Deliverables:

- Standard response envelope and structured errors
- Dry-run for write operations
- Rate limiting and remediation semantics

Exit Criteria:

- Contract tests for success/error envelopes
- no ambiguous 500s for common client mistakes

### Phase 3: MCP Runtime Surface

Objective: first-class tool protocol for agent interoperability.

Deliverables:

- MCP tools for content lifecycle
- MCP resources and prompts for guided workflows
- parity checks between REST and MCP capabilities

Exit Criteria:

- MCP tool list and calls verified by automated scripts
- key operations support dry-run + clear errors

### Phase 4: Operational Safety and Governance

Objective: make autonomous edits reversible and auditable.

Deliverables:

- Version history and rollback semantics
- Audit logging for create/update/delete/rollback
- Supervisor-oriented observability endpoints

Exit Criteria:

- rollback success + failure modes covered by tests
- audit events emitted consistently

### Phase 5: Packaging and Adoption Readiness

Objective: make onboarding and deployment reproducible.

Deliverables:

- containerized runtime and migration workflow
- clear docs for setup, test modes, and verification scripts
- licensing and contribution hygiene

Exit Criteria:

- fresh-clone setup succeeds without tribal knowledge
- default test workflow stable in CI and local environments

### Phase 6: x402/L402 Payment Protocol

Objective: enable programmable paid operations for agents.

Deliverables:

- x402/L402 protocol assessment and compatibility design
- `402 Payment Required` middleware for premium routes
- compliant payment provider integration for settlement + receipts

Exit Criteria:

- protected endpoints enforce payment flow deterministically
- payment-failure states return machine-actionable remediation

#### Detailed Implementation Plan for Phase 6

**1. Research & Architecture Design**
- The L402 protocol combines HTTP 402 Payment Required with Macaroons (bearer tokens) and Lightning Network invoices.
- **Flow:**
  1. Agent requests a protected API route.
  2. Server responds with `402 Payment Required`, returning a Macaroon and a Lightning Invoice in the `WWW-Authenticate` header.
  3. Agent pays the invoice via the Lightning Network.
  4. Agent obtains the payment preimage.
  5. Agent replays the request with the Macaroon and preimage in the `Authorization: L402 <macaroon>:<preimage>` header.
  6. Server verifies the Macaroon and preimage, then serves the request.

**2. Middleware Implementation (Fastify)**
- Create an `l402Middleware` for Fastify.
- **Dependencies:** `macaroon` library for token generation and verification.
- **Logic:**
  - Check for the `Authorization: L402 ...` header.
  - If missing or invalid, generate a Macaroon (tied to the request/resource) and fetch a Lightning invoice from the payment provider.
  - Return `402 Payment Required` with `WWW-Authenticate: L402 macaroon="...", invoice="..."`.
  - If present, parse the Macaroon and preimage, verify the Macaroon signature and the preimage against the invoice hash (or query the payment provider to confirm settlement).
  - If valid, allow the request to proceed.

**3. Payment Provider Integration**
- Integrate with a Lightning infrastructure provider (e.g., LND, Alby, Lightspark, or Strike API) to generate invoices and check payment status.
- Abstract the provider behind a `PaymentProvider` interface to allow swapping backends.
- **Interface methods:** `createInvoice(amount, memo) -> { invoice, hash }`, `verifyPayment(hash, preimage) -> boolean`.

**4. Testing & Verification**
- Write unit tests for the `l402Middleware` simulating the 402 challenge-response flow.
- Write integration tests using a mock payment provider.
- Update agent SDK/documentation to demonstrate how an agent should handle the 402 response, pay the invoice, and retry the request.

## Phase 8: Human Supervisor Web Interface

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

## Phase 7: Agent Usability Hardening

Objective: remove friction for autonomous agents operating at scale — batch throughput, reliable retries, real-time event integration, and improved discoverability.

### 7.0 Agent Identity & Authentication (High Priority — Prerequisite)

**Problem**: Authentication is static environment-variable-only (`API_KEYS=key=scope|scope`). There is no database-backed agent identity, no runtime key management, and `audit_logs.userId` is always `null` — meaning no operation is traceable to a specific agent. All downstream governance, quota, and billing features (Phases 6–7) are blocked without a real identity layer.

**Current state**:
- `src/api/auth.ts`: parses keys from `process.env.API_KEYS` at request time — no DB involvement
- `src/db/schema.ts`: has a `users` table but no `api_keys` table; `audit_logs.userId` is nullable and never populated
- Principal `keyId` is truncated to 6 chars (`key.slice(0, 6) + '...'`) — not a stable identity

**Deliverables**:

**Schema** — new `api_keys` table:
```sql
api_keys (
  id          serial PRIMARY KEY,
  name        text NOT NULL,               -- human label e.g. "picoclaw-prod"
  key_prefix  text NOT NULL,               -- first 8 chars, shown in UI
  key_hash    text NOT NULL UNIQUE,        -- bcrypt/sha256 hash of full key
  scopes      text NOT NULL,               -- pipe-separated scope list
  created_by  integer REFERENCES users(id),
  created_at  timestamp DEFAULT now(),
  expires_at  timestamp,                   -- null = no expiry
  revoked_at  timestamp,                   -- null = active
  last_used_at timestamp
)
```

**API endpoints** (scoped to `admin`):
- `POST /api/auth/keys` — create key, returns full key once (never stored plain)
- `GET /api/auth/keys` — list keys with prefix, scopes, created_at, last_used_at, status
- `DELETE /api/auth/keys/:id` — revoke key (sets `revoked_at`, key rejected immediately)
- `PUT /api/auth/keys/:id` — rotate key (revoke + issue replacement atomically)

**Auth middleware update**:
- Validate key against DB (`key_hash`) instead of env var
- Reject if `revoked_at` is set or `expires_at` is past
- Update `last_used_at` on every successful auth
- Return stable `keyId` (DB `id`) — not truncated key prefix

**Audit log wiring**:
- Populate `audit_logs.userId` with the authenticated `api_keys.id` on every write operation
- All audit events become traceable to a specific agent key

**MCP + GraphQL parity**:
- Expose key management as MCP tools: `create_api_key`, `list_api_keys`, `revoke_api_key`
- Add to capability matrix

Exit Criteria:
- Key creation, listing, revocation all functional via REST + MCP
- `audit_logs.userId` populated on all authenticated write operations
- Revoked keys rejected within one request (no caching window)
- Expired keys rejected at middleware level
- Env-var fallback (`API_KEYS`) retained for local dev with `AUTH_REQUIRED=false`
- Migration included for `api_keys` table

### 7.1 Batch Operations (High Priority)

**Problem**: Agents must issue one HTTP round-trip per item. At volume this saturates the rate limiter (100 req/min) and accumulates latency.

Deliverables:
- `POST /content-items/batch` — array payload, per-item success/failure envelope
- `PUT /content-items/batch` — array of `{ id, updates }`, partial-success semantics
- `DELETE /content-items/batch` — array of IDs
- Dry-run support on all batch endpoints (`?mode=dry_run`)
- Transactional option: `"atomic": true` flag rolls back all on any failure

Exit Criteria:
- Batch endpoints covered by parity matrix (REST + GraphQL + MCP)
- Per-item error reporting with same error envelope as single-item operations
- Dry-run batch returns projected results without writes

### 7.2 Pagination on List Endpoints (High Priority)

**Problem**: `GET /content-items` and `GET /content-types` return full result sets with no limit/offset. Agents parsing large datasets face memory and parsing overhead.

Deliverables:
- Add `limit` and `offset` query params to all list endpoints
- Cursor-based pagination on `GET /audit-logs` (append-only, cursor is stable)
- Response metadata: `{ total, offset, limit, hasMore, nextCursor }`
- Document default limit (50) and maximum limit (500)

Exit Criteria:
- All list endpoints paginate consistently
- GraphQL equivalents updated with `limit`/`offset`/`cursor` args
- MCP tools updated to expose pagination params

### 7.3 Idempotency Keys (Medium Priority)

**Problem**: Network failures on create/update force agents to retry blind. Without idempotency, retries produce duplicate content items and duplicate audit events.

Deliverables:
- Accept optional `Idempotency-Key: <uuid>` header on all POST/PUT/DELETE
- Cache successful response keyed by method + path + idempotency key for 5 minutes
- Return `409 Conflict` with cached result on duplicate key within window
- Error code `IDEMPOTENCY_KEY_CONFLICT` with remediation text

Exit Criteria:
- Idempotency tested: duplicate request with same key returns identical response
- Duplicate request without key creates duplicate (expected behaviour documented)

### 7.4 Request ID Tracing (Medium Priority)

**Problem**: Agents issue concurrent requests. Without correlation IDs, log debugging across parallel operations is infeasible.

Deliverables:
- Fastify middleware: generate `X-Request-ID` (UUIDv4) if not supplied by caller
- Echo `X-Request-ID` in response headers
- Include `requestId` in all error `context` objects
- Include `requestId` in audit log entries

Exit Criteria:
- Every request has a traceable ID end-to-end in logs and response headers
- Error responses include `requestId` in context field

### 7.5 Enhanced Health Endpoint (Medium Priority)

**Problem**: `GET /health` returns `{ status: 'ok' }` without checking database connectivity. Agents cannot distinguish server-up from service-ready.

Deliverables:
- Extend `/health` to perform a lightweight DB ping
- Response:
  ```json
  {
    "status": "healthy|degraded|unhealthy",
    "services": { "database": "healthy|unhealthy" },
    "timestamp": "<ISO8601>"
  }
  ```
- Return `503` if any dependency is unhealthy

Exit Criteria:
- Health endpoint correctly reports degraded state when DB is unavailable
- Agents can gate workflows on readiness check

### 7.6 GraphQL Schema Descriptions (Medium Priority)

**Problem**: GraphQL queries and mutations lack descriptions. Agent LLMs cannot reliably discover intent or constraints from schema introspection alone.

Deliverables:
- Add `description` strings to all Query fields, Mutation fields, and input types
- Document required vs optional fields, enum values, and side effects
- Add usage examples to MCP tool descriptions

Exit Criteria:
- GraphQL introspection returns descriptions for all operations
- MCP tool list includes full parameter descriptions with examples

### 7.7 Advanced List Filtering (Medium Priority)

**Problem**: `GET /content-items` supports only `contentTypeId` filter. Agents cannot efficiently find items by status, date range, or content field values.

Deliverables:
- Add filter query params: `?status=draft&createdAfter=ISO8601&createdBefore=ISO8601`
- Add to GraphQL and MCP for parity
- Document filter combinations and precedence

Exit Criteria:
- Filters covered by parity matrix
- Invalid filter params return deterministic error code `INVALID_FILTER_PARAM`

### 7.8 Webhook / Event Stream Support (Lower Priority)

**Problem**: Agents must poll audit logs to detect changes. No push mechanism exists for event-driven multi-agent orchestration.

Deliverables:
- `POST /webhooks` — register callback URL with event type filters (`create`, `update`, `delete`, `rollback`)
- `GET /webhooks` — list registered webhooks
- `DELETE /webhooks/:id` — deregister
- Server sends signed POST to registered URL on matching events
- WebSocket endpoint `WS /events` for real-time audit stream (authenticated)

Exit Criteria:
- Webhook delivery verified with test endpoint
- Failed deliveries retried with exponential backoff (max 3 attempts)
- `X-Wordclaw-Signature` header for payload verification

---

## Immediate Improvements Recommended

Based on recent repository reviews, the following improvements should be integrated into the roadmap:

1. **Database Migration Consistency:** Ensure all development schema changes are consistently captured in migration journals to prevent drift between the runtime schema and deployment environments.
2. **Robust Validation:** Strengthen input validation across all endpoints (e.g., preventing empty bodies on PUT requests) to avoid unhandled server errors and provide clear, actionable feedback to agents.
3. **Comprehensive Coverage:** Increase the parity between the GraphQL and REST interfaces, ensuring features like dry-run and detailed error envelopes are universally available.
4. **Automated Auditing:** Expand the verification scripts to continuously monitor the health of audit logs and versioning mechanisms during CI.
