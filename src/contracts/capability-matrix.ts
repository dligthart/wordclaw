export type RestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type GraphqlOperation = 'Query' | 'Mutation';

export const requiredProtocolSurfaces = ['rest', 'mcp'] as const;
export const compatibilityProtocolSurfaces = ['graphql'] as const;

export type Capability = {
    id: string;
    description: string;
    rest: {
        method: RestMethod;
        path: string;
    };
    graphql?: {
        operation: GraphqlOperation;
        field: string;
    };
    mcp: {
        tool: string;
    };
};

// Core capability coverage only. Incubator surfaces such as agent-run orchestration
// are intentionally excluded from the default parity contract.
export const capabilityMatrix: Capability[] = [
    {
        id: 'create_domain',
        description: 'Create a domain for workspace bootstrap or multi-domain administration',
        rest: { method: 'POST', path: '/domains' },
        mcp: { tool: 'create_domain' }
    },
    {
        id: 'create_content_type',
        description: 'Create content type schema',
        rest: { method: 'POST', path: '/content-types' },
        graphql: { operation: 'Mutation', field: 'createContentType' },
        mcp: { tool: 'create_content_type' }
    },
    {
        id: 'list_content_types',
        description: 'List content types',
        rest: { method: 'GET', path: '/content-types' },
        graphql: { operation: 'Query', field: 'contentTypes' },
        mcp: { tool: 'list_content_types' }
    },
    {
        id: 'get_content_type',
        description: 'Get content type by ID',
        rest: { method: 'GET', path: '/content-types/:id' },
        graphql: { operation: 'Query', field: 'contentType' },
        mcp: { tool: 'get_content_type' }
    },
    {
        id: 'update_content_type',
        description: 'Update content type',
        rest: { method: 'PUT', path: '/content-types/:id' },
        graphql: { operation: 'Mutation', field: 'updateContentType' },
        mcp: { tool: 'update_content_type' }
    },
    {
        id: 'delete_content_type',
        description: 'Delete content type',
        rest: { method: 'DELETE', path: '/content-types/:id' },
        graphql: { operation: 'Mutation', field: 'deleteContentType' },
        mcp: { tool: 'delete_content_type' }
    },
    {
        id: 'list_globals',
        description: 'List singleton/global content types and their current item',
        rest: { method: 'GET', path: '/globals' },
        graphql: { operation: 'Query', field: 'globals' },
        mcp: { tool: 'list_globals' }
    },
    {
        id: 'get_global',
        description: 'Get a singleton/global content type by slug',
        rest: { method: 'GET', path: '/globals/:slug' },
        graphql: { operation: 'Query', field: 'global' },
        mcp: { tool: 'get_global' }
    },
    {
        id: 'update_global',
        description: 'Create or update the singleton item for a global content type',
        rest: { method: 'PUT', path: '/globals/:slug' },
        graphql: { operation: 'Mutation', field: 'updateGlobal' },
        mcp: { tool: 'update_global' }
    },
    {
        id: 'list_forms',
        description: 'List reusable form definitions',
        rest: { method: 'GET', path: '/forms' },
        graphql: { operation: 'Query', field: 'forms' },
        mcp: { tool: 'list_forms' }
    },
    {
        id: 'get_form',
        description: 'Get a reusable form definition',
        rest: { method: 'GET', path: '/forms/:id' },
        graphql: { operation: 'Query', field: 'form' },
        mcp: { tool: 'get_form' }
    },
    {
        id: 'create_form',
        description: 'Create a reusable form definition',
        rest: { method: 'POST', path: '/forms' },
        graphql: { operation: 'Mutation', field: 'createForm' },
        mcp: { tool: 'create_form' }
    },
    {
        id: 'update_form',
        description: 'Update a reusable form definition',
        rest: { method: 'PUT', path: '/forms/:id' },
        graphql: { operation: 'Mutation', field: 'updateForm' },
        mcp: { tool: 'update_form' }
    },
    {
        id: 'delete_form',
        description: 'Delete a reusable form definition',
        rest: { method: 'DELETE', path: '/forms/:id' },
        graphql: { operation: 'Mutation', field: 'deleteForm' },
        mcp: { tool: 'delete_form' }
    },
    {
        id: 'submit_form',
        description: 'Submit a public form payload into its target content type',
        rest: { method: 'POST', path: '/public/forms/:slug/submissions' },
        mcp: { tool: 'submit_form' }
    },
    {
        id: 'list_ai_provider_configs',
        description: 'List tenant-scoped AI provider credentials used by provider-backed draft generation',
        rest: { method: 'GET', path: '/ai/providers' },
        mcp: { tool: 'list_ai_provider_configs' }
    },
    {
        id: 'get_ai_provider_config',
        description: 'Inspect one tenant-scoped AI provider credential',
        rest: { method: 'GET', path: '/ai/providers/:provider' },
        mcp: { tool: 'get_ai_provider_config' }
    },
    {
        id: 'configure_ai_provider',
        description: 'Create or update a tenant-scoped AI provider credential',
        rest: { method: 'PUT', path: '/ai/providers/:provider' },
        mcp: { tool: 'configure_ai_provider' }
    },
    {
        id: 'delete_ai_provider_config',
        description: 'Delete a tenant-scoped AI provider credential',
        rest: { method: 'DELETE', path: '/ai/providers/:provider' },
        mcp: { tool: 'delete_ai_provider_config' }
    },
    {
        id: 'list_workforce_agents',
        description: 'List tenant-managed workforce agents',
        rest: { method: 'GET', path: '/workforce/agents' },
        mcp: { tool: 'list_workforce_agents' }
    },
    {
        id: 'get_workforce_agent',
        description: 'Inspect one tenant-managed workforce agent',
        rest: { method: 'GET', path: '/workforce/agents/:id' },
        mcp: { tool: 'get_workforce_agent' }
    },
    {
        id: 'create_workforce_agent',
        description: 'Create a tenant-managed workforce agent',
        rest: { method: 'POST', path: '/workforce/agents' },
        mcp: { tool: 'create_workforce_agent' }
    },
    {
        id: 'update_workforce_agent',
        description: 'Update a tenant-managed workforce agent',
        rest: { method: 'PUT', path: '/workforce/agents/:id' },
        mcp: { tool: 'update_workforce_agent' }
    },
    {
        id: 'delete_workforce_agent',
        description: 'Delete a tenant-managed workforce agent',
        rest: { method: 'DELETE', path: '/workforce/agents/:id' },
        mcp: { tool: 'delete_workforce_agent' }
    },
    {
        id: 'create_asset',
        description: 'Upload an asset',
        rest: { method: 'POST', path: '/assets' },
        mcp: { tool: 'create_asset' }
    },
    {
        id: 'issue_direct_asset_upload',
        description: 'Issue a direct provider upload URL and completion token for an asset',
        rest: { method: 'POST', path: '/assets/direct-upload' },
        mcp: { tool: 'issue_direct_asset_upload' }
    },
    {
        id: 'complete_direct_asset_upload',
        description: 'Finalize a previously issued direct provider upload',
        rest: { method: 'POST', path: '/assets/direct-upload/complete' },
        mcp: { tool: 'complete_direct_asset_upload' }
    },
    {
        id: 'list_assets',
        description: 'List assets',
        rest: { method: 'GET', path: '/assets' },
        mcp: { tool: 'list_assets' }
    },
    {
        id: 'get_asset',
        description: 'Get asset by ID',
        rest: { method: 'GET', path: '/assets/:id' },
        mcp: { tool: 'get_asset' }
    },
    {
        id: 'get_asset_usage',
        description: 'Inspect reverse references for an asset',
        rest: { method: 'GET', path: '/assets/:id/used-by' },
        graphql: { operation: 'Query', field: 'assetUsedBy' },
        mcp: { tool: 'get_asset_usage' }
    },
    {
        id: 'list_asset_derivatives',
        description: 'List derivative variants for a source asset',
        rest: { method: 'GET', path: '/assets/:id/derivatives' },
        mcp: { tool: 'list_asset_derivatives' }
    },
    {
        id: 'issue_asset_access',
        description: 'Issue signed asset access or direct delivery guidance',
        rest: { method: 'POST', path: '/assets/:id/access' },
        mcp: { tool: 'issue_asset_access' }
    },
    {
        id: 'delete_asset',
        description: 'Soft-delete an asset',
        rest: { method: 'DELETE', path: '/assets/:id' },
        mcp: { tool: 'delete_asset' }
    },
    {
        id: 'restore_asset',
        description: 'Restore a soft-deleted asset',
        rest: { method: 'POST', path: '/assets/:id/restore' },
        mcp: { tool: 'restore_asset' }
    },
    {
        id: 'purge_asset',
        description: 'Permanently remove a soft-deleted asset',
        rest: { method: 'POST', path: '/assets/:id/purge' },
        mcp: { tool: 'purge_asset' }
    },
    {
        id: 'create_content_item',
        description: 'Create content item',
        rest: { method: 'POST', path: '/content-items' },
        graphql: { operation: 'Mutation', field: 'createContentItem' },
        mcp: { tool: 'create_content_item' }
    },
    {
        id: 'create_content_items_batch',
        description: 'Create multiple content items',
        rest: { method: 'POST', path: '/content-items/batch' },
        graphql: { operation: 'Mutation', field: 'createContentItemsBatch' },
        mcp: { tool: 'create_content_items_batch' }
    },
    {
        id: 'list_content_items',
        description: 'List content items',
        rest: { method: 'GET', path: '/content-items' },
        graphql: { operation: 'Query', field: 'contentItems' },
        mcp: { tool: 'get_content_items' }
    },
    {
        id: 'project_content_items',
        description: 'Build grouped read-model buckets from content items',
        rest: { method: 'GET', path: '/content-items/projections' },
        graphql: { operation: 'Query', field: 'contentItemProjection' },
        mcp: { tool: 'project_content_items' }
    },
    {
        id: 'get_content_item',
        description: 'Get content item by ID',
        rest: { method: 'GET', path: '/content-items/:id' },
        graphql: { operation: 'Query', field: 'contentItem' },
        mcp: { tool: 'get_content_item' }
    },
    {
        id: 'get_content_item_usage',
        description: 'Inspect reverse references for a content item',
        rest: { method: 'GET', path: '/content-items/:id/used-by' },
        graphql: { operation: 'Query', field: 'contentItemUsedBy' },
        mcp: { tool: 'get_content_item_usage' }
    },
    {
        id: 'update_content_item',
        description: 'Update content item',
        rest: { method: 'PUT', path: '/content-items/:id' },
        graphql: { operation: 'Mutation', field: 'updateContentItem' },
        mcp: { tool: 'update_content_item' }
    },
    {
        id: 'update_content_items_batch',
        description: 'Update multiple content items',
        rest: { method: 'PUT', path: '/content-items/batch' },
        graphql: { operation: 'Mutation', field: 'updateContentItemsBatch' },
        mcp: { tool: 'update_content_items_batch' }
    },
    {
        id: 'delete_content_item',
        description: 'Delete content item',
        rest: { method: 'DELETE', path: '/content-items/:id' },
        graphql: { operation: 'Mutation', field: 'deleteContentItem' },
        mcp: { tool: 'delete_content_item' }
    },
    {
        id: 'delete_content_items_batch',
        description: 'Delete multiple content items',
        rest: { method: 'DELETE', path: '/content-items/batch' },
        graphql: { operation: 'Mutation', field: 'deleteContentItemsBatch' },
        mcp: { tool: 'delete_content_items_batch' }
    },
    {
        id: 'list_content_item_versions',
        description: 'List item version history',
        rest: { method: 'GET', path: '/content-items/:id/versions' },
        graphql: { operation: 'Query', field: 'contentItemVersions' },
        mcp: { tool: 'get_content_item_versions' }
    },
    {
        id: 'rollback_content_item',
        description: 'Rollback item to a previous version',
        rest: { method: 'POST', path: '/content-items/:id/rollback' },
        graphql: { operation: 'Mutation', field: 'rollbackContentItem' },
        mcp: { tool: 'rollback_content_item' }
    },
    {
        id: 'list_jobs',
        description: 'List background jobs',
        rest: { method: 'GET', path: '/jobs' },
        graphql: { operation: 'Query', field: 'jobs' },
        mcp: { tool: 'list_jobs' }
    },
    {
        id: 'get_job',
        description: 'Get background job by ID',
        rest: { method: 'GET', path: '/jobs/:id' },
        graphql: { operation: 'Query', field: 'job' },
        mcp: { tool: 'get_job' }
    },
    {
        id: 'create_job',
        description: 'Create a generic background job',
        rest: { method: 'POST', path: '/jobs' },
        graphql: { operation: 'Mutation', field: 'createJob' },
        mcp: { tool: 'create_job' }
    },
    {
        id: 'cancel_job',
        description: 'Cancel a queued background job',
        rest: { method: 'DELETE', path: '/jobs/:id' },
        graphql: { operation: 'Mutation', field: 'cancelJob' },
        mcp: { tool: 'cancel_job' }
    },
    {
        id: 'schedule_content_status_change',
        description: 'Schedule a future content item status change',
        rest: { method: 'POST', path: '/content-items/:id/schedule-status' },
        graphql: { operation: 'Mutation', field: 'scheduleContentStatusChange' },
        mcp: { tool: 'schedule_content_status_change' }
    },
    {
        id: 'list_audit_logs',
        description: 'List audit logs with filters',
        rest: { method: 'GET', path: '/audit-logs' },
        graphql: { operation: 'Query', field: 'auditLogs' },
        mcp: { tool: 'get_audit_logs' }
    },
    {
        id: 'create_webhook',
        description: 'Register a webhook endpoint for audit events',
        rest: { method: 'POST', path: '/webhooks' },
        graphql: { operation: 'Mutation', field: 'createWebhook' },
        mcp: { tool: 'create_webhook' }
    },
    {
        id: 'list_webhooks',
        description: 'List registered webhooks',
        rest: { method: 'GET', path: '/webhooks' },
        graphql: { operation: 'Query', field: 'webhooks' },
        mcp: { tool: 'list_webhooks' }
    },
    {
        id: 'get_webhook',
        description: 'Get webhook by ID',
        rest: { method: 'GET', path: '/webhooks/:id' },
        graphql: { operation: 'Query', field: 'webhook' },
        mcp: { tool: 'get_webhook' }
    },
    {
        id: 'update_webhook',
        description: 'Update webhook URL, events, secret, or active state',
        rest: { method: 'PUT', path: '/webhooks/:id' },
        graphql: { operation: 'Mutation', field: 'updateWebhook' },
        mcp: { tool: 'update_webhook' }
    },
    {
        id: 'delete_webhook',
        description: 'Delete a webhook registration',
        rest: { method: 'DELETE', path: '/webhooks/:id' },
        graphql: { operation: 'Mutation', field: 'deleteWebhook' },
        mcp: { tool: 'delete_webhook' }
    },
    {
        id: 'list_payments',
        description: 'List L402 payments',
        rest: { method: 'GET', path: '/payments' },
        graphql: { operation: 'Query', field: 'payments' },
        mcp: { tool: 'list_payments' }
    },
    {
        id: 'get_payment',
        description: 'Get payment by ID',
        rest: { method: 'GET', path: '/payments/:id' },
        graphql: { operation: 'Query', field: 'payment' },
        mcp: { tool: 'get_payment' }
    }
];

export const dryRunCapabilities = new Set<string>([
    'create_content_type',
    'update_content_type',
    'delete_content_type',
    'create_content_item',
    'create_content_items_batch',
    'update_content_item',
    'update_content_items_batch',
    'delete_content_item',
    'delete_content_items_batch',
    'rollback_content_item'
]);
