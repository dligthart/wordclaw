# Capability Parity Matrix

This matrix is the source of truth for core capability coverage across protocol surfaces.

Incubator surfaces such as agent-run orchestration are intentionally excluded from the default matrix. They may exist behind runtime feature flags, but they are not part of the supported core parity contract.

- REST API (`src/api/routes.ts`)
- MCP server (`src/mcp/server.ts`)
- GraphQL API (`src/graphql/schema.ts`, `src/graphql/resolvers.ts`) as a compatibility surface

Automated guardrail:

- `src/contracts/capability-parity.test.ts` validates required surfaces in CI/local tests and checks GraphQL compatibility coverage when it is declared in the matrix.

Contract tiers:

- **Required core surfaces:** REST and MCP
- **Compatibility surface:** GraphQL
- **Rule for new capabilities:** add REST and MCP first; add GraphQL only when the compatibility surface is intentionally extended

## Coverage

| Capability | REST (Required) | GraphQL (Compatibility) | MCP (Required) | Dry-Run |
| --- | --- | --- | --- | --- |
| Create a domain for workspace bootstrap or multi-domain administration | `POST /api/domains` | N/A | `create_domain` | N/A |
| Create content type schema | `POST /api/content-types` | `createContentType` | `create_content_type` | Yes |
| List content types | `GET /api/content-types` | `contentTypes` | `list_content_types` | N/A |
| Get content type by ID | `GET /api/content-types/:id` | `contentType` | `get_content_type` | N/A |
| Update content type | `PUT /api/content-types/:id` | `updateContentType` | `update_content_type` | Yes |
| Delete content type | `DELETE /api/content-types/:id` | `deleteContentType` | `delete_content_type` | Yes |
| List singleton/global content types and their current item | `GET /api/globals` | `globals` | `list_globals` | N/A |
| Get a singleton/global content type by slug | `GET /api/globals/:slug` | `global` | `get_global` | N/A |
| Create or update the singleton item for a global content type | `PUT /api/globals/:slug` | `updateGlobal` | `update_global` | N/A |
| List reusable form definitions | `GET /api/forms` | `forms` | `list_forms` | N/A |
| Get a reusable form definition | `GET /api/forms/:id` | `form` | `get_form` | N/A |
| Create a reusable form definition | `POST /api/forms` | `createForm` | `create_form` | N/A |
| Update a reusable form definition | `PUT /api/forms/:id` | `updateForm` | `update_form` | N/A |
| Delete a reusable form definition | `DELETE /api/forms/:id` | `deleteForm` | `delete_form` | N/A |
| Submit a public form payload into its target content type | `POST /api/public/forms/:slug/submissions` | N/A | `submit_form` | N/A |
| Upload an asset | `POST /api/assets` | N/A | `create_asset` | N/A |
| Issue a direct provider upload URL and completion token for an asset | `POST /api/assets/direct-upload` | N/A | `issue_direct_asset_upload` | N/A |
| Finalize a previously issued direct provider upload | `POST /api/assets/direct-upload/complete` | N/A | `complete_direct_asset_upload` | N/A |
| List assets | `GET /api/assets` | N/A | `list_assets` | N/A |
| Get asset by ID | `GET /api/assets/:id` | N/A | `get_asset` | N/A |
| Inspect reverse references for an asset | `GET /api/assets/:id/used-by` | `assetUsedBy` | `get_asset_usage` | N/A |
| List derivative variants for a source asset | `GET /api/assets/:id/derivatives` | N/A | `list_asset_derivatives` | N/A |
| Issue signed asset access or direct delivery guidance | `POST /api/assets/:id/access` | N/A | `issue_asset_access` | N/A |
| Soft-delete an asset | `DELETE /api/assets/:id` | N/A | `delete_asset` | N/A |
| Restore a soft-deleted asset | `POST /api/assets/:id/restore` | N/A | `restore_asset` | N/A |
| Permanently remove a soft-deleted asset | `POST /api/assets/:id/purge` | N/A | `purge_asset` | N/A |
| Create content item | `POST /api/content-items` | `createContentItem` | `create_content_item` | Yes |
| Create multiple content items | `POST /api/content-items/batch` | `createContentItemsBatch` | `create_content_items_batch` | Yes |
| List content items | `GET /api/content-items` | `contentItems` | `get_content_items` | N/A |
| Build grouped read-model buckets from content items | `GET /api/content-items/projections` | `contentItemProjection` | `project_content_items` | N/A |
| Get content item by ID | `GET /api/content-items/:id` | `contentItem` | `get_content_item` | N/A |
| Inspect reverse references for a content item | `GET /api/content-items/:id/used-by` | `contentItemUsedBy` | `get_content_item_usage` | N/A |
| Update content item | `PUT /api/content-items/:id` | `updateContentItem` | `update_content_item` | Yes |
| Update multiple content items | `PUT /api/content-items/batch` | `updateContentItemsBatch` | `update_content_items_batch` | Yes |
| Delete content item | `DELETE /api/content-items/:id` | `deleteContentItem` | `delete_content_item` | Yes |
| Delete multiple content items | `DELETE /api/content-items/batch` | `deleteContentItemsBatch` | `delete_content_items_batch` | Yes |
| List item version history | `GET /api/content-items/:id/versions` | `contentItemVersions` | `get_content_item_versions` | N/A |
| Rollback item to a previous version | `POST /api/content-items/:id/rollback` | `rollbackContentItem` | `rollback_content_item` | Yes |
| List background jobs | `GET /api/jobs` | `jobs` | `list_jobs` | N/A |
| Get background job by ID | `GET /api/jobs/:id` | `job` | `get_job` | N/A |
| Create a generic background job | `POST /api/jobs` | `createJob` | `create_job` | N/A |
| Cancel a queued background job | `DELETE /api/jobs/:id` | `cancelJob` | `cancel_job` | N/A |
| Schedule a future content item status change | `POST /api/content-items/:id/schedule-status` | `scheduleContentStatusChange` | `schedule_content_status_change` | N/A |
| List audit logs with filters | `GET /api/audit-logs` | `auditLogs` | `get_audit_logs` | N/A |
| Register a webhook endpoint for audit events | `POST /api/webhooks` | `createWebhook` | `create_webhook` | N/A |
| List registered webhooks | `GET /api/webhooks` | `webhooks` | `list_webhooks` | N/A |
| Get webhook by ID | `GET /api/webhooks/:id` | `webhook` | `get_webhook` | N/A |
| Update webhook URL, events, secret, or active state | `PUT /api/webhooks/:id` | `updateWebhook` | `update_webhook` | N/A |
| Delete a webhook registration | `DELETE /api/webhooks/:id` | `deleteWebhook` | `delete_webhook` | N/A |
| List L402 payments | `GET /api/payments` | `payments` | `list_payments` | N/A |
| Get payment by ID | `GET /api/payments/:id` | `payment` | `get_payment` | N/A |

## Enforcement Rule

Any new core operational capability must be added to:

1. `src/contracts/capability-matrix.ts`
2. REST route surface
3. MCP tool surface

GraphQL is optional for new capabilities. If a capability declares GraphQL coverage in the matrix, the compatibility tests require the schema/resolver surface to exist and stay aligned.
