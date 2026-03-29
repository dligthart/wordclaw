---
name: wordclaw-cms
description: >
  Use when OpenClaw is connected to a WordClaw MCP server or WordClaw-backed
  REST runtime. Start with system://capabilities, system://deployment-status,
  system://current-actor, and system://workspace-context, then use guide_task
  or resolve_workspace_target before writing. Covers schema-bound authoring,
  review workflows, asset delivery, integrations, audit provenance, and
  REST-first L402 paid-content flows.
version: 0.1.0
tags:
  - cms
  - content
  - mcp
  - payments
  - governance
---

# WordClaw CMS Skill

You are connected to a **WordClaw** content runtime. Do not invent a workflow
when the runtime can tell you what to do. Prefer the built-in discovery
resources, `guide_task`, and `resolve_workspace_target` over guessing tool
order from memory.

## Session Start

For every new session, or whenever the actor/domain may have changed:

1. Read `system://capabilities`
2. Read `system://deployment-status`
3. Read `system://current-actor`
4. Read `system://workspace-context` or `system://workspace-context/{intent}`
5. If you do not know which task model to use, read `system://agent-guidance`
6. Call `guide_task` for the current job, or `resolve_workspace_target` when
   you need the single best content/work target

If deployment status reports `domainCount: 0`, call
`guide_task("bootstrap-workspace")`, then bootstrap the first domain with MCP
`create_domain` or the REST fallback `POST /api/domains` before calling any
content write tool.

`guide_task` supports these live task IDs:
- `bootstrap-workspace`
- `discover-deployment`
- `discover-workspace`
- `author-content`
- `review-workflow`
- `manage-integrations`
- `consume-paid-content`
- `verify-provenance`

Skip discovery only when you are resuming a known operation and the user made
it explicit that the cached workspace state is still valid.

## Hard Rules

- Never call a write tool before discovery unless you are explicitly resuming a known task.
- Do not assume `AUTH_REQUIRED=false` means anonymous writes are allowed. Treat writes as credentialed unless discovery explicitly shows insecure local admin is active.
- Prefer `guide_task` over a hand-written plan when a supported task ID exists.
- Respect `recommendedNextAction` in API and MCP responses.
- Dry-run create, update, delete, and batch operations when supported unless the user opts out.
- Respect the active domain from `system://current-actor` and `system://workspace-context`.
- Never auto-approve a review task without inspecting the content and any review comments.
- Asset bytes and paid content are REST-first, even when discovery happens over MCP.
- If a read returns `PAYMENT_REQUIRED` or `OFFER_REQUIRED`, switch to the REST offer/purchase flow.
- If a paid read returns `ENTITLEMENT_AMBIGUOUS`, retry with `x-entitlement-id`.
- Prefer `subscribe_events` recipe subscriptions over polling when you need to stay attached to live state.

## Low-Memory Operating Pattern

Treat **WordClaw as the durable state layer** and **OpenClaw as the planner**.
Do not keep large schema dumps, full item payloads, or long reasoning traces in
OpenClaw memory when WordClaw can rehydrate them on demand.

Prefer this compact checkpoint shape between turns or sessions:

```json
{
  "intent": "authoring",
  "domainId": 1,
  "actorId": "api_key:12",
  "contentTypeId": 42,
  "contentItemId": 314,
  "reviewTaskId": null,
  "offerId": null,
  "entitlementId": null,
  "lastAuditCursor": "<cursor-or-null>",
  "nextAction": "resume-draft-validation"
}
```

Keep only:

- actor and domain identity
- current intent
- canonical entity IDs
- the next concrete action
- an audit cursor or last-known timestamp for delta reads

Do not keep:

- full schema JSON unless you are actively writing against it
- full content item bodies after the write is complete
- repeated copies of workspace inventory
- paid-content challenge payloads after the purchase is settled

## Resume Pattern

When resuming a task in a fresh session:

1. Read `system://current-actor`
2. Read the narrowest workspace resource you can:
   - `system://workspace-target/{intent}` when you already know the task class
   - `system://workspace-context/{intent}/{limit}` when you need a small candidate set
   - full `system://workspace-context` only when you truly need full inventory
3. Call `guide_task` for the current task and IDs you already have
4. Reload only the referenced entities:
   - `get_content_item`
   - `get_asset`
   - `get_audit_logs`
   - REST offer or entitlement endpoints for paid flows
5. Read only the audit delta since the last cursor instead of replaying the whole trail

For long-lived sessions, use `subscribe_events`.
For cold-start resumes, use `get_audit_logs` with filters or the REST audit
endpoint to rebuild state from deltas.

## Task Playbooks

### Discover Deployment

Use:

```json
guide_task { "taskId": "discover-deployment" }
```

This is the safest starting point when you do not yet know which modules,
auth modes, transports, or workers are enabled.

### Discover Workspace

Use:

```json
guide_task { "taskId": "discover-workspace", "intent": "authoring" }
```

Or read the narrower resources directly:

- `system://workspace-context/{intent}`
- `system://workspace-target/{intent}`

Use this before choosing a schema, review queue, workflow target, or paid
content item.

If you already know the task class on resume, prefer:

- `system://workspace-target/{intent}`
- `resolve_workspace_target`
- `guide_task`

These are cheaper than re-reading the full workspace inventory.

### Author Content

Preferred sequence:

```text
1. If no schema is known yet, start with guide_task { "taskId": "author-content" }
2. resolve_workspace_target { "intent": "authoring", "search": "..." }
3. guide_task { "taskId": "author-content", "contentTypeId": <id> }
4. create_content_item or update_content_item with "dryRun": true
5. Fix validation or policy errors
6. Repeat without dryRun
7. Use get_content_item_versions or rollback_content_item if needed
8. Optionally subscribe_events { "recipeId": "content-lifecycle", "filters": { "contentTypeId": <id> } }
```

