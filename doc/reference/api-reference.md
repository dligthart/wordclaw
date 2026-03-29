# API Reference

<script setup>
import SwaggerUI from '../.vitepress/components/SwaggerUI.vue'
</script>

This document covers WordClaw's primary HTTP surface: the REST API. MCP is the primary agent-native companion surface; see [mcp-integration.md](../guides/mcp-integration). GraphQL remains available at `/graphql` as a compatibility layer. Experimental revenue, payout, delegation, and agent-run endpoints are intentionally hidden from the default API reference unless an operator explicitly enables those incubator modules in runtime configuration.

The prose examples below are the current reference point for the newest runtime layers such as globals, locale-aware reads, working-copy versus published reads, preview tokens, reverse-reference usage graphs, reusable forms, background jobs, public write lanes, direct asset upload, and the latest asset lifecycle flows. The embedded OpenAPI viewer still emphasizes the longest-stable core contract while those newer slices continue to be expanded there.

For deployment-level discovery before authentication, use `GET /api/capabilities` plus `GET /api/deployment-status`. The manifest reports the current protocol contract, enabled modules, auth/domain expectations, reusable actor profiles, dry-run coverage, task-oriented agent recipes, and a REST/MCP/GraphQL/CLI tool-equivalence map in one machine-readable document. It now also includes bootstrap and effective auth posture so clients can tell whether content writes still need a credential, whether insecure local admin is active, and whether a first domain still needs to be provisioned. It also includes the MCP reactive contract: whether session-backed subscriptions are enabled, which tool to call, which notification method to handle, which filter fields are available, which topics are supported, and which subscription recipes expand into curated topic sets. The same manifest also advertises the asset-storage contract: configured versus effective provider, supported providers (`local`, `s3`), fallback state when remote storage is misconfigured, REST and MCP upload modes, supported delivery modes, signed-access issuance, and lifecycle controls. It now also publishes the content-runtime query contract: field-aware listing constraints, queryable scalar field kinds, grouped projection support for lightweight leaderboard and analytics-style read models, TTL lifecycle semantics for session-like content via `x-wordclaw-lifecycle` plus the `includeArchived` override on list/projection reads, and where to inspect semantic-index readiness for the latest published snapshot of each content item. The task recipes in that same manifest now include static `reactiveFollowUp` examples so agents can discover likely `subscribe_events` payloads before asking for live task-specific guidance. The status snapshot adds live readiness for the database, bootstrap state, REST/MCP availability, vector RAG readiness, embedding queue health, supervisor UI availability, content-runtime query surfaces, asset storage, the current reactive MCP transport details, and any enabled background worker surfaces. For authenticated preflight checks, use `GET /api/identity` plus `GET /api/workspace-context` to confirm the current actor, active domain, and available content-model targets before mutating runtime state. The workspace snapshot now includes grouped target recommendations for authoring, workflow, review, and paid-content flows, and `GET /api/workspace-target` resolves the strongest schema-plus-work-target candidate for one of those task classes.

The fastest task-oriented preflight sequence is:

1. `GET /api/capabilities`
2. `GET /api/deployment-status`
   - if `domainCount` is `0`, bootstrap the first domain with `POST /api/domains` or MCP `create_domain`
3. `GET /api/identity`
4. `GET /api/workspace-context`
   - supports `intent`, `search`, and `limit` when the agent already knows whether it wants authoring, review, workflow, or paid-content targets
5. `GET /api/workspace-target`
   - resolves the best schema target plus the next concrete work target for `authoring`, `review`, `workflow`, or `paid`
6. Use the matching CLI helper:
   - `mcp call guide_task --json '{"taskId":"bootstrap-workspace"}'`
   - `workspace guide`
   - `workspace resolve --intent <intent>`
   - `content guide` or `content guide --content-type-id <id>`
   - `workflow guide`
   - `integrations guide`
   - `audit guide --entity-type <type> --entity-id <id>`
   - `l402 guide --item <id>`

## Content-State Contract

The current REST content contract includes a few authoring-state primitives that matter for agents and supervisors:

