# API Reference

WordClaw exposes the same capabilities through three protocols. This document covers the REST API. For GraphQL, use the interactive playground at `/graphql`. For MCP, see [mcp-integration.md](mcp-integration.md).

## Authentication

When `AUTH_REQUIRED=true`, every request must include an API key:

```
x-api-key: <key>
# or
Authorization: Bearer <key>
```

Scopes: `content:read`, `content:write`, `audit:read`, `admin`.

## Common Headers

| Header             | Purpose                                        |
|--------------------|------------------------------------------------|
| `x-request-id`    | Trace ID (auto-generated if absent)            |
| `Idempotency-Key` | Deduplicates POST/PUT/DELETE within TTL window |
| `x-api-key`       | API key for authentication                     |

## Dry-Run Mode

Append `?mode=dry_run` to any mutation endpoint. The server validates input and simulates execution without persisting changes. GraphQL mutations accept `dryRun: true`.

---

## Content Types

### Create Content Type

```
POST /api/content-types
```

| Field    | Type   | Required | Description                    |
|----------|--------|----------|--------------------------------|
| `name`   | string | yes      | Unique name                    |
| `schema` | string | yes      | JSON schema for content items  |
| `slug`   | string | no       | URL-friendly identifier        |

### List Content Types

```
GET /api/content-types?limit=20&offset=0
```

### Get Content Type

```
GET /api/content-types/:id
```

### Update Content Type

```
PUT /api/content-types/:id
```

### Delete Content Type

```
DELETE /api/content-types/:id
```

---

## Content Items

### Create Content Item

```
POST /api/content-items
```

| Field           | Type   | Required | Description                          |
|-----------------|--------|----------|--------------------------------------|
| `contentTypeId` | number | yes      | Reference to content type            |
| `data`          | string | yes      | JSON content (validated against schema) |
| `status`        | string | no       | `draft` (default), `published`, `archived` |

### Batch Create

```
POST /api/content-items/batch
```

| Field    | Type    | Required | Description                            |
|----------|---------|----------|----------------------------------------|
| `items`  | array   | yes      | Array of content item payloads         |
| `atomic` | boolean | no       | `true` = all-or-nothing transaction    |

### List Content Items

```
GET /api/content-items?contentTypeId=1&status=published&limit=20&offset=0
```

Filters: `contentTypeId`, `status`, `createdAfter`, `createdBefore`, `limit`, `offset`.

### Get / Update / Delete

```
GET    /api/content-items/:id
PUT    /api/content-items/:id
DELETE /api/content-items/:id
```

### Batch Update / Delete

```
PUT    /api/content-items/batch
DELETE /api/content-items/batch
```

### Version History

```
GET /api/content-items/:id/versions
```

### Rollback

```
POST /api/content-items/:id/rollback
```

| Field     | Type   | Required | Description                |
|-----------|--------|----------|----------------------------|
| `version` | number | yes      | Target version to restore  |

---

## Webhooks

### Create Webhook

```
POST /api/webhooks
```

| Field    | Type     | Required | Description                                |
|----------|----------|----------|--------------------------------------------|
| `url`    | string   | yes      | Callback URL                               |
| `events` | string[] | yes      | Event patterns (e.g. `content_item.create`) |
| `secret` | string   | yes      | HMAC-SHA256 signing secret                 |
| `active` | boolean  | no       | Default `true`                             |

### List / Get / Update / Delete

```
GET    /api/webhooks
GET    /api/webhooks/:id
PUT    /api/webhooks/:id
DELETE /api/webhooks/:id
```

---

## API Keys

### Create API Key

```
POST /api/auth/keys
```

| Field    | Type     | Required | Description                 |
|----------|----------|----------|-----------------------------|
| `name`   | string   | yes      | Key label                   |
| `scopes` | string[] | yes      | Granted permission scopes   |

### List / Rotate / Revoke

```
GET    /api/auth/keys
POST   /api/auth/keys/:id/rotate
DELETE /api/auth/keys/:id
```

---

## Audit Logs

```
GET /api/audit-logs?entityType=content_item&action=create&limit=50&cursor=<base64>
```

Cursor-paginated, newest-first. The response includes a cursor for the next page.

---

## Error Format

All errors follow a structured envelope:

```json
{
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE",
  "remediation": "What to do next",
  "context": { "requestId": "..." }
}
```

Common codes: `EMPTY_UPDATE_BODY`, `CONTENT_TYPE_NOT_FOUND`, `CONTENT_ITEM_NOT_FOUND`, `INVALID_CONTENT_SCHEMA_JSON`, `CONTENT_SCHEMA_VALIDATION_FAILED`, `TARGET_VERSION_NOT_FOUND`, `AUTH_MISSING_API_KEY`, `AUTH_INSUFFICIENT_SCOPE`.

---

## OpenAPI / Swagger

Interactive API docs are served at:

```
GET /documentation
```
