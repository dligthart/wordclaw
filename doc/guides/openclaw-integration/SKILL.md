---
name: wordclaw-cms
description: >
  Orchestrate a WordClaw content runtime — create schemas, author content,
  manage assets, review workflows, handle L402 payments, and subscribe to
  live events. This skill teaches the agent the discovery-first workflow so
  it uses WordClaw's self-describing MCP tools correctly.
version: 0.1.0
tags:
  - cms
  - content
  - mcp
  - payments
  - governance
---

# WordClaw CMS Skill

You are connected to a **WordClaw** content runtime via the MCP server.
WordClaw is a safe content runtime for AI agents that combines structured
content, schema-aware media assets, approval workflows, dry-run safety,
auditability, and L402 Lightning payments.

## Golden Rule — Discovery First

**NEVER call a write tool before you have run discovery.** WordClaw is
self-describing. Always follow this sequence:

1. Read `system://capabilities` → understand the deployment contract
2. Read `system://current-actor` → confirm your identity and scopes
3. Read `system://workspace-context` → see available content types, domains,
   and workspace targets
4. Call `resolve_workspace_target` with an `intent` → get the best schema
   and work target for your task
5. **Then** proceed to authoring, review, or consumption

Skip discovery only when resuming a session where you have already cached
the workspace state AND the user explicitly asked for a known operation.

---

## Workflow Recipes

### 1. Content Authoring

```
Step 1  →  resolve_workspace_target { "intent": "authoring" }
Step 2  →  guide_task { "taskId": "author-content", "contentTypeId": <id> }
Step 3  →  create_content_item { "contentTypeId": <id>, "data": {...}, "dryRun": true }
Step 4  →  Review dry-run result for validation errors
Step 5  →  create_content_item { "contentTypeId": <id>, "data": {...} }
Step 6  →  (Optional) subscribe_events { "topics": ["content_item.published"],
           "filters": { "contentTypeId": <id> } }
```

**Constraints:**
- Always dry-run first on new schemas you haven't written to before.
- Content data must match the JSON schema defined on the content type.
- Use `create_content_items_batch` for bulk operations (supports atomic mode).
- Respect `recommendedNextAction` in the response to decide what to do next.

### 2. Workflow Review

```
Step 1  →  resolve_workspace_target { "intent": "review" }
Step 2  →  guide_task { "taskId": "review-workflow" }
Step 3  →  Read the returned pending tasks
Step 4  →  For each task: inspect the content item, then approve or reject
Step 5  →  (Optional) subscribe_events { "recipeId": "review-decisions" }
```

**Constraints:**
- Never auto-approve without inspecting the content payload.
- If the user hasn't specified an approval policy, ask them before deciding.

### 3. Asset Management

```
Step 1  →  list_assets { "limit": 10 }
Step 2  →  create_asset { "contentFile": <path>, "mimeType": "image/png",
           "accessMode": "public" }
Step 3  →  (For derivatives) create_asset { "sourceAssetId": <id>,
           "variantKey": "thumbnail", "transformSpec": {...} }
Step 4  →  issue_asset_access { "assetId": <id> }  (for signed assets)
```

**Access modes:** `public` (open URL), `signed` (time-limited token),
`entitled` (requires L402 payment).

### 4. L402 Paid Content

```
Step 1  →  guide_task { "taskId": "consume-paid-content",
           "contentItemId": <id> }
Step 2  →  Parse the 402 challenge (Macaroon + Lightning invoice)
Step 3  →  Pay the invoice through your payment provider
Step 4  →  Retry the request with the paid token
```

**Constraints:**
- NEVER attempt to fabricate or replay payment tokens.
- If `x-proposed-price` header is available, you may negotiate price.
- Paid tokens are single-use; the runtime marks them as consumed.

### 5. Reactive Subscriptions

Use reactive subscriptions to stay in sync instead of polling.

```
subscribe_events {
  "recipeId": "content-lifecycle",
  "filters": { "contentTypeId": <id> }
}
```

**Available recipes:**
| Recipe | Events | Required Scopes |
|--------|--------|-----------------|
| `content-publication` | Published content | `content:read` |
| `review-decisions` | Workflow approvals/rejections | `content:read` |
| `content-lifecycle` | All content CRUD + rollback | `content:write` |
| `schema-governance` | Content type changes | `content:write` |
| `integration-admin` | API key & webhook changes | `admin` |

### 6. Content Queries & Projections

For analytics or leaderboard-style views:

```
project_content_items {
  "contentTypeId": <id>,
  "groupBy": "category",
  "metric": "count"
}
```

For filtered reads:

```
get_content_items {
  "contentTypeId": <id>,
  "status": "published",
  "limit": 20
}
```

Add `"includeArchived": true` to include TTL-expired content.

---

## Tool Reference (Quick Index)

### Content Types
`create_content_type` · `list_content_types` · `get_content_type` ·
`update_content_type` · `delete_content_type`

### Content Items
`create_content_item` · `create_content_items_batch` · `get_content_items` ·
`project_content_items` · `get_content_item` · `update_content_item` ·
`update_content_items_batch` · `delete_content_item` ·
`delete_content_items_batch` · `get_content_item_versions` ·
`rollback_content_item`

### Assets
`create_asset` · `list_assets` · `get_asset` · `list_asset_derivatives` ·
`issue_direct_asset_upload` · `complete_direct_asset_upload` ·
`get_asset_access` · `issue_asset_access` · `delete_asset` ·
`restore_asset` · `purge_asset`

### Governance
`evaluate_policy` · `subscribe_events` · `get_audit_logs`

### Integrations
`create_api_key` · `list_api_keys` · `revoke_api_key` ·
`create_webhook` · `list_webhooks` · `get_webhook` ·
`update_webhook` · `delete_webhook`

### Guidance
`guide_task` · `resolve_workspace_target`

---

## Error Handling

All errors follow the pattern: `ERROR_CODE: description`.

- On validation errors → fix the payload and retry.
- On `402 Payment Required` → follow the L402 flow above.
- On scope errors → read `system://current-actor` to check your permissions.
- On `dryRun` failure → do NOT proceed with the real write.

## Safety Rules

1. **Always dry-run destructive operations** (deletes, batch updates) unless
   the user explicitly opts out.
2. **Never bypass approval workflows.** If content requires approval,
   submit it and wait.
3. **Respect multi-tenant isolation.** Never attempt to access content
   outside your active domain.
4. **Audit trail is immutable.** You cannot delete audit logs.
5. **Asset purge is permanent.** Always confirm with the user before
   calling `purge_asset`.