- `GET /api/content-items`, `GET /api/content-items/:id`, `GET /api/globals`, and `GET /api/globals/:slug` accept `draft`, `locale`, and `fallbackLocale`.
- Reads default to `draft=true`, which means the latest working copy is returned.
- `draft=false` prefers the latest published snapshot while still returning publication metadata for the current working copy.
- Content item and global reads now include `publicationState`, `workingCopyVersion`, `publishedVersion`, optional `localeResolution`, and `embeddingReadiness` for the latest published semantic-search snapshot.
- `GET /api/deployment-status` now includes `checks.embeddings`, which reports whether semantic indexing is enabled, whether anything is currently queued or in flight, and whether the most recent sync failed.
- `GET /api/deployment-status` also includes `checks.ui`, which tells you whether the supervisor is currently being served from `/ui/` and which local dev command to run when it is not.
- Short-lived preview tokens are issued through `POST /api/content-items/:id/preview-token` and `POST /api/globals/:slug/preview-token`, then redeemed through `/api/preview/...` paths.
- Reverse-reference usage graphs are available through `GET /api/content-items/:id/used-by` and `GET /api/assets/:id/used-by`.
- Reusable forms are managed through `GET/POST /api/forms`, `GET/PUT/DELETE /api/forms/:id`, and the public submission surface at `GET /api/public/forms/:slug` plus `POST /api/public/forms/:slug/submissions`.
- Background jobs are managed through `GET/POST /api/jobs`, `GET/DELETE /api/jobs/:id`, `GET /api/jobs/worker-status`, and `POST /api/content-items/:id/schedule-status`.
- Preview reads stay scoped to one item or global, remain auditable, and currently reject paywalled targets.

## Common Examples

### 1. Fetching Workspace Context

Determine available domains and schema targets for authoring or review based on the authenticated actor.

**Request:**
```bash
curl -H "x-api-key: writer" "http://localhost:4000/api/workspace-context?intent=authoring"
```

**Response:**
```json
{
  "data": {
    "currentDomainId": 1,
    "selectableDomains": [1],
    "contentModelInventory": {
      "schemas": { "15": "agent-skill" },
      "activeWorkflows": { "15": 1 },
      "pendingReviewTasks": {},
      "activeOffers": { "15": 7 }
    },
    "targets": {
      "authoringCandidates": [{ "kind": "content-type", "id": 15, "score": 100 }],
      "reviewCandidates": [],
      "workflowCandidates": [],
      "paidCandidates": []
    }
  }
}
```

### 2. Bootstrapping the First Domain

If the deployment is fresh and `GET /api/deployment-status` reports `domainCount: 0`, create the first domain before attempting content writes. Otherwise content-type and content-item writes fail with `NO_DOMAIN`. The MCP equivalent is `create_domain`, and the recommended bootstrap planner is `guide_task("bootstrap-workspace")`.

**Request:**
```bash
curl -X POST http://localhost:4000/api/domains \
  -H "x-api-key: writer" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Local Development",
    "hostname": "local.development"
  }'
```

**Response:**
```json
{
  "data": {
    "id": 1,
    "name": "Local Development",
    "hostname": "local.development",
    "createdAt": "2026-03-29T09:00:00.000Z"
  }
}
```

### 3. Creating Content (Authoring)

Author a new draft into an existing schema (`id: 15`).

**Request:**
```bash
curl -X POST http://localhost:4000/api/content-items \
  -H "x-api-key: writer" \
  -H "Content-Type: application/json" \
  -d '{
    "contentTypeId": 15,
    "status": "draft",
    "data": {
      "title": "React Generator",
      "prompt_template": "Write React code..."
    }
  }'
```

**Response:**
```json
{
  "data": {
    "id": 88,
    "contentTypeId": 15,
    "version": 1,
    "status": "draft",
    "data": {
      "title": "React Generator",
      "prompt_template": "Write React code..."
    },
    "createdAt": "2024-03-24T12:00:00Z"
  }
}
```

### 4. Listing Content with Cursor Pagination

List content safely in pages without fetching the entire dataset up front. Reuse the returned `meta.nextCursor` for the next request.

**Request:**
```bash
curl -H "x-api-key: writer" \
  "http://localhost:4000/api/content-items?contentTypeId=15&status=draft&limit=2"
```

