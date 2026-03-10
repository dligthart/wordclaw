import {
    capabilityMatrix,
    dryRunCapabilities,
    requiredProtocolSurfaces,
    compatibilityProtocolSurfaces,
} from '../contracts/capability-matrix.js';
import {
    isExperimentalAgentRunsEnabled,
    isExperimentalDelegationEnabled,
    isExperimentalRevenueEnabled,
} from '../config/runtime-features.js';

export type CapabilityManifest = ReturnType<typeof buildCapabilityManifest>;

export function buildCapabilityManifest() {
    const experimentalRevenue = isExperimentalRevenueEnabled();
    const experimentalDelegation = isExperimentalDelegationEnabled();
    const experimentalAgentRuns = isExperimentalAgentRunsEnabled();
    const agentGuidance = {
        routingHints: [
            {
                intent: 'discover-deployment',
                preferredSurface: 'rest',
                fallbackSurface: 'mcp',
                rationale: 'The REST manifest is public and easiest to read before you authenticate or connect over MCP.',
            },
            {
                intent: 'author-content',
                preferredSurface: 'mcp',
                fallbackSurface: 'rest',
                rationale: 'MCP is the most natural agent surface for schema discovery, dry-run validation, and content mutations.',
            },
            {
                intent: 'review-workflow',
                preferredSurface: 'mcp',
                fallbackSurface: 'rest',
                rationale: 'Workflow review and comments fit agent-style tool calls well, while REST remains a direct fallback.',
            },
            {
                intent: 'manage-integrations',
                preferredSurface: 'mcp',
                fallbackSurface: 'rest',
                rationale: 'API keys and webhooks are available on MCP and are simpler to automate as tool calls.',
            },
            {
                intent: 'consume-paid-content',
                preferredSurface: 'rest',
                fallbackSurface: null,
                rationale: 'L402 settlement and entitlement-backed reads remain REST-first even though discovery is available elsewhere.',
            },
        ],
        taskRecipes: [
            {
                id: 'discover-deployment',
                goal: 'Determine which modules, transports, auth modes, and dry-run paths are enabled before acting.',
                preferredSurface: 'rest',
                fallbackSurface: 'mcp',
                recommendedAuth: 'none',
                requiredModules: [],
                dryRunRecommended: false,
                steps: [
                    {
                        title: 'Read the deployment manifest',
                        surface: 'rest',
                        operation: 'GET /api/capabilities',
                        purpose: 'Inspect enabled modules, auth expectations, protocol roles, and dry-run support.',
                    },
                    {
                        title: 'Mirror the manifest inside an MCP session',
                        surface: 'mcp',
                        operation: 'read system://capabilities',
                        purpose: 'Confirm the same contract after connecting as an MCP client.',
                        optional: true,
                    },
                ],
            },
            {
                id: 'author-content',
                goal: 'Create or update schema-bound content with validation, versioning, and optional dry-run checks.',
                preferredSurface: 'mcp',
                fallbackSurface: 'rest',
                recommendedAuth: 'api-key',
                requiredModules: ['content-runtime'],
                dryRunRecommended: true,
                steps: [
                    {
                        title: 'Discover the target schema',
                        surface: 'mcp',
                        operation: 'list_content_types or get_content_type',
                        purpose: 'Find the content model and inspect its schema before generating data.',
                    },
                    {
                        title: 'Validate a draft without persisting it',
                        surface: 'mcp',
                        operation: 'create_content_item { dryRun: true } or update_content_item { dryRun: true }',
                        purpose: 'Use the runtime validator to catch schema and policy issues before write time.',
                    },
                    {
                        title: 'Persist or revise the content item',
                        surface: 'mcp',
                        operation: 'create_content_item or update_content_item',
                        purpose: 'Store the item after dry-run feedback is satisfactory.',
                    },
                    {
                        title: 'Inspect versions when revising',
                        surface: 'mcp',
                        operation: 'get_content_item_versions or rollback_content_item',
                        purpose: 'Review or revert history if the content needs correction.',
                        optional: true,
                    },
                ],
            },
            {
                id: 'review-workflow',
                goal: 'Move content through supervised review, comments, and decision steps.',
                preferredSurface: 'mcp',
                fallbackSurface: 'rest',
                recommendedAuth: 'api-key-or-supervisor',
                requiredModules: ['content-runtime', 'workflow-review'],
                dryRunRecommended: false,
                steps: [
                    {
                        title: 'Create the workflow path if needed',
                        surface: 'mcp',
                        operation: 'create_workflow and create_workflow_transition',
                        purpose: 'Define the review path that content should follow.',
                        optional: true,
                    },
                    {
                        title: 'Submit content into review',
                        surface: 'mcp',
                        operation: 'submit_review_task',
                        purpose: 'Move a content item from its current state into supervised review.',
                    },
                    {
                        title: 'Add review feedback',
                        surface: 'mcp',
                        operation: 'add_review_comment',
                        purpose: 'Record actionable feedback for the current review cycle.',
                        optional: true,
                    },
                    {
                        title: 'Approve or reject the task',
                        surface: 'mcp',
                        operation: 'decide_review_task',
                        purpose: 'Complete the supervised review step and settle the item state.',
                    },
                ],
            },
            {
                id: 'manage-integrations',
                goal: 'Provision agent credentials and outbound webhooks for external integrations.',
                preferredSurface: 'mcp',
                fallbackSurface: 'rest',
                recommendedAuth: 'api-key-or-supervisor',
                requiredModules: ['api-keys-webhooks'],
                dryRunRecommended: false,
                steps: [
                    {
                        title: 'Create an API key',
                        surface: 'mcp',
                        operation: 'create_api_key',
                        purpose: 'Provision a scoped credential for an external agent or integration.',
                    },
                    {
                        title: 'Register webhook delivery',
                        surface: 'mcp',
                        operation: 'create_webhook',
                        purpose: 'Subscribe an external system to audit or content-change events.',
                        optional: true,
                    },
                    {
                        title: 'Inspect or rotate integration state',
                        surface: 'mcp',
                        operation: 'list_api_keys, revoke_api_key, list_webhooks, update_webhook',
                        purpose: 'Manage lifecycle and rotation for integration surfaces.',
                        optional: true,
                    },
                ],
            },
            {
                id: 'consume-paid-content',
                goal: 'Purchase access to paid content and perform entitlement-backed reads.',
                preferredSurface: 'rest',
                fallbackSurface: null,
                recommendedAuth: 'api-key',
                requiredModules: ['payments-l402'],
                dryRunRecommended: false,
                steps: [
                    {
                        title: 'Discover offers for a content item',
                        surface: 'rest',
                        operation: 'GET /api/content-items/:id/offers',
                        purpose: 'Find the available paid-access offers for a content item.',
                    },
                    {
                        title: 'Start the L402 purchase',
                        surface: 'rest',
                        operation: 'POST /api/offers/:id/purchase',
                        purpose: 'Receive the Lightning challenge and purchase metadata.',
                    },
                    {
                        title: 'Confirm the payment',
                        surface: 'rest',
                        operation: 'POST /api/offers/:id/purchase/confirm',
                        purpose: 'Complete settlement and activate the entitlement.',
                    },
                    {
                        title: 'Read with the entitlement',
                        surface: 'rest',
                        operation: 'GET /api/content-items/:id with entitlement context',
                        purpose: 'Fetch the paid content through the entitlement-backed read path.',
                    },
                ],
            },
        ],
    };

    return {
        generatedAt: new Date().toISOString(),
        product: {
            name: 'WordClaw',
            positioning: 'Safe content runtime for AI agents and human supervisors',
        },
        discovery: {
            restManifestPath: '/api/capabilities',
            mcpResourceUri: 'system://capabilities',
            cliCommand: 'node dist/cli/index.js capabilities show',
        },
        protocolSurfaces: {
            rest: {
                role: 'primary',
                basePath: '/api',
            },
            mcp: {
                role: 'primary',
                transports: ['stdio', 'streamable-http'],
                endpoint: '/mcp',
                attachable: true,
            },
            graphql: {
                role: 'compatibility',
            },
        },
        auth: {
            rest: {
                apiKeyHeader: 'x-api-key',
                bearerHeader: 'Authorization: Bearer <api-key>',
                supervisorCookie: 'supervisor_session',
            },
            mcp: {
                endpoint: '/mcp',
                apiKeyHeader: 'x-api-key',
                bearerHeader: 'Authorization: Bearer <api-key>',
                supervisorCookie: 'supervisor_session',
                supervisorHeader: 'x-wordclaw-domain',
            },
            domainContext: {
                supervisorHeader: 'x-wordclaw-domain',
                apiKeysAreDomainScoped: true,
                mcpDomainEnv: 'WORDCLAW_DOMAIN_ID',
            },
        },
        modules: [
            {
                id: 'content-runtime',
                tier: 'core',
                enabled: true,
                description: 'Schema-bound content type and content item operations.',
            },
            {
                id: 'workflow-review',
                tier: 'core',
                enabled: true,
                description: 'Supervisor review tasks, comments, and workflow transitions.',
            },
            {
                id: 'api-keys-webhooks',
                tier: 'core',
                enabled: true,
                description: 'Agent-facing credential management and webhook registration.',
            },
            {
                id: 'payments-l402',
                tier: 'core',
                enabled: true,
                description: 'Paid content, offers, payments, and entitlement-backed reads.',
            },
            {
                id: 'revenue-reporting',
                tier: 'experimental',
                enabled: experimentalRevenue,
                description: 'Earnings and payout-oriented surfaces remain incubating.',
            },
            {
                id: 'delegation',
                tier: 'experimental',
                enabled: experimentalDelegation,
                description: 'Entitlement delegation remains an incubating module.',
            },
            {
                id: 'agent-runs',
                tier: 'experimental',
                enabled: experimentalAgentRuns,
                description: 'Autonomous run orchestration remains an incubating module.',
            },
        ],
        paidContent: {
            l402Enabled: true,
            purchaseFlowSurface: 'rest',
            entitlementReadSurface: 'rest',
            note: 'MCP is suitable for discovery and management; paid-content settlement and entitlement reads remain REST-first.',
        },
        agentGuidance,
        capabilities: capabilityMatrix.map((capability) => ({
            id: capability.id,
            description: capability.description,
            rest: capability.rest,
            mcp: capability.mcp,
            graphql: capability.graphql ?? null,
            dryRun: dryRunCapabilities.has(capability.id),
        })),
        protocolContract: {
            required: [...requiredProtocolSurfaces],
            compatibility: [...compatibilityProtocolSurfaces],
        },
        limitations: [
            'graphql_compatibility_only',
        ],
    };
}
