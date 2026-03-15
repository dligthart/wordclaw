# API Reference

<script setup>
import SwaggerUI from '../.vitepress/components/SwaggerUI.vue'
</script>

This document covers WordClaw's primary HTTP surface: the REST API. MCP is the primary agent-native companion surface; see [mcp-integration.md](../guides/mcp-integration). GraphQL remains available at `/graphql` as a compatibility layer. Experimental revenue, payout, delegation, and agent-run endpoints are intentionally hidden from the default API reference unless an operator explicitly enables those incubator modules in runtime configuration.

For deployment-level discovery before authentication, use `GET /api/capabilities` plus `GET /api/deployment-status`. The manifest reports the current protocol contract, enabled modules, auth/domain expectations, reusable actor profiles, dry-run coverage, and task-oriented agent recipes in one machine-readable document. It now also includes the MCP reactive contract: whether session-backed subscriptions are enabled, which tool to call, which notification method to handle, which filter fields are available, which topics are supported, and which subscription recipes expand into curated topic sets. The same manifest also advertises the asset-storage contract: configured versus effective provider, REST and MCP upload modes, supported delivery modes, signed-access issuance, and lifecycle controls. The task recipes in that same manifest now include static `reactiveFollowUp` examples so agents can discover likely `subscribe_events` payloads before asking for live task-specific guidance. The status snapshot adds live readiness for the database, REST/MCP availability, asset storage, the current reactive MCP transport details, and any enabled background worker surfaces. For authenticated preflight checks, use `GET /api/identity` plus `GET /api/workspace-context` to confirm the current actor, active domain, and available content-model targets before mutating runtime state. The workspace snapshot now includes grouped target recommendations for authoring, workflow, review, and paid-content flows, and `GET /api/workspace-target` resolves the strongest schema-plus-work-target candidate for one of those task classes.

The fastest task-oriented preflight sequence is:

1. `GET /api/capabilities`
2. `GET /api/deployment-status`
3. `GET /api/identity`
4. `GET /api/workspace-context`
   - supports `intent`, `search`, and `limit` when the agent already knows whether it wants authoring, review, workflow, or paid-content targets
5. `GET /api/workspace-target`
   - resolves the best schema target plus the next concrete work target for `authoring`, `review`, `workflow`, or `paid`
6. Use the matching CLI helper:
   - `workspace guide`
   - `workspace resolve --intent <intent>`
   - `content guide --content-type-id <id>`
   - `workflow guide`
   - `integrations guide`
   - `audit guide --entity-type <type> --entity-id <id>`
   - `l402 guide --item <id>`

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
    "currentDomainId": "tenant-A",
    "selectableDomains": ["tenant-A"],
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

### 2. Creating Content (Authoring)

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

### 3. Listing Content with Cursor Pagination

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

### 4. Uploading an Asset

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

### 5. Paying an L402 Invoice

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
