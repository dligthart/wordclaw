# Capability Parity Matrix

This matrix is the source of truth for protocol-level parity across:

- REST API (`src/api/routes.ts`)
- GraphQL API (`src/graphql/schema.ts`, `src/graphql/resolvers.ts`)
- MCP server (`src/mcp/server.ts`)

Automated guardrail:

- `src/contracts/capability-parity.test.ts` validates this contract in CI/local tests.

## Coverage

| Capability | REST | GraphQL | MCP | Dry-Run |
| --- | --- | --- | --- | --- |
| Create content type | `POST /api/content-types` | `createContentType` | `create_content_type` | Yes |
| List content types | `GET /api/content-types` | `contentTypes` | `list_content_types` | N/A |
| Get content type | `GET /api/content-types/:id` | `contentType` | `get_content_type` | N/A |
| Update content type | `PUT /api/content-types/:id` | `updateContentType` | `update_content_type` | Yes |
| Delete content type | `DELETE /api/content-types/:id` | `deleteContentType` | `delete_content_type` | Yes |
| Create content item | `POST /api/content-items` | `createContentItem` | `create_content_item` | Yes |
| List content items | `GET /api/content-items` (`contentTypeId` filter) | `contentItems(contentTypeId)` | `get_content_items(contentTypeId)` | N/A |
| Get content item | `GET /api/content-items/:id` | `contentItem` | `get_content_item` | N/A |
| Update content item | `PUT /api/content-items/:id` | `updateContentItem` | `update_content_item` | Yes |
| Delete content item | `DELETE /api/content-items/:id` | `deleteContentItem` | `delete_content_item` | Yes |
| List item versions | `GET /api/content-items/:id/versions` | `contentItemVersions` | `get_content_item_versions` | N/A |
| Rollback content item | `POST /api/content-items/:id/rollback` | `rollbackContentItem` | `rollback_content_item` | Yes |
| List audit logs | `GET /api/audit-logs` | `auditLogs` | `get_audit_logs` | N/A |

## Enforcement Rule

Any new operational capability must be added to:

1. `src/contracts/capability-matrix.ts`
2. REST route surface
3. GraphQL schema/resolver surface
4. MCP tool surface

If any one surface is missing, parity tests fail.
