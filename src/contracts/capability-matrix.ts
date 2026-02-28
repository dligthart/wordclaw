export type RestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type GraphqlOperation = 'Query' | 'Mutation';

export type Capability = {
    id: string;
    description: string;
    rest: {
        method: RestMethod;
        path: string;
    };
    graphql: {
        operation: GraphqlOperation;
        field: string;
    };
    mcp: {
        tool: string;
    };
};

export const capabilityMatrix: Capability[] = [
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
        id: 'get_content_item',
        description: 'Get content item by ID',
        rest: { method: 'GET', path: '/content-items/:id' },
        graphql: { operation: 'Query', field: 'contentItem' },
        mcp: { tool: 'get_content_item' }
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
    },
    {
        id: 'create_agent_run',
        description: 'Create autonomous content ops run',
        rest: { method: 'POST', path: '/agent-runs' },
        graphql: { operation: 'Mutation', field: 'createAgentRun' },
        mcp: { tool: 'create_agent_run' }
    },
    {
        id: 'list_agent_runs',
        description: 'List autonomous runs',
        rest: { method: 'GET', path: '/agent-runs' },
        graphql: { operation: 'Query', field: 'agentRuns' },
        mcp: { tool: 'list_agent_runs' }
    },
    {
        id: 'get_agent_run',
        description: 'Get autonomous run by ID',
        rest: { method: 'GET', path: '/agent-runs/:id' },
        graphql: { operation: 'Query', field: 'agentRun' },
        mcp: { tool: 'get_agent_run' }
    },
    {
        id: 'control_agent_run',
        description: 'Control autonomous run lifecycle',
        rest: { method: 'POST', path: '/agent-runs/:id/control' },
        graphql: { operation: 'Mutation', field: 'controlAgentRun' },
        mcp: { tool: 'control_agent_run' }
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
