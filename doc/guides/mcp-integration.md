# MCP Integration

WordClaw ships a [Model Context Protocol](https://modelcontextprotocol.io/) server so LLM agents can manage content without writing HTTP requests. MCP is one of the two primary product surfaces alongside REST. The current runtime still exposes GraphQL, but GraphQL is treated as a compatibility layer rather than the default contract for new agent capabilities.

The tool coverage documented in this guide reflects the default core parity contract. Incubator-only tools, such as agent-run orchestration, are intentionally excluded unless operators explicitly enable those runtime flags.

## Transports

WordClaw now exposes MCP in two ways:

- **Local stdio** for embedded or developer-run MCP sessions
- **Streamable HTTP** at `/mcp` for attachable remote clients

For machine-readable discovery of the current deployment contract, read the `system://capabilities` resource or use `mcp inspect` from the CLI. That manifest reports the enabled module set, protocol expectations, dry-run coverage, the currently available MCP transports, task-oriented routing hints, the current REST/MCP/CLI tool-equivalence map, and the actor/auth profiles an agent can use for workflows such as workspace targeting, authoring, review, integration setup, provenance verification, and paid-content consumption. The MCP section now also includes a reactive contract block describing whether session-backed subscriptions are enabled, which tool to call, which notification method to handle, which session header is used, which filter fields are supported, and which topics are currently supported. The manifest also now exposes the content-runtime query contract, including singleton globals, localized fields, working-copy versus published reads, reverse-reference usage graphs for content and assets, reusable form definitions, background jobs, field-aware content listing, grouped projection support for leaderboard and analytics-style views, TTL lifecycle semantics for session-like content, and the semantic-index readiness surfaces for the latest published snapshot of each item. It also reports bootstrap and effective auth posture: whether content writes require a provisioned domain, whether writes are still credentialed even when public discovery is open, and whether vector RAG is currently enabled. MCP callers can pass `draft=false` to `get_content_items`, `get_content_item`, `list_globals`, or `get_global` when they need the latest published snapshot instead of the current working copy, and can pass `locale` plus `fallbackLocale` for localized reads. MCP callers can still pass `includeArchived` to `get_content_items` or `project_content_items` when they need lifecycle-archived rows instead of the default active-only read model. Content reads now also include `embeddingReadiness`, so MCP clients can tell whether the latest published snapshot is actually searchable yet. The agent-guidance task recipes now also expose static `reactiveFollowUp` examples so an agent can discover likely subscription recipes and filters before it asks for a live `guide_task` refinement. For the live readiness layer, read `system://deployment-status`. That snapshot mirrors the reactive MCP status with the active transport, notification method, supported filter fields, and supported topic count. It now also reports bootstrap readiness, effective auth posture, vector RAG readiness, embedding queue health, supervisor UI availability through `checks.ui`, and the readiness of the content-runtime query layer, including grouped projections, localization, globals, reverse references, working-copy preview support, reusable forms, and background jobs. For the authenticated workspace layer, read `system://workspace-context`. That workspace snapshot now also groups the strongest authoring, workflow, review, and paid-content targets for the active actor. If you already know the task class and want the best schema plus the next concrete work target immediately, use `system://workspace-target/<intent>` or the `resolve_workspace_target` tool. That resolution now prioritizes the strongest actionable candidate across the active workspace rather than only picking the busiest schema first. If you want only the task-routing layer, use `system://agent-guidance` instead. If you need to confirm which actor the current MCP session is using, read `system://current-actor` or run `mcp whoami` from the CLI.

Bootstrap note: MCP discovery now tells you when the install has `domainCount: 0`, which MCP tool can create the first domain (`create_domain`), and which guide task to call next (`bootstrap-workspace`). If bootstrap is blocked, either call `create_domain` from MCP or use the REST fallback `POST /api/domains`, then continue with `guide_task("bootstrap-workspace")` or `guide_task("discover-workspace")`.

## Client Config Paths

Different agent clients expect MCP config in different places. Use `wordclaw provision --agent <framework>` to generate the right snippet instead of guessing.

| Client | Preferred helper | Typical project path | Typical user path | Notes |
|--------|-------------------|----------------------|-------------------|-------|
| OpenClaw | `wordclaw provision --agent openclaw` | n/a | `~/.openclaw/openclaw.json` | User-scoped JSON config |
| Codex | `wordclaw provision --agent codex` | n/a | `~/.codex/config.toml` | User-scoped TOML config |
| Claude Code | `wordclaw provision --agent claude-code --scope project` | `.mcp.json` | `~/.claude.json` | WordClaw only writes project-scoped `.mcp.json` directly |
| Cursor | `wordclaw provision --agent cursor --scope project` | `.cursor/mcp.json` | `~/.cursor/mcp.json` | JSON config for project or user scope |

## REST-First Fallback

Some client builds lag on MCP registry UX, and some operators want to bootstrap the workspace before wiring MCP at all. The supported fallback is:

1. Read `GET /api/capabilities` and `GET /api/deployment-status`.
2. If `checks.bootstrap.domainCount` is `0`, create the first domain with `POST /api/domains`.
3. Confirm `checks.ui` if you expect the supervisor at `/ui/`, or run `npm run dev:all` for local API plus UI development.
4. Once the runtime is provisioned, register the MCP server for your client and continue with `guide_task("bootstrap-workspace")` or `guide_task("discover-workspace")`.

Preview-token issuance remains a REST and CLI path today. MCP covers locale-aware working-copy and published reads, but it does not mint public preview tokens directly.

The same discovery surfaces now expose the asset contract too:

- configured versus effective asset storage provider
- supported upload modes over REST and MCP
- whether direct provider upload is currently available, plus the issue/complete paths
- supported delivery modes (`public`, `signed`, `entitled`)
- signed asset issuance path/tool plus the default token TTL
- derivative variant support, including the source field, variant key field, transform metadata field, and list route/tool

Asset discovery is available in-band too:

- `content://assets` lists the current domain asset catalog snapshot
- `content://assets/{id}` returns a single asset metadata snapshot
- `content://assets/{id}/derivatives` lists the current derivative family for a source asset
- `get_asset_usage` returns the active plus historical content references for an asset
- `get_asset_access` explains which REST path to read, whether auth is required, and whether an entitlement-backed offer applies
- `create_asset` accepts `sourceAssetId`, `variantKey`, and `transformSpec` when you need to create a managed derivative variant
- `issue_direct_asset_upload` returns a provider upload URL plus a completion token for S3-compatible direct upload flows
- `issue_direct_asset_upload` also accepts `sourceAssetId`, `variantKey`, and `transformSpec` so direct provider uploads can finalize as derivative assets
- `complete_direct_asset_upload` finalizes the uploaded object into a first-class asset record after the provider write succeeds
- `issue_asset_access` issues a short-lived signed asset URL for `signed` assets, or returns direct public-read guidance when the asset is already public

Recommended remote MCP preflight:

```bash
node dist/cli/index.js mcp inspect \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer

node dist/cli/index.js mcp whoami \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer

node dist/cli/index.js mcp resource system://deployment-status \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer

node dist/cli/index.js mcp resource system://workspace-context \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer

node dist/cli/index.js mcp resource system://workspace-context/review/5 \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer

node dist/cli/index.js mcp resource system://workspace-target/review \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer

node dist/cli/index.js mcp resource system://agent-guidance \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer

node dist/cli/index.js mcp call list_globals --json '{"locale":"nl"}' \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer

node dist/cli/index.js mcp call get_content_item --json '{"id":345,"draft":false,"locale":"nl","fallbackLocale":"en"}' \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer

node dist/cli/index.js mcp resource content://assets \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer

node dist/cli/index.js mcp resource content://assets/44/derivatives \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer

node dist/cli/index.js mcp call guide_task '{"taskId":"discover-deployment"}' \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer

node dist/cli/index.js mcp call guide_task '{"taskId":"bootstrap-workspace"}' \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key remote-admin

node dist/cli/index.js mcp call create_domain '{"name":"Local Development","hostname":"local.development"}' \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key remote-admin

node dist/cli/index.js mcp call guide_task '{"taskId":"discover-workspace","intent":"authoring","workspaceLimit":5}' \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer

node dist/cli/index.js mcp call guide_task '{"taskId":"manage-integrations"}' \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer

node dist/cli/index.js mcp call resolve_workspace_target '{"intent":"review"}' \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer

node dist/cli/index.js mcp call guide_task '{"taskId":"verify-provenance","entityType":"content_item","entityId":123}' \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer
```

For `author-content`, `review-workflow`, `manage-integrations`, and `verify-provenance`, `guide_task` now returns a `reactiveRecommendation` block when MCP reactivity can help the current actor stay in sync with runtime changes. That payload is intentionally runnable:

- `recipeId` points to the preferred reactive subscription recipe when one exists
- `filters` narrows the runtime stream to the current schema, review task, actor, or entity
- `subscribe` contains the exact `subscribe_events` arguments the agent can send next
- `available=false` and `subscribe=null` mean the current actor is missing the scopes required for the recommended stream
- `author-content` returns `reactiveRecommendation=null` until a concrete `contentTypeId` is known, because the schema-design bootstrap path has nothing specific to subscribe to yet

## Starting the Local MCP Server

```bash
npm run mcp:start
```

The local server communicates over **stdio** (stdin/stdout), which remains the default transport for local MCP integrations and the current CLI MCP workflow.

## Remote MCP Endpoint

When the HTTP server is running, remote MCP clients can connect to:

```text
http://localhost:4000/mcp
```

Authentication for the HTTP endpoint matches the main runtime:

- API key via `x-api-key`
- API key via `Authorization: Bearer <api-key>`
- Supervisor session via `supervisor_session` plus `x-wordclaw-domain`

Remote MCP is session-backed today:

- `POST /mcp` initializes the MCP session and handles normal request or response exchange
- the server returns `mcp-session-id` after initialization
- `GET /mcp` holds a standalone SSE stream open for server-pushed notifications
- `DELETE /mcp` closes the active session explicitly

This matters for reactive agents. A long-lived MCP client can now subscribe to runtime events and receive them over the same remote session instead of polling REST or MCP tools on a timer.

## Reactive Subscriptions

Reactive event delivery currently ships as an MCP session feature on the remote HTTP transport.

- Tool: `subscribe_events`
- Notification method: `notifications/wordclaw/event`
- Optional `recipeId` for curated subscriptions:
  - `content-publication`
  - `review-decisions`
  - `content-lifecycle`
  - `schema-governance`
  - `integration-admin`
- Optional filter fields:
  - `entityType`, `entityId`, `action`
  - `contentTypeId`, `status`, `decision`
  - `actorId`, `workflowTransitionId`, `reviewTaskId`
- First supported topics:
  - `content_item.published`
  - `content_item.approved`
  - `workflow.review.approved`
  - `workflow.review.rejected`
  - `content_item.create`, `content_item.update`, `content_item.delete`, `content_item.rollback`
  - `content_type.create`, `content_type.update`, `content_type.delete`
  - `api_key.create`, `api_key.update`, `api_key.delete`
  - `webhook.create`, `webhook.update`, `webhook.delete`
  - `content_item.*`
  - `content_type.*`
  - `api_key.*`
  - `webhook.*`
  - `audit.*`

Scope expectations for those families are intentionally conservative:

- `content_item.*`, `workflow.review.*`, and `content_type.*` require `content:read`, `content:write`, or `admin`
- `api_key.*` and `webhook.*` require `admin`
- `*` remains admin-only

Use `recipeId` when you want a higher-level workflow subscription without enumerating every raw topic yourself. You can still combine a recipe with explicit `topics` and optional filters in the same `subscribe_events` call.

The CLI is intentionally short-lived, so `wordclaw mcp call subscribe_events ...` is useful for contract inspection but not for staying attached long enough to receive pushed notifications. Use a persistent MCP client or the verification script below when you want to observe live events.

```bash
npx tsx verify-mcp-streams.ts

npx tsx demos/mcp-demo-agent.ts watch content_item.published \
  --transport http \
  --base-url http://localhost:4000 \
  --api-key writer

npx tsx demos/mcp-demo-agent.ts watch content_item.published \
  --transport http \
  --base-url http://localhost:4000 \
  --api-key writer \
  --filters '{"contentTypeId":12}'

npx tsx demos/mcp-demo-agent.ts watch api_key.create \
  --transport http \
  --base-url http://localhost:4000 \
  --api-key remote-admin \
  --once

npx tsx demos/mcp-demo-agent.ts watch \
  --recipe integration-admin \
  --transport http \
  --base-url http://localhost:4000 \
  --api-key remote-admin \
  --once
```

The verification script:

- connects to the remote `/mcp` endpoint over Streamable HTTP
- confirms the standalone SSE stream is attached
- subscribes to `content_item.published`
- creates a published content item through the normal REST API
- waits for the matching MCP notification

The demo agent `watch` mode is better for iterative testing:

- keeps the MCP session open until you press `Ctrl+C`
- prints the discovered reactive contract from `system://capabilities`
- subscribes to the requested topic or recipe through `subscribe_events`, optionally with a filter object
- reacts to matching `notifications/wordclaw/event` payloads
- fetches the latest REST snapshot for `content_item` events so you can see the post-notification follow-up

## OpenAI-Compatible Tool Export

If you want to reuse the live MCP tool contract in an OpenAI-compatible agent stack, export the current inventory through the CLI:

```bash
node dist/cli/index.js mcp openai-tools \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer \
  --raw
```

That returns an array of `type: "function"` tool definitions using the live MCP names, descriptions, and input schemas. This is useful when you want an OpenAI tool list that stays aligned with the running WordClaw deployment instead of maintaining a second handwritten contract.

## Tools

Tools are the primary interface for agents. Each tool maps to a CRUD operation and uses Zod for input validation.

### Content Type Tools

| Tool                   | Description                    |
|------------------------|--------------------------------|
| `create_content_type`  | Create a content type schema   |
| `list_content_types`   | List with pagination           |
| `get_content_type`     | Get by ID or slug              |
| `update_content_type`  | Update schema or name          |
| `delete_content_type`  | Delete a content type          |

### Global Tools

| Tool             | Description                                                |
|------------------|------------------------------------------------------------|
| `list_globals`   | List singleton/global documents with locale and draft flags |
| `get_global`     | Get one singleton/global by slug                           |
| `update_global`  | Update the singleton/global document for a slug            |

### Form Tools

| Tool            | Description                                                  |
|-----------------|--------------------------------------------------------------|
| `list_forms`    | List reusable form definitions                               |
| `get_form`      | Get one form definition by id                                |
| `create_form`   | Create a bounded public intake form                          |
| `update_form`   | Update a form definition                                     |
| `delete_form`   | Delete a form definition                                     |
| `submit_form`   | Submit a public-form payload into its target content type    |

### Content Item Tools

| Tool                          | Description                            |
|-------------------------------|----------------------------------------|
| `create_content_item`         | Create a single content item           |
| `create_content_items_batch`  | Batch create (supports atomic mode)    |
| `get_content_items`           | List with filters, locale options, and cursor paging |
| `project_content_items`       | Build grouped buckets for leaderboard and analytics-style views |
| `get_content_item`            | Get by ID with locale and draft options |
| `get_content_item_usage`      | Inspect active and historical reverse references for a content item |
| `update_content_item`         | Update (auto-versions)                 |
| `update_content_items_batch`  | Batch update                           |
| `delete_content_item`         | Delete single                          |
| `delete_content_items_batch`  | Batch delete                           |
| `get_content_item_versions`   | View version history                   |
| `rollback_content_item`       | Rollback to a previous version         |

Read tools now return derived publication metadata too:

- `publicationState`
- `workingCopyVersion`
- `publishedVersion`
- `localeResolution` when a localized read was requested

### Asset Tools

| Tool               | Description                                                          |
|--------------------|----------------------------------------------------------------------|
| `create_asset`     | Upload an asset with public, signed, or entitled access mode         |
| `list_asset_derivatives` | List derivative variants for a source asset                    |
| `issue_direct_asset_upload` | Issue a provider upload URL and completion token for direct asset upload |
| `complete_direct_asset_upload` | Finalize a previously issued direct asset upload into an asset record |
| `list_assets`      | List assets with optional filters and cursor paging                  |
| `get_asset`        | Read a single asset metadata record                                  |
| `get_asset_usage`  | Inspect active and historical reverse references for an asset        |
| `get_asset_access` | Return REST delivery guidance, auth requirements, and available offers |
| `issue_asset_access` | Issue a short-lived signed asset URL or direct public delivery guidance |
| `delete_asset`     | Soft-delete an asset so it can no longer be newly referenced         |
| `restore_asset`    | Restore a soft-deleted asset back to active status                   |
| `purge_asset`      | Permanently remove a soft-deleted asset after reference checks       |

### Background Job Tools

| Tool                             | Description                                        |
|----------------------------------|----------------------------------------------------|
| `list_jobs`                      | List background jobs with optional kind/status filters |
| `get_job`                        | Get one background job by id                       |
| `create_job`                     | Queue a generic background job                     |
| `cancel_job`                     | Cancel a queued background job                     |
| `schedule_content_status_change` | Schedule a future status transition for a content item |

### API Key Tools

| Tool              | Description        |
|-------------------|--------------------|
| `create_api_key`  | Create with scopes |
| `list_api_keys`   | List all keys      |
| `revoke_api_key`  | Revoke a key       |

### Webhook Tools

| Tool               | Description                |
|--------------------|----------------------------|
| `create_webhook`   | Register webhook endpoint  |
| `list_webhooks`    | List all webhooks          |
| `get_webhook`      | Get by ID                  |
| `update_webhook`   | Update URL, events, secret |
| `delete_webhook`   | Delete a webhook           |

### Audit Tools

| Tool             | Description                    |
|------------------|--------------------------------|
| `get_audit_logs` | Cursor-paginated audit trail   |

### Policy Tools

| Tool              | Description                    |
|-------------------|--------------------------------|
| `evaluate_policy` | Dry-run permission checks against the PolicyEngine |
| `subscribe_events` | Subscribe the active MCP session to reactive WordClaw runtime events |

### Agent Guidance Tools

| Tool         | Description                                                                |
|--------------|----------------------------------------------------------------------------|
| `guide_task` | Returns live, actor-aware task guidance for deployment discovery, workspace targeting, content authoring, review, integrations, provenance checks, or paid-content flows |

## Resources

| Resource         | Description                           |
|------------------|---------------------------------------|
| `capabilities`   | Deployment capability manifest as JSON, including bootstrap, auth, and vector-RAG posture |
| `deployment-status` | Live readiness snapshot for database, bootstrap, auth, REST, MCP, vector RAG, embedding queue health, supervisor UI availability, and enabled workers |
| `current-actor`  | Canonical actor, domain, and scope snapshot for the current MCP session |
| `workspace-context` | Current domain, accessible domains, and content-model inventory for the active actor |
| `agent-guidance` | Task-oriented routing hints and recipes for agent workflows |
| `content-types`  | Returns the content type catalog as text |

Resources give agents read-only context about the system state. If `system://deployment-status` shows `domainCount: 0`, bootstrap the first domain over REST before attempting MCP authoring writes.

## Prompts

| Prompt                          | Description                                      |
|---------------------------------|--------------------------------------------------|
| `content-generation-template`   | Guides the agent to generate content matching a schema |
| `workflow-guidance`             | Step-by-step workflow for creating content        |
| `task-guidance`                 | Returns the preferred surface and step recipe for a specific task id |

Prompts are templates that help agents follow best practices when interacting with the CMS.

Current task ids exposed through `task-guidance`:

- `discover-deployment`
- `discover-workspace`
- `author-content`
- `review-workflow`
- `manage-integrations`
- `consume-paid-content`

Current task ids exposed through `guide_task`:

- `discover-deployment`
- `discover-workspace`
- `author-content` with optional `contentTypeId`
- `review-workflow` with optional `reviewTaskId`
- `manage-integrations`
- `verify-provenance` with optional `actorId`, `actorType`, `entityType`, `entityId`, `action`, and `limit`
- `consume-paid-content` with `contentItemId` and optional `offerId`

Reactive guidance today is attached to these `guide_task` flows:

- `author-content` returns schema-design guidance when `contentTypeId` is omitted, and recommends the `content-lifecycle` recipe once `contentTypeId` is known
- `review-workflow` recommends the `review-decisions` recipe and narrows to `reviewTaskId` when provided
- `manage-integrations` recommends the `integration-admin` recipe for API key and webhook changes
- `verify-provenance` recommends either a scoped recipe (`content-lifecycle`, `schema-governance`, `integration-admin`) or a filtered `audit.*` subscription for actor-centric provenance checks

Static discovery surfaces now expose the same idea one layer earlier:

- `system://agent-guidance` and `GET /api/capabilities` include `taskRecipes[*].reactiveFollowUp`
- `task-guidance` includes the same follow-up as text, including an example `subscribe_events` payload
- `guide_task` remains the live refinement layer when the agent knows concrete ids such as `contentTypeId`, `reviewTaskId`, or an actor/entity filter set, but `guide_task { "taskId": "author-content" }` is also the bootstrap path when no schema exists yet

## Response Format

All tool responses follow one of two patterns:

**Success (text)**
```json
{ "content": [{ "type": "text", "text": "Operation completed" }] }
```

**Success (JSON)**
```json
{ "content": [{ "type": "text", "text": "{\"id\": 1, ...}" }] }
```

**Error**
```json
{ "content": [{ "type": "text", "text": "ERROR_CODE: description" }], "isError": true }
```

## Dry-Run Support

Core write tools accept a `dryRun` boolean parameter. When `true`, the tool validates input and simulates the operation without persisting changes. REST and MCP remain the required dry-run surfaces for core capability work; GraphQL mirrors those semantics where the compatibility surface is implemented.