**Response:**
```json
{
  "data": [
    {
      "id": 88,
      "contentTypeId": 15,
      "status": "draft",
      "version": 1,
      "data": "{\"title\":\"React Generator\"}",
      "createdAt": "2024-03-24T12:00:00Z",
      "updatedAt": "2024-03-24T12:00:00Z"
    }
  ],
  "meta": {
    "hasMore": true,
    "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI0LTAzLTI0VDEyOjAwOjAwLjAwMFoiLCJpZCI6ODh9"
  }
}
```

**Next page:**
```bash
curl -H "x-api-key: writer" \
  "http://localhost:4000/api/content-items?contentTypeId=15&status=draft&limit=2&cursor=eyJjcmVhdGVkQXQiOiIyMDI0LTAzLTI0VDEyOjAwOjAwLjAwMFoiLCJpZCI6ODh9"
```

### 5. Building a Grouped Content Projection

Build a leaderboard- or analytics-style grouped read model directly from content data. In this first pass the runtime groups by one top-level scalar schema field and supports `count`, `sum`, `avg`, `min`, and `max`.

**Request:**
```bash
curl -H "x-api-key: writer" \
  "http://localhost:4000/api/content-items/projections?contentTypeId=15&groupBy=characterClass&metric=avg&metricField=score&limit=5"
```

**Response:**
```json
{
  "data": [
    {
      "group": "Chronomancer",
      "value": 18.5,
      "count": 2
    },
    {
      "group": "Ranger",
      "value": 11.25,
      "count": 4
    }
  ],
  "meta": {
    "contentTypeId": 15,
    "groupBy": "characterClass",
    "metric": "avg",
    "metricField": "score",
    "orderBy": "value",
    "orderDir": "desc",
    "limit": 5
  }
}
```

### 6. TTL-Managed Session Content

For ephemeral session-like models, declare a lifecycle policy in the content type schema and let the runtime lazily archive stale rows on touch. List and projection reads exclude those archived rows by default; operators can opt back in with `includeArchived=true`.

**Schema excerpt:**
```json
{
  "type": "object",
  "properties": {
    "sessionId": { "type": "string" },
    "body": { "type": "string" }
  },
  "required": ["sessionId", "body"],
  "x-wordclaw-lifecycle": {
    "ttlSeconds": 900,
    "archiveStatus": "archived",
    "clock": "updatedAt"
  }
}
```

**List including archived rows:**
```bash
curl -H "x-api-key: writer" \
  "http://localhost:4000/api/content-items?contentTypeId=15&includeArchived=true&limit=20"
```

### 7. Reading Globals

Read singleton/global documents through the dedicated globals surface instead of treating them like ordinary collection rows.

**Request:**
```bash
curl -H "x-api-key: writer" \
  "http://localhost:4000/api/globals?locale=nl"
```

**Response excerpt:**
```json
{
  "data": [
    {
      "contentType": {
        "id": 11,
        "slug": "site-settings",
        "kind": "singleton"
      },
      "item": {
        "id": 81,
        "status": "published",
        "publicationState": "published",
        "workingCopyVersion": 2,
        "publishedVersion": 2,
        "data": "{\"title\":\"Instellingen\"}"
      }
    }
  ]
}
```

### 8. Reading the Latest Published Snapshot

Use `draft=false` when a caller explicitly wants the latest published representation instead of the newest working copy.

**Request:**
```bash
curl -H "x-api-key: writer" \
  "http://localhost:4000/api/content-items/345?draft=false&locale=nl&fallbackLocale=en"
```

**Response excerpt:**
```json
{
  "data": {
    "id": 345,
    "status": "published",
    "version": 7,
    "publicationState": "changed",
    "workingCopyVersion": 9,
    "publishedVersion": 7,
    "data": "{\"title\":\"Hallo wereld\"}",
    "localeResolution": {
      "requestedLocale": "nl",
      "fallbackLocale": "en",
      "resolvedFieldCount": 1
    }
  }
}
```

### 9. Issuing and Redeeming a Preview Token

Preview tokens are the explicit draft-access contract for one content item or global. They are short-lived, domain-scoped, and must be supplied on the preview read.

**Issue the token:**
```bash
curl -X POST http://localhost:4000/api/content-items/345/preview-token \
  -H "x-api-key: writer" \
  -H "Content-Type: application/json" \
  -d '{
    "draft": true,
    "locale": "nl",
    "fallbackLocale": "en",
    "ttlSeconds": 120
  }'
```

