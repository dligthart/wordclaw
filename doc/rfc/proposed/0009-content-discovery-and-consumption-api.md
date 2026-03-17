# RFC 0009: Content Discovery and Consumption API

**Author:** Codex  
**Status:** Rolling out  
**Date:** 2026-03-12  
**Updated:** 2026-03-17  

## 0. Current Status

As of 2026-03-17, RFC 0009 is rolling out in slices.

Implemented so far:

- cursor pagination for `GET /api/content-items`
- matching MCP, GraphQL, CLI, and demo-client adoption for cursor-based content listing
- content-runtime query groundwork that supports safer consumption on top of the existing content surface

Still pending:

- full collection browsing and catalog-search endpoints described in this RFC
- completing the broader consumer-facing discovery contract beyond the current content-items foundation

## 1. Summary
This RFC proposes a consumer-facing discovery surface for published content and paid offers that matches WordClaw's current runtime model.

V1 focuses on four concrete outcomes:

1. cursor-paginated discovery over published content,
2. deterministic collection browsing,
3. access-aware retrieval for paid and free content,
4. REST and MCP as the required delivery surfaces.

Broad subscription feeds and webhook-style change delivery remain a later slice. They should not block the first usable discovery contract.

## 2. Dependencies & Graph
* **Depends on:** RFC 0004 (Entitlements) for access-aware retrieval and paid-content remediation.
* **Depends on:** published content versioning and immutable read snapshots for stable consumption.
* **Depends on:** the current actor identity runtime (`/api/identity`, MCP `system://current-actor`) for canonical principal scoping.
* **Constrained by:** RFC 0021 (Core Product Focus and Feature Pruning), which makes REST and MCP the required product surfaces and treats broader subscription abstractions as non-core until demand is proven.
* **Depended on by:** RFC 0005 (Distribution) if distribution plans need a stable buyer-side discovery contract.

## 3. Motivation
WordClaw has strong creation and governance primitives, but consumer-side discovery is still too producer-centric. The current runtime exposes content listing and filtering, yet agent and buyer workflows still lack:

* a stable published-content discovery contract,
* server-side pagination that scales beyond small domains,
* collection browsing that is safe for machine consumption,
* consistent paid-content access metadata,
* an MCP-discoverable equivalent of the same contract.

