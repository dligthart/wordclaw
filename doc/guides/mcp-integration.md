# MCP Integration

WordClaw ships a [Model Context Protocol](https://modelcontextprotocol.io/) server so LLM agents can manage content without writing HTTP requests. MCP is one of the two primary product surfaces alongside REST. The current runtime still exposes GraphQL, but GraphQL is treated as a compatibility layer rather than the default contract for new agent capabilities.

The tool coverage documented in this guide reflects the default core parity contract. Incubator-only tools, such as agent-run orchestration, are intentionally excluded unless operators explicitly enable those runtime flags.

## Transports

WordClaw now exposes MCP in two ways:

- **Local stdio** for embedded or developer-run MCP sessions
- **Streamable HTTP** at `/mcp` for attachable remote clients

For machine-readable discovery of the current deployment contract, read the `system://capabilities` resource or use `mcp inspect` from the CLI. That manifest reports the enabled module set, protocol expectations, dry-run coverage, the currently available MCP transports, task-oriented routing hints, and the actor/auth profiles an agent can use for workflows such as authoring, review, integration setup, and paid-content consumption. If you want only the task-routing layer, use `system://agent-guidance` instead.

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

Remote MCP is stateless today:

- `POST /mcp` handles MCP requests
- `GET /mcp` returns `405`, so clients fall back to request/response mode instead of a long-lived SSE stream
- no MCP session ID is issued

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
| `get_content_items`           | List with filters                      |
| `get_content_item`            | Get by ID                              |
| `update_content_item`         | Update (auto-versions)                 |
| `update_content_items_batch`  | Batch update                           |
| `delete_content_item`         | Delete single                          |
| `delete_content_items_batch`  | Batch delete                           |
| `get_content_item_versions`   | View version history                   |
| `rollback_content_item`       | Rollback to a previous version         |

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

## Resources

| Resource         | Description                           |
|------------------|---------------------------------------|
| `capabilities`   | Deployment capability manifest as JSON |
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
