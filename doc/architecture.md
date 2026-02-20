# Architecture Overview

WordClaw is an AI-first headless CMS that exposes identical capabilities over three protocols — REST, GraphQL, and MCP (Model Context Protocol) — so both human operators and AI agents can manage content through a single runtime.

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENTS                                    │
│                                                                     │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐                   │
│   │  Browser  │     │  Agent   │     │   CLI    │                   │
│   │  / cURL   │     │  (LLM)   │     │  Tools   │                   │
│   └────┬──────┘     └────┬─────┘     └────┬─────┘                   │
│        │ HTTP            │ HTTP/stdio      │ HTTP                    │
└────────┼────────────────┼────────────────┼──────────────────────────┘
         │                │                │
┌────────▼────────────────▼────────────────▼──────────────────────────┐
│                        WORDCLAW SERVER                              │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                     MIDDLEWARE CHAIN                            │ │
│  │                                                                │ │
│  │  Request ID ─► Rate Limit ─► Idempotency ─► Auth ─► L402      │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                              │                                      │
│         ┌────────────────────┼────────────────────┐                 │
│         ▼                    ▼                    ▼                  │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────┐           │
│  │  REST API   │    │ GraphQL API  │    │  MCP Server  │           │
│  │  (Fastify)  │    │ (Mercurius)  │    │   (stdio)    │           │
│  │             │    │              │    │              │            │
│  │ /api/*      │    │ /graphql     │    │ Tools        │            │
│  │ OpenAPI/    │    │ GraphiQL     │    │ Resources    │            │
│  │ Swagger     │    │ Playground   │    │ Prompts      │            │
│  └──────┬──────┘    └──────┬───────┘    └──────┬───────┘           │
│         │                  │                   │                    │
│         └──────────────────┼───────────────────┘                    │
│                            ▼                                        │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                     SERVICES LAYER                             │ │
│  │                                                                │ │
│  │  Content Types ─── Content Items ─── Content Schema Validation │ │
│  │  API Keys ──────── Audit Logging ─── Webhook Delivery          │ │
│  │  Event Bus ──────── Payment Provider                           │ │
│  └────────────────────────────┬───────────────────────────────────┘ │
│                               ▼                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                     DATA LAYER (Drizzle ORM)                   │ │
│  │                                                                │ │
│  │  content_types ── content_items ── content_item_versions       │ │
│  │  audit_logs ───── api_keys ─────── webhooks ─── users          │ │
│  └────────────────────────────┬───────────────────────────────────┘ │
│                               │                                     │
└───────────────────────────────┼─────────────────────────────────────┘
                                ▼
                     ┌────────────────────┐
                     │   PostgreSQL 16    │
                     │   (Docker)         │
                     └────────────────────┘
```

## Layer Responsibilities

### Middleware Chain

Every incoming HTTP request passes through a shared middleware pipeline before reaching any API handler:

| Middleware       | Purpose                                                    |
|------------------|------------------------------------------------------------|
| **Request ID**   | Assigns or propagates `x-request-id` for traceability      |
| **Rate Limit**   | Fastify rate-limit plugin, per-IP throttling                |
| **Idempotency**  | Caches POST/PUT/DELETE responses keyed by `Idempotency-Key` |
| **Auth**         | Validates `x-api-key` or `Authorization: Bearer` headers   |
| **L402**         | Optional micropayment gate using Lightning invoices         |

### API Layer

Three protocol interfaces expose the same set of operations:

- **REST** — RESTful routes under `/api/*` with OpenAPI documentation at `/documentation`.
- **GraphQL** — Full query and mutation schema at `/graphql` with GraphiQL playground.
- **MCP** — Model Context Protocol over stdio; exposes tools, resources, and prompts for LLM agents.

Feature parity across the three is enforced by an automated [capability parity contract](../src/contracts/capability-parity.test.ts) that runs in CI.

### Services Layer

Business logic lives in isolated service modules. No API handler accesses the database directly — all operations route through services that own validation, versioning, audit emission, and webhook delivery.

### Data Layer

Drizzle ORM maps TypeScript types to PostgreSQL tables. Migrations live in `drizzle/` and are generated with `drizzle-kit`.

## Data Model

```
content_types 1───* content_items 1───* content_item_versions
                          │
                          │ (audit trail)
                          ▼
                     audit_logs
                          ▲
                          │ (event matching)
                     webhooks

users 1───* api_keys
```

Key relationships:

- A **content type** defines a JSON schema; many **content items** reference it.
- Every update to a content item creates an immutable **version** snapshot.
- All mutations emit **audit logs**; matching **webhooks** receive HMAC-signed delivery.
- **API keys** carry scopes (`content:read`, `content:write`, `audit:read`, `admin`).

## Request Lifecycle

```
Client Request
     │
     ▼
  Assign x-request-id
     │
     ▼
  Rate limit check ──── 429 Too Many Requests
     │
     ▼
  Idempotency lookup ── Return cached response (if duplicate key)
     │
     ▼
  Authenticate ───────── 401 / 403 (if required)
     │
     ▼
  Route handler (REST / GraphQL / MCP)
     │
     ▼
  Service layer (validate → execute → version)
     │
     ├──► Audit log written
     ├──► Event bus emitted
     └──► Webhook delivery queued (non-blocking, retries)
     │
     ▼
  Cache response for idempotency
     │
     ▼
  Return response with x-request-id
```

## Technology Stack

| Component      | Technology               |
|----------------|--------------------------|
| Runtime        | Node.js 20+              |
| Language       | TypeScript (strict)      |
| HTTP framework | Fastify 5.x              |
| GraphQL        | Mercurius 16.x           |
| MCP            | @modelcontextprotocol/sdk |
| ORM            | Drizzle 0.45             |
| Database       | PostgreSQL 16            |
| Validation     | Zod + TypeBox            |
| Testing        | Vitest                   |
| Containers     | Docker Compose           |
