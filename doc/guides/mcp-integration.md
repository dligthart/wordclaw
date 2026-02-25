# MCP Integration

WordClaw ships a [Model Context Protocol](https://modelcontextprotocol.io/) server so LLM agents can manage content without writing HTTP requests. The MCP server exposes the same operations as the REST and GraphQL APIs through **tools**, **resources**, and **prompts**.

## Starting the MCP Server

```bash
npm run mcp:start
```

The server communicates over **stdio** (stdin/stdout), which is the standard transport for local MCP integrations.

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
| `content-types`  | Returns the content type catalog as text |

Resources give agents read-only context about the system state.

## Prompts

| Prompt                          | Description                                      |
|---------------------------------|--------------------------------------------------|
| `content-generation-template`   | Guides the agent to generate content matching a schema |
| `workflow-guidance`             | Step-by-step workflow for creating content        |

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

All write tools accept a `dryRun` boolean parameter. When `true`, the tool validates input and simulates the operation without persisting changes.
