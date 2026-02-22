# RFC 0011: Multi-Domain (Tenant) Data Isolation

**Author:** AI Assistant  
**Status:** Proposed  
**Date:** 2026-02-22  

## 1. Summary
This RFC proposes modifying the WordClaw backend ecosystem (database schema, API access layer, and policy rules) to support multi-domain capability. This ensures that a single WordClaw instance can serve and securely isolate data (Content Types, Items, API Keys, Webhooks, and Audit Logs) for multiple distinct internet domains (or tenants/projects). 

## 2. Motivation
Currently, WordClaw operates as a single-tenant CMS. All content models, API keys, and configurations reside in a flat namespace.
To support SaaS models, scaled agency deployments, or unified central supervisor instances, the platform must partition data so that:
* Multiple client websites (domains) can use the same supervisor UI and database without overlapping their data schema.
* Agent API keys can be tightly scoped to only manipulate content within their authorized domain.
* Webhooks are dispatched per domain.
* The API correctly scopes REST, GraphQL, and MCP tool boundaries according to the requesting tenant's domain.

## 3. Proposal
Introduce a `Domain` (or `Tenant`) primitive to the core Drizzle schema.
Subsequent core entities—such as `AgentProfile` (API Keys), `ContentType`, `ContentItem`, `Webhook`, and `AuditEvents`—will be updated to include a mandatory `domainId` foreign key.

When requests route to the backend:
1. The domain context will be extracted from either an explicit API header (e.g., `x-wordclaw-domain`), the GraphQL context, or the API key's intrinsic `domainId` property.
2. The `PolicyEngine` will enforce that the principal is strictly authorized to access the requested domain.
3. Database queries will universally append a `.where(eq(table.domainId, currentDomainId))` filter enforced by a low-level query middleware to prevent tenant-bleed.

## 4. Technical Design (Architecture)

### 4.1 Schema Additions
*   **New Table:** `domains`
    *   `id`: `uuid` (Primary Key)
    *   `hostname`: `varchar` (e.g., `example.com`, `api.client.dev`) (Unique)
    *   `name`: `varchar`
    *   `createdAt` & `updatedAt`

*   **Foreign Key Migrations:**
    *   `content_types.domain_id`
    *   `content_items.domain_id`
    *   `agent_profiles.domain_id`
    *   `webhooks.domain_id`
    *   `audit_events.domain_id`

### 4.2 API and Routing Changes
*   **Context Injection:** The Fastify request lifecycle will inject a `domainId` into the unified `OperationContext` used across REST, GraphQL, and MCP.
*   **API Key Resolution:** When an API key validates, the resolved `AgentProfile.domainId` is used. For human supervisor operations, a domain selector in the UI (`/ui`) must supply the target domain.

### 4.3 Policy Engine Modifications
*   `PolicyEngine` (`src/services/policy.ts`) rules will verify that `context.principal.domainId === context.resource.domainId`.
*   A new admin scope, `tenant:admin`, may be introduced for cross-domain orchestration.

### 4.4 UI Updates
*   The SvelteKit Supervisor UI must include a global "Domain Switcher" dropdown.
*   API fetches in the UI must inject the currently selected domain context.

## 5. Alternatives Considered
*   **Separate Database Instances per Domain:** Cleanest isolation natively, but operationally expensive to manage scaling, migrations, and infrastructure overhead per new domain. Soft logical isolation in a single database is more cost-effective for the target use-case.
*   **Schema-based Multi-Tenancy (PostgreSQL schemas):** Creating a separate Postgres `schema` per domain. Better isolation than row-level checks, but requires dynamic query building and complicates Drizzle schema management and pooling limits. Row-Level Security (RLS) or application-level `domainId` filtering is preferred.

## 6. Security & Privacy Implications
*   **Tenant Bleed:** The most significant risk is a bug in the data access layer omitting the `domainId` filter, returning another domain's content.
*   **Mitigation:** Enforce data access strictly through dedicated repository classes or Drizzle policies (RLS if adopting Postgres-native features) rather than inline route queries.
*   **L402 Separation:** Lighting network nodes and invoice tracking can remain unified, but the mapped `L402Request` records should also store the `domainId` to credit the correct project.

## 7. Rollout Plan / Milestones
*   **Phase 1: Foundation.** Add `domains` table. Add nullable `domain_id` to existing tables. Backfill existing data with a `default` domain.
*   **Phase 2: Enforcement.** Alter `domain_id` to strictly non-null. Update `PolicyEngine` and backend API endpoints to require and scope by domain context.
*   **Phase 3: Supervisor UI.** Add the domain selector to the Svelte application and update all components to route fetches with domain context.
*   **Phase 4: Agent Parity.** Update MCP Tools and GraphQL Schemas to accept and filter by domain filters.
