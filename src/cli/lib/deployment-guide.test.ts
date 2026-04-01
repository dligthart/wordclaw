import { describe, expect, it } from 'vitest';

import type { CurrentActorSnapshot } from '../../services/actor-identity.js';
import type { DeploymentStatusSnapshot } from '../../services/deployment-status.js';
import { buildDeploymentGuide } from './deployment-guide.js';

function buildActor(overrides: Partial<CurrentActorSnapshot> = {}): CurrentActorSnapshot {
    return {
        actorId: 'anonymous',
        actorType: 'anonymous',
        actorSource: 'anonymous',
        actorProfileId: 'public-discovery',
        domainId: 1,
        scopes: [],
        assignmentRefs: ['anonymous'],
        ...overrides,
    };
}

function buildDeploymentStatus(overrides: {
    overallStatus?: DeploymentStatusSnapshot['overallStatus'];
    bootstrap?: Partial<DeploymentStatusSnapshot['checks']['bootstrap']>;
    auth?: Partial<DeploymentStatusSnapshot['checks']['auth']>;
    vectorRag?: Partial<DeploymentStatusSnapshot['checks']['vectorRag']>;
    draftGeneration?: Partial<DeploymentStatusSnapshot['checks']['draftGeneration']>;
    warnings?: string[];
} = {}): DeploymentStatusSnapshot {
    const base: DeploymentStatusSnapshot = {
        generatedAt: '2026-03-29T09:00:00.000Z',
        overallStatus: 'ready',
        checks: {
            database: {
                status: 'ready',
                note: 'ok',
            },
            restApi: {
                status: 'ready',
                basePath: '/api',
                note: 'ok',
            },
            bootstrap: {
                status: 'ready',
                domainCount: 2,
                contentWritesRequireDomain: true,
                supportsInBandDomainCreation: true,
                restCreateDomainPath: '/api/domains',
                mcpCreateDomainTool: 'create_domain',
                recommendedGuideTask: 'bootstrap-workspace',
                nextAction: 'Continue with workspace discovery.',
                note: 'Bootstrap prerequisites are already satisfied.',
            },
            auth: {
                status: 'ready',
                authRequired: true,
                writeRequiresCredential: true,
                insecureLocalAdminEnabled: false,
                recommendedActorProfile: 'api-key',
                recommendedScopes: ['content:write'],
                note: 'A write-capable credential is configured.',
            },
            vectorRag: {
                status: 'ready',
                enabled: true,
                model: 'text-embedding-3-large',
                restPath: '/api/search/semantic',
                mcpTool: 'search_semantic_knowledge',
                requiredEnvironmentVariables: ['OPENAI_API_KEY'],
                reason: 'ready',
                note: 'Semantic search is enabled.',
            },
            draftGeneration: {
                status: 'ready',
                defaultProvider: 'deterministic',
                supportedProviders: ['deterministic', 'openai', 'anthropic', 'gemini'],
                provisionedProviders: ['deterministic'],
                provisioningMode: 'tenant-scoped',
                note: 'Deterministic draft generation is always available. External AI providers are tenant-managed and must be provisioned per domain before model-backed jobs can run.',
                providers: {
                    deterministic: {
                        status: 'ready',
                        enabled: true,
                        requiresProvisioning: false,
                        note: 'Deterministic draft generation is always available.',
                    },
                    openai: {
                        status: 'disabled',
                        enabled: false,
                        model: 'gpt-4o',
                        requiresProvisioning: true,
                        provisioningScope: 'tenant',
                        managementRestPath: '/api/ai/providers/openai',
                        managementMcpTool: 'list_ai_provider_configs',
                        reason: 'tenant_provider_config_required',
                        note: 'OpenAI draft generation is supported, but each tenant must configure its own API key before provider-backed draft jobs can run.',
                    },
                    anthropic: {
                        status: 'disabled',
                        enabled: false,
                        model: null,
                        requiresProvisioning: true,
                        provisioningScope: 'tenant',
                        managementRestPath: '/api/ai/providers/anthropic',
                        managementMcpTool: 'list_ai_provider_configs',
                        reason: 'tenant_provider_config_required',
                        note: 'Anthropic draft generation is supported, but each tenant must configure its own API key and model before provider-backed draft jobs can run.',
                    },
                    gemini: {
                        status: 'disabled',
                        enabled: false,
                        model: null,
                        requiresProvisioning: true,
                        provisioningScope: 'tenant',
                        managementRestPath: '/api/ai/providers/gemini',
                        managementMcpTool: 'list_ai_provider_configs',
                        reason: 'tenant_provider_config_required',
                        note: 'Gemini draft generation is supported, but each tenant must configure its own API key and model before provider-backed draft jobs can run.',
                    },
                },
            },
            embeddings: {
                status: 'ready',
                enabled: true,
                model: 'text-embedding-3-large',
                queueDepth: 0,
                inFlightSyncCount: 0,
                pendingItemCount: 0,
                dailyBudget: 2000,
                dailyBudgetRemaining: 1975,
                maxRequestsPerMinute: 30,
                lastSyncCompletedAt: '2026-03-29T08:58:00.000Z',
                lastSyncErrorMessage: null,
                lastSyncErroredAt: null,
                reason: 'ready',
                note: 'healthy',
            },
            ui: {
                status: 'ready',
                servedFromApi: true,
                routePrefix: '/ui/',
                buildPath: '/workspace/ui/build/index.html',
                devCommand: 'npm run dev:all',
                devUrl: 'http://localhost:5173/ui/',
                note: 'ready',
            },
            contentRuntime: {
                status: 'ready',
                fieldAwareQueries: {
                    supported: true,
                    restPath: '/api/content-items',
                    mcpTool: 'get_content_items',
                    graphqlField: 'contentItems',
                    requiresContentTypeId: true,
                },
                projections: {
                    supported: true,
                    restPath: '/api/content-items/projections',
                    mcpTool: 'project_content_items',
                    graphqlField: 'contentItemProjection',
                    metrics: ['count'],
                    requiresContentTypeId: true,
                },
                publicWriteLane: {
                    supported: true,
                    issueTokenPath: '/api/content-types/:id/public-write-tokens',
                    createPath: '/api/public/content-types/:id/items',
                    updatePath: '/api/public/content-items/:id',
                    tokenHeader: 'x-public-write-token',
                    requiresSchemaPolicy: true,
                },
                lifecycle: {
                    supported: true,
                    triggerMode: 'lazy-on-touch',
                    schemaExtension: 'x-wordclaw-lifecycle',
                    includeArchivedFlag: 'includeArchived',
                    defaultArchiveStatus: 'archived',
                },
                note: 'ok',
            },
            mcp: {
                status: 'ready',
                endpoint: '/mcp',
                transports: ['stdio', 'streamable-http'],
                attachable: true,
                reactive: {
                    supported: true,
                    transport: 'streamable-http',
                    subscriptionTool: 'subscribe_events',
                    notificationMethod: 'notifications/wordclaw/event',
                    supportedTopicCount: 1,
                    supportedRecipeCount: 1,
                    supportedFilterFields: ['contentTypeId'],
                },
                note: 'ok',
            },
            assetStorage: {
                status: 'ready',
                enabled: true,
                configuredProvider: 'local',
                effectiveProvider: 'local',
                fallbackApplied: false,
                supportedProviders: ['local'],
                restUploadModes: ['json-base64'],
                mcpUploadModes: ['inline-base64'],
                directProviderUpload: {
                    enabled: false,
                    issuePath: '/api/assets/direct-upload',
                    completePath: '/api/assets/direct-upload/complete',
                    method: 'PUT',
                    providers: ['s3'],
                },
                deliveryModes: ['public'],
                signedAccess: {
                    enabled: true,
                    defaultTtlSeconds: 300,
                    issuePath: '/api/assets/:id/access',
                    issueTool: 'issue_asset_access',
                },
                entitlementDelivery: {
                    enabled: true,
                    offersPath: '/api/assets/:id/offers',
                    contentPath: '/api/assets/:id/content',
                },
                derivatives: {
                    supported: true,
                    listPath: '/api/assets/:id/derivatives',
                    listTool: 'list_asset_derivatives',
                    sourceField: 'sourceAssetId',
                    variantKeyField: 'variantKey',
                    transformSpecField: 'transformSpec',
                },
                note: 'ok',
            },
            agentRuns: {
                status: 'disabled',
                enabled: false,
                workerStarted: false,
                sweepInProgress: false,
                lastSweepCompletedAt: null,
                lastErrorMessage: null,
                note: 'disabled',
            },
            backgroundJobs: {
                status: 'ready',
                enabled: true,
                workerStarted: true,
                sweepInProgress: false,
                lastSweepCompletedAt: '2026-03-29T08:55:00.000Z',
                lastErrorMessage: null,
                note: 'healthy',
            },
        },
        warnings: [],
    };

    return {
        ...base,
        overallStatus: overrides.overallStatus ?? base.overallStatus,
        checks: {
            ...base.checks,
            bootstrap: {
                ...base.checks.bootstrap,
                ...overrides.bootstrap,
            },
            auth: {
                ...base.checks.auth,
                ...overrides.auth,
            },
            vectorRag: {
                ...base.checks.vectorRag,
                ...overrides.vectorRag,
            },
            draftGeneration: {
                ...base.checks.draftGeneration,
                ...overrides.draftGeneration,
            },
        },
        warnings: overrides.warnings ?? base.warnings,
    };
}