Use `list_content_types` and `get_content_type` when you need full schema
detail. When no usable schema exists yet, `guide_task { "taskId": "author-content" }`
also returns manifest-oriented patterns for memory, task-log, and checkpoint
content types. Use `create_content_items_batch` only when the user actually
wants coordinated bulk writes.

After a successful write, keep only `contentTypeId`, `contentItemId`, and the
next action. Re-read the item later instead of carrying the whole draft body
forward in memory.

### Review Workflow

Preferred sequence:

```text
1. guide_task { "taskId": "review-workflow", "reviewTaskId": <optional> }
2. Inspect the returned pending tasks
3. Read the target content item with get_content_item
4. Add feedback with add_review_comment if needed
5. Decide with decide_review_task { "taskId": <id>, "decision": "approved" | "rejected" }
6. Use submit_review_task when sending a draft into review
7. Optionally subscribe_events { "recipeId": "review-decisions", "filters": { "reviewTaskId": <id> } }
```

Only call `create_workflow` and `create_workflow_transition` when the review
path does not exist yet. If the user has not provided approval criteria,
ask before approving or rejecting.

For cross-session consistency, keep `reviewTaskId`, `contentItemId`, and an
audit cursor. On resume, fetch only the task, item, and audit delta.

### Assets

Preferred sequence:

```text
1. list_assets or get_asset
2. get_asset_access before assuming delivery behavior
3. For signed assets, use issue_asset_access
4. For derivatives, use create_asset with sourceAssetId, variantKey, and transformSpec
5. Use list_asset_derivatives to inspect derived variants
6. Use issue_direct_asset_upload and complete_direct_asset_upload for provider-backed uploads
```

Rules:

- `public` assets are directly readable over REST.
- `signed` assets use short-lived access guidance or signed URLs.
- `entitled` assets require REST offer discovery and entitlement-backed reads.
- MCP is metadata-first for asset bytes. Use REST for actual content delivery.
- Keep asset IDs and delivery mode, not the byte payload, in OpenClaw memory.

### Paid Content

Use MCP for discovery, but use REST for the actual purchase and read flow.

Preferred sequence:

```text
1. guide_task { "taskId": "consume-paid-content", "contentItemId": <id>, "offerId": <optional> }
2. GET /api/content-items/:id/offers
3. POST /api/offers/:id/purchase
4. Keep the macaroon, paymentHash, and entitlementId from the 402 response
5. Settle the Lightning invoice
6. POST /api/offers/:id/purchase/confirm with Authorization: L402 <macaroon>:<preimage>
7. If needed, include x-payment-hash when confirming
8. GET /api/content-items/:id using x-entitlement-id when multiple eligible entitlements exist
```

For entitled assets, the equivalent REST-first flow is:

```text
GET /api/assets/:id/offers
POST /api/offers/:id/purchase
POST /api/offers/:id/purchase/confirm
GET /api/assets/:id/content
```

Rules:

- Never fabricate or replay payment tokens.
- Purchases and confirmations are API-key- and domain-scoped.
- If the environment cannot pay Lightning invoices or perform REST calls, stop and ask for a human settlement step.
- After settlement, keep only `offerId`, `entitlementId`, and `paymentHash` when a confirm or resume step still depends on them.

### Manage Integrations

Use:

```json
guide_task { "taskId": "manage-integrations" }
```

Then operate with:

- `create_api_key`
- `list_api_keys`
- `revoke_api_key`
- `create_webhook`
- `list_webhooks`
- `get_webhook`
- `update_webhook`
- `delete_webhook`

Use `subscribe_events { "recipeId": "integration-admin" }` when you need to
watch API key and webhook changes.

### Verify Provenance

Use:

```json
guide_task {
  "taskId": "verify-provenance",
  "entityType": "content_item",
  "entityId": 123
}
```

Preferred sequence:

```text
1. Read system://current-actor
2. guide_task { "taskId": "verify-provenance", ...filters }
3. Read get_audit_logs for the narrowed actor or entity
4. Subscribe to the recipe or audit topics returned by the guidance when follow-up monitoring matters
```

This is the preferred way to rebuild context across sessions without replaying
old chat state.

### Projections and Filtered Reads

Use `project_content_items` for grouped analytics or leaderboard-style views.
Use `get_content_items` for filtered reads, and include
`"includeArchived": true` when lifecycle-managed archived content should
still be visible.

## Error Cues

- `AUTH_*` or scope errors: reread `system://current-actor`.
- `CONTENT_TYPE_NOT_FOUND`, `CONTENT_ITEM_NOT_FOUND`, `ASSET_NOT_FOUND`, `OFFER_NOT_FOUND`: re-check target resolution and active domain.
- `PAYMENT_REQUIRED` or `OFFER_REQUIRED`: switch to the REST paid-content flow.
- `ENTITLEMENT_AMBIGUOUS`: choose a candidate entitlement ID and retry with `x-entitlement-id`.
- `ENTITLEMENT_NOT_FOUND`, `ENTITLEMENT_NOT_ACTIVE`, `ENTITLEMENT_EXPIRED`, `ENTITLEMENT_EXHAUSTED`: inspect the current entitlement state, then purchase again or switch entitlements.
- Dry-run failure: do not perform the real write until the validation problem is fixed.

## Safety Rules

1. Always dry-run destructive or multi-item mutations unless the user explicitly opts out.
2. Never bypass review workflows or tenant isolation.
3. Audit logs are immutable.
4. `purge_asset` is permanent. Confirm with the user before calling it.