**Response excerpt:**
```json
{
  "data": {
    "contentItemId": 345,
    "draft": true,
    "ttlSeconds": 120,
    "token": "<preview-token>",
    "previewPath": "/api/preview/content-items/345?token=<preview-token>"
  }
}
```

**Redeem the preview token:**
```bash
curl "http://localhost:4000/api/preview/content-items/345?token=<preview-token>"
```

### 10. Inspecting Reverse References

Use the usage graph endpoints before deleting, purging, or restructuring linked content and assets.

**Request:**
```bash
curl -H "x-api-key: writer" \
  "http://localhost:4000/api/content-items/345/used-by"
```

**Response excerpt:**
```json
{
  "data": {
    "activeReferenceCount": 2,
    "historicalReferenceCount": 1,
    "activeReferences": [
      {
        "contentItemId": 401,
        "contentTypeName": "Landing Page",
        "contentTypeSlug": "landing-page",
        "path": "/featuredPosts/0",
        "version": 7,
        "status": "published"
      }
    ]
  }
}
```

The same shape is returned by `GET /api/assets/:id/used-by`.

### 11. Managing Form Definitions

Forms turn bounded external intake into a first-class runtime contract instead of one-off public-write glue.

**Create a form definition:**
```bash
curl -X POST http://localhost:4000/api/forms \
  -H "x-api-key: writer" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Contact",
    "slug": "contact",
    "contentTypeId": 15,
    "fields": [
      { "name": "email", "type": "text", "required": true },
      { "name": "message", "type": "textarea", "required": true }
    ],
    "publicRead": true,
    "submissionStatus": "draft"
  }'
```

**Response excerpt:**
```json
{
  "data": {
    "id": 21,
    "slug": "contact",
    "contentTypeSlug": "lead",
    "active": true,
    "publicRead": true,
    "submissionStatus": "draft",
    "fields": [
      { "name": "email", "type": "text", "required": true },
      { "name": "message", "type": "textarea", "required": true }
    ]
  }
}
```

**Read the sanitized public contract:**
```bash
curl "http://localhost:4000/api/public/forms/contact?domainId=1"
```

**Submit a public payload:**
```bash
curl -X POST "http://localhost:4000/api/public/forms/contact/submissions?domainId=1" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "email": "operator@example.com",
      "message": "Hello from the public form lane."
    }
  }'
```

### 12. Queueing Background Jobs

Jobs make slow or scheduled side effects explicit and inspectable.

**Queue an outbound webhook job:**
```bash
curl -X POST http://localhost:4000/api/jobs \
  -H "x-api-key: writer" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "outbound_webhook",
    "runAt": "2026-03-29T18:00:00Z",
    "payload": {
      "url": "https://example.com/hooks/wordclaw",
      "body": {
        "event": "demo",
        "source": "docs"
      }
    }
  }'
```

**Response excerpt:**
```json
{
  "data": {
    "id": 44,
    "kind": "outbound_webhook",
    "queue": "webhooks",
    "status": "queued",
    "attempts": 0,
    "maxAttempts": 3
  }
}
```

**Schedule a content status change:**
```bash
curl -X POST http://localhost:4000/api/content-items/345/schedule-status \
  -H "x-api-key: writer" \
  -H "Content-Type: application/json" \
  -d '{
    "targetStatus": "published",
    "runAt": "2026-03-29T18:30:00Z"
  }'
```

**Inspect worker health:**
```bash
curl -H "x-api-key: writer" \
  "http://localhost:4000/api/jobs/worker-status"
```

### 13. Uploading an Asset

Create a signed asset and attach metadata without leaving the core runtime.

**Request:**
```bash
curl -X POST http://localhost:4000/api/assets \
  -H "x-api-key: writer" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "hero.png",
    "originalFilename": "hero.png",
    "mimeType": "image/png",
    "contentBase64": "<base64-bytes>",
    "accessMode": "signed",
    "metadata": {
      "alt": "Autonomous workflow hero image"
    }
  }'
```

**Response:**
```json
{
  "data": {
    "id": 44,
    "filename": "hero.png",
    "mimeType": "image/png",
    "accessMode": "signed",
    "status": "active",
    "delivery": {
      "contentPath": "/api/assets/44/content",
      "requiresEntitlement": false
    }
  }
}
```

