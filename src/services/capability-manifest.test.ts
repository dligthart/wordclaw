import { afterEach, describe, expect, it } from 'vitest';

import { buildCapabilityManifest } from './capability-manifest.js';

const originalExperimentalRevenue = process.env.ENABLE_EXPERIMENTAL_REVENUE;
const originalExperimentalDelegation = process.env.ENABLE_EXPERIMENTAL_DELEGATION;
const originalExperimentalAgentRuns = process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS;
const originalNodeEnv = process.env.NODE_ENV;

function restoreEnv() {
    if (originalExperimentalRevenue === undefined) {
        delete process.env.ENABLE_EXPERIMENTAL_REVENUE;
    } else {
        process.env.ENABLE_EXPERIMENTAL_REVENUE = originalExperimentalRevenue;
    }

    if (originalExperimentalDelegation === undefined) {
        delete process.env.ENABLE_EXPERIMENTAL_DELEGATION;
    } else {
        process.env.ENABLE_EXPERIMENTAL_DELEGATION = originalExperimentalDelegation;
    }

    if (originalExperimentalAgentRuns === undefined) {
        delete process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS;
    } else {
        process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = originalExperimentalAgentRuns;
    }

    if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
    } else {
        process.env.NODE_ENV = originalNodeEnv;
    }
}