This gap is visible today in the demo blog and archive views, which currently compensate for missing server-side discovery behavior by fetching large result sets and paginating on the client. Issue [#168](https://github.com/dligthart/wordclaw/issues/168) captures the immediate pressure point: the content-items API needs cursor-based pagination so clients can consume large datasets safely.

Without this RFC, WordClaw remains strong at content production but weak at downstream retrieval and consumption.

## 4. Proposal
Introduce discovery as a staged extension of the existing content runtime rather than as an entirely separate buyer platform.

### 4.1 V1 Discovery Scope
V1 includes:

1. **Published Content Listing**
   * Cursor-paginated listing over published content.
   * Built on the existing `content-items` surface so current clients can adopt it incrementally.
2. **Collections**
   * Stable, named groupings of published content.
   * Support both curated and rule-based definitions.
3. **Access-aware Retrieval**
   * Discovery responses include entitlement state, offer hints, and remediation guidance without leaking protected body content.
4. **REST + MCP Parity**
   * Discovery must ship in REST and MCP.
   * GraphQL may expose a compatibility view later, but it is not required for V1.

### 4.2 Deferred From V1
These are intentionally deferred:

* webhook delivery,
* broad subscription management abstractions,
* rank-based search that cannot yet support deterministic cursors,
* a separate buyer identity namespace.

## 5. Technical Design (Architecture)

### 5.1 Data Model
V1 should keep the existing `content_items` table as the source of truth and add read-model structures only where they materially simplify discovery.

* `catalog_entries`
  * `id`, `domainId`, `contentItemId`, `contentVersion`, `contentTypeId`, `title`, `summary`, `tags`, `language`, `publishedAt`, `visibility`, `offerScope`, `indexedAt`
  * Optional V1 read model for search and collection materialization.
* `collections`
  * `id`, `domainId`, `slug`, `name`, `description`, `definitionMode`, `queryJson`, `active`, `createdAt`, `updatedAt`
* `collection_entries`
  * `id`, `collectionId`, `catalogEntryId`, `rank`, `createdAt`

If subscription feeds are added later, they must bind to the canonical actor identity:

* `subscriptions` (Deferred)
  * `id`, `domainId`, `actorId`, `actorType`, `collectionId`, `cursor`, `deliveryMode`, `active`, `createdAt`

`agentProfileId` should not be the client-facing ownership primitive for discovery. If entitlement resolution still depends on an agent profile internally, that mapping should be derived server-side from the current actor context.

### 5.2 Protocol Strategy
Discovery follows the current project standard:

* **Required:** REST and MCP
* **Optional / Compatibility:** GraphQL

The RFC does not require feature-complete GraphQL parity for initial implementation.

### 5.3 REST Contract
V1 should standardize on these REST endpoints:

* `GET /api/content-items`
  * Supports `status=published`, `contentTypeId`, `q`, `createdAfter`, `createdBefore`, `limit`, `cursor`
  * Cursor pagination becomes the default machine-consumption mode for large domains.
  * Offset pagination may remain available for existing operator UIs, but discovery clients should use cursors.
* `GET /api/catalog/search`
  * Supports `q`, `tags`, `contentTypeId`, `limit`, `cursor`
  * Only ship once ordering is deterministic.
* `GET /api/collections/:slug`
  * Returns collection metadata, not the full item set.
* `GET /api/collections/:slug/items`
  * Supports `limit`, `cursor`
  * Returns the paginated item window for the collection.

Deferred:

* `POST /api/subscriptions`
* `GET /api/subscriptions/:id/changes`

### 5.4 MCP Contract
MCP must expose the same discovery contract in a machine-usable way:

* `content_items_list`
  * Must expose `limit` and `cursor` and return pagination metadata.
* `search_catalog`
  * Mirrors the REST catalog search once implemented.
* `get_collection`
  * Returns collection metadata only.
* `list_collection_items`
  * Returns paginated collection items.

The discovery tools must be visible in MCP inspection and capability guidance so agents can discover pagination arguments without reading human docs first.

### 5.5 Pagination Contract
This RFC adopts a single V1 cursor contract for discovery-oriented list endpoints.

#### Request
All cursor-paginated endpoints accept:

* `limit`
  * integer, `1-100` for public discovery endpoints unless a stricter endpoint-specific max is documented.
* `cursor`
  * opaque string returned by the previous response.

#### Response Envelope
Cursor-paginated responses must return:

```json
{
  "data": [],
  "metadata": {
    "limit": 50,
    "hasMore": true,
    "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTAzLTEyVDEwOjAwOjAwLjAwMFoiLCJpZCI6ODh9"
  }
}
```

#### Cursor Semantics
* Cursors are opaque to clients.
* V1 content discovery uses deterministic ordering:
  * `createdAt DESC, id DESC` for `content-items` when no stronger published timestamp exists,
  * `rank ASC, catalogEntryId ASC` for collection entries,
  * `publishedAt DESC, id DESC` for search only if the endpoint can guarantee deterministic ordering.
* The encoded cursor payload should follow the project's current pattern:
  * timestamp field,
  * tie-breaker id,
  * base64url-encoded JSON.
* Clients must not synthesize cursors themselves. They must reuse the server-issued `nextCursor`.
* Invalid cursors return `400` with remediation guidance.

#### Offset Pagination
Offset pagination can remain on operator-facing surfaces, but it should not be the default contract for discovery endpoints expected to handle large datasets or high-churn archives.

### 5.6 Search Behavior
Search should remain implementable and cursor-safe.

V1 rules:

* `q`
  * Supports simple filter-safe text search over approved fields such as `title` and `summary`.
* `tags`
  * Supports tag-based filtering.
* Relevance ranking must not ship unless its ordering contract is cursor-stable.
* If cursor-safe relevance is not ready, the endpoint should prefer deterministic chronological ordering over unstable ranked pagination.

This prevents a partially implemented "smart search" from breaking replay safety or causing duplicate/skipped items across pages.

### 5.7 Access-aware Retrieval and Paywalls
Discovery endpoints must return only fields that are safe to expose before entitlement validation.

Allowed fields:

* `title`
* `summary`
* `tags`
* `contentTypeId` / schema identity
* `publishedAt`
* attribution fields explicitly marked safe for discovery
* offer and entitlement hints

Protected body fields remain gated behind normal content read rules and L402/entitlement enforcement.

Discovery responses should include explicit access state such as:

* `access.requiresEntitlement`
* `access.availableOfferIds`
* `access.remediation`

If no explicit summary exists, V1 may generate a truncated excerpt from a discovery-approved field set. It must not expose arbitrary protected body content just to improve search snippets.

### 5.8 Identity and Isolation
All discovery requests execute within the current `CurrentActorSnapshot`.

That means:

* domain scoping is resolved from the actor context,
* scope checks evaluate against canonical actor permissions,
* audit and future subscription ownership use `actorId` and `actorType`,
* internal entitlement mapping may still resolve a buyer profile, but clients do not pass `agentProfileId` as a discovery ownership primitive.

This keeps discovery aligned with the current identity model already used by `/api/identity`, MCP `whoami`, audit attribution, and workspace guidance.

### 5.9 Lifecycle Coupling
Publishing, updating, or deleting published content must update discovery state asynchronously but deterministically.

* Publish/update:
  * enqueue catalog refresh or collection re-materialization jobs.
* Hard delete:
  * remove or tombstone discovery records depending on whether change feeds exist yet.

Tombstones are only required once subscription/change-feed semantics are implemented. They should not complicate the first pagination slice unnecessarily.

## 6. Alternatives Considered
* **Keep using raw `/content-items` offset pagination everywhere**
  * Rejected because high-volume agent consumers and archives need replay-safe pagination.
* **Build a separate buyer API before fixing the existing content-items contract**
  * Rejected because issue `#168` already shows that the current content surface needs pagination now.
* **Ship webhook subscriptions first**
  * Rejected because the project is not yet ready to standardize broad subscription abstractions, and pull-based discovery is simpler to harden first.
* **Require GraphQL parity from day one**
  * Rejected because current product policy is REST and MCP first.

## 7. Security & Privacy Implications
* Discovery results must respect domain, visibility, and entitlement boundaries.
* Search indexing must exclude fields that should never influence public discovery.
* Cursor payloads must be opaque and validated strictly.
* Rate limits should key off canonical actor identity and domain rather than a separate buyer namespace.
* Access hints must not leak full paid content.

## 8. Rollout Plan / Milestones
1. **Phase 1**
   * Implement cursor pagination for `GET /api/content-items`.
   * Add `limit` + `cursor` support and metadata to the MCP `content_items_list` tool.
   * Update the demo blog and archive consumers to use server-side pagination.
2. **Phase 2**
   * Add a published-content discovery profile and access-aware metadata to content listing responses.
3. **Phase 3**
   * Add collections plus paginated `GET /api/collections/:slug/items` and MCP equivalents.
4. **Phase 4**
   * Add `catalog_entries` search only when deterministic cursor-safe ordering is in place.
5. **Phase 5 (Optional / Later)**
   * Evaluate pull-based subscription feeds and tombstone semantics once real consumers require them.
