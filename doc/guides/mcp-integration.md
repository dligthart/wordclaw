# MCP Integration

WordClaw ships a [Model Context Protocol](https://modelcontextprotocol.io/) server so LLM agents can manage content without writing HTTP requests. MCP is one of the two primary product surfaces alongside REST. The current runtime still exposes GraphQL, but GraphQL is treated as a compatibility layer rather than the default contract for new agent capabilities.

The tool coverage documented in this guide reflects the default core parity contract. Incubator-only tools, such as agent-run orchestration, are intentionally excluded unless operators explicitly enable those runtime flags.

## Transports

WordClaw now exposes MCP in two ways:

- **Local stdio** for embedded or developer-run MCP sessions
- **Streamable HTTP** at `/mcp` for attachable remote clients

For machine-readable discovery of the current deployment contract, read the `system://capabilities` resource or use `mcp inspect` from the CLI. That manifest reports the enabled module set, protocol expectations, dry-run coverage, the currently available MCP transports, task-oriented routing hints, and the actor/auth profiles an agent can use for workflows such as workspace targeting, authoring, review, integration setup, provenance verification, and paid-content consumption. The MCP section now also includes a reactive contract block describing whether session-backed subscriptions are enabled, which tool to call, which notification method to handle, which session header is used, which filter fields are supported, and which topics are currently supported. The manifest also now exposes the content-runtime query contract, including field-aware content listing and grouped projection support for leaderboard and analytics-style views. The agent-guidance task recipes now also expose static `reactiveFollowUp` examples so an agent can discover likely subscription recipes and filters before it asks for a live `guide_task` refinement. For the live readiness layer, read `system://deployment-status`. That snapshot mirrors the reactive MCP status with the active transport, notification method, supported filter fields, and supported topic count. It now also reports the readiness of the content-runtime query layer, including grouped projections. For the authenticated workspace layer, read `system://workspace-context`. That workspace snapshot now also groups the strongest authoring, workflow, review, and paid-content targets for the active actor. If you already know the task class and want the best schema plus the next concrete work target immediately, use `system://workspace-target/<intent>` or the `resolve_workspace_target` tool. That resolution now prioritizes the strongest actionable candidate across the active workspace rather than only picking the busiest schema first. If you want only the task-routing layer, use `system://agent-guidance` instead. If you need to confirm which actor the current MCP session is using, read `system://current-actor` or run `mcp whoami` from the CLI.

The same discovery surfaces now expose the asset contract too:

- configured versus effective asset storage provider
- supported upload modes over REST and MCP
- supported delivery modes (`public`, `signed`, `entitled`)
- signed asset issuance path/tool plus the default token TTL

Asset discovery is available in-band too:

- `content://assets` lists the current domain asset catalog snapshot
- `content://assets/{id}` returns a single asset metadata snapshot
- `get_asset_access` explains which REST path to read, whether auth is required, and whether an entitlement-backed offer applies
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

node dist/cli/index.js mcp resource content://assets \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer

node dist/cli/index.js mcp call guide_task '{"taskId":"discover-deployment"}' \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer

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

### Content Item Tools

| Tool                          | Description                            |
|-------------------------------|----------------------------------------|
| `create_content_item`         | Create a single content item           |
| `create_content_items_batch`  | Batch create (supports atomic mode)    |
| `get_content_items`           | List with filters and cursor paging    |
| `project_content_items`       | Build grouped buckets for leaderboard and analytics-style views |
| `get_content_item`            | Get by ID                              |
| `update_content_item`         | Update (auto-versions)                 |
| `update_content_items_batch`  | Batch update                           |
| `delete_content_item`         | Delete single                          |
| `delete_content_items_batch`  | Batch delete                           |
| `get_content_item_versions`   | View version history                   |
| `rollback_content_item`       | Rollback to a previous version         |

### Asset Tools

| Tool               | Description                                                          |
|--------------------|----------------------------------------------------------------------|
| `create_asset`     | Upload an asset with public, signed, or entitled access mode         |
| `list_assets`      | List assets with optional filters and cursor paging                  |
| `get_asset`        | Read a single asset metadata record                                  |
| `get_asset_access` | Return REST delivery guidance, auth requirements, and available offers |
| `issue_asset_access` | Issue a short-lived signed asset URL or direct public delivery guidance |
| `delete_asset`     | Soft-delete an asset so it can no longer be newly referenced         |
| `restore_asset`    | Restore a soft-deleted asset back to active status                   |
| `purge_asset`      | Permanently remove a soft-deleted asset after reference checks       |

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
| `capabilities`   | Deployment capability manifest as JSON |
| `deployment-status` | Live readiness snapshot for database, REST, MCP, and enabled workers |
| `current-actor`  | Canonical actor, domain, and scope snapshot for the current MCP session |
| `workspace-context` | Current domain, accessible domains, and content-model inventory for the active actor |
| `agent-guidance` | Task-oriented routing hints and recipes for agent workflows |
| `content-types`  | Returns the content type catalog as text |

Resources give agents read-only context about the system state.

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
- `author-content` with `contentTypeId`
- `review-workflow` with optional `reviewTaskId`
- `manage-integrations`
- `verify-provenance` with optional `actorId`, `actorType`, `entityType`, `entityId`, `action`, and `limit`
- `consume-paid-content` with `contentItemId` and optional `offerId`

Reactive guidance today is attached to these `guide_task` flows:

- `author-content` recommends the `content-lifecycle` recipe scoped by `contentTypeId`
- `review-workflow` recommends the `review-decisions` recipe and narrows to `reviewTaskId` when provided
- `manage-integrations` recommends the `integration-admin` recipe for API key and webhook changes
- `verify-provenance` recommends either a scoped recipe (`content-lifecycle`, `schema-governance`, `integration-admin`) or a filtered `audit.*` subscription for actor-centric provenance checks

Static discovery surfaces now expose the same idea one layer earlier:

- `system://agent-guidance` and `GET /api/capabilities` include `taskRecipes[*].reactiveFollowUp`
- `task-guidance` includes the same follow-up as text, including an example `subscribe_events` payload
- `guide_task` remains the live refinement layer when the agent knows concrete ids such as `contentTypeId`, `reviewTaskId`, or an actor/entity filter set

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