describe('buildCapabilityManifest', () => {
    afterEach(() => {
        restoreEnv();
    });

    it('reports discovery, protocol, paid-content, and agent-guidance surfaces', () => {
        delete process.env.ENABLE_EXPERIMENTAL_REVENUE;
        delete process.env.ENABLE_EXPERIMENTAL_DELEGATION;
        process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = 'false';

        const manifest = buildCapabilityManifest();

        expect(manifest.discovery.restManifestPath).toBe('/api/capabilities');
        expect(manifest.discovery.restStatusPath).toBe('/api/deployment-status');
        expect(manifest.discovery.restIdentityPath).toBe('/api/identity');
        expect(manifest.discovery.restWorkspacePath).toBe('/api/workspace-context');
        expect(manifest.discovery.restWorkspaceTargetPath).toBe('/api/workspace-target');
        expect(manifest.discovery.mcpResourceUri).toBe('system://capabilities');
        expect(manifest.discovery.mcpStatusResourceUri).toBe('system://deployment-status');
        expect(manifest.discovery.mcpActorResourceUri).toBe('system://current-actor');
        expect(manifest.discovery.mcpWorkspaceResourceUri).toBe('system://workspace-context');
        expect(manifest.discovery.mcpWorkspaceTargetToolName).toBe('resolve_workspace_target');
        expect(manifest.discovery.mcpReactiveToolName).toBe('subscribe_events');
        expect(manifest.discovery.mcpReactiveNotificationMethod).toBe('notifications/wordclaw/event');
        expect(manifest.discovery.cliStatusCommand).toBe('node dist/cli/index.js capabilities status');
        expect(manifest.discovery.cliWhoAmICommand).toBe('node dist/cli/index.js capabilities whoami');
        expect(manifest.discovery.cliWorkspaceCommand).toBe('node dist/cli/index.js workspace guide');
        expect(manifest.discovery.cliWorkspaceResolveCommand).toBe('node dist/cli/index.js workspace resolve --intent authoring');
        expect(manifest.protocolSurfaces.mcp.transports).toEqual(['stdio', 'streamable-http']);
        expect(manifest.protocolSurfaces.mcp.endpoint).toBe('/mcp');
        expect(manifest.protocolSurfaces.mcp.attachable).toBe(true);
        expect(manifest.protocolSurfaces.mcp.reactive).toEqual(expect.objectContaining({
            supported: true,
            transport: 'streamable-http',
            sessionHeader: 'mcp-session-id',
            standaloneSsePath: '/mcp',
            subscriptionTool: 'subscribe_events',
            notificationMethod: 'notifications/wordclaw/event',
        }));
        expect(manifest.protocolSurfaces.mcp.reactive.supportedTopics).toEqual(
            expect.arrayContaining([
                'content_item.published',
                'content_item.approved',
                'workflow.review.approved',
            ]),
        );
        expect(manifest.auth.mcp.endpoint).toBe('/mcp');
        expect(manifest.auth.mcp.supervisorHeader).toBe('x-wordclaw-domain');
        expect(manifest.protocolContract.required).toEqual(['rest', 'mcp']);
        expect(manifest.protocolContract.compatibility).toEqual(['graphql']);
        expect(manifest.paidContent.purchaseFlowSurface).toBe('rest');
        expect(manifest.agentGuidance.routingHints).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    intent: 'discover-deployment',
                    preferredSurface: 'rest',
                    preferredActorProfile: 'public-discovery',
                }),
                expect.objectContaining({
                    intent: 'author-content',
                    preferredSurface: 'mcp',
                    preferredActorProfile: 'api-key',
                }),
                expect.objectContaining({
                    intent: 'discover-workspace',
                    preferredSurface: 'mcp',
                    preferredActorProfile: 'api-key',
                }),
                expect.objectContaining({
                    intent: 'consume-paid-content',
                    preferredSurface: 'rest',
                    preferredActorProfile: 'api-key',
                }),
                expect.objectContaining({
                    intent: 'verify-provenance',
                    preferredSurface: 'mcp',
                    preferredActorProfile: 'api-key',
                }),
            ]),
        );
        expect(manifest.agentGuidance.actorProfiles).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'api-key',
                    actorType: 'api_key',
                    authMode: 'api-key',
                    domainContext: expect.objectContaining({
                        strategy: 'implicit-from-key',
                    }),
                }),
                expect.objectContaining({
                    id: 'env-key',
                    actorType: 'env_key',
                    authMode: 'api-key',
                    domainContext: expect.objectContaining({
                        strategy: 'server-configured-default',
                    }),
                }),
                expect.objectContaining({
                    id: 'supervisor-session',
                    actorType: 'supervisor',
                    domainContext: expect.objectContaining({
                        strategy: 'header',
                        header: 'x-wordclaw-domain',
                    }),
                }),
            ]),
        );
        expect(manifest.agentGuidance.taskRecipes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'discover-deployment',
                    recommendedAuth: 'none',
                    preferredActorProfile: 'public-discovery',
                    supportedActorProfiles: expect.arrayContaining(['public-discovery', 'api-key', 'env-key']),
                    steps: expect.arrayContaining([
                        expect.objectContaining({
                            operation: 'GET /api/deployment-status',
                        }),
                        expect.objectContaining({
                            operation: 'read system://deployment-status',
                        }),
                    ]),
                }),
                expect.objectContaining({
                    id: 'discover-workspace',
                    preferredSurface: 'mcp',
                    preferredActorProfile: 'api-key',
                    recommendedApiKeyScopes: ['content:read'],
                    steps: expect.arrayContaining([
                        expect.objectContaining({
                            operation: 'GET /api/workspace-context',
                        }),
                        expect.objectContaining({
                            operation: 'read system://workspace-context',
                        }),
                        expect.objectContaining({
                            operation: 'resolve_workspace_target or read system://workspace-target/<intent>',
                        }),
                    ]),
                }),
                expect.objectContaining({
                    id: 'author-content',
                    dryRunRecommended: true,
                    recommendedApiKeyScopes: ['content:write'],
                }),
                expect.objectContaining({
                    id: 'verify-provenance',
                    preferredSurface: 'mcp',
                    preferredActorProfile: 'api-key',
                    recommendedApiKeyScopes: ['audit:read'],
                }),
            ]),
        );
        expect(
            manifest.capabilities.some((capability) => capability.id === 'create_content_item'),
        ).toBe(true);
    });

    it('reflects feature flag state for incubator modules', () => {
        process.env.ENABLE_EXPERIMENTAL_REVENUE = 'true';
        process.env.ENABLE_EXPERIMENTAL_DELEGATION = 'true';
        process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = 'true';

        const manifest = buildCapabilityManifest();
        const modules = Object.fromEntries(
            manifest.modules.map((module) => [module.id, module]),
        );

        expect(modules['revenue-reporting']?.enabled).toBe(true);
        expect(modules.delegation?.enabled).toBe(true);
        expect(modules['agent-runs']?.enabled).toBe(true);
    });
});
