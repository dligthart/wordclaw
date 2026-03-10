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