### 14. Issuing a Public Write Token

For bounded player/session-like writes, issue a short-lived token from a schema that explicitly allows public writes.

**Request:**
```bash
curl -X POST http://localhost:4000/api/content-types/15/public-write-tokens \
  -H "x-api-key: writer" \
  -H "Content-Type: application/json" \
  -d '{
    "expiresInSeconds": 900,
    "subject": {
      "playerId": "session-42"
    }
  }'
```

**Response:**
```json
{
  "data": {
    "token": "<signed-token>",
    "expiresAt": "2026-03-17T12:00:00.000Z"
  }
}
```

**Public write using the token:**
```bash
curl -X POST http://localhost:4000/api/public/content-types/15/items \
  -H "Content-Type: application/json" \
  -d '{
    "token": "<signed-token>",
    "data": {
      "playerId": "session-42",
      "score": 18
    }
  }'
```

### 12. Direct Asset Upload Through a Storage Provider

For large files or browser-friendly flows, ask WordClaw for a provider upload URL first, then complete the asset after the object write succeeds.

**Issue upload URL:**
```bash
curl -X POST http://localhost:4000/api/assets/direct-upload \
  -H "x-api-key: writer" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "hero.png",
    "originalFilename": "hero.png",
    "mimeType": "image/png",
    "accessMode": "signed",
    "sourceAssetId": 44,
    "variantKey": "hero-webp",
    "transformSpec": {
      "width": 1200,
      "format": "webp"
    }
  }'
```

**Response:**
```json
{
  "data": {
    "provider": "s3",
    "upload": {
      "uploadUrl": "https://storage.example.com/bucket/object?signature=...",
      "method": "PUT",
      "uploadHeaders": {
        "content-type": "image/png"
      },
      "expiresAt": "2026-03-17T12:15:00.000Z",
      "ttlSeconds": 900
    },
    "finalize": {
      "path": "/api/assets/direct-upload/complete",
      "token": "<direct-upload-token>",
      "expiresAt": "2026-03-17T12:15:00.000Z"
    },
  }
}
```

**Complete the asset after the provider write succeeds:**
```bash
curl -X POST http://localhost:4000/api/assets/direct-upload/complete \
  -H "x-api-key: writer" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "<direct-upload-token>",
    "metadata": {
      "alt": "Workflow hero image"
    }
  }'
```

### 13. Inspecting Derivative Asset Variants

List the managed variants attached to a source asset, such as a web-optimized image or thumbnail derivative.

**Request:**
```bash
curl http://localhost:4000/api/assets/44/derivatives \
  -H "x-api-key: writer"
```

**Response excerpt:**
```json
{
  "data": [
    {
      "id": 45,
      "sourceAssetId": 44,
      "variantKey": "hero-webp",
      "transformSpec": {
        "width": 1200,
        "format": "webp"
      }
    }
  ],
  "meta": {
    "total": 1,
    "sourceAssetId": 44,
    "status": "active"
  }
}
```

### 14. Inspecting Asset Storage Readiness

Check which asset storage provider is configured, which provider is actually active, and whether the runtime fell back to local storage because remote configuration is incomplete.

**Request:**
```bash
curl http://localhost:4000/api/deployment-status
```

**Response excerpt:**
```json
{
  "assetStorage": {
    "configuredProvider": "s3",
    "effectiveProvider": "local",
    "supportedProviders": ["local", "s3"],
    "fallbackApplied": true,
    "fallbackReason": "missing_s3_configuration",
    "deliveryModes": ["public", "signed", "entitled"]
  }
}
```

### 15. Paying an L402 Invoice

Confirming a purchase locally with a simulated payment backend.

**Request:**
```bash
curl -X POST http://localhost:4000/api/offers/7/purchase/confirm \
  -H "x-api-key: buyer-key" \
  -H "Content-Type: application/json" \
  -H "Authorization: L402 <macaroon>:mock_preimage_12345"
```

**Response:**
```json
{
  "data": {
    "status": "paid",
    "paymentDetails": {
      "preimage": "mock_preimage_12345"
    }
  }
}
```

<SwaggerUI />