describe('buildDeploymentGuide', () => {
    it('surfaces bootstrap, auth, and semantic-search blockers from deployment status', () => {
        const guide = buildDeploymentGuide({
            currentActor: buildActor(),
            deploymentStatus: buildDeploymentStatus({
                overallStatus: 'degraded',
                bootstrap: {
                    status: 'degraded',
                    domainCount: 0,
                    nextAction: 'Create the first domain before attempting content-type or content-item writes.',
                    note: 'The runtime has no provisioned domains yet, so the first write must bootstrap the workspace.',
                },
                auth: {
                    authRequired: false,
                    writeRequiresCredential: true,
                    insecureLocalAdminEnabled: true,
                    note: 'Public discovery is allowed, but writes still require an API key or local MCP admin actor.',
                },
                vectorRag: {
                    status: 'disabled',
                    enabled: false,
                    model: null,
                    reason: 'OPENAI_API_KEY not set',
                    note: 'Semantic search is disabled until embeddings are configured.',
                },
                draftGeneration: {
                    status: 'ready',
                    provisionedProviders: ['deterministic'],
                    provisioningMode: 'tenant-scoped',
                    note: 'Deterministic draft generation is always available. External AI providers are tenant-managed and must be provisioned per domain before model-backed jobs can run.',
                    providers: {
                        deterministic: {
                            status: 'ready',
                            enabled: true,
                            requiresProvisioning: false,
                            note: 'Deterministic draft generation is always available.',
                        },
                        openai: {
                            status: 'disabled',
                            enabled: false,
                            model: null,
                            requiresProvisioning: true,
                            provisioningScope: 'tenant',
                            managementRestPath: '/api/ai/providers/openai',
                            managementMcpTool: 'list_ai_provider_configs',
                            reason: 'tenant_provider_config_required',
                            note: 'OpenAI draft generation is supported, but each tenant must configure its own API key before provider-backed draft jobs can run.',
                        },
                        anthropic: {
                            status: 'disabled',
                            enabled: false,
                            model: null,
                            requiresProvisioning: true,
                            provisioningScope: 'tenant',
                            managementRestPath: '/api/ai/providers/anthropic',
                            managementMcpTool: 'list_ai_provider_configs',
                            reason: 'tenant_provider_config_required',
                            note: 'Anthropic draft generation is supported, but each tenant must configure its own API key and model before provider-backed draft jobs can run.',
                        },
                        gemini: {
                            status: 'disabled',
                            enabled: false,
                            model: null,
                            requiresProvisioning: true,
                            provisioningScope: 'tenant',
                            managementRestPath: '/api/ai/providers/gemini',
                            managementMcpTool: 'list_ai_provider_configs',
                            reason: 'tenant_provider_config_required',
                            note: 'Gemini draft generation is supported, but each tenant must configure its own API key and model before provider-backed draft jobs can run.',
                        },
                    },
                },
                warnings: ['No domains are provisioned yet, so content writes are blocked until bootstrap completes.'],
            }),
        });

        expect(guide.taskId).toBe('discover-deployment');
        expect(guide.bootstrap).toEqual(expect.objectContaining({
            status: 'blocked',
            domainCount: 0,
            recommendedGuideTask: 'bootstrap-workspace',
        }));
        expect(guide.auth).toEqual(expect.objectContaining({
            status: 'blocked',
            writeRequiresCredential: true,
            actorCanWrite: false,
        }));
        expect(guide.vectorRag).toEqual(expect.objectContaining({
            status: 'disabled',
            enabled: false,
            reason: 'OPENAI_API_KEY not set',
        }));
        expect(guide.draftGeneration).toEqual(expect.objectContaining({
            status: 'ready',
            provisionedProviders: ['deterministic'],
            enabledProviders: [],
            provisionableProviders: ['openai', 'anthropic', 'gemini'],
            pendingProviders: ['openai', 'anthropic', 'gemini'],
            provisioningMode: 'tenant-scoped',
        }));
        expect(guide.steps).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'resolve-bootstrap-blocker',
                status: 'ready',
                command: `node dist/cli/index.js mcp call guide_task --json '{"taskId":"bootstrap-workspace"}'`,
            }),
            expect.objectContaining({
                id: 'confirm-write-actor',
                status: 'ready',
                command: 'node dist/cli/index.js capabilities whoami',
                notes: expect.arrayContaining([
                    'Public discovery is allowed, but writes still require an API key or local MCP admin actor.',
                    'Current actor anonymous is discovery-only for write operations.',
                ]),
            }),
            expect.objectContaining({
                id: 'check-semantic-search-posture',
                status: 'optional',
                notes: expect.arrayContaining([
                    'Semantic search is disabled until embeddings are configured.',
                    'Current reason: OPENAI_API_KEY not set.',
                ]),
            }),
            expect.objectContaining({
                id: 'check-draft-generation-provider-provisioning',
                status: 'optional',
                command: 'node dist/cli/index.js mcp call list_ai_provider_configs',
                notes: expect.arrayContaining([
                    'Deterministic draft generation is always available. External AI providers are tenant-managed and must be provisioned per domain before model-backed jobs can run.',
                    'Provisioning mode: tenant-scoped.',
                    'Supported external providers: openai, anthropic, gemini.',
                    'Provisioned providers: deterministic.',
                    'Pending tenant provisioning: openai, anthropic, gemini.',
                    'Current reason: tenant_provider_config_required.',
                    'Management path: /api/ai/providers/openai.',
                ]),
            }),
        ]));
    });

    it('marks bootstrap, auth, and semantic search as satisfied for a local admin actor', () => {
        const guide = buildDeploymentGuide({
            currentActor: buildActor({
                actorId: 'mcp-local',
                actorType: 'mcp',
                actorSource: 'local',
                actorProfileId: 'mcp-local',
                domainId: 7,
                scopes: ['admin'],
                assignmentRefs: ['mcp-local'],
            }),
            deploymentStatus: buildDeploymentStatus({
                auth: {
                    recommendedActorProfile: 'mcp-local',
                    recommendedScopes: ['admin'],
                    note: 'The current local MCP actor can mutate runtime state.',
                },
            }),
        });

        expect(guide.bootstrap.status).toBe('ready');
        expect(guide.auth.status).toBe('ready');
        expect(guide.vectorRag.status).toBe('ready');
        expect(guide.draftGeneration.status).toBe('ready');
        expect(guide.steps).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'resolve-bootstrap-blocker',
                status: 'completed',
            }),
            expect.objectContaining({
                id: 'confirm-write-actor',
                status: 'completed',
                command: 'node dist/cli/index.js mcp whoami',
            }),
            expect.objectContaining({
                id: 'check-semantic-search-posture',
                status: 'completed',
            }),
            expect.objectContaining({
                id: 'check-draft-generation-provider-provisioning',
                status: 'optional',
            }),
        ]));
    });
});
