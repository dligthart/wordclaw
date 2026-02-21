# RFC 0009: Content Discovery and Consumption API

**Author:** AI Assistant  
**Status:** Proposed  
**Date:** 2026-02-21  

## 1. Summary
This RFC proposes a buyer-facing discovery and catalog consumption layer with searchable collections and subscription feeds so agents can reliably find, retrieve, and consume monetized content.

## 2. Dependencies & Graph
*   **Depends on:** RFC 0004 (Entitlements) — Access-aware retrieval resolving entitlement status.
*   **Depends on:** Phase 4 (Versioning) — Catalog entries are locked to specific published ContentItem versions.
*   **Depended on by:** RFC 0005 (Distribution) — Target plans can trigger dynamically against rule-based collections.
*   **Integrated with:** RFC 0001 (Valuation) — Catalog entries surface valuation metadata for external acquisition agents.

## 3. Motivation
WordClaw provides strong content creation and management primitives, but buyer-side consumption capabilities are still minimal (basic list/filter by type/status/date). Agentic distribution requires:
* discovery of what exists and what is purchasable,
* stable retrieval/query APIs for downstream agents,
* change feeds/subscriptions for incremental ingestion,
* pricing/entitlement metadata attached to discoverable assets.

Without this, distribution remains producer-centric and hard to automate for consumers.

## 4. Proposal
Introduce a structured discovery domain:
1. **Catalogs**: Searchable indexes of content assets and offers.
2. **Collections**: Curated or rule-based groupings with stable IDs.
3. **Consumption Feeds**: Cursor-based incremental streams and subscription hooks.
4. **Access-aware Retrieval**: Responses include entitlement requirements and remediation.

## 5. Technical Design (Architecture)

### 5.1 Data Model Additions
* `catalog_entries`
  * `id`, `contentItemId`, `contentVersion`, `title`, `summary`, `tags`, `language`, `publishedAt`, `visibility`, `searchVector`
* `collections`
  * `id`, `slug`, `name`, `description`, `queryJson`, `active`
* `collection_entries`
  * `id`, `collectionId`, `catalogEntryId`, `rank`
* `subscriptions`
  * `id`, `agentProfileId`, `collectionId`, `cursor`, `deliveryMode`, `active`, `createdAt`

### 5.2 API / Protocol
* REST
  * `GET /api/catalog/search?q=&tags=&limit=[1-100]`
  * `GET /api/collections/:slug`
  * `POST /api/subscriptions`
  * `GET /api/subscriptions/:id/changes`
* GraphQL
  * `catalogSearch`, `collection`, `createSubscription`, `subscriptionChanges`
* MCP
  * `search_catalog`, `get_collection`, `create_subscription`, `get_subscription_changes`

### 5.3 Behavior & Query Specification
* `GET /api/catalog/search` handles Full-text Search.
  * `q`: Supports logical AND/OR across `title` and vector text.
  * `tags`: Implicitly executed as an OR across tags array.
* V1 Delivery Mode (`subscriptions.deliveryMode`): Strictly `pull` (client cursor iteration against `GET /subscriptions/:id/changes`). Push integration via webhooks is reserved for V2.
* Lifecycle Coupling: Publishing or modifying content executes an asynchronous `pgboss` background job to re-index the catalog entry. Hard-deletes remove the catalog entry.

### 5.4 Retrieval Excerpts & Paywalls
* Free vs Paid Metadata: The catalog endpoint returns the `title`, `tags`, and explicit `summary`. If no `summary` exists, an auto-truncated 300C excerpt of the body is generated. Full body execution is gated via standard Entitlement verification.

## 6. Alternatives Considered
* **Use only `/content-items` filters**: Not enough for buyer discovery or subscription workflows.
* **External search service first**: Adds operational overhead before core semantics are stable.
* **Channel-only push distribution**: Lacks pull-based consumption model needed by many agents.

## 7. Security & Privacy Implications
* Search results must respect visibility and entitlement boundaries.
* Subscription endpoints should enforce principal isolation.
* Catalog summaries should avoid leaking protected full content.
* **Query Abuse Controls**: Max integer result window of 10,000 index hits. Strict token bucket rate limit on search endpoint `25r/sec` globally to intercept index crawling.

## 8. Rollout Plan / Milestones
1. **Phase 1**: Add catalog/collection schema, PostgreSQL full-text search configs, and indexing backgrounds jobs tied to item mutations.
2. **Phase 2**: Implement search and collection APIs in REST/GraphQL/MCP.
3. **Phase 3**: Add V1 Pull-based subscription change feeds with cursor checkpoints.
4. **Phase 4**: Integrate preview truncation strategies.
5. **Phase 5**: Add UI views for catalogs and subscription diagnostics.


