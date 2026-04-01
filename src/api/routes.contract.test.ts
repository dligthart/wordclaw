import fastifyMultipart from '@fastify/multipart';
import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const dbMock = {
        select: vi.fn(),
        execute: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        transaction: vi.fn(),
    };

    return {
        dbMock,
        logAuditMock: vi.fn(),
        isSafeWebhookUrlMock: vi.fn(async () => true),
    };
});

vi.mock('../db/index.js', () => ({
    db: mocks.dbMock,
}));

vi.mock('../services/audit.js', () => ({
    logAudit: mocks.logAuditMock,
}));

vi.mock('../services/webhook.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/webhook.js')>();
    return {
        ...actual,
        isSafeWebhookUrl: mocks.isSafeWebhookUrlMock,
    };
});

import { errorHandler } from './error-handler.js';
import apiRoutes from './routes.js';
import { WorkflowService } from '../services/workflow.js';
import { AgentRunService } from '../services/agent-runs.js';
import { AgentRunMetricsService } from '../services/agent-run-metrics.js';
import { LicensingService } from '../services/licensing.js';
import { agentRunWorker } from '../workers/agent-run.worker.js';
import * as assetService from '../services/assets.js';
import * as formsService from '../services/forms.js';
import * as referenceUsageService from '../services/reference-usage.js';
import { issuePublicWriteToken } from '../services/public-write.js';
import { issuePreviewToken } from '../services/content-preview.js';
import { EmbeddingService } from '../services/embedding.js';

type ApiErrorBody = {
    error: string;
    code: string;
    remediation: string;
};

async function buildServer(): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });
    app.setErrorHandler(errorHandler);
    await app.register(fastifyMultipart, {
        limits: {
            files: 1
        }
    });
    await app.register(apiRoutes, { prefix: '/api' });
    return app;
}

function buildMultipartPayload(
    boundary: string,
    fields: Record<string, string>,
    file: { fieldName: string; filename: string; contentType: string; content: Buffer }
): Buffer {
    const chunks: Buffer[] = [];

    for (const [name, value] of Object.entries(fields)) {
        chunks.push(Buffer.from(
            `--${boundary}\r\n`
            + `Content-Disposition: form-data; name="${name}"\r\n\r\n`
            + `${value}\r\n`,
            'utf8'
        ));
    }

    chunks.push(Buffer.from(
        `--${boundary}\r\n`
        + `Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\n`
        + `Content-Type: ${file.contentType}\r\n\r\n`,
        'utf8'
    ));
    chunks.push(file.content);
    chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));

    return Buffer.concat(chunks);
}

function resetMocks() {
    mocks.dbMock.select.mockReset();
    mocks.dbMock.execute.mockReset();
    mocks.dbMock.insert.mockReset();
    mocks.dbMock.update.mockReset();
    mocks.dbMock.delete.mockReset();
    mocks.dbMock.transaction.mockReset();
    mocks.logAuditMock.mockReset();
    mocks.isSafeWebhookUrlMock.mockReset();
    mocks.isSafeWebhookUrlMock.mockImplementation(async () => true);
    mocks.dbMock.execute.mockResolvedValue([{ '?column?': 1 }]);
}

const originalAuthRequired = process.env.AUTH_REQUIRED;
const originalApiKeys = process.env.API_KEYS;
const originalAllowInsecureLocalAdmin = process.env.ALLOW_INSECURE_LOCAL_ADMIN;
const originalExperimentalRevenue = process.env.ENABLE_EXPERIMENTAL_REVENUE;
const originalExperimentalDelegation = process.env.ENABLE_EXPERIMENTAL_DELEGATION;
const originalExperimentalAgentRuns = process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS;
const originalAssetStorageProvider = process.env.ASSET_STORAGE_PROVIDER;
const originalAssetSignedTtl = process.env.ASSET_SIGNED_TTL_SECONDS;
const originalPublicWriteSecret = process.env.PUBLIC_WRITE_SECRET;
const originalPublicWriteTtl = process.env.PUBLIC_WRITE_TTL_SECONDS;

function restoreAuthEnv() {
    if (originalAuthRequired === undefined) {
        delete process.env.AUTH_REQUIRED;
    } else {
        process.env.AUTH_REQUIRED = originalAuthRequired;
    }

    if (originalApiKeys === undefined) {
        delete process.env.API_KEYS;
    } else {
        process.env.API_KEYS = originalApiKeys;
    }

    if (originalAllowInsecureLocalAdmin === undefined) {
        delete process.env.ALLOW_INSECURE_LOCAL_ADMIN;
    } else {
        process.env.ALLOW_INSECURE_LOCAL_ADMIN = originalAllowInsecureLocalAdmin;
    }

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

    if (originalAssetStorageProvider === undefined) {
        delete process.env.ASSET_STORAGE_PROVIDER;
    } else {
        process.env.ASSET_STORAGE_PROVIDER = originalAssetStorageProvider;
    }

    if (originalAssetSignedTtl === undefined) {
        delete process.env.ASSET_SIGNED_TTL_SECONDS;
    } else {
        process.env.ASSET_SIGNED_TTL_SECONDS = originalAssetSignedTtl;
    }

    if (originalPublicWriteSecret === undefined) {
        delete process.env.PUBLIC_WRITE_SECRET;
    } else {
        process.env.PUBLIC_WRITE_SECRET = originalPublicWriteSecret;
    }

    if (originalPublicWriteTtl === undefined) {
        delete process.env.PUBLIC_WRITE_TTL_SECONDS;
    } else {
        process.env.PUBLIC_WRITE_TTL_SECONDS = originalPublicWriteTtl;
    }
}

describe('API Route Contracts', () => {
    beforeEach(() => {
        resetMocks();
        EmbeddingService.resetRuntimeStateForTests();
        process.env.AUTH_REQUIRED = 'false';
        process.env.ALLOW_INSECURE_LOCAL_ADMIN = 'true';
        delete process.env.API_KEYS;
        delete process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS;
    });

    afterEach(() => {
        resetMocks();
        EmbeddingService.resetRuntimeStateForTests();
        restoreAuthEnv();
    });

    it('exposes a public capability manifest without requiring auth', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.ENABLE_EXPERIMENTAL_REVENUE = 'false';
        process.env.ENABLE_EXPERIMENTAL_DELEGATION = 'false';
        process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = 'false';
        process.env.ASSET_SIGNED_TTL_SECONDS = '480';
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/capabilities',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: {
                    discovery: {
                        restManifestPath: string;
                        restStatusPath: string;
                        restIdentityPath: string;
                        restWorkspacePath: string;
                        restWorkspaceTargetPath: string;
                        mcpResourceUri: string;
                        mcpStatusResourceUri: string;
                        mcpActorResourceUri: string;
                        mcpWorkspaceResourceUri: string;
                        mcpWorkspaceTargetToolName: string;
                        mcpReactiveToolName: string;
                        mcpReactiveNotificationMethod: string;
                        cliStatusCommand: string;
                        cliWhoAmICommand: string;
                        cliWorkspaceCommand: string;
                        cliWorkspaceResolveCommand: string;
                    };
                    protocolSurfaces: {
                        mcp: {
                            transports: string[];
                            endpoint: string;
                            attachable: boolean;
                            reactive: {
                                supported: boolean;
                                transport: string;
                                sessionHeader: string;
                                standaloneSsePath: string;
                                subscriptionTool: string;
                                notificationMethod: string;
                                supportedTopics: string[];
                                subscriptionRecipes: Array<{
                                    id: string;
                                    title: string;
                                    description: string;
                                    topics: string[];
                                    requiredScopes: string[];
                                }>;
                                supportedFilterFields: string[];
                            };
                        };
                    };
                    auth: {
                        mcp: {
                            endpoint: string;
                            supervisorHeader: string;
                        };
                        effective: {
                            authRequired: boolean;
                            writeRequiresCredential: boolean;
                            insecureLocalAdminEnabled: boolean;
                            recommendedActorProfile: string;
                            recommendedScopes: string[];
                            note: string;
                        };
                    };
                    bootstrap: {
                        contentWritesRequireDomain: boolean;
                        supportsInBandDomainCreation: boolean;
                        restCreateDomainPath: string;
                        mcpCreateDomainTool: string | null;
                        recommendedGuideTask: string | null;
                        noDomainErrorCode: string;
                    };
                    vectorRag: {
                        enabled: boolean;
                        model: string | null;
                        restPath: string;
                        mcpTool: string;
                    };
                    draftGeneration: {
                        defaultProvider: string;
                        supportedProviders: string[];
                        provisionedProviders: string[];
                        provisioningMode?: string;
                        providers: {
                            deterministic: {
                                enabled: boolean;
                                requiresProvisioning: boolean;
                            };
                            openai: {
                                enabled: boolean;
                                model: string | null;
                                requiresProvisioning?: boolean;
                                provisioningScope?: string;
                                managementRestPath?: string;
                                managementMcpTool?: string | null;
                                reason?: string;
                            };
                        };
                        note: string;
                    };
                    toolEquivalence: Array<{
                        intent: string;
                        rest: string;
                        mcp: string | null;
                        graphql: string | null;
                        cli: string | null;
                    }>;
                    modules: Array<{
                        id: string;
                        enabled: boolean;
                    }>;
                    contentRuntime: {
                        fieldAwareQueries: {
                            supported: boolean;
                            requiresContentTypeId: boolean;
                            queryableFieldKinds: string[];
                            filterOperators: string[];
                            restPath: string;
                            mcpTool: string;
                            graphqlField: string;
                        };
                        projections: {
                            supported: boolean;
                            requiresContentTypeId: boolean;
                            groupByMode: string;
                            groupableFieldKinds: string[];
                            metrics: string[];
                            restPath: string;
                            mcpTool: string;
                            graphqlField: string;
                        };
                        publicWriteLane: {
                            supported: boolean;
                            requiresSchemaPolicy: boolean;
                            issueTokenPath: string;
                            createPath: string;
                            updatePath: string;
                            tokenHeader: string;
                        };
                    };
                    assetStorage: {
                        configuredProvider: string;
                        effectiveProvider: string;
                        fallbackApplied: boolean;
                        supportedProviders: string[];
                        upload: {
                            rest: {
                                path: string;
                                modes: string[];
                                directProviderUpload: {
                                    enabled: boolean;
                                    issuePath: string;
                                    completePath: string;
                                    method: string;
                                    providers: string[];
                                };
                            };
                            mcp: {
                                tool: string;
                                modes: string[];
                            };
                        };
                        delivery: {
                            supportedModes: string[];
                            signed: {
                                issuePath: string;
                                issueTool: string;
                                defaultTtlSeconds: number;
                            };
                        };
                        derivatives: {
                            supported: boolean;
                            createViaRestPath: string;
                            createViaMcpTool: string;
                            listPath: string;
                            listTool: string;
                            sourceField: string;
                            variantKeyField: string;
                            transformSpecField: string;
                        };
                    };
                    agentGuidance: {
                        routingHints: Array<{
                            intent: string;
                            preferredSurface: string;
                            preferredActorProfile: string;
                        }>;
                        actorProfiles: Array<{
                            id: string;
                            actorType: string;
                            authMode: string;
                            domainContext: {
                                strategy: string;
                            };
                        }>;
                        taskRecipes: Array<{
                            id: string;
                            preferredSurface: string;
                            preferredActorProfile: string;
                            supportedActorProfiles: string[];
                            recommendedApiKeyScopes: string[];
                            reactiveFollowUp?: {
                                recipeId: string | null;
                                topics: string[];
                                recommendedFilters: string[];
                            };
                        }>;
                    };
                    limitations: string[];
                };
            };

            expect(body.data.discovery.restManifestPath).toBe('/api/capabilities');
            expect(body.data.discovery.restStatusPath).toBe('/api/deployment-status');
            expect(body.data.discovery.restIdentityPath).toBe('/api/identity');
            expect(body.data.discovery.restWorkspacePath).toBe('/api/workspace-context');
            expect(body.data.discovery.restWorkspaceTargetPath).toBe('/api/workspace-target');
            expect(body.data.discovery.mcpResourceUri).toBe('system://capabilities');
            expect(body.data.discovery.mcpStatusResourceUri).toBe('system://deployment-status');
            expect(body.data.discovery.mcpActorResourceUri).toBe('system://current-actor');
            expect(body.data.discovery.mcpWorkspaceResourceUri).toBe('system://workspace-context');
            expect(body.data.discovery.mcpWorkspaceTargetToolName).toBe('resolve_workspace_target');
            expect(body.data.discovery.mcpReactiveToolName).toBe('subscribe_events');
            expect(body.data.discovery.mcpReactiveNotificationMethod).toBe('notifications/wordclaw/event');
            expect(body.data.discovery.cliStatusCommand).toBe('node dist/cli/index.js capabilities status');
            expect(body.data.discovery.cliWhoAmICommand).toBe('node dist/cli/index.js capabilities whoami');
            expect(body.data.discovery.cliWorkspaceCommand).toBe('node dist/cli/index.js workspace guide');
            expect(body.data.discovery.cliWorkspaceResolveCommand).toBe('node dist/cli/index.js workspace resolve --intent authoring');
            expect(body.data.protocolSurfaces.mcp.transports).toEqual(['stdio', 'streamable-http']);
            expect(body.data.protocolSurfaces.mcp.endpoint).toBe('/mcp');
            expect(body.data.protocolSurfaces.mcp.attachable).toBe(true);
            expect(body.data.protocolSurfaces.mcp.reactive).toEqual(expect.objectContaining({
                supported: true,
                transport: 'streamable-http',
                sessionHeader: 'mcp-session-id',
                standaloneSsePath: '/mcp',
                subscriptionTool: 'subscribe_events',
                notificationMethod: 'notifications/wordclaw/event',
                subscriptionRecipes: expect.arrayContaining([
                    expect.objectContaining({
                        id: 'content-publication',
                        topics: ['content_item.published'],
                    }),
                    expect.objectContaining({
                        id: 'integration-admin',
                        requiredScopes: ['admin'],
                    }),
                ]),
            }));
            expect(body.data.protocolSurfaces.mcp.reactive.supportedTopics).toEqual(
                expect.arrayContaining([
                    'content_item.published',
                    'workflow.review.approved',
                    'content_type.*',
                    'api_key.create',
                    'webhook.update',
                ]),
            );
            expect(body.data.protocolSurfaces.mcp.reactive.supportedFilterFields).toEqual(
                expect.arrayContaining(['contentTypeId', 'entityId', 'status', 'decision', 'actorType']),
            );
            expect(body.data.auth.mcp.endpoint).toBe('/mcp');
            expect(body.data.auth.mcp.supervisorHeader).toBe('x-wordclaw-domain');
            expect(body.data.auth.effective).toEqual({
                authRequired: true,
                writeRequiresCredential: true,
                insecureLocalAdminEnabled: true,
                recommendedActorProfile: 'api-key',
                recommendedScopes: ['content:write'],
                note: 'Authenticated writes require an API key or supervisor session with the appropriate scope set.',
            });
            expect(body.data.bootstrap).toEqual(expect.objectContaining({
                contentWritesRequireDomain: true,
                supportsInBandDomainCreation: true,
                restCreateDomainPath: '/api/domains',
                mcpCreateDomainTool: 'create_domain',
                recommendedGuideTask: 'bootstrap-workspace',
                noDomainErrorCode: 'NO_DOMAIN',
            }));
            expect(body.data.vectorRag).toEqual(expect.objectContaining({
                enabled: false,
                model: null,
                restPath: '/api/search/semantic',
                mcpTool: 'search_semantic_knowledge',
            }));
            expect(body.data.draftGeneration).toEqual(expect.objectContaining({
                defaultProvider: 'deterministic',
                supportedProviders: ['deterministic', 'openai', 'anthropic', 'gemini'],
                provisionedProviders: ['deterministic'],
                provisioningMode: 'tenant-scoped',
                providers: expect.objectContaining({
                    deterministic: expect.objectContaining({
                        enabled: true,
                        requiresProvisioning: false,
                    }),
                    openai: expect.objectContaining({
                        enabled: false,
                        model: null,
                        requiresProvisioning: true,
                        provisioningScope: 'tenant',
                        managementRestPath: '/api/ai/providers/openai',
                        managementMcpTool: 'list_ai_provider_configs',
                        reason: 'tenant_provider_config_required',
                    }),
                    anthropic: expect.objectContaining({
                        enabled: false,
                        model: null,
                        requiresProvisioning: true,
                        provisioningScope: 'tenant',
                        managementRestPath: '/api/ai/providers/anthropic',
                        managementMcpTool: 'list_ai_provider_configs',
                        reason: 'tenant_provider_config_required',
                    }),
                    gemini: expect.objectContaining({
                        enabled: false,
                        model: null,
                        requiresProvisioning: true,
                        provisioningScope: 'tenant',
                        managementRestPath: '/api/ai/providers/gemini',
                        managementMcpTool: 'list_ai_provider_configs',
                        reason: 'tenant_provider_config_required',
                    }),
                }),
            }));
            expect(body.data.toolEquivalence).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    intent: 'inspect-deployment',
                    rest: 'GET /api/deployment-status',
                    mcp: 'read system://deployment-status',
                }),
                expect.objectContaining({
                    intent: 'create-domain',
                    rest: 'POST /api/domains',
                    mcp: 'create_domain',
                }),
            ]));
            expect(body.data.modules).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: 'content-runtime', enabled: true }),
                    expect.objectContaining({ id: 'agent-runs', enabled: false }),
                ]),
            );
            expect(body.data.contentRuntime).toEqual(expect.objectContaining({
                fieldAwareQueries: expect.objectContaining({
                    supported: true,
                    requiresContentTypeId: true,
                    queryableFieldKinds: ['string', 'number', 'boolean'],
                    filterOperators: ['eq', 'contains', 'gte', 'lte'],
                    restPath: '/api/content-items',
                    mcpTool: 'get_content_items',
                    graphqlField: 'contentItems',
                }),
                projections: expect.objectContaining({
                    supported: true,
                    requiresContentTypeId: true,
                    groupByMode: 'single-field',
                    groupableFieldKinds: ['string', 'number', 'boolean'],
                    metrics: ['count', 'sum', 'avg', 'min', 'max'],
                    restPath: '/api/content-items/projections',
                    mcpTool: 'project_content_items',
                    graphqlField: 'contentItemProjection',
                }),
                publicWriteLane: expect.objectContaining({
                    supported: true,
                    requiresSchemaPolicy: true,
                    issueTokenPath: '/api/content-types/:id/public-write-tokens',
                    createPath: '/api/public/content-types/:id/items',
                    updatePath: '/api/public/content-items/:id',
                    tokenHeader: 'x-public-write-token',
                }),
                lifecycle: expect.objectContaining({
                    supported: true,
                    requiresSchemaPolicy: true,
                    triggerMode: 'lazy-on-touch',
                    schemaExtension: 'x-wordclaw-lifecycle',
                    defaultClock: 'updatedAt',
                    defaultArchiveStatus: 'archived',
                    includeArchivedFlag: 'includeArchived',
                }),
            }));
            expect(body.data.assetStorage).toEqual(expect.objectContaining({
                configuredProvider: 'local',
                effectiveProvider: 'local',
                fallbackApplied: false,
                supportedProviders: ['local', 's3'],
                upload: expect.objectContaining({
                    rest: {
                        path: '/api/assets',
                        modes: ['json-base64', 'multipart-form-data'],
                        directProviderUpload: {
                            enabled: false,
                            issuePath: '/api/assets/direct-upload',
                            completePath: '/api/assets/direct-upload/complete',
                            method: 'PUT',
                            providers: ['s3'],
                        },
                    },
                    mcp: {
                        tool: 'create_asset',
                        modes: ['inline-base64'],
                    },
                }),
                delivery: expect.objectContaining({
                    supportedModes: ['public', 'signed', 'entitled'],
                    signed: expect.objectContaining({
                        issuePath: '/api/assets/:id/access',
                        issueTool: 'issue_asset_access',
                        defaultTtlSeconds: 480,
                    }),
                }),
                derivatives: expect.objectContaining({
                    supported: true,
                    createViaRestPath: '/api/assets',
                    createViaMcpTool: 'create_asset',
                    listPath: '/api/assets/:id/derivatives',
                    listTool: 'list_asset_derivatives',
                    sourceField: 'sourceAssetId',
                    variantKeyField: 'variantKey',
                    transformSpecField: 'transformSpec',
                }),
            }));
            expect(body.data.agentGuidance.routingHints).toEqual(
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
                        intent: 'verify-provenance',
                        preferredSurface: 'mcp',
                        preferredActorProfile: 'api-key',
                    }),
                ]),
            );
            expect(body.data.agentGuidance.actorProfiles).toEqual(
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
                        id: 'mcp-local',
                        actorType: 'mcp',
                        domainContext: expect.objectContaining({
                            strategy: 'environment',
                        }),
                    }),
                    expect.objectContaining({
                        id: 'env-key',
                        actorType: 'env_key',
                        domainContext: expect.objectContaining({
                            strategy: 'server-configured-default',
                        }),
                    }),
                ]),
            );
            expect(body.data.agentGuidance.taskRecipes).toEqual(
                expect.arrayContaining([
                expect.objectContaining({
                    id: 'discover-workspace',
                    preferredSurface: 'mcp',
                    preferredActorProfile: 'api-key',
                    recommendedApiKeyScopes: ['content:read'],
                }),
                expect.objectContaining({
                    id: 'consume-paid-content',
                    preferredSurface: 'rest',
                    preferredActorProfile: 'api-key',
                        supportedActorProfiles: ['api-key', 'env-key'],
                        recommendedApiKeyScopes: ['content:read'],
                    }),
                    expect.objectContaining({
                        id: 'author-content',
                        reactiveFollowUp: expect.objectContaining({
                            recipeId: 'content-lifecycle',
                            recommendedFilters: ['contentTypeId'],
                        }),
                    }),
                    expect.objectContaining({
                        id: 'verify-provenance',
                        preferredSurface: 'mcp',
                        preferredActorProfile: 'api-key',
                        recommendedApiKeyScopes: ['audit:read'],
                        reactiveFollowUp: expect.objectContaining({
                            recipeId: null,
                            topics: ['audit.*'],
                        }),
                    }),
                ]),
            );
        } finally {
            await app.close();
        }
    });

    it('exposes a public deployment status snapshot without requiring auth', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = 'false';
        process.env.ASSET_SIGNED_TTL_SECONDS = '510';
        delete process.env.OPENAI_API_KEY;
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/deployment-status',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: {
                    overallStatus: string;
                    checks: {
                        database: { status: string };
                        restApi: { status: string; basePath: string };
                        bootstrap: {
                            status: string;
                            domainCount: number;
                            contentWritesRequireDomain: boolean;
                            supportsInBandDomainCreation: boolean;
                            restCreateDomainPath: string | null;
                            mcpCreateDomainTool: string | null;
                            recommendedGuideTask: string | null;
                            nextAction: string;
                        };
                        auth: {
                            status: string;
                            authRequired: boolean;
                            writeRequiresCredential: boolean;
                            insecureLocalAdminEnabled: boolean;
                            recommendedActorProfile: string;
                            recommendedScopes: string[];
                        };
                        vectorRag: {
                            status: string;
                            enabled: boolean;
                            model: string | null;
                            restPath: string;
                            mcpTool: string;
                            reason: string;
                        };
                        draftGeneration: {
                            status: string;
                            defaultProvider: string;
                            supportedProviders: string[];
                            provisionedProviders: string[];
                            provisioningMode?: string;
                            providers: {
                                deterministic: {
                                    status: string;
                                    enabled: boolean;
                                    requiresProvisioning: boolean;
                                };
                                openai: {
                                    status: string;
                                    enabled: boolean;
                                    model: string | null;
                                    reason: string;
                                    requiresProvisioning?: boolean;
                                    provisioningScope?: string;
                                    managementRestPath?: string;
                                    managementMcpTool?: string | null;
                                };
                            };
                        };
                        embeddings: {
                            status: string;
                            enabled: boolean;
                            model: string | null;
                            queueDepth: number;
                            inFlightSyncCount: number;
                            pendingItemCount: number;
                            dailyBudget: number;
                            dailyBudgetRemaining: number;
                            maxRequestsPerMinute: number;
                            reason: string;
                        };
                        ui: {
                            status: string;
                            servedFromApi: boolean;
                            routePrefix: string;
                            devCommand: string;
                            devUrl: string;
                        };
                        contentRuntime: {
                            status: string;
                            fieldAwareQueries: {
                                supported: boolean;
                                restPath: string;
                                mcpTool: string;
                                graphqlField: string;
                                requiresContentTypeId: boolean;
                            };
                            projections: {
                                supported: boolean;
                                restPath: string;
                                mcpTool: string;
                                graphqlField: string;
                                metrics: string[];
                                requiresContentTypeId: boolean;
                            };
                            publicWriteLane: {
                                supported: boolean;
                                issueTokenPath: string;
                                createPath: string;
                                updatePath: string;
                                tokenHeader: string;
                                requiresSchemaPolicy: boolean;
                            };
                        };
                        mcp: {
                            status: string;
                            endpoint: string;
                            transports: string[];
                            attachable: boolean;
                            reactive: {
                                supported: boolean;
                                transport: string;
                                subscriptionTool: string;
                                notificationMethod: string;
                                supportedTopicCount: number;
                                supportedRecipeCount: number;
                                supportedFilterFields: string[];
                            };
                        };
                        assetStorage: {
                            status: string;
                            enabled: boolean;
                            configuredProvider: string;
                            effectiveProvider: string;
                            fallbackApplied: boolean;
                            supportedProviders: string[];
                            restUploadModes: string[];
                            mcpUploadModes: string[];
                            directProviderUpload: {
                                enabled: boolean;
                                issuePath: string;
                                completePath: string;
                                method: string;
                                providers: string[];
                            };
                            deliveryModes: string[];
                            signedAccess: {
                                enabled: boolean;
                                defaultTtlSeconds: number;
                                issuePath: string;
                                issueTool: string;
                            };
                            derivatives: {
                                supported: boolean;
                                listPath: string;
                                listTool: string;
                                sourceField: string;
                                variantKeyField: string;
                                transformSpecField: string;
                            };
                        };
                        agentRuns: { status: string; enabled: boolean };
                    };
                    warnings: string[];
                };
            };

            expect(body.data.overallStatus).toBe('ready');
            expect(body.data.checks.database.status).toBe('ready');
            expect(body.data.checks.restApi).toEqual(expect.objectContaining({
                status: 'ready',
                basePath: '/api',
            }));
            expect(body.data.checks.bootstrap).toEqual(expect.objectContaining({
                status: 'ready',
                domainCount: 1,
                contentWritesRequireDomain: true,
                supportsInBandDomainCreation: true,
                restCreateDomainPath: '/api/domains',
                mcpCreateDomainTool: 'create_domain',
                recommendedGuideTask: 'bootstrap-workspace',
                nextAction: 'Bootstrap prerequisites are satisfied for content writes.',
            }));
            expect(body.data.checks.auth).toEqual(expect.objectContaining({
                status: 'ready',
                authRequired: true,
                writeRequiresCredential: true,
                insecureLocalAdminEnabled: true,
                recommendedActorProfile: 'api-key',
                recommendedScopes: ['content:write'],
            }));
            expect(body.data.checks.vectorRag).toEqual(expect.objectContaining({
                status: 'disabled',
                enabled: false,
                model: null,
                restPath: '/api/search/semantic',
                mcpTool: 'search_semantic_knowledge',
                reason: 'OPENAI_API_KEY not set',
            }));
            expect(body.data.checks.draftGeneration).toEqual(expect.objectContaining({
                status: 'ready',
                defaultProvider: 'deterministic',
                supportedProviders: ['deterministic', 'openai', 'anthropic', 'gemini'],
                provisionedProviders: ['deterministic'],
                provisioningMode: 'tenant-scoped',
                providers: expect.objectContaining({
                    deterministic: expect.objectContaining({
                        status: 'ready',
                        enabled: true,
                        requiresProvisioning: false,
                    }),
                    openai: expect.objectContaining({
                        status: 'disabled',
                        enabled: false,
                        model: null,
                        requiresProvisioning: true,
                        provisioningScope: 'tenant',
                        managementRestPath: '/api/ai/providers/openai',
                        managementMcpTool: 'list_ai_provider_configs',
                        reason: 'tenant_provider_config_required',
                    }),
                    anthropic: expect.objectContaining({
                        status: 'disabled',
                        enabled: false,
                        model: null,
                        requiresProvisioning: true,
                        provisioningScope: 'tenant',
                        managementRestPath: '/api/ai/providers/anthropic',
                        managementMcpTool: 'list_ai_provider_configs',
                        reason: 'tenant_provider_config_required',
                    }),
                    gemini: expect.objectContaining({
                        status: 'disabled',
                        enabled: false,
                        model: null,
                        requiresProvisioning: true,
                        provisioningScope: 'tenant',
                        managementRestPath: '/api/ai/providers/gemini',
                        managementMcpTool: 'list_ai_provider_configs',
                        reason: 'tenant_provider_config_required',
                    }),
                }),
            }));
            expect(body.data.checks.embeddings).toEqual(expect.objectContaining({
                status: 'disabled',
                enabled: false,
                model: null,
                queueDepth: 0,
                inFlightSyncCount: 0,
                pendingItemCount: 0,
                dailyBudget: 2000,
                dailyBudgetRemaining: 2000,
                maxRequestsPerMinute: 30,
                reason: 'OPENAI_API_KEY not set',
            }));
            expect(body.data.checks.ui).toEqual(expect.objectContaining({
                status: expect.any(String),
                servedFromApi: expect.any(Boolean),
                routePrefix: '/ui/',
                devCommand: 'npm run dev:all',
                devUrl: 'http://localhost:5173/ui/',
            }));
            expect(body.data.checks.contentRuntime).toEqual(expect.objectContaining({
                status: 'ready',
                fieldAwareQueries: expect.objectContaining({
                    supported: true,
                    restPath: '/api/content-items',
                    mcpTool: 'get_content_items',
                    graphqlField: 'contentItems',
                    requiresContentTypeId: true,
                }),
                projections: expect.objectContaining({
                    supported: true,
                    restPath: '/api/content-items/projections',
                    mcpTool: 'project_content_items',
                    graphqlField: 'contentItemProjection',
                    metrics: ['count', 'sum', 'avg', 'min', 'max'],
                    requiresContentTypeId: true,
                }),
                publicWriteLane: expect.objectContaining({
                    supported: true,
                    issueTokenPath: '/api/content-types/:id/public-write-tokens',
                    createPath: '/api/public/content-types/:id/items',
                    updatePath: '/api/public/content-items/:id',
                    tokenHeader: 'x-public-write-token',
                    requiresSchemaPolicy: true,
                }),
                lifecycle: expect.objectContaining({
                    supported: true,
                    triggerMode: 'lazy-on-touch',
                    schemaExtension: 'x-wordclaw-lifecycle',
                    includeArchivedFlag: 'includeArchived',
                    defaultArchiveStatus: 'archived',
                }),
            }));
            expect(body.data.checks.mcp).toEqual(expect.objectContaining({
                status: 'ready',
                endpoint: '/mcp',
                transports: ['stdio', 'streamable-http'],
                attachable: true,
                reactive: expect.objectContaining({
                    supported: true,
                    transport: 'streamable-http',
                    subscriptionTool: 'subscribe_events',
                    notificationMethod: 'notifications/wordclaw/event',
                    supportedRecipeCount: 5,
                    supportedFilterFields: expect.arrayContaining(['contentTypeId', 'entityId', 'actorType']),
                }),
            }));
            expect(body.data.checks.assetStorage).toEqual(expect.objectContaining({
                status: 'ready',
                enabled: true,
                configuredProvider: 'local',
                effectiveProvider: 'local',
                fallbackApplied: false,
                supportedProviders: ['local', 's3'],
                restUploadModes: ['json-base64', 'multipart-form-data'],
                mcpUploadModes: ['inline-base64'],
                directProviderUpload: {
                    enabled: false,
                    issuePath: '/api/assets/direct-upload',
                    completePath: '/api/assets/direct-upload/complete',
                    method: 'PUT',
                    providers: ['s3'],
                },
                deliveryModes: ['public', 'signed', 'entitled'],
                signedAccess: expect.objectContaining({
                    enabled: true,
                    defaultTtlSeconds: 510,
                    issuePath: '/api/assets/:id/access',
                    issueTool: 'issue_asset_access',
                }),
                derivatives: expect.objectContaining({
                    supported: true,
                    listPath: '/api/assets/:id/derivatives',
                    listTool: 'list_asset_derivatives',
                    sourceField: 'sourceAssetId',
                    variantKeyField: 'variantKey',
                    transformSpecField: 'transformSpec',
                }),
            }));
            expect(body.data.checks.agentRuns).toEqual(expect.objectContaining({
                status: 'disabled',
                enabled: false,
            }));
            if (body.data.checks.ui.servedFromApi) {
                expect(body.data.warnings).toEqual([]);
            } else {
                expect(body.data.warnings).toEqual([
                    'Supervisor UI assets are not currently being served from /ui/. Build the UI or use npm run dev:all for local development.',
                ]);
            }
        } finally {
            await app.close();
        }
    });

    it('returns degraded deployment status when no domains are provisioned', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = 'false';
        delete process.env.OPENAI_API_KEY;
        mocks.dbMock.execute
            .mockResolvedValueOnce([{ '?column?': 1 }])
            .mockResolvedValueOnce([{ total: 0 }]);
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/deployment-status',
            });

            expect(response.statusCode).toBe(503);
            const body = response.json() as {
                data: {
                    overallStatus: string;
                    checks: {
                        bootstrap: {
                            status: string;
                            domainCount: number;
                            nextAction: string;
                        };
                    };
                    warnings: string[];
                };
            };

            expect(body.data.overallStatus).toBe('degraded');
            expect(body.data.checks.bootstrap).toEqual(expect.objectContaining({
                status: 'degraded',
                domainCount: 0,
                nextAction: 'Create the first domain before attempting content-type or content-item writes.',
            }));
            expect(body.data.warnings).toContain('No domains are provisioned yet, so content-type and content-item writes are blocked until bootstrap completes.');
        } finally {
            await app.close();
        }
    });

    it('returns workspace context for authenticated callers', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'remote-admin=admin';
        const app = await buildServer();

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 1,
                        name: 'Local Dev',
                        hostname: 'localhost',
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 7,
                        name: 'Scenario Blog Post',
                        slug: 'scenario-blog-post',
                        description: 'Scenario content',
                        schema: '{"type":"object","required":["title"],"properties":{"title":{"type":"string"},"body":{"type":"string"}}}',
                        basePrice: null,
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 500,
                        contentTypeId: 7,
                        status: 'published',
                        updatedAt: new Date('2026-03-10T10:00:00Z'),
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 22,
                        domainId: 1,
                        name: 'Editorial Flow',
                        contentTypeId: 7,
                        active: true,
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        workflowId: 22,
                    }, {
                        workflowId: 22,
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        scopeRef: 7,
                        priceSats: 150,
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        contentItemId: 500,
                    }]),
                }),
            }));

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/workspace-context',
                headers: {
                    'x-api-key': 'remote-admin',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: {
                    currentActor: { actorId: string; actorProfileId: string; domainId: number };
                    currentDomain: { id: number; name: string; hostname: string; current: boolean };
                    accessibleDomains: Array<{ id: number; current: boolean }>;
                    filter: {
                        intent: string;
                        search: string | null;
                        limit: number | null;
                        totalContentTypesBeforeFilter: number;
                        totalContentTypesAfterSearch: number;
                        returnedContentTypes: number;
                    };
                    summary: {
                        totalContentTypes: number;
                        contentTypesWithContent: number;
                        workflowEnabledContentTypes: number;
                        paidContentTypes: number;
                        pendingReviewTaskCount: number;
                    };
                    targets: {
                        authoring: Array<{
                            id: number;
                            reason: string;
                            recommendedCommands: { contentGuide: string };
                        }>;
                        review: Array<{
                            id: number;
                            reason: string;
                        }>;
                        workflow: Array<{
                            id: number;
                            reason: string;
                        }>;
                        paid: Array<{
                            id: number;
                            reason: string;
                        }>;
                    };
                    contentTypes: Array<{
                        id: number;
                        slug: string;
                        itemCount: number;
                        pendingReviewTaskCount: number;
                        workflow: { activeWorkflowCount: number; activeWorkflows: Array<{ transitionCount: number }> };
                        paid: { activeTypeOfferCount: number; lowestTypeOfferSats: number | null };
                        recommendedCommands: { contentGuide: string; workflowActive: string };
                    }>;
                    warnings: string[];
                };
            };

            expect(body.data.currentActor).toEqual(expect.objectContaining({
                actorId: 'env_key:remote-admin',
                actorProfileId: 'env-key',
                domainId: 1,
            }));
            expect(body.data.currentDomain).toEqual({
                id: 1,
                name: 'Local Dev',
                hostname: 'localhost',
                current: true,
            });
            expect(body.data.accessibleDomains).toEqual([{
                id: 1,
                name: 'Local Dev',
                hostname: 'localhost',
                current: true,
            }]);
            expect(body.data.filter).toEqual({
                intent: 'all',
                search: null,
                limit: null,
                totalContentTypesBeforeFilter: 1,
                totalContentTypesAfterSearch: 1,
                returnedContentTypes: 1,
            });
            expect(body.data.summary).toEqual({
                totalContentTypes: 1,
                contentTypesWithContent: 1,
                workflowEnabledContentTypes: 1,
                paidContentTypes: 1,
                pendingReviewTaskCount: 1,
            });
            expect(body.data.targets).toEqual({
                authoring: [expect.objectContaining({
                    id: 7,
                    reason: '1 stored item(s) and 1 active workflow(s) make this a strong authoring target.',
                    recommendedCommands: expect.objectContaining({
                        contentGuide: 'node dist/cli/index.js content guide --content-type-id 7',
                    }),
                })],
                review: [expect.objectContaining({
                    id: 7,
                    reason: '1 pending review task(s) across 1 stored item(s).',
                })],
                workflow: [expect.objectContaining({
                    id: 7,
                    reason: '1 active workflow(s) and 1 pending review task(s) are mapped to this schema.',
                })],
                paid: [expect.objectContaining({
                    id: 7,
                    reason: '1 active type offer(s), starting at 150 sats.',
                })],
            });
            expect(body.data.contentTypes[0]).toEqual(expect.objectContaining({
                id: 7,
                slug: 'scenario-blog-post',
                itemCount: 1,
                pendingReviewTaskCount: 1,
                workflow: expect.objectContaining({
                    activeWorkflowCount: 1,
                    activeWorkflows: [expect.objectContaining({
                        transitionCount: 2,
                    })],
                }),
                paid: expect.objectContaining({
                    activeTypeOfferCount: 1,
                    lowestTypeOfferSats: 150,
                }),
                recommendedCommands: expect.objectContaining({
                    contentGuide: 'node dist/cli/index.js content guide --content-type-id 7',
                    workflowActive: 'node dist/cli/index.js workflow active --content-type-id 7',
                }),
            }));
            expect(body.data.warnings).toEqual([]);
        } finally {
            await app.close();
        }
    });

    it('supports filtered workspace context queries for authenticated callers', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'remote-admin=admin';
        const app = await buildServer();
        const selectSpy = vi.spyOn(mocks.dbMock, 'select');

        selectSpy
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 1,
                        name: 'Local Dev',
                        hostname: 'localhost',
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([
                        {
                            id: 7,
                            domainId: 1,
                            name: 'Author Profile',
                            slug: 'author-profile',
                            description: null,
                            schema: '{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}',
                            basePrice: null,
                        },
                        {
                            id: 8,
                            domainId: 1,
                            name: 'Editorial Blog Post',
                            slug: 'editorial-blog-post',
                            description: 'Reviewed content',
                            schema: '{"type":"object","properties":{"title":{"type":"string"}},"required":["title"]}',
                            basePrice: null,
                        },
                    ]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 501,
                        contentTypeId: 8,
                        status: 'in_review',
                        updatedAt: new Date('2026-03-10T10:00:00Z'),
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 22,
                        domainId: 1,
                        name: 'Editorial Flow',
                        contentTypeId: 8,
                        active: true,
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ workflowId: 22 }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ contentItemId: 501 }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 501,
                        contentTypeId: 8,
                        data: '{"title":"Editorial Draft","slug":"editorial-draft"}',
                        status: 'in_review',
                        version: 3,
                        createdAt: new Date('2026-03-10T09:00:00Z'),
                        updatedAt: new Date('2026-03-10T10:00:00Z'),
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 22,
                        name: 'Editorial Flow',
                        contentTypeId: 8,
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 77,
                        workflowId: 22,
                        fromState: 'draft',
                        toState: 'in_review',
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 91,
                        contentItemId: 501,
                        workflowTransitionId: 77,
                        status: 'pending',
                        assignee: 'env_key:remote-admin',
                        createdAt: new Date('2026-03-10T10:05:00Z'),
                        updatedAt: new Date('2026-03-10T10:05:00Z'),
                    }]),
                }),
            }));

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/workspace-context?intent=review&search=editorial&limit=1',
                headers: {
                    'x-api-key': 'remote-admin',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: {
                    filter: {
                        intent: string;
                        search: string | null;
                        limit: number | null;
                        totalContentTypesBeforeFilter: number;
                        totalContentTypesAfterSearch: number;
                        returnedContentTypes: number;
                    };
                    summary: {
                        totalContentTypes: number;
                    };
                    contentTypes: Array<{ id: number; slug: string }>;
                    targets: {
                        review: Array<{ id: number }>;
                    };
                };
            };

            expect(body.data.filter).toEqual({
                intent: 'review',
                search: 'editorial',
                limit: 1,
                totalContentTypesBeforeFilter: 2,
                totalContentTypesAfterSearch: 1,
                returnedContentTypes: 1,
            });
            expect(body.data.summary.totalContentTypes).toBe(1);
            expect(body.data.contentTypes).toEqual([expect.objectContaining({
                id: 8,
                slug: 'editorial-blog-post',
            })]);
            expect(body.data.targets.review).toEqual([expect.objectContaining({
                id: 8,
            })]);
        } finally {
            await app.close();
        }
    });

    it('resolves the best workspace target for authenticated callers', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'remote-admin=admin';
        const app = await buildServer();
        const selectSpy = vi.spyOn(mocks.dbMock, 'select');

        selectSpy
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 1,
                        name: 'Local Dev',
                        hostname: 'localhost',
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([
                        {
                            id: 7,
                            domainId: 1,
                            name: 'Author Profile',
                            slug: 'author-profile',
                            description: null,
                            schema: '{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}',
                            basePrice: null,
                        },
                        {
                            id: 8,
                            domainId: 1,
                            name: 'Editorial Blog Post',
                            slug: 'editorial-blog-post',
                            description: 'Reviewed content',
                            schema: '{"type":"object","properties":{"title":{"type":"string"}},"required":["title"]}',
                            basePrice: null,
                        },
                    ]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 501,
                        contentTypeId: 8,
                        status: 'in_review',
                        updatedAt: new Date('2026-03-10T10:00:00Z'),
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 22,
                        domainId: 1,
                        name: 'Editorial Flow',
                        contentTypeId: 8,
                        active: true,
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ workflowId: 22 }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ contentItemId: 501 }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 501,
                        contentTypeId: 8,
                        data: '{"title":"Editorial Draft","slug":"editorial-draft"}',
                        status: 'in_review',
                        version: 3,
                        createdAt: new Date('2026-03-10T09:00:00Z'),
                        updatedAt: new Date('2026-03-10T10:00:00Z'),
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 22,
                        name: 'Editorial Flow',
                        contentTypeId: 8,
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 77,
                        workflowId: 22,
                        fromState: 'draft',
                        toState: 'in_review',
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 91,
                        contentItemId: 501,
                        workflowTransitionId: 77,
                        status: 'pending',
                        assignee: 'env_key:remote-admin',
                        createdAt: new Date('2026-03-10T10:05:00Z'),
                        updatedAt: new Date('2026-03-10T10:05:00Z'),
                    }]),
                }),
            }));

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/workspace-target?intent=review&search=editorial',
                headers: {
                    'x-api-key': 'remote-admin',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: {
                    intent: string;
                    search: string | null;
                    availableTargetCount: number;
                    target: {
                        id: number;
                        rank: number;
                        workTarget: {
                            kind: string;
                            status: string;
                            reviewTask: {
                                id: number;
                                actionable: boolean;
                            } | null;
                            contentItem: {
                                label: string;
                                slug: string | null;
                            } | null;
                        } | null;
                        contentType: {
                            slug: string;
                        } | null;
                    } | null;
                    alternatives: Array<unknown>;
                };
            };

            expect(body.data.intent).toBe('review');
            expect(body.data.search).toBe('editorial');
            expect(body.data.availableTargetCount).toBe(1);
            expect(body.data.target).toEqual(expect.objectContaining({
                id: 8,
                rank: 1,
                contentType: expect.objectContaining({
                    slug: 'editorial-blog-post',
                }),
                workTarget: expect.objectContaining({
                    kind: 'review-task',
                    status: 'ready',
                    reviewTask: expect.objectContaining({
                        id: 91,
                        actionable: true,
                    }),
                    contentItem: expect.objectContaining({
                        label: 'Editorial Draft',
                        slug: 'editorial-draft',
                    }),
                }),
            }));
            expect(body.data.alternatives).toEqual([]);
        } finally {
            await app.close();
        }
    });

    it('returns the current canonical actor snapshot for authenticated callers', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'remote-admin=admin';
        mocks.dbMock.select.mockImplementationOnce(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    id: 1,
                    name: 'Default',
                    hostname: 'default.local'
                }]),
            }),
        }));
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/identity',
                headers: {
                    'x-api-key': 'remote-admin',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: {
                    actorId: string;
                    actorType: string;
                    actorSource: string;
                    actorProfileId: string;
                    domainId: number;
                    domain: {
                        id: number;
                        name: string;
                        hostname: string;
                    } | null;
                    scopes: string[];
                    assignmentRefs: string[];
                    profile: {
                        id: string;
                        authMode: string;
                    } | null;
                };
            };

            expect(body.data).toEqual(expect.objectContaining({
                actorId: 'env_key:remote-admin',
                actorType: 'env_key',
                actorSource: 'env',
                actorProfileId: 'env-key',
                domainId: 1,
                domain: {
                    id: 1,
                    name: 'Default',
                    hostname: 'default.local'
                },
                scopes: ['admin'],
                assignmentRefs: ['env_key:remote-admin', 'remote-admin'],
                profile: expect.objectContaining({
                    id: 'env-key',
                    authMode: 'api-key',
                }),
            }));
        } finally {
            await app.close();
        }
    });

    it('aliases the current actor snapshot at /api/whoami', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'remote-admin=admin';
        mocks.dbMock.select.mockImplementationOnce(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    id: 1,
                    name: 'Default',
                    hostname: 'default.local'
                }]),
            }),
        }));
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/whoami',
                headers: {
                    'x-api-key': 'remote-admin',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: {
                    actorId: string;
                    domainId: number;
                    domain: {
                        id: number;
                        name: string;
                        hostname: string;
                    } | null;
                };
            };

            expect(body.data).toEqual(expect.objectContaining({
                actorId: 'env_key:remote-admin',
                domainId: 1,
                domain: {
                    id: 1,
                    name: 'Default',
                    hostname: 'default.local'
                }
            }));
        } finally {
            await app.close();
        }
    });

    it('does not register the experimental earnings route by default', async () => {
        delete process.env.ENABLE_EXPERIMENTAL_REVENUE;
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/agents/me/earnings',
            });

            expect(response.statusCode).toBe(404);
        } finally {
            await app.close();
        }
    });

    it('registers the experimental earnings route when explicitly enabled', async () => {
        process.env.ENABLE_EXPERIMENTAL_REVENUE = 'true';
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/agents/me/earnings',
            });

            expect(response.statusCode).toBe(401);

            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('API_KEY_REQUIRED');
        } finally {
            await app.close();
        }
    });

    it('does not register the delegation route by default', async () => {
        delete process.env.ENABLE_EXPERIMENTAL_DELEGATION;
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/entitlements/1/delegate',
                payload: {
                    targetApiKeyId: 2,
                    readsAmount: 1
                }
            });

            expect(response.statusCode).toBe(404);
        } finally {
            await app.close();
        }
    });

    it('registers the delegation route when explicitly enabled', async () => {
        process.env.ENABLE_EXPERIMENTAL_DELEGATION = 'true';
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/entitlements/1/delegate',
                payload: {
                    targetApiKeyId: 2,
                    readsAmount: 1
                }
            });

            expect(response.statusCode).toBe(403);

            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('API_KEY_REQUIRED');
        } finally {
            await app.close();
        }
    });

    it('does not register agent-run routes when explicitly disabled', async () => {
        process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = 'false';
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/agent-runs?status=queued',
            });

            expect(response.statusCode).toBe(404);
        } finally {
            await app.close();
        }
    });

    it('registers agent-run routes when explicitly enabled', async () => {
        process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = 'true';
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/agent-runs?status=not-a-status',
            });

            expect(response.statusCode).toBe(400);

            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('AGENT_RUN_INVALID_STATUS');
        } finally {
            await app.close();
        }
    });

    it('returns EMPTY_UPDATE_BODY for content-type update with empty body', async () => {
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'PUT',
                url: '/api/content-types/1',
                payload: {}
            });

            expect(response.statusCode).toBe(400);

            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('EMPTY_UPDATE_BODY');
            expect(body.remediation).toContain('at least one field');
            expect(mocks.dbMock.update).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('returns EMPTY_UPDATE_BODY for content-item update with empty body', async () => {
        const app = await buildServer();

        mocks.dbMock.select.mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([])
            })
        });

        try {
            const response = await app.inject({
                method: 'PUT',
                url: '/api/content-items/1',
                payload: {}
            });
            expect(response.statusCode).toBe(400);

            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('EMPTY_UPDATE_BODY');
            expect(body.remediation).toContain('at least one field');
            expect(mocks.dbMock.transaction).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('returns content-item reverse-reference usage over REST', async () => {
        const app = await buildServer();
        mocks.dbMock.select.mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([{ id: 42 }])
            })
        });
        const usageSpy = vi.spyOn(referenceUsageService, 'findContentItemUsage').mockResolvedValue({
            activeReferences: [{
                contentItemId: 88,
                contentTypeId: 7,
                contentTypeName: 'Article',
                contentTypeSlug: 'article',
                path: '/related/0',
                version: 5,
                status: 'published'
            }],
            historicalReferences: []
        });

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/content-items/42/used-by'
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: {
                    activeReferenceCount: number;
                    historicalReferenceCount: number;
                    activeReferences: Array<{ contentItemId: number; path: string }>;
                };
            };
            expect(body.data.activeReferenceCount).toBe(1);
            expect(body.data.historicalReferenceCount).toBe(0);
            expect(body.data.activeReferences[0]).toMatchObject({
                contentItemId: 88,
                path: '/related/0'
            });
            expect(usageSpy).toHaveBeenCalledWith(1, 42);
        } finally {
            usageSpy.mockRestore();
            await app.close();
        }
    });

    it('returns INVALID_CONTENT_SCHEMA_JSON for content-type create with invalid schema JSON', async () => {
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-types',
                payload: {
                    name: 'Invalid Schema Type',
                    slug: 'invalid-schema-type',
                    schema: '{not-json'
                }
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('INVALID_CONTENT_SCHEMA_JSON');
            expect(mocks.dbMock.insert).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('accepts schema manifests for content-type create and returns the compiled schema', async () => {
        const app = await buildServer();

        mocks.dbMock.insert.mockImplementation(() => ({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{
                    id: 17,
                    name: 'Landing Page',
                    slug: 'landing-page',
                    kind: 'collection',
                    description: 'Manifest-backed type',
                    schemaManifest: JSON.stringify({
                        fields: [
                            {
                                name: 'title',
                                type: 'text',
                                required: true
                            }
                        ]
                    }),
                    schema: JSON.stringify({
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            title: {
                                type: 'string'
                            }
                        },
                        required: ['title'],
                        'x-wordclaw-schema-manifest': {
                            version: 1
                        }
                    }),
                    basePrice: null,
                    createdAt: '2026-03-29T10:00:00.000Z',
                    updatedAt: '2026-03-29T10:00:00.000Z'
                }])
            }),
        }));

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-types',
                payload: {
                    name: 'Landing Page',
                    slug: 'landing-page',
                    schemaManifest: {
                        fields: [
                            {
                                name: 'title',
                                type: 'text',
                                required: true
                            }
                        ]
                    }
                }
            });

            expect(response.statusCode).toBe(201);
            const body = response.json() as {
                data: {
                    schemaManifest?: string | null;
                    schema: string;
                };
            };
            expect(body.data.schemaManifest).toContain('"fields"');
            expect(JSON.parse(body.data.schema)).toMatchObject({
                type: 'object',
                required: ['title']
            });
        } finally {
            await app.close();
        }
    });

    it('returns INVALID_CONTENT_SCHEMA_ASSET_EXTENSION for malformed asset schema extensions', async () => {
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-types',
                payload: {
                    name: 'Broken Asset Type',
                    slug: 'broken-asset-type',
                    schema: {
                        type: 'object',
                        properties: {
                            heroImage: {
                                type: 'string',
                                'x-wordclaw-field-kind': 'asset'
                            }
                        }
                    }
                }
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('INVALID_CONTENT_SCHEMA_ASSET_EXTENSION');
            expect(mocks.dbMock.insert).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('returns NO_DOMAIN for content-type create when no domains are provisioned', async () => {
        mocks.dbMock.execute
            .mockResolvedValueOnce([{ total: 0 }])
            .mockResolvedValueOnce([{ total: 0 }]);
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-types',
                payload: {
                    name: 'Article',
                    slug: 'article',
                    schema: '{"type":"object"}'
                }
            });

            expect(response.statusCode).toBe(409);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('NO_DOMAIN');
            expect(mocks.dbMock.insert).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('returns CONTENT_TYPE_SLUG_CONFLICT for content-type create duplicate slug in domain', async () => {
        const app = await buildServer();
        const duplicateError = Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
            constraint: 'content_types_domain_slug_unique'
        });

        mocks.dbMock.insert.mockImplementation(() => ({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockRejectedValue(duplicateError)
            }),
        }));

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-types',
                payload: {
                    name: 'Duplicate Slug',
                    slug: 'article',
                    schema: '{"type":"object"}'
                }
            });

            expect(response.statusCode).toBe(409);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('CONTENT_TYPE_SLUG_CONFLICT');
        } finally {
            await app.close();
        }
    });

    it('creates the first domain during bootstrap', async () => {
        mocks.dbMock.execute.mockResolvedValueOnce([{ total: 0 }]);
        mocks.dbMock.insert.mockImplementation(() => ({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{
                    id: 1,
                    name: 'Local Development',
                    hostname: 'local.development',
                    createdAt: new Date('2026-03-29T09:00:00.000Z')
                }]),
            }),
        }));
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/domains',
                payload: {
                    name: 'Local Development',
                    hostname: 'local.development'
                }
            });

            expect(response.statusCode).toBe(201);
            const body = response.json() as {
                data: {
                    id: number;
                    name: string;
                    hostname: string;
                    createdAt: string;
                };
            };

            expect(body.data).toEqual({
                id: 1,
                name: 'Local Development',
                hostname: 'local.development',
                createdAt: '2026-03-29T09:00:00.000Z'
            });
            expect(mocks.logAuditMock).toHaveBeenCalledWith(
                1,
                'create',
                'domain',
                1,
                expect.objectContaining({
                    id: 1,
                    hostname: 'local.development'
                }),
                expect.anything(),
                expect.any(String)
            );
        } finally {
            await app.close();
        }
    });

    it('onboards a tenant and returns its initial admin key', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'remote-admin=admin';
        mocks.dbMock.execute.mockResolvedValueOnce([{ total: 0 }]);
        mocks.dbMock.transaction.mockImplementation(async (callback: (tx: typeof mocks.dbMock) => Promise<unknown>) => {
            let insertCount = 0;
            const tx = {
                insert: vi.fn().mockImplementation(() => ({
                    values: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([
                            insertCount++ === 0
                                ? {
                                    id: 2,
                                    name: 'Epilomedia',
                                    hostname: 'epilomedia.com',
                                    createdAt: new Date('2026-03-31T09:00:00.000Z')
                                }
                                : {
                                    id: 19,
                                    domainId: 2,
                                    name: 'Epilomedia Admin',
                                    keyPrefix: 'wcak_testkey',
                                    scopes: 'admin',
                                    createdBy: null,
                                    createdAt: new Date('2026-03-31T09:00:01.000Z'),
                                    expiresAt: null,
                                    revokedAt: null,
                                    lastUsedAt: null
                                }
                        ])
                    })
                }))
            } as unknown as typeof mocks.dbMock;

            return callback(tx);
        });
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/onboard',
                headers: {
                    'x-api-key': 'remote-admin',
                    host: 'kb.lightheart.tech',
                    'x-forwarded-proto': 'https'
                },
                payload: {
                    tenantName: 'Epilomedia',
                    hostname: 'epilomedia.com',
                    apiKeyName: 'Epilomedia Admin'
                }
            });

            expect(response.statusCode).toBe(201);
            const body = response.json() as {
                data: {
                    bootstrap: boolean;
                    domain: { id: number; name: string; hostname: string; createdAt: string };
                    apiKey: { id: number; name: string; keyPrefix: string; scopes: string[]; expiresAt: string | null; apiKey: string };
                    endpoints: { api: string | null; mcp: string | null };
                };
            };

            expect(body.data.bootstrap).toBe(true);
            expect(body.data.domain).toEqual({
                id: 2,
                name: 'Epilomedia',
                hostname: 'epilomedia.com',
                createdAt: '2026-03-31T09:00:00.000Z'
            });
            expect(body.data.apiKey).toEqual(expect.objectContaining({
                id: 19,
                name: 'Epilomedia Admin',
                keyPrefix: 'wcak_testkey',
                scopes: ['admin'],
                expiresAt: null,
                apiKey: expect.stringMatching(/^wcak_/)
            }));
            expect(body.data.endpoints).toEqual({
                api: 'https://kb.lightheart.tech/api',
                mcp: 'https://kb.lightheart.tech/mcp'
            });
            expect(mocks.logAuditMock).toHaveBeenNthCalledWith(
                1,
                2,
                'create',
                'domain',
                2,
                expect.objectContaining({
                    onboardTenant: true,
                    hostname: 'epilomedia.com'
                }),
                expect.anything(),
                expect.any(String)
            );
            expect(mocks.logAuditMock).toHaveBeenNthCalledWith(
                2,
                2,
                'create',
                'api_key',
                19,
                expect.objectContaining({
                    onboardTenant: true,
                    authKeyCreated: true,
                    scopes: ['admin']
                }),
                expect.anything(),
                expect.any(String)
            );
        } finally {
            await app.close();
        }
    });

    it('returns DOMAIN_HOSTNAME_CONFLICT with existing domain context for duplicate onboarding hostname', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'remote-admin=admin';
        const duplicateError = Object.assign(new Error('Failed query: insert into "domains"'), {
            cause: {
                code: '23505',
                constraint: 'domains_hostname_unique'
            }
        });
        mocks.dbMock.execute.mockResolvedValueOnce([{ total: 1 }]);
        mocks.dbMock.transaction.mockRejectedValueOnce(duplicateError);
        mocks.dbMock.select.mockImplementationOnce(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    id: 7,
                    name: 'Epilomedia',
                    hostname: 'epilomedia.com'
                }]),
            }),
        }));
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/onboard',
                headers: {
                    'x-api-key': 'remote-admin'
                },
                payload: {
                    tenantName: 'Epilomedia',
                    hostname: 'epilomedia.com'
                }
            });

            expect(response.statusCode).toBe(409);
            const body = response.json() as ApiErrorBody & {
                context?: {
                    existingDomain?: {
                        id: number;
                        name: string;
                        hostname: string;
                    };
                };
            };

            expect(body.code).toBe('DOMAIN_HOSTNAME_CONFLICT');
            expect(body.remediation).toContain('POST /api/auth/keys');
            expect(body.context?.existingDomain).toEqual({
                id: 7,
                name: 'Epilomedia',
                hostname: 'epilomedia.com'
            });
        } finally {
            await app.close();
        }
    });

    it('optionally creates a tenant-scoped supervisor during onboarding', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'remote-admin=admin';
        mocks.dbMock.execute.mockResolvedValueOnce([{ total: 0 }]);
        mocks.dbMock.transaction.mockImplementationOnce(async (callback: (tx: typeof mocks.dbMock) => Promise<unknown>) => {
            const txInsert = vi.fn()
                .mockImplementationOnce(() => ({
                    values: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{
                            id: 2,
                            name: 'Epilomedia',
                            hostname: 'epilomedia.com',
                            createdAt: new Date('2026-03-31T09:00:00.000Z'),
                        }])
                    })
                }))
                .mockImplementationOnce(() => ({
                    values: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{
                            id: 19,
                            domainId: 2,
                            name: 'Epilomedia Admin',
                            keyPrefix: 'wcak_testkey',
                            scopes: 'admin',
                            createdBy: null,
                            createdAt: new Date('2026-03-31T09:00:00.000Z'),
                            expiresAt: null,
                        }])
                    })
                }))
                .mockImplementationOnce(() => ({
                    values: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{
                            id: 31,
                            email: 'admin@epilomedia.com',
                            domainId: 2,
                            passwordHash: 'hash',
                            createdAt: new Date('2026-03-31T09:00:00.000Z'),
                            lastLoginAt: null,
                        }])
                    })
                }));

            const tx = {
                ...mocks.dbMock,
                select: vi.fn().mockImplementationOnce(() => ({
                    from: () => ({
                        where: vi.fn().mockResolvedValue([{
                            id: 2,
                            name: 'Epilomedia',
                            hostname: 'epilomedia.com',
                        }]),
                    }),
                })),
                insert: txInsert,
            } as unknown as typeof mocks.dbMock;

            return callback(tx);
        });
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/onboard',
                headers: {
                    'x-api-key': 'remote-admin',
                },
                payload: {
                    tenantName: 'Epilomedia',
                    hostname: 'epilomedia.com',
                    supervisor: {
                        email: 'admin@epilomedia.com',
                        password: 'password123',
                    }
                }
            });

            expect(response.statusCode).toBe(201);
            const body = response.json() as {
                data: {
                    supervisor: { id: number; email: string; domainId: number } | null;
                };
            };

            expect(body.data.supervisor).toEqual({
                id: 31,
                email: 'admin@epilomedia.com',
                domainId: 2,
            });
            expect(mocks.logAuditMock).toHaveBeenNthCalledWith(
                3,
                2,
                'create',
                'supervisor',
                31,
                expect.objectContaining({
                    onboardTenant: true,
                    email: 'admin@epilomedia.com'
                }),
                expect.anything(),
                expect.any(String)
            );
        } finally {
            await app.close();
        }
    });

    it('requires admin scope to onboard a tenant', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'writer=content:write';
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/onboard',
                headers: {
                    'x-api-key': 'writer'
                },
                payload: {
                    tenantName: 'Epilomedia',
                    hostname: 'epilomedia.com'
                }
            });

            expect(response.statusCode).toBe(403);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('PLATFORM_ADMIN_REQUIRED');
        } finally {
            await app.close();
        }
    });

    it('requires a platform-admin actor to create additional domains', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'writer=content:write';
        mocks.dbMock.execute.mockResolvedValueOnce([{ total: 1 }]);
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/domains',
                headers: {
                    'x-api-key': 'writer'
                },
                payload: {
                    name: 'Second Domain',
                    hostname: 'second.example'
                }
            });

            expect(response.statusCode).toBe(403);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('PLATFORM_ADMIN_REQUIRED');
        } finally {
            await app.close();
        }
    });

    it('returns CONTENT_TYPE_SLUG_CONFLICT for content-type update duplicate slug in domain', async () => {
        const app = await buildServer();
        const duplicateError = Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
            constraint: 'content_types_domain_slug_unique'
        });

        mocks.dbMock.select.mockImplementationOnce(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    id: 1,
                    name: 'Article',
                    slug: 'article',
                    kind: 'collection',
                    description: null,
                    schema: '{"type":"object"}',
                    basePrice: 0,
                    createdAt: '2026-03-01T10:00:00.000Z',
                    updatedAt: '2026-03-06T08:00:00.000Z'
                }]),
            }),
        }));

        mocks.dbMock.update.mockImplementation(() => ({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockRejectedValue(duplicateError)
                })
            }),
        }));

        try {
            const response = await app.inject({
                method: 'PUT',
                url: '/api/content-types/1',
                payload: {
                    slug: 'article'
                }
            });

            expect(response.statusCode).toBe(409);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('CONTENT_TYPE_SLUG_CONFLICT');
        } finally {
            await app.close();
        }
    });

    it('returns SINGLETON_CONTENT_TYPE_REQUIRES_ONE_ITEM when converting a populated collection to singleton', async () => {
        const app = await buildServer();

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 1,
                        name: 'Site Settings',
                        slug: 'site-settings',
                        kind: 'collection',
                        description: null,
                        schema: '{"type":"object"}',
                        basePrice: 0,
                        createdAt: '2026-03-01T10:00:00.000Z',
                        updatedAt: '2026-03-06T08:00:00.000Z'
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ total: 2 }]),
                }),
            }));

        try {
            const response = await app.inject({
                method: 'PUT',
                url: '/api/content-types/1',
                payload: {
                    kind: 'singleton'
                }
            });

            expect(response.statusCode).toBe(409);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('SINGLETON_CONTENT_TYPE_REQUIRES_ONE_ITEM');
        } finally {
            await app.close();
        }
    });

    it('maps missing rollback target version to 404 TARGET_VERSION_NOT_FOUND', async () => {
        const app = await buildServer();

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ id: 1, contentTypeId: 9, version: 3 }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([]),
                }),
            }));

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-items/1/rollback',
                payload: { version: 999 }
            });

            expect(response.statusCode).toBe(404);

            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('TARGET_VERSION_NOT_FOUND');
            expect(body.remediation).toContain('GET /api/content-items/1/versions');
            expect(mocks.dbMock.transaction).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('supports dry-run rollback without executing a transaction', async () => {
        const app = await buildServer();

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ id: 1, contentTypeId: 4, version: 3 }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ id: 10, version: 2, data: '{}', status: 'draft' }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 4,
                        schema: '{"type":"object"}'
                    }]),
                }),
            }));

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-items/1/rollback?mode=dry_run',
                payload: { version: 2 }
            });

            expect(response.statusCode).toBe(200);

            const body = response.json() as { meta?: { dryRun?: boolean } };
            expect(body.meta?.dryRun).toBe(true);
            expect(mocks.dbMock.transaction).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('returns CONTENT_ITEM_NOT_FOUND when rollback transaction returns null', async () => {
        const app = await buildServer();

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ id: 42, contentTypeId: 7, version: 4 }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ id: 77, version: 1, data: '{"title":"ok"}', status: 'draft' }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 7,
                        schema: '{"type":"object"}'
                    }]),
                }),
            }));

        mocks.dbMock.transaction.mockResolvedValue(null);

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-items/42/rollback',
                payload: { version: 1 }
            });

            expect(response.statusCode).toBe(404);

            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('CONTENT_ITEM_NOT_FOUND');
            expect(mocks.logAuditMock).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('returns AGENT_RUN_INVALID_STATUS for invalid agent-run list filter', async () => {
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/agent-runs?status=not-a-status'
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('AGENT_RUN_INVALID_STATUS');
        } finally {
            await app.close();
        }
    });

    it('forwards runType filter for run-definition list route', async () => {
        const app = await buildServer();
        const listDefinitionsSpy = vi.spyOn(AgentRunService, 'listDefinitions').mockResolvedValue({
            items: [],
            total: 0,
            limit: 50,
            offset: 0,
            hasMore: false
        });

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/agent-run-definitions?runType=quality_refiner&limit=25&offset=5'
            });

            expect(response.statusCode).toBe(200);
            expect(listDefinitionsSpy).toHaveBeenCalledWith(1, {
                active: undefined,
                runType: 'quality_refiner',
                limit: 25,
                offset: 5
            });
        } finally {
            listDefinitionsSpy.mockRestore();
            await app.close();
        }
    });

    it('forwards metrics query options for agent-run metrics route', async () => {
        process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = 'true';
        const app = await buildServer();
        const metricsSpy = vi.spyOn(AgentRunMetricsService, 'getMetrics').mockResolvedValue({
            window: {
                hours: 48,
                from: '2026-03-06T00:00:00.000Z',
                to: '2026-03-08T00:00:00.000Z',
                runType: 'quality_refiner'
            },
            queue: {
                backlog: 2,
                queued: 1,
                planning: 0,
                waitingApproval: 1,
                running: 0
            },
            outcomes: {
                succeeded: 3,
                failed: 1,
                cancelled: 0,
                completionRate: 0.75
            },
            latencyMs: {
                queueToStartAvg: 1000,
                queueToStartSamples: 2,
                completionAvg: 2000,
                completionSamples: 2
            },
            throughput: {
                createdRuns: 4,
                startedRuns: 2,
                completedRuns: 4,
                reviewActionsPlanned: 0,
                reviewActionsSucceeded: 0,
                qualityChecksPlanned: 5,
                qualityChecksSucceeded: 4
            },
            failureClasses: {
                policyDenied: 0,
                reviewExecutionFailed: 0,
                qualityValidationFailed: 1,
                settledFailed: 1
            }
        });

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/agent-runs/metrics?windowHours=48&runType=quality_refiner'
            });

            expect(response.statusCode).toBe(200);
            expect(metricsSpy).toHaveBeenCalledWith(1, {
                windowHours: 48,
                runType: 'quality_refiner'
            });
        } finally {
            metricsSpy.mockRestore();
            await app.close();
        }
    });

    it('returns agent-run worker status for the operational status route', async () => {
        process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = 'true';
        const app = await buildServer();
        const statusSpy = vi.spyOn(agentRunWorker, 'getStatus').mockReturnValue({
            started: true,
            sweepInProgress: false,
            intervalMs: 1000,
            maxRunsPerSweep: 25,
            lastSweepStartedAt: '2026-03-08T09:00:00.000Z',
            lastSweepCompletedAt: '2026-03-08T09:00:01.000Z',
            lastSweepProcessedRuns: 3,
            totalSweeps: 12,
            totalProcessedRuns: 20,
            lastError: null
        });

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/agent-runs/worker-status'
            });

            expect(response.statusCode).toBe(200);
            expect(statusSpy).toHaveBeenCalledTimes(1);
        } finally {
            statusSpy.mockRestore();
            await app.close();
        }
    });

    it('returns AGENT_RUN_DEFINITION_EMPTY_UPDATE for empty run-definition update payload', async () => {
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'PUT',
                url: '/api/agent-run-definitions/1',
                payload: {}
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('AGENT_RUN_DEFINITION_EMPTY_UPDATE');
        } finally {
            await app.close();
        }
    });

    it('returns content-type stats when includeStats is requested', async () => {
        const app = await buildServer();

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ total: 2 }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                            offset: vi.fn().mockResolvedValue([
                                {
                                    id: 11,
                                    name: 'Article',
                                    slug: 'article',
                                    kind: 'collection',
                                    description: 'Long-form editorial content',
                                    schema: '{"type":"object"}',
                                    basePrice: 0,
                                    createdAt: '2026-03-01T10:00:00.000Z',
                                    updatedAt: '2026-03-06T08:00:00.000Z'
                                },
                                {
                                    id: 12,
                                    name: 'Changelog',
                                    slug: 'changelog',
                                    kind: 'collection',
                                    description: null,
                                    schema: '{"type":"object"}',
                                    basePrice: 100,
                                    createdAt: '2026-03-02T10:00:00.000Z',
                                    updatedAt: '2026-03-04T09:30:00.000Z'
                                }
                            ]),
                        }),
                    }),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockReturnValue({
                        groupBy: vi.fn().mockResolvedValue([
                            {
                                contentTypeId: 11,
                                status: 'draft',
                                itemCount: 2,
                                lastItemUpdatedAt: '2026-03-05T10:00:00.000Z'
                            },
                            {
                                contentTypeId: 11,
                                status: 'published',
                                itemCount: 3,
                                lastItemUpdatedAt: '2026-03-06T08:00:00.000Z'
                            }
                        ]),
                    }),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 1,
                        name: 'Default',
                        hostname: 'default.local'
                    }]),
                }),
            }));

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/content-types?limit=25&offset=5&includeStats=true'
            });

            expect(response.statusCode).toBe(200);

            const body = response.json() as {
                data: Array<{
                    id: number;
                    stats?: {
                        itemCount: number;
                        lastItemUpdatedAt: string | null;
                        statusCounts: Record<string, number>;
                    };
                }>;
                meta: {
                    domain: {
                        id: number;
                        name: string;
                        hostname: string;
                    } | null;
                };
            };

            expect(body.data).toEqual([
                expect.objectContaining({
                    id: 11,
                    stats: {
                        itemCount: 5,
                        lastItemUpdatedAt: '2026-03-06T08:00:00.000Z',
                        statusCounts: {
                            draft: 2,
                            published: 3
                        }
                    }
                }),
                expect.objectContaining({
                    id: 12,
                    stats: {
                        itemCount: 0,
                        lastItemUpdatedAt: null,
                        statusCounts: {}
                    }
                })
            ]);
            expect(body.meta.domain).toEqual({
                id: 1,
                name: 'Default',
                hostname: 'default.local'
            });
        } finally {
            await app.close();
        }
    });

    it('returns canonical actor fields for audit log entries', async () => {
        const app = await buildServer();
        const countWhereMock = vi.fn().mockResolvedValue([{ total: 1 }]);
        const limitMock = vi.fn().mockResolvedValue([
            {
                id: 91,
                action: 'update',
                entityType: 'content_item',
                entityId: 44,
                actorId: 'supervisor:7',
                actorType: 'supervisor',
                actorSource: 'cookie',
                details: '{"requestId":"req-1"}',
                createdAt: new Date('2026-03-08T09:36:03.000Z')
            }
        ]);

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: countWhereMock,
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: limitMock,
                        }),
                    }),
                }),
            }));

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/audit-logs?limit=10&actorId=supervisor%3A7&actorType=supervisor'
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: Array<{
                    actorId?: string;
                    actorType?: string;
                    actorSource?: string;
                }>;
            };

            expect(body.data[0]).toMatchObject({
                actorId: 'supervisor:7',
                actorType: 'supervisor',
                actorSource: 'cookie'
            });
        } finally {
            await app.close();
        }
    });

    it('returns canonical actor fields for payment activity', async () => {
        const app = await buildServer();
        const countWhereMock = vi.fn().mockResolvedValue([{ total: 1 }]);
        const offsetMock = vi.fn().mockResolvedValue([
            {
                id: 14,
                paymentHash: 'hash-14',
                amountSatoshis: 210,
                status: 'paid',
                resourcePath: '/api/content-items/7',
                actorId: 'supervisor:3',
                actorType: 'supervisor',
                actorSource: 'cookie',
                details: { provider: 'mock' },
                createdAt: '2026-03-12T10:00:00.000Z'
            }
        ]);

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: countWhereMock,
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockReturnValue({
                                offset: offsetMock,
                            }),
                        }),
                    }),
                }),
            }));

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/payments?limit=10',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: Array<{
                    actorId?: string;
                    actorType?: string;
                    actorSource?: string;
                }>;
            };

            expect(body.data[0]).toMatchObject({
                actorId: 'supervisor:3',
                actorType: 'supervisor',
                actorSource: 'cookie'
            });
        } finally {
            await app.close();
        }
    });

    it('returns AUTH_MISSING_API_KEY when auth is required', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'writer=content:read|content:write|audit:read';
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/content-types'
            });

            expect(response.statusCode).toBe(401);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('AUTH_MISSING_API_KEY');
        } finally {
            await app.close();
        }
    });

    it('returns AUTH_INSUFFICIENT_SCOPE when write scope is missing', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'reader=content:read|audit:read';
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-types',
                headers: {
                    'x-api-key': 'reader'
                },
                payload: {
                    name: 'Type',
                    slug: 'type',
                    schema: '{"type":"object"}'
                }
            });

            expect(response.statusCode).toBe(403);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('MISSING_CONTENT_WRITE_SCOPE');
        } finally {
            await app.close();
        }
    });

    it('returns CONTENT_TYPE_NOT_FOUND when workflow target content type is outside current domain', async () => {
        const app = await buildServer();
        const createWorkflowSpy = vi.spyOn(WorkflowService, 'createWorkflow')
            .mockRejectedValue(new Error('CONTENT_TYPE_NOT_FOUND'));

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/workflows',
                payload: {
                    name: 'Cross Domain Workflow',
                    contentTypeId: 99999,
                    active: true
                }
            });

            expect(response.statusCode).toBe(404);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('CONTENT_TYPE_NOT_FOUND');
        } finally {
            createWorkflowSpy.mockRestore();
            await app.close();
        }
    });

    it('returns WORKFLOW_NOT_FOUND when transition target workflow is outside current domain', async () => {
        const app = await buildServer();
        const createTransitionSpy = vi.spyOn(WorkflowService, 'createWorkflowTransition')
            .mockRejectedValue(new Error('WORKFLOW_NOT_FOUND'));

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/workflows/99999/transitions',
                payload: {
                    fromState: 'draft',
                    toState: 'published',
                    requiredRoles: ['admin']
                }
            });

            expect(response.statusCode).toBe(404);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('WORKFLOW_NOT_FOUND');
        } finally {
            createTransitionSpy.mockRestore();
            await app.close();
        }
    });

    it('returns INVALID_CONTENT_DATA_JSON for content-item create with invalid JSON data', async () => {
        const app = await buildServer();

        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    id: 1,
                    schema: '{"type":"object"}',
                    basePrice: 0
                }]),
            }),
        }));

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-items',
                payload: {
                    contentTypeId: 1,
                    data: '{bad-json',
                    status: 'draft'
                }
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('INVALID_CONTENT_DATA_JSON');
            expect(mocks.dbMock.insert).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('returns CONTENT_SCHEMA_VALIDATION_FAILED for schema mismatch on content-item create', async () => {
        const app = await buildServer();

        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    id: 1,
                    schema: '{"type":"object","required":["title"],"properties":{"title":{"type":"string"}}}',
                    basePrice: 0
                }]),
            }),
        }));

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-items',
                payload: {
                    contentTypeId: 1,
                    data: '{"title":123}',
                    status: 'draft'
                }
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('CONTENT_SCHEMA_VALIDATION_FAILED');
            expect(mocks.dbMock.insert).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('returns CONTENT_ASSET_REFERENCE_INVALID when content-item create references missing assets', async () => {
        const app = await buildServer();

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 1,
                        schema: JSON.stringify({
                            type: 'object',
                            properties: {
                                heroImage: {
                                    type: 'object',
                                    'x-wordclaw-field-kind': 'asset',
                                    properties: {
                                        assetId: { type: 'integer' }
                                    },
                                    required: ['assetId']
                                }
                            }
                        }),
                        basePrice: 0
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 1,
                        schema: JSON.stringify({
                            type: 'object',
                            properties: {
                                heroImage: {
                                    type: 'object',
                                    'x-wordclaw-field-kind': 'asset',
                                    properties: {
                                        assetId: { type: 'integer' }
                                    },
                                    required: ['assetId']
                                }
                            }
                        }),
                        basePrice: 0
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([]),
                }),
            }));

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-items',
                payload: {
                    contentTypeId: 1,
                    data: {
                        heroImage: {
                            assetId: 999
                        }
                    },
                    status: 'draft'
                }
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('CONTENT_ASSET_REFERENCE_INVALID');
        } finally {
            await app.close();
        }
    });

    it('issues public write tokens for policy-enabled content types', async () => {
        const app = await buildServer();

        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    id: 7,
                    schema: JSON.stringify({
                        type: 'object',
                        properties: {
                            sessionId: { type: 'string' },
                            body: { type: 'string' }
                        },
                        required: ['sessionId', 'body'],
                        'x-wordclaw-public-write': {
                            enabled: true,
                            subjectField: 'sessionId',
                            allowedOperations: ['create', 'update'],
                            requiredStatus: 'draft'
                        }
                    })
                }]),
            }),
        }));

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-types/7/public-write-tokens',
                payload: {
                    subject: 'session-123',
                    operations: ['create', 'update'],
                    ttlSeconds: 300
                }
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: {
                    token: string;
                    contentTypeId: number;
                    subjectField: string;
                    subject: string;
                    allowedOperations: string[];
                    requiredStatus: string;
                    ttlSeconds: number;
                };
            };

            expect(body.data).toMatchObject({
                contentTypeId: 7,
                subjectField: 'sessionId',
                subject: 'session-123',
                allowedOperations: ['create', 'update'],
                requiredStatus: 'draft',
                ttlSeconds: 300
            });
            expect(body.data.token).toEqual(expect.any(String));
        } finally {
            await app.close();
        }
    });

    it('creates session-bound content through the public write lane without API auth', async () => {
        process.env.AUTH_REQUIRED = 'true';
        delete process.env.ALLOW_INSECURE_LOCAL_ADMIN;
        process.env.PUBLIC_WRITE_SECRET = 'public-write-secret';
        const app = await buildServer();
        const insertReturningMock = vi.fn().mockResolvedValue([{
            id: 44,
            contentTypeId: 7,
            version: 1,
            status: 'draft'
        }]);

        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    id: 7,
                    domainId: 1,
                    schema: JSON.stringify({
                        type: 'object',
                        properties: {
                            sessionId: { type: 'string' },
                            body: { type: 'string' }
                        },
                        required: ['sessionId', 'body'],
                        'x-wordclaw-public-write': {
                            enabled: true,
                            subjectField: 'sessionId',
                            allowedOperations: ['create', 'update'],
                            requiredStatus: 'draft'
                        }
                    })
                }]),
            }),
        }));
        mocks.dbMock.insert.mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: insertReturningMock
            })
        });

        const issued = issuePublicWriteToken({
            domainId: 1,
            contentTypeId: 7,
            subjectField: 'sessionId',
            subject: 'session-123',
            allowedOperations: ['create', 'update'],
            requiredStatus: 'draft'
        });

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/public/content-types/7/items',
                headers: {
                    'x-public-write-token': issued.token
                },
                payload: {
                    data: {
                        sessionId: 'session-123',
                        body: 'checkpoint'
                    }
                }
            });

            expect(response.statusCode).toBe(201);
            expect(response.json()).toMatchObject({
                data: {
                    id: 44,
                    contentTypeId: 7,
                    version: 1,
                    status: 'draft'
                }
            });
            expect(mocks.logAuditMock).toHaveBeenCalledWith(
                1,
                'create',
                'content_item',
                44,
                expect.objectContaining({
                    publicWrite: true,
                    subjectField: 'sessionId',
                    subject: 'session-123'
                }),
                expect.objectContaining({
                    actorId: 'public_write:7:session-123'
                }),
                expect.any(String)
            );
        } finally {
            await app.close();
        }
    });

    it('updates only the token-bound item through the public write lane', async () => {
        process.env.AUTH_REQUIRED = 'true';
        delete process.env.ALLOW_INSECURE_LOCAL_ADMIN;
        process.env.PUBLIC_WRITE_SECRET = 'public-write-secret';
        const app = await buildServer();

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 91,
                        domainId: 1,
                        contentTypeId: 7,
                        data: JSON.stringify({
                            sessionId: 'session-123',
                            body: 'before'
                        }),
                        status: 'draft',
                        version: 2,
                        updatedAt: new Date('2026-03-16T12:00:00.000Z')
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 7,
                        domainId: 1,
                        schema: JSON.stringify({
                            type: 'object',
                            properties: {
                                sessionId: { type: 'string' },
                                body: { type: 'string' }
                            },
                            required: ['sessionId', 'body'],
                            'x-wordclaw-public-write': {
                                enabled: true,
                                subjectField: 'sessionId',
                                allowedOperations: ['create', 'update'],
                                requiredStatus: 'draft'
                            }
                        })
                    }]),
                }),
            }));

        mocks.dbMock.transaction.mockImplementation(async (callback: (tx: typeof mocks.dbMock) => Promise<unknown>) => {
            const tx = {
                insert: vi.fn().mockReturnValue({
                    values: vi.fn().mockResolvedValue(undefined)
                }),
                update: vi.fn().mockReturnValue({
                    set: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            returning: vi.fn().mockResolvedValue([{
                                id: 91,
                                contentTypeId: 7,
                                version: 3,
                                status: 'draft'
                            }])
                        })
                    })
                })
            } as unknown as typeof mocks.dbMock;

            return callback(tx);
        });

        const issued = issuePublicWriteToken({
            domainId: 1,
            contentTypeId: 7,
            subjectField: 'sessionId',
            subject: 'session-123',
            allowedOperations: ['update'],
            requiredStatus: 'draft'
        });

        try {
            const response = await app.inject({
                method: 'PUT',
                url: '/api/public/content-items/91',
                headers: {
                    authorization: `Bearer ${issued.token}`
                },
                payload: {
                    data: {
                        sessionId: 'session-123',
                        body: 'after'
                    }
                }
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toMatchObject({
                data: {
                    id: 91,
                    contentTypeId: 7,
                    version: 3,
                    status: 'draft'
                }
            });
            expect(mocks.logAuditMock).toHaveBeenCalledWith(
                1,
                'update',
                'content_item',
                91,
                expect.objectContaining({
                    publicWrite: true,
                    subjectField: 'sessionId',
                    subject: 'session-123'
                }),
                expect.objectContaining({
                    actorId: 'public_write:7:session-123'
                }),
                expect.any(String)
            );
        } finally {
            await app.close();
        }
    });

    it('locks the public write lane once lifecycle-managed content auto-archives', async () => {
        process.env.AUTH_REQUIRED = 'true';
        delete process.env.ALLOW_INSECURE_LOCAL_ADMIN;
        process.env.PUBLIC_WRITE_SECRET = 'public-write-secret';
        const app = await buildServer();

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 91,
                        domainId: 1,
                        contentTypeId: 7,
                        data: JSON.stringify({
                            sessionId: 'session-123',
                            body: 'before'
                        }),
                        status: 'draft',
                        version: 2,
                        createdAt: new Date('2026-03-16T11:00:00.000Z'),
                        updatedAt: new Date('2026-03-16T11:00:00.000Z')
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 7,
                        domainId: 1,
                        schema: JSON.stringify({
                            type: 'object',
                            properties: {
                                sessionId: { type: 'string' },
                                body: { type: 'string' }
                            },
                            required: ['sessionId', 'body'],
                            'x-wordclaw-public-write': {
                                enabled: true,
                                subjectField: 'sessionId',
                                allowedOperations: ['create', 'update'],
                                requiredStatus: 'draft'
                            },
                            'x-wordclaw-lifecycle': {
                                ttlSeconds: 60
                            }
                        })
                    }]),
                }),
            }));

        mocks.dbMock.transaction.mockImplementation(async (callback: (tx: typeof mocks.dbMock) => Promise<unknown>) => {
            const tx = {
                insert: vi.fn().mockReturnValue({
                    values: vi.fn().mockResolvedValue(undefined)
                }),
                update: vi.fn().mockReturnValue({
                    set: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            returning: vi.fn().mockResolvedValue([{
                                id: 91,
                                domainId: 1,
                                contentTypeId: 7,
                                data: JSON.stringify({
                                    sessionId: 'session-123',
                                    body: 'before'
                                }),
                                status: 'archived',
                                version: 3,
                                createdAt: new Date('2026-03-16T11:00:00.000Z'),
                                updatedAt: new Date('2026-03-16T12:00:00.000Z')
                            }])
                        })
                    })
                })
            } as unknown as typeof mocks.dbMock;

            return callback(tx);
        });

        const issued = issuePublicWriteToken({
            domainId: 1,
            contentTypeId: 7,
            subjectField: 'sessionId',
            subject: 'session-123',
            allowedOperations: ['update'],
            requiredStatus: 'draft'
        });

        try {
            const response = await app.inject({
                method: 'PUT',
                url: '/api/public/content-items/91',
                headers: {
                    authorization: `Bearer ${issued.token}`
                },
                payload: {
                    data: {
                        sessionId: 'session-123',
                        body: 'after'
                    }
                }
            });

            expect(response.statusCode).toBe(409);
            expect(response.json()).toMatchObject({
                code: 'PUBLIC_WRITE_STATUS_LOCKED'
            });
            expect(mocks.dbMock.transaction).toHaveBeenCalledTimes(1);
        } finally {
            await app.close();
        }
    });

    it('creates form definitions over REST', async () => {
        const app = await buildServer();
        const createFormSpy = vi.spyOn(formsService, 'createFormDefinition').mockResolvedValue({
            id: 5,
            domainId: 1,
            name: 'Contact Form',
            slug: 'contact',
            description: 'Inbound contact form',
            contentTypeId: 12,
            contentTypeName: 'Lead',
            contentTypeSlug: 'lead',
            active: true,
            publicRead: true,
            submissionStatus: 'draft',
            workflowTransitionId: null,
            requirePayment: false,
            successMessage: 'Thanks',
            draftGeneration: {
                targetContentTypeId: 13,
                targetContentTypeName: 'Lead Draft',
                targetContentTypeSlug: 'lead-draft',
                workforceAgentId: null,
                workforceAgentSlug: null,
                workforceAgentName: null,
                workforceAgentPurpose: null,
                agentSoul: 'lead-draft-writer',
                fieldMap: {
                    email: 'contactEmail',
                    message: 'contactMessage',
                },
                defaultData: {},
                provider: {
                    type: 'openai',
                    model: 'gpt-4o',
                    instructions: 'Draft an inbound lead summary.',
                },
                postGenerationWorkflowTransitionId: null,
            },
            fields: [
                { name: 'email', type: 'text', required: true, label: 'Email' },
                { name: 'message', type: 'text', required: false, label: 'Message' },
                { name: 'attachments', type: 'asset-list', required: false, label: 'Attachments' },
            ],
            defaultData: {},
            createdAt: new Date('2026-03-29T10:00:00.000Z'),
            updatedAt: new Date('2026-03-29T10:00:00.000Z')
        });

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/forms',
                payload: {
                    name: 'Contact Form',
                    slug: 'contact',
                    description: 'Inbound contact form',
                    contentTypeId: 12,
                    fields: [
                        { name: 'email', label: 'Email' },
                        { name: 'message', label: 'Message' },
                        { name: 'attachments', label: 'Attachments', type: 'asset-list' },
                    ],
                    successMessage: 'Thanks',
                    draftGeneration: {
                        targetContentTypeId: 13,
                        workforceAgentId: null,
                        agentSoul: 'lead-draft-writer',
                        fieldMap: {
                            email: 'contactEmail',
                            message: 'contactMessage',
                        },
                        provider: {
                            type: 'openai',
                            model: 'gpt-4o',
                            instructions: 'Draft an inbound lead summary.',
                        },
                    }
                }
            });

            expect(createFormSpy).toHaveBeenCalledWith(expect.objectContaining({
                domainId: 1,
                slug: 'contact',
                draftGeneration: expect.objectContaining({
                    targetContentTypeId: 13,
                    agentSoul: 'lead-draft-writer',
                }),
            }));
            expect(response.statusCode).toBe(201);
            expect(response.json()).toMatchObject({
                data: {
                    id: 5,
                    slug: 'contact',
                    contentTypeId: 12,
                    contentTypeSlug: 'lead',
                    successMessage: 'Thanks',
                    draftGeneration: {
                        targetContentTypeId: 13,
                        targetContentTypeSlug: 'lead-draft',
                        workforceAgentId: null,
                        workforceAgentSlug: null,
                        workforceAgentName: null,
                        workforceAgentPurpose: null,
                        agentSoul: 'lead-draft-writer',
                        fieldMap: {
                            email: 'contactEmail',
                            message: 'contactMessage',
                        },
                        provider: {
                            type: 'openai',
                            model: 'gpt-4o',
                            instructions: 'Draft an inbound lead summary.',
                        },
                    },
                    fields: expect.arrayContaining([
                        expect.objectContaining({ name: 'email', required: true }),
                        expect.objectContaining({ name: 'message', required: false }),
                        expect.objectContaining({ name: 'attachments', type: 'asset-list', required: false }),
                    ])
                }
            });
            expect(mocks.logAuditMock).toHaveBeenCalledWith(
                1,
                'create',
                'form_definition',
                5,
                expect.objectContaining({
                    slug: 'contact',
                    contentTypeId: 12,
                }),
                expect.anything(),
                expect.any(String)
            );
        } finally {
            createFormSpy.mockRestore();
            await app.close();
        }
    });

    it('accepts unauthenticated public form submissions when domainId is provided', async () => {
        process.env.AUTH_REQUIRED = 'true';
        delete process.env.ALLOW_INSECURE_LOCAL_ADMIN;
        const app = await buildServer();

        const formRow = {
            id: 5,
            domainId: 1,
            name: 'Contact Form',
            slug: 'contact',
            description: 'Inbound contact form',
            contentTypeId: 12,
            fields: [
                { name: 'email', type: 'text', required: true, label: 'Email' },
                { name: 'message', type: 'text', required: false, label: 'Message' }
            ],
            defaultData: {},
            active: true,
            publicRead: true,
            submissionStatus: 'draft',
            workflowTransitionId: null,
            requirePayment: false,
            webhookUrl: null,
            webhookSecret: null,
            successMessage: 'Thanks',
            createdAt: new Date('2026-03-29T10:00:00.000Z'),
            updatedAt: new Date('2026-03-29T10:00:00.000Z')
        };
        const contentTypeRow = {
            id: 12,
            domainId: 1,
            name: 'Lead',
            slug: 'lead',
            basePrice: 0,
            schema: JSON.stringify({
                type: 'object',
                properties: {
                    email: { type: 'string' },
                    message: { type: 'string' }
                },
                required: ['email']
            })
        };

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([formRow]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([contentTypeRow]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([formRow]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([contentTypeRow]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([contentTypeRow]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ webhookUrl: null, webhookSecret: null }]),
                }),
            }));

        mocks.dbMock.insert.mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{
                    id: 88,
                    domainId: 1,
                    contentTypeId: 12,
                    data: JSON.stringify({
                        email: 'reader@example.com',
                        message: 'Hello'
                    }),
                    status: 'draft',
                    version: 1,
                    createdAt: new Date('2026-03-29T10:01:00.000Z'),
                    updatedAt: new Date('2026-03-29T10:01:00.000Z')
                }])
            })
        });

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/public/forms/contact/submissions?domainId=1',
                payload: {
                    data: {
                        email: 'reader@example.com',
                        message: 'Hello'
                    }
                }
            });

            expect(response.statusCode).toBe(201);
            expect(response.json()).toMatchObject({
                data: {
                    form: {
                        slug: 'contact',
                        requirePayment: false,
                    },
                    submission: {
                        contentItemId: 88,
                        status: 'draft',
                        reviewTaskId: null,
                        successMessage: 'Thanks',
                    }
                }
            });
        } finally {
            await app.close();
        }
    });

    it('returns draft generation tracking metadata for configured form submissions', async () => {
        process.env.AUTH_REQUIRED = 'true';
        delete process.env.ALLOW_INSECURE_LOCAL_ADMIN;

        const form = {
            id: 5,
            domainId: 1,
            name: 'Proposal Request',
            slug: 'proposal-request',
            description: 'Inbound proposal request form',
            contentTypeId: 12,
            contentTypeName: 'Proposal Request',
            contentTypeSlug: 'proposal-request',
            active: true,
            publicRead: true,
            submissionStatus: 'draft',
            workflowTransitionId: null,
            requirePayment: false,
            successMessage: 'Thanks',
            draftGeneration: {
                targetContentTypeId: 13,
                targetContentTypeName: 'Proposal Draft',
                targetContentTypeSlug: 'proposal-draft',
                workforceAgentId: null,
                workforceAgentSlug: null,
                workforceAgentName: null,
                workforceAgentPurpose: null,
                agentSoul: 'software-proposal-writer',
                fieldMap: {
                    company: 'clientName',
                },
                defaultData: {},
                provider: {
                    type: 'deterministic' as const,
                },
                postGenerationWorkflowTransitionId: null,
            },
            fields: [
                { name: 'company', type: 'text' as const, required: true, label: 'Company' },
            ],
            defaultData: {},
            createdAt: new Date('2026-03-31T10:00:00.000Z'),
            updatedAt: new Date('2026-03-31T10:00:00.000Z'),
        };

        const getFormSpy = vi.spyOn(formsService, 'getFormDefinitionBySlug').mockResolvedValue(form);
        const submitSpy = vi.spyOn(formsService, 'submitFormDefinition').mockResolvedValue({
            form,
            item: {
                id: 88,
                domainId: 1,
                contentTypeId: 12,
                data: JSON.stringify({ company: 'Acme' }),
                status: 'draft',
                embeddingStatus: 'disabled',
                embeddingChunks: 0,
                embeddingUpdatedAt: null,
                embeddingErrorCode: null,
                version: 1,
                createdAt: new Date('2026-03-31T10:01:00.000Z'),
                updatedAt: new Date('2026-03-31T10:01:00.000Z'),
            },
            reviewTaskId: null,
            draftGenerationJob: {
                id: 21,
                domainId: 1,
                kind: 'draft_generation',
                queue: 'drafts',
                status: 'queued',
                payload: {},
                result: null,
                runAt: new Date('2026-03-31T10:01:00.000Z'),
                attempts: 0,
                maxAttempts: 3,
                lastError: null,
                claimedAt: null,
                startedAt: null,
                completedAt: null,
                createdAt: new Date('2026-03-31T10:01:00.000Z'),
                updatedAt: new Date('2026-03-31T10:01:00.000Z'),
            },
        });

        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/public/forms/proposal-request/submissions?domainId=1',
                payload: {
                    data: {
                        company: 'Acme',
                    },
                },
            });

            expect(response.statusCode).toBe(201);
            expect(response.json()).toMatchObject({
                data: {
                    submission: {
                        contentItemId: 88,
                        reviewTaskId: null,
                        draftGenerationJobId: 21,
                        successMessage: 'Thanks',
                    },
                },
                meta: expect.objectContaining({
                    availableActions: ['GET /api/jobs/21'],
                }),
            });
        } finally {
            getFormSpy.mockRestore();
            submitSpy.mockRestore();
            await app.close();
        }
    });

    it('schedules content status changes through the background jobs route', async () => {
        const app = await buildServer();

        mocks.dbMock.select.mockImplementationOnce(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{ id: 44 }]),
            }),
        }));
        mocks.dbMock.insert.mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{
                    id: 9,
                    domainId: 1,
                    kind: 'content_status_transition',
                    queue: 'content',
                    status: 'queued',
                    payload: {
                        contentItemId: 44,
                        targetStatus: 'published'
                    },
                    result: null,
                    runAt: new Date('2026-04-01T09:00:00.000Z'),
                    attempts: 0,
                    maxAttempts: 3,
                    lastError: null,
                    claimedAt: null,
                    startedAt: null,
                    completedAt: null,
                    createdAt: new Date('2026-03-29T10:05:00.000Z'),
                    updatedAt: new Date('2026-03-29T10:05:00.000Z')
                }])
            })
        });

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-items/44/schedule-status',
                payload: {
                    targetStatus: 'published',
                    runAt: '2026-04-01T09:00:00.000Z'
                }
            });

            expect(response.statusCode).toBe(201);
            expect(response.json()).toMatchObject({
                data: {
                    id: 9,
                    kind: 'content_status_transition',
                    status: 'queued',
                    payload: {
                        contentItemId: 44,
                        targetStatus: 'published'
                    }
                }
            });
            expect(mocks.logAuditMock).toHaveBeenCalledWith(
                1,
                'create',
                'job',
                9,
                expect.objectContaining({
                    source: 'schedule_content_status',
                    contentItemId: 44,
                    targetStatus: 'published',
                }),
                expect.anything(),
                expect.any(String)
            );
        } finally {
            await app.close();
        }
    });

    it('returns INVALID_CREATED_AFTER for malformed content-item filter date', async () => {
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/content-items?createdAfter=not-a-date'
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('INVALID_CREATED_AFTER');
        } finally {
            await app.close();
        }
    });

    it('returns CONTENT_LOCALE_REQUIRED when fallbackLocale is provided without locale', async () => {
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/content-items?fallbackLocale=en'
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('CONTENT_LOCALE_REQUIRED');
            expect(mocks.dbMock.select).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('returns CONTENT_ITEMS_FIELD_QUERY_REQUIRES_CONTENT_TYPE for field filters without contentTypeId', async () => {
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/content-items?fieldName=enabled&fieldValue=true'
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('CONTENT_ITEMS_FIELD_QUERY_REQUIRES_CONTENT_TYPE');
        } finally {
            await app.close();
        }
    });

    it('returns CONTENT_ITEMS_FIELD_FILTER_FIELD_UNKNOWN for unsupported schema field filters', async () => {
        const app = await buildServer();

        mocks.dbMock.select.mockImplementationOnce(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    schema: JSON.stringify({
                        type: 'object',
                        properties: {
                            enabled: { type: 'boolean' }
                        }
                    })
                }])
            })
        }));

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/content-items?contentTypeId=7&fieldName=missingField&fieldValue=true'
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('CONTENT_ITEMS_FIELD_FILTER_FIELD_UNKNOWN');
        } finally {
            await app.close();
        }
    });

    it('accepts content-item search and sort query params', async () => {
        const app = await buildServer();
        const countWhereMock = vi.fn().mockResolvedValue([{ total: 1 }]);
        const offsetMock = vi.fn().mockResolvedValue([
            {
                item: {
                    id: 11,
                    contentTypeId: 3,
                    data: '{"title":"Hello World","slug":"hello-world"}',
                    status: 'published',
                    version: 4,
                    createdAt: new Date('2026-03-05T10:00:00.000Z'),
                    updatedAt: new Date('2026-03-06T10:00:00.000Z')
                },
                schema: '{"type":"object"}',
                basePrice: 0
            }
        ]);
        const limitMock = vi.fn(() => ({ offset: offsetMock }));
        const orderByMock = vi.fn(() => ({ limit: limitMock }));
        const whereMock = vi.fn(() => ({ orderBy: orderByMock }));

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        schema: JSON.stringify({
                            type: 'object',
                            properties: {
                                title: { type: 'string' }
                            }
                        })
                    }])
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: countWhereMock
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    innerJoin: () => ({
                        where: whereMock
                    }),
                }),
            }));

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/content-items?contentTypeId=3&q=hello&sortBy=createdAt&sortDir=asc&limit=25&offset=5'
            });

            expect(response.statusCode).toBe(200);

            const body = response.json() as {
                data: Array<{ id: number; status: string; version: number }>;
                meta: { total: number; offset: number; limit: number; hasMore: boolean };
            };

            expect(body.data).toHaveLength(1);
            expect(body.data[0]).toMatchObject({
                id: 11,
                status: 'published',
                version: 4
            });
            expect(body.meta).toMatchObject({
                total: 1,
                offset: 5,
                limit: 25,
                hasMore: false
            });
            expect(countWhereMock).toHaveBeenCalledTimes(1);
            expect(whereMock).toHaveBeenCalledTimes(1);
            expect(orderByMock).toHaveBeenCalledTimes(1);
            expect(limitMock).toHaveBeenCalledWith(25);
            expect(offsetMock).toHaveBeenCalledWith(5);
        } finally {
            await app.close();
        }
    });

    it('returns localized content items when locale-aware reads are requested', async () => {
        delete process.env.OPENAI_API_KEY;
        const app = await buildServer();
        const countWhereMock = vi.fn().mockResolvedValue([{ total: 1 }]);
        const offsetMock = vi.fn().mockResolvedValue([
            {
                item: {
                    id: 15,
                    contentTypeId: 7,
                    data: JSON.stringify({
                        title: {
                            en: 'Hello world',
                            nl: 'Hallo wereld'
                        }
                    }),
                    status: 'published',
                    version: 2,
                    createdAt: new Date('2026-03-10T10:00:00.000Z'),
                    updatedAt: new Date('2026-03-11T10:00:00.000Z')
                },
                schema: JSON.stringify({
                    type: 'object',
                    properties: {
                        title: {
                            type: 'string',
                            'x-wordclaw-localized': true
                        }
                    },
                    required: ['title'],
                    'x-wordclaw-localization': {
                        supportedLocales: ['en', 'nl'],
                        defaultLocale: 'en'
                    }
                }),
                basePrice: 0
            }
        ]);
        const limitMock = vi.fn(() => ({ offset: offsetMock }));
        const orderByMock = vi.fn(() => ({ limit: limitMock }));
        const whereMock = vi.fn(() => ({ orderBy: orderByMock }));

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: countWhereMock
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    innerJoin: () => ({
                        where: whereMock
                    }),
                }),
            }));

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/content-items?locale=nl'
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: Array<{
                    data: string;
                    embeddingStatus: string;
                    embeddingChunks: number;
                    embeddingUpdatedAt: string | null;
                    embeddingErrorCode: string | null;
                    localeResolution?: {
                        requestedLocale: string;
                        fallbackLocale: string;
                        resolvedFieldCount: number;
                    };
                    embeddingReadiness: {
                        enabled: boolean;
                        state: string;
                        searchable: boolean;
                    };
                }>;
            };

            expect(body.data).toHaveLength(1);
            expect(JSON.parse(body.data[0].data)).toEqual({
                title: 'Hallo wereld'
            });
            expect(body.data[0].localeResolution).toMatchObject({
                requestedLocale: 'nl',
                fallbackLocale: 'en',
                resolvedFieldCount: 1
            });
            expect(body.data[0].embeddingReadiness).toEqual(expect.objectContaining({
                enabled: false,
                state: 'disabled',
                searchable: false,
            }));
            expect(body.data[0]).toMatchObject({
                embeddingStatus: 'disabled',
                embeddingChunks: 0,
                embeddingUpdatedAt: null,
                embeddingErrorCode: null,
            });
        } finally {
            await app.close();
        }
    });

    it('returns cursor pagination metadata for content items', async () => {
        const app = await buildServer();
        const countWhereMock = vi.fn().mockResolvedValue([{ total: 2 }]);
        const limitMock = vi.fn().mockResolvedValue([
            {
                item: {
                    id: 21,
                    contentTypeId: 7,
                    data: '{"title":"First"}',
                    status: 'published',
                    version: 2,
                    createdAt: new Date('2026-03-08T10:00:00.000Z'),
                    updatedAt: new Date('2026-03-08T10:30:00.000Z')
                },
                schema: '{"type":"object"}',
                basePrice: 0
            },
            {
                item: {
                    id: 20,
                    contentTypeId: 7,
                    data: '{"title":"Second"}',
                    status: 'draft',
                    version: 1,
                    createdAt: new Date('2026-03-08T09:00:00.000Z'),
                    updatedAt: new Date('2026-03-08T09:15:00.000Z')
                },
                schema: '{"type":"object"}',
                basePrice: 0
            }
        ]);
        const orderByMock = vi.fn(() => ({ limit: limitMock }));
        const whereMock = vi.fn(() => ({ orderBy: orderByMock }));

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        schema: JSON.stringify({
                            type: 'object',
                            properties: {
                                title: { type: 'string' }
                            }
                        })
                    }])
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: countWhereMock
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    innerJoin: () => ({
                        where: whereMock
                    }),
                }),
            }));

        const cursor = Buffer.from(JSON.stringify({
            createdAt: '2026-03-09T11:00:00.000Z',
            id: 99
        }), 'utf8').toString('base64url');

        try {
            const response = await app.inject({
                method: 'GET',
                url: `/api/content-items?contentTypeId=7&limit=1&cursor=${cursor}`
            });

            expect(response.statusCode).toBe(200);

            const body = response.json() as {
                data: Array<{ id: number }>;
                meta: { total: number; limit: number; hasMore: boolean; nextCursor: string | null; offset?: number };
            };

            expect(body.data).toHaveLength(1);
            expect(body.data[0]).toMatchObject({ id: 21 });
            expect(body.meta).toMatchObject({
                total: 2,
                limit: 1,
                hasMore: true,
                nextCursor: expect.any(String)
            });
            expect(body.meta.offset).toBeUndefined();
            expect(limitMock).toHaveBeenCalledWith(2);
        } finally {
            await app.close();
        }
    });

    it('returns INVALID_CONTENT_ITEMS_CURSOR for malformed content-item cursor', async () => {
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/content-items?cursor=not-a-cursor'
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('INVALID_CONTENT_ITEMS_CURSOR');
        } finally {
            await app.close();
        }
    });

    it('returns grouped content projections for leaderboard-style views', async () => {
        const app = await buildServer();
        const limitMock = vi.fn().mockResolvedValue([
            { group: 'chronomancer', value: 18.5, count: 2 },
            { group: 'ranger', value: 11.25, count: 4 }
        ]);
        const orderByMock = vi.fn(() => ({ limit: limitMock }));
        const groupByMock = vi.fn(() => ({ orderBy: orderByMock }));
        const whereMock = vi.fn(() => ({ groupBy: groupByMock }));

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        schema: JSON.stringify({
                            type: 'object',
                            properties: {
                                characterClass: { type: 'string' },
                                score: { type: 'integer' }
                            }
                        })
                    }])
                })
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: whereMock
                })
            }));

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/content-items/projections?contentTypeId=7&groupBy=characterClass&metric=avg&metricField=score&limit=10'
            });

            expect(response.statusCode).toBe(200);

            const body = response.json() as {
                data: Array<{ group: string; value: number; count: number }>;
                meta: Record<string, unknown>;
            };

            expect(body.data).toEqual([
                { group: 'chronomancer', value: 18.5, count: 2 },
                { group: 'ranger', value: 11.25, count: 4 }
            ]);
            expect(body.meta).toMatchObject({
                contentTypeId: 7,
                groupBy: 'characterClass',
                metric: 'avg',
                metricField: 'score',
                orderBy: 'value',
                orderDir: 'desc',
                limit: 10
            });
            expect(limitMock).toHaveBeenCalledWith(10);
        } finally {
            await app.close();
        }
    });

    it('returns CONTENT_ITEMS_PROJECTION_METRIC_FIELD_REQUIRED for numeric projection metrics without metricField', async () => {
        const app = await buildServer();

        mocks.dbMock.select.mockImplementationOnce(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    schema: JSON.stringify({
                        type: 'object',
                        properties: {
                            characterClass: { type: 'string' },
                            score: { type: 'integer' }
                        }
                    })
                }])
            })
        }));

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/content-items/projections?contentTypeId=7&groupBy=characterClass&metric=avg'
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('CONTENT_ITEMS_PROJECTION_METRIC_FIELD_REQUIRED');
        } finally {
            await app.close();
        }
    });

    it('returns CONTENT_ITEMS_CURSOR_OFFSET_CONFLICT when cursor and offset are both provided', async () => {
        const app = await buildServer();
        const cursor = Buffer.from(JSON.stringify({
            createdAt: '2026-03-09T11:00:00.000Z',
            id: 99
        }), 'utf8').toString('base64url');

        try {
            const response = await app.inject({
                method: 'GET',
                url: `/api/content-items?cursor=${cursor}&offset=0`
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('CONTENT_ITEMS_CURSOR_OFFSET_CONFLICT');
        } finally {
            await app.close();
        }
    });

    it('creates an asset through the REST upload route', async () => {
        const app = await buildServer();
        const createSpy = vi.spyOn(assetService, 'createAsset').mockResolvedValue({
            id: 18,
            domainId: 1,
            sourceAssetId: 12,
            variantKey: 'hero-webp',
            transformSpec: { width: 1200, format: 'webp' },
            filename: 'hero.png',
            originalFilename: 'hero.png',
            mimeType: 'image/png',
            sizeBytes: 128,
            byteHash: 'abc123',
            storageProvider: 'local',
            storageKey: '1/test-hero.png',
            accessMode: 'public',
            entitlementScopeType: null,
            entitlementScopeRef: null,
            status: 'active',
            metadata: { width: 1200 },
            uploaderActorId: 'anonymous',
            uploaderActorType: 'anonymous',
            uploaderActorSource: 'anonymous',
            createdAt: new Date('2026-03-13T10:00:00.000Z'),
            updatedAt: new Date('2026-03-13T10:00:00.000Z'),
            deletedAt: null
        });

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/assets',
                payload: {
                    filename: 'hero.png',
                    mimeType: 'image/png',
                    contentBase64: Buffer.from('png-bytes').toString('base64'),
                    accessMode: 'public',
                    metadata: { width: 1200 },
                    sourceAssetId: 12,
                    variantKey: 'hero-webp',
                    transformSpec: { width: 1200, format: 'webp' },
                }
            });

            expect(response.statusCode).toBe(201);
            const body = response.json() as {
                data: {
                    id: number;
                    delivery: {
                        contentPath: string;
                        requiresAuth: boolean;
                        requiresEntitlement: boolean;
                        offersPath: string | null;
                    };
                };
            };

            expect(body.data).toMatchObject({
                id: 18,
                delivery: {
                    contentPath: '/api/assets/18/content',
                    requiresAuth: false,
                    requiresEntitlement: false,
                    offersPath: null
                }
            });
            expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
                domainId: 1,
                filename: 'hero.png',
                mimeType: 'image/png',
                accessMode: 'public',
                sourceAssetId: 12,
                variantKey: 'hero-webp',
                transformSpec: { width: 1200, format: 'webp' },
            }));
        } finally {
            createSpy.mockRestore();
            await app.close();
        }
    });

    it('creates an asset through the REST multipart upload route', async () => {
        const app = await buildServer();
        const createSpy = vi.spyOn(assetService, 'createAsset').mockResolvedValue({
            id: 19,
            domainId: 1,
            sourceAssetId: null,
            variantKey: null,
            transformSpec: null,
            filename: 'hero.jpg',
            originalFilename: 'hero-original.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 256,
            byteHash: 'def456',
            storageProvider: 'local',
            storageKey: '1/test-hero.jpg',
            accessMode: 'signed',
            entitlementScopeType: null,
            entitlementScopeRef: null,
            status: 'active',
            metadata: { width: 1600, height: 900 },
            uploaderActorId: 'anonymous',
            uploaderActorType: 'anonymous',
            uploaderActorSource: 'anonymous',
            createdAt: new Date('2026-03-15T10:00:00.000Z'),
            updatedAt: new Date('2026-03-15T10:00:00.000Z'),
            deletedAt: null
        });

        const boundary = '----wordclaw-test-boundary';
        const payload = buildMultipartPayload(
            boundary,
            {
                accessMode: 'signed',
                metadata: JSON.stringify({ width: 1600, height: 900 }),
                originalFilename: 'hero-original.jpg',
                sourceAssetId: '18',
                variantKey: 'hero-jpeg-preview',
                transformSpec: JSON.stringify({ width: 1600, format: 'jpeg' }),
            },
            {
                fieldName: 'file',
                filename: 'hero.jpg',
                contentType: 'image/jpeg',
                content: Buffer.from('jpg-bytes')
            }
        );

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/assets',
                headers: {
                    'content-type': `multipart/form-data; boundary=${boundary}`
                },
                payload
            });

            expect(response.statusCode).toBe(201);
            expect(createSpy).toHaveBeenCalledTimes(1);
            expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
                domainId: 1,
                filename: 'hero.jpg',
                originalFilename: 'hero-original.jpg',
                mimeType: 'image/jpeg',
                accessMode: 'signed',
                metadata: { width: 1600, height: 900 },
                sourceAssetId: 18,
                variantKey: 'hero-jpeg-preview',
                transformSpec: { width: 1600, format: 'jpeg' },
                contentBytes: expect.any(Buffer)
            }));

            const createArgs = createSpy.mock.calls[0]?.[0];
            expect(createArgs?.contentBytes?.toString('utf8')).toBe('jpg-bytes');
        } finally {
            createSpy.mockRestore();
            await app.close();
        }
    });

    it('issues a direct asset upload session through REST', async () => {
        const app = await buildServer();
        const issueSpy = vi.spyOn(assetService, 'issueDirectAssetUpload').mockResolvedValue({
            provider: 's3',
            upload: {
                provider: 's3',
                storageKey: '1/direct-hero.png',
                method: 'PUT',
                uploadUrl: 'https://storage.example.com/wordclaw-assets/1/direct-hero.png?X-Amz-Signature=test',
                uploadHeaders: {
                    'content-type': 'image/png',
                },
                expiresAt: new Date('2026-03-16T12:05:00.000Z'),
                ttlSeconds: 300,
            },
            finalize: {
                path: '/api/assets/direct-upload/complete',
                token: 'direct-upload-token',
                expiresAt: new Date('2026-03-16T12:05:00.000Z'),
            },
        });

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/assets/direct-upload',
                payload: {
                    filename: 'hero.png',
                    mimeType: 'image/png',
                    accessMode: 'signed',
                    metadata: { alt: 'Hero' },
                    sourceAssetId: 18,
                    variantKey: 'hero-webp',
                    transformSpec: { width: 1200, format: 'webp' },
                }
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: {
                    provider: string;
                    upload: { method: string; uploadUrl: string; uploadHeaders: Record<string, string>; ttlSeconds: number };
                    finalize: { path: string; token: string };
                };
            };
            expect(body.data).toMatchObject({
                provider: 's3',
                upload: {
                    method: 'PUT',
                    uploadUrl: 'https://storage.example.com/wordclaw-assets/1/direct-hero.png?X-Amz-Signature=test',
                    uploadHeaders: {
                        'content-type': 'image/png',
                    },
                    ttlSeconds: 300,
                },
                finalize: {
                    path: '/api/assets/direct-upload/complete',
                    token: 'direct-upload-token',
                }
            });
            expect(issueSpy).toHaveBeenCalledWith(expect.objectContaining({
                domainId: 1,
                filename: 'hero.png',
                mimeType: 'image/png',
                accessMode: 'signed',
                metadata: { alt: 'Hero' },
                sourceAssetId: 18,
                variantKey: 'hero-webp',
                transformSpec: { width: 1200, format: 'webp' },
            }));
        } finally {
            issueSpy.mockRestore();
            await app.close();
        }
    });

    it('completes a direct asset upload through REST', async () => {
        const app = await buildServer();
        const completeSpy = vi.spyOn(assetService, 'completeDirectAssetUpload').mockResolvedValue({
            id: 20,
            domainId: 1,
            sourceAssetId: null,
            variantKey: null,
            transformSpec: null,
            filename: 'hero.png',
            originalFilename: 'hero.png',
            mimeType: 'image/png',
            sizeBytes: 512,
            byteHash: null,
            storageProvider: 's3',
            storageKey: '1/direct-hero.png',
            accessMode: 'signed',
            entitlementScopeType: null,
            entitlementScopeRef: null,
            status: 'active',
            metadata: { alt: 'Hero' },
            uploaderActorId: 'anonymous',
            uploaderActorType: 'anonymous',
            uploaderActorSource: 'anonymous',
            createdAt: new Date('2026-03-16T12:00:00.000Z'),
            updatedAt: new Date('2026-03-16T12:00:00.000Z'),
            deletedAt: null
        });

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/assets/direct-upload/complete',
                payload: {
                    token: 'direct-upload-token'
                }
            });

            expect(response.statusCode).toBe(201);
            const body = response.json() as {
                data: { id: number; storageProvider: string; delivery: { accessPath: string | null } };
            };
            expect(body.data).toMatchObject({
                id: 20,
                storageProvider: 's3',
                delivery: {
                    accessPath: '/api/assets/20/access',
                }
            });
            expect(completeSpy).toHaveBeenCalledWith('direct-upload-token', 1, expect.objectContaining({
                actorId: 'anonymous',
            }));
        } finally {
            completeSpy.mockRestore();
            await app.close();
        }
    });

    it('returns cursor pagination metadata for assets', async () => {
        const app = await buildServer();
        const listSpy = vi.spyOn(assetService, 'listAssets').mockResolvedValue({
            items: [{
                id: 32,
                domainId: 1,
                sourceAssetId: null,
                variantKey: null,
                transformSpec: null,
                filename: 'spec.pdf',
                originalFilename: 'spec.pdf',
                mimeType: 'application/pdf',
                sizeBytes: 2048,
                byteHash: 'hash-32',
                storageProvider: 'local',
                storageKey: '1/spec.pdf',
                accessMode: 'signed',
                entitlementScopeType: null,
                entitlementScopeRef: null,
                status: 'active',
                metadata: {},
                uploaderActorId: 'api_key:2',
                uploaderActorType: 'api_key',
                uploaderActorSource: 'db',
                createdAt: new Date('2026-03-13T12:00:00.000Z'),
                updatedAt: new Date('2026-03-13T12:00:00.000Z'),
                deletedAt: null
            }],
            total: 2,
            limit: 1,
            hasMore: true,
            nextCursor: 'next-assets-cursor'
        });

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/assets?limit=1&cursor=current-assets-cursor&accessMode=signed'
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: Array<{ id: number; delivery: { requiresAuth: boolean } }>;
                meta: { total: number; limit: number; hasMore: boolean; nextCursor: string };
            };

            expect(body.data).toHaveLength(1);
            expect(body.data[0]).toMatchObject({
                id: 32,
                delivery: {
                    requiresAuth: true,
                    requiresEntitlement: false
                }
            });
            expect(body.meta).toMatchObject({
                total: 2,
                limit: 1,
                hasMore: true,
                nextCursor: 'next-assets-cursor'
            });
            expect(listSpy).toHaveBeenCalledWith(1, {
                q: undefined,
                accessMode: 'signed',
                status: undefined,
                limit: 1,
                offset: undefined,
                cursor: 'current-assets-cursor'
            });
        } finally {
            listSpy.mockRestore();
            await app.close();
        }
    });

    it('lists derivative variants for a source asset', async () => {
        const app = await buildServer();
        const getAssetSpy = vi.spyOn(assetService, 'getAsset').mockResolvedValue({
            id: 18,
            domainId: 1,
            sourceAssetId: null,
            variantKey: null,
            transformSpec: null,
            filename: 'hero.png',
            originalFilename: 'hero.png',
            mimeType: 'image/png',
            sizeBytes: 256,
            byteHash: 'hash-18',
            storageProvider: 'local',
            storageKey: '1/hero.png',
            accessMode: 'public',
            entitlementScopeType: null,
            entitlementScopeRef: null,
            status: 'active',
            metadata: {},
            uploaderActorId: 'api_key:2',
            uploaderActorType: 'api_key',
            uploaderActorSource: 'db',
            createdAt: new Date('2026-03-16T12:00:00.000Z'),
            updatedAt: new Date('2026-03-16T12:00:00.000Z'),
            deletedAt: null,
        });
        const listDerivativeSpy = vi.spyOn(assetService, 'listAssetDerivatives').mockResolvedValue([
            {
                id: 19,
                domainId: 1,
                sourceAssetId: 18,
                variantKey: 'hero-webp',
                transformSpec: { width: 1200, format: 'webp' },
                filename: 'hero.webp',
                originalFilename: 'hero.webp',
                mimeType: 'image/webp',
                sizeBytes: 192,
                byteHash: 'hash-19',
                storageProvider: 'local',
                storageKey: '1/hero.webp',
                accessMode: 'public',
                entitlementScopeType: null,
                entitlementScopeRef: null,
                status: 'active',
                metadata: { purpose: 'preview' },
                uploaderActorId: 'api_key:2',
                uploaderActorType: 'api_key',
                uploaderActorSource: 'db',
                createdAt: new Date('2026-03-16T12:05:00.000Z'),
                updatedAt: new Date('2026-03-16T12:05:00.000Z'),
                deletedAt: null,
            },
        ]);

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/assets/18/derivatives',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: Array<{
                    id: number;
                    sourceAssetId: number | null;
                    variantKey: string | null;
                    transformSpec: Record<string, unknown> | null;
                    relationships: {
                        sourcePath: string | null;
                        derivativesPath: string;
                    };
                }>;
                meta: {
                    total: number;
                    sourceAssetId: number;
                    status: string;
                };
            };

            expect(body.data).toEqual([
                expect.objectContaining({
                    id: 19,
                    sourceAssetId: 18,
                    variantKey: 'hero-webp',
                    transformSpec: { width: 1200, format: 'webp' },
                    relationships: {
                        sourcePath: '/api/assets/18',
                        derivativesPath: '/api/assets/19/derivatives',
                    },
                }),
            ]);
            expect(body.meta).toMatchObject({
                total: 1,
                sourceAssetId: 18,
                status: 'active',
            });
            expect(listDerivativeSpy).toHaveBeenCalledWith(18, 1, {
                includeDeleted: false,
            });
        } finally {
            listDerivativeSpy.mockRestore();
            getAssetSpy.mockRestore();
            await app.close();
        }
    });

    it('serves public asset content without auth', async () => {
        process.env.AUTH_REQUIRED = 'true';
        const app = await buildServer();
        const publicSpy = vi.spyOn(assetService, 'getPublicAsset').mockResolvedValue({
            id: 44,
            domainId: 1,
            sourceAssetId: null,
            variantKey: null,
            transformSpec: null,
            filename: 'cover.jpg',
            originalFilename: 'cover.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 12,
            byteHash: 'hash-44',
            storageProvider: 'local',
            storageKey: '1/cover.jpg',
            accessMode: 'public',
            entitlementScopeType: null,
            entitlementScopeRef: null,
            status: 'active',
            metadata: {},
            uploaderActorId: null,
            uploaderActorType: null,
            uploaderActorSource: null,
            createdAt: new Date('2026-03-13T12:00:00.000Z'),
            updatedAt: new Date('2026-03-13T12:00:00.000Z'),
            deletedAt: null
        });
        const contentSpy = vi.spyOn(assetService, 'readAssetContent').mockResolvedValue(Buffer.from('hello world'));

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/assets/44/content'
            });

            expect(response.statusCode).toBe(200);
            expect(response.headers['content-type']).toContain('image/jpeg');
            expect(response.headers['x-wordclaw-access-mode']).toBe('public');
            expect(response.body).toBe('hello world');
        } finally {
            publicSpy.mockRestore();
            contentSpy.mockRestore();
            await app.close();
        }
    });

    it('lists offers for an entitled asset', async () => {
        const app = await buildServer();
        const getAssetSpy = vi.spyOn(assetService, 'getAsset').mockResolvedValue({
            id: 77,
            domainId: 1,
            sourceAssetId: null,
            variantKey: null,
            transformSpec: null,
            filename: 'premium.pdf',
            originalFilename: 'premium.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 512,
            byteHash: 'hash-77',
            storageProvider: 'local',
            storageKey: '1/premium.pdf',
            accessMode: 'entitled',
            entitlementScopeType: 'subscription',
            entitlementScopeRef: null,
            status: 'active',
            metadata: {},
            uploaderActorId: 'api_key:1',
            uploaderActorType: 'api_key',
            uploaderActorSource: 'db',
            createdAt: new Date('2026-03-13T12:00:00.000Z'),
            updatedAt: new Date('2026-03-13T12:00:00.000Z'),
            deletedAt: null
        });
        const offersSpy = vi.spyOn(LicensingService, 'getActiveOffersForReadScope').mockResolvedValue([
            {
                id: 9,
                domainId: 1,
                slug: 'premium-subscription',
                name: 'Premium Subscription',
                scopeType: 'subscription',
                scopeRef: null,
                priceSats: 250,
                active: true
            }
        ] as any);

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/assets/77/offers'
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as { data: Array<{ id: number; scopeType: string }> };
            expect(body.data).toEqual([
                expect.objectContaining({
                    id: 9,
                    scopeType: 'subscription'
                })
            ]);
            expect(offersSpy).toHaveBeenCalledWith(1, {
                scopeType: 'subscription',
                scopeRef: null
            });
        } finally {
            offersSpy.mockRestore();
            getAssetSpy.mockRestore();
            await app.close();
        }
    });

    it('issues signed asset access over the REST access route', async () => {
        const app = await buildServer();
        const getAssetSpy = vi.spyOn(assetService, 'getAsset').mockResolvedValue({
            id: 78,
            domainId: 1,
            sourceAssetId: null,
            variantKey: null,
            transformSpec: null,
            filename: 'private.pdf',
            originalFilename: 'private.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 2048,
            byteHash: 'hash-78',
            storageProvider: 'local',
            storageKey: '1/private.pdf',
            accessMode: 'signed',
            entitlementScopeType: null,
            entitlementScopeRef: null,
            status: 'active',
            metadata: {},
            uploaderActorId: 'api_key:1',
            uploaderActorType: 'api_key',
            uploaderActorSource: 'db',
            createdAt: new Date('2026-03-14T10:00:00.000Z'),
            updatedAt: new Date('2026-03-14T10:00:00.000Z'),
            deletedAt: null
        });

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/assets/78/access',
                payload: {
                    ttlSeconds: 120
                }
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: {
                    asset: { id: number; accessMode: string };
                    access: {
                        mode: string;
                        signedUrl: string | null;
                        token: string | null;
                        expiresAt: string | null;
                        ttlSeconds: number | null;
                    };
                };
            };
            expect(body.data.asset).toEqual(expect.objectContaining({
                id: 78,
                accessMode: 'signed'
            }));
            expect(body.data.access.mode).toBe('signed');
            expect(body.data.access.ttlSeconds).toBe(120);
            expect(body.data.access.token).toEqual(expect.any(String));
            expect(body.data.access.signedUrl).toContain('/api/assets/78/content?token=');
            expect(body.data.access.expiresAt).toEqual(expect.any(String));
        } finally {
            getAssetSpy.mockRestore();
            await app.close();
        }
    });

    it('returns ASSET_ACCESS_ISSUE_UNSUPPORTED when issuing access for an entitled asset', async () => {
        const app = await buildServer();
        const getAssetSpy = vi.spyOn(assetService, 'getAsset').mockResolvedValue({
            id: 79,
            domainId: 1,
            sourceAssetId: null,
            variantKey: null,
            transformSpec: null,
            filename: 'premium.pdf',
            originalFilename: 'premium.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 512,
            byteHash: 'hash-79',
            storageProvider: 'local',
            storageKey: '1/premium.pdf',
            accessMode: 'entitled',
            entitlementScopeType: 'subscription',
            entitlementScopeRef: null,
            status: 'active',
            metadata: {},
            uploaderActorId: 'api_key:1',
            uploaderActorType: 'api_key',
            uploaderActorSource: 'db',
            createdAt: new Date('2026-03-14T10:00:00.000Z'),
            updatedAt: new Date('2026-03-14T10:00:00.000Z'),
            deletedAt: null
        });

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/assets/79/access'
            });

            expect(response.statusCode).toBe(409);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('ASSET_ACCESS_ISSUE_UNSUPPORTED');
        } finally {
            getAssetSpy.mockRestore();
            await app.close();
        }
    });

    it('requires auth for signed asset content', async () => {
        process.env.AUTH_REQUIRED = 'true';
        const app = await buildServer();
        const publicSpy = vi.spyOn(assetService, 'getPublicAsset').mockResolvedValue(
            null as unknown as Awaited<ReturnType<typeof assetService.getPublicAsset>>
        );

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/assets/51/content'
            });

            expect(response.statusCode).toBe(401);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('AUTH_MISSING_API_KEY');
        } finally {
            publicSpy.mockRestore();
            await app.close();
        }
    });

    it('soft-deletes an asset through the REST delete route', async () => {
        const app = await buildServer();
        const deleteSpy = vi.spyOn(assetService, 'softDeleteAsset').mockResolvedValue({
            id: 61,
            domainId: 1,
            sourceAssetId: null,
            variantKey: null,
            transformSpec: null,
            filename: 'diagram.svg',
            originalFilename: 'diagram.svg',
            mimeType: 'image/svg+xml',
            sizeBytes: 512,
            byteHash: 'hash-61',
            storageProvider: 'local',
            storageKey: '1/diagram.svg',
            accessMode: 'signed',
            entitlementScopeType: null,
            entitlementScopeRef: null,
            status: 'deleted',
            metadata: {},
            uploaderActorId: 'api_key:9',
            uploaderActorType: 'api_key',
            uploaderActorSource: 'db',
            createdAt: new Date('2026-03-13T12:00:00.000Z'),
            updatedAt: new Date('2026-03-13T13:00:00.000Z'),
            deletedAt: new Date('2026-03-13T13:00:00.000Z')
        });

        try {
            const response = await app.inject({
                method: 'DELETE',
                url: '/api/assets/61'
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as { data: { status: string } };
            expect(body.data.status).toBe('deleted');
            expect(deleteSpy).toHaveBeenCalledWith(61, 1, expect.objectContaining({
                actorId: 'anonymous'
            }));
        } finally {
            deleteSpy.mockRestore();
            await app.close();
        }
    });

    it('returns asset reverse-reference usage over REST', async () => {
        const app = await buildServer();
        const getAssetSpy = vi.spyOn(assetService, 'getAsset').mockResolvedValue({
            id: 61,
            domainId: 1,
            sourceAssetId: null,
            variantKey: null,
            transformSpec: null,
            filename: 'diagram.svg',
            originalFilename: 'diagram.svg',
            mimeType: 'image/svg+xml',
            sizeBytes: 512,
            byteHash: 'hash-61',
            storageProvider: 'local',
            storageKey: '1/diagram.svg',
            accessMode: 'signed',
            entitlementScopeType: null,
            entitlementScopeRef: null,
            status: 'deleted',
            metadata: {},
            uploaderActorId: 'api_key:9',
            uploaderActorType: 'api_key',
            uploaderActorSource: 'db',
            createdAt: new Date('2026-03-13T12:00:00.000Z'),
            updatedAt: new Date('2026-03-13T13:00:00.000Z'),
            deletedAt: new Date('2026-03-13T13:00:00.000Z')
        });
        const usageSpy = vi.spyOn(referenceUsageService, 'findAssetUsage').mockResolvedValue({
            activeReferences: [],
            historicalReferences: [{
                contentItemId: 71,
                contentItemVersionId: 11,
                contentTypeId: 6,
                contentTypeName: 'Landing Page',
                contentTypeSlug: 'landing-page',
                path: '/hero',
                version: 3
            }]
        });

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/assets/61/used-by'
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: {
                    activeReferenceCount: number;
                    historicalReferenceCount: number;
                    historicalReferences: Array<{ contentItemId: number; path: string }>;
                };
            };
            expect(body.data.activeReferenceCount).toBe(0);
            expect(body.data.historicalReferenceCount).toBe(1);
            expect(body.data.historicalReferences[0]).toMatchObject({
                contentItemId: 71,
                path: '/hero'
            });
            expect(getAssetSpy).toHaveBeenCalledWith(61, 1, { includeDeleted: true });
            expect(usageSpy).toHaveBeenCalledWith(1, 61);
        } finally {
            getAssetSpy.mockRestore();
            usageSpy.mockRestore();
            await app.close();
        }
    });

    it('restores a soft-deleted asset through the REST restore route', async () => {
        const app = await buildServer();
        const restoreSpy = vi.spyOn(assetService, 'restoreAsset').mockResolvedValue({
            id: 62,
            domainId: 1,
            sourceAssetId: null,
            variantKey: null,
            transformSpec: null,
            filename: 'diagram.svg',
            originalFilename: 'diagram.svg',
            mimeType: 'image/svg+xml',
            sizeBytes: 512,
            byteHash: 'hash-62',
            storageProvider: 'local',
            storageKey: '1/diagram.svg',
            accessMode: 'signed',
            entitlementScopeType: null,
            entitlementScopeRef: null,
            status: 'active',
            metadata: {},
            uploaderActorId: 'api_key:9',
            uploaderActorType: 'api_key',
            uploaderActorSource: 'db',
            createdAt: new Date('2026-03-13T12:00:00.000Z'),
            updatedAt: new Date('2026-03-13T13:05:00.000Z'),
            deletedAt: null
        });

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/assets/62/restore'
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as { data: { status: string; deletedAt: string | null } };
            expect(body.data.status).toBe('active');
            expect(body.data.deletedAt).toBeNull();
            expect(restoreSpy).toHaveBeenCalledWith(62, 1, expect.objectContaining({
                actorId: 'anonymous'
            }));
        } finally {
            restoreSpy.mockRestore();
            await app.close();
        }
    });

    it('returns ASSET_RESTORE_NOT_DELETED when restoring an active asset', async () => {
        const app = await buildServer();
        const restoreSpy = vi.spyOn(assetService, 'restoreAsset').mockRejectedValue(new assetService.AssetListError(
            'Asset is not deleted',
            'ASSET_RESTORE_NOT_DELETED',
            'Soft-delete the asset before attempting to restore it.'
        ));

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/assets/62/restore'
            });

            expect(response.statusCode).toBe(409);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('ASSET_RESTORE_NOT_DELETED');
        } finally {
            restoreSpy.mockRestore();
            await app.close();
        }
    });

    it('purges a soft-deleted asset through the REST purge route', async () => {
        const app = await buildServer();
        const purgeSpy = vi.spyOn(assetService, 'purgeAsset').mockResolvedValue({
            asset: {
                id: 63,
                domainId: 1,
                sourceAssetId: null,
                variantKey: null,
                transformSpec: null,
                filename: 'legacy.pdf',
                originalFilename: 'legacy.pdf',
                mimeType: 'application/pdf',
                sizeBytes: 1024,
                byteHash: 'hash-63',
                storageProvider: 'local',
                storageKey: '1/legacy.pdf',
                accessMode: 'signed',
                entitlementScopeType: null,
                entitlementScopeRef: null,
                status: 'deleted',
                metadata: {},
                uploaderActorId: 'api_key:9',
                uploaderActorType: 'api_key',
                uploaderActorSource: 'db',
                createdAt: new Date('2026-03-13T12:00:00.000Z'),
                updatedAt: new Date('2026-03-13T13:00:00.000Z'),
                deletedAt: new Date('2026-03-13T13:00:00.000Z')
            },
            usage: {
                activeReferences: [],
                historicalReferences: []
            }
        });

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/assets/63/purge'
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: {
                    purged: boolean;
                    referenceSummary: { activeReferenceCount: number; historicalReferenceCount: number };
                };
            };
            expect(body.data.purged).toBe(true);
            expect(body.data.referenceSummary).toEqual({
                activeReferenceCount: 0,
                historicalReferenceCount: 0
            });
            expect(purgeSpy).toHaveBeenCalledWith(63, 1, expect.objectContaining({
                actorId: 'anonymous'
            }));
        } finally {
            purgeSpy.mockRestore();
            await app.close();
        }
    });

    it('returns retained reference context when asset purge is blocked', async () => {
        const app = await buildServer();
        const purgeSpy = vi.spyOn(assetService, 'purgeAsset').mockRejectedValue(new assetService.AssetListError(
            'Asset purge blocked by retained references',
            'ASSET_PURGE_BLOCKED',
            'Remove or archive current and historical content references before purging this asset.',
            {
                activeReferences: [{
                    contentItemId: 501,
                    contentTypeId: 9,
                    contentTypeName: 'Post',
                    contentTypeSlug: 'post',
                    path: '$.heroImage',
                    version: 3,
                    status: 'published'
                }],
                historicalReferences: [{
                    contentItemId: 501,
                    contentItemVersionId: 77,
                    contentTypeId: 9,
                    contentTypeName: 'Post',
                    contentTypeSlug: 'post',
                    path: '$.heroImage',
                    version: 2
                }]
            }
        ));

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/assets/63/purge'
            });

            expect(response.statusCode).toBe(409);
            const body = response.json() as ApiErrorBody & {
                context?: {
                    activeReferences?: Array<{ contentItemId: number }>;
                    historicalReferences?: Array<{ contentItemVersionId: number }>;
                };
            };
            expect(body.code).toBe('ASSET_PURGE_BLOCKED');
            expect(body.context?.activeReferences?.[0]?.contentItemId).toBe(501);
            expect(body.context?.historicalReferences?.[0]?.contentItemVersionId).toBe(77);
        } finally {
            purgeSpy.mockRestore();
            await app.close();
        }
    });

    it('requires admin scope to purge an asset', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'writer=content:write';
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/assets/63/purge',
                headers: {
                    'x-api-key': 'writer'
                }
            });

            expect(response.statusCode).toBe(403);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('ADMIN_REQUIRED');
        } finally {
            await app.close();
        }
    });

    it('returns INVALID_WEBHOOK_EVENTS when webhook registration has empty events', async () => {
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/webhooks',
                payload: {
                    url: 'https://example.com/hooks/wordclaw',
                    events: [],
                    secret: 'test-secret'
                }
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('INVALID_WEBHOOK_EVENTS');
            expect(mocks.dbMock.insert).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('requires admin scope to create API keys', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'writer=content:write';
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/auth/keys',
                headers: {
                    'x-api-key': 'writer'
                },
                payload: {
                    name: 'Writer Managed Key',
                    scopes: ['content:read']
                }
            });

            expect(response.statusCode).toBe(403);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('ADMIN_REQUIRED');
        } finally {
            await app.close();
        }
    });

    it('requires admin scope to create webhooks', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'writer=content:write';
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/webhooks',
                headers: {
                    'x-api-key': 'writer'
                },
                payload: {
                    url: 'https://example.com/hooks/wordclaw',
                    events: ['content_item.create'],
                    secret: 'test-secret'
                }
            });

            expect(response.statusCode).toBe(403);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('ADMIN_REQUIRED');
        } finally {
            await app.close();
        }
    });

    it('requires admin scope to configure tenant AI providers', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'writer=content:write';
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'PUT',
                url: '/api/ai/providers/openai',
                headers: {
                    'x-api-key': 'writer'
                },
                payload: {
                    apiKey: 'sk-openai-1234567890',
                    defaultModel: 'gpt-4o',
                }
            });

            expect(response.statusCode).toBe(403);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('ADMIN_REQUIRED');
        } finally {
            await app.close();
        }
    });

    it('lists tenant-scoped AI provider configs without returning raw secrets', async () => {
        const app = await buildServer();
        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: () => ({
                    orderBy: vi.fn().mockResolvedValue([{
                        id: 41,
                        domainId: 1,
                        provider: 'openai',
                        apiKey: 'sk-openai-1234567890',
                        defaultModel: 'gpt-4o',
                        settings: {},
                        createdAt: new Date('2026-04-01T10:00:00.000Z'),
                        updatedAt: new Date('2026-04-01T11:00:00.000Z'),
                    }]),
                }),
            }),
        }));

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/ai/providers',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: Array<{
                    provider: string;
                    maskedApiKey: string;
                    defaultModel: string | null;
                }>;
            };
            expect(body.data).toEqual([expect.objectContaining({
                provider: 'openai',
                maskedApiKey: 'sk-o...7890',
                defaultModel: 'gpt-4o',
            })]);
        } finally {
            await app.close();
        }
    });

    it('upserts a tenant-scoped AI provider config', async () => {
        const app = await buildServer();
        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([]),
            }),
        }));
        mocks.dbMock.insert.mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{
                    id: 41,
                    domainId: 1,
                    provider: 'openai',
                    apiKey: 'sk-openai-1234567890',
                    defaultModel: 'gpt-4o',
                    settings: {},
                    createdAt: new Date('2026-04-01T10:00:00.000Z'),
                    updatedAt: new Date('2026-04-01T10:00:00.000Z'),
                }]),
            }),
        });

        try {
            const response = await app.inject({
                method: 'PUT',
                url: '/api/ai/providers/openai',
                payload: {
                    apiKey: 'sk-openai-1234567890',
                    defaultModel: 'gpt-4o',
                }
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: {
                    provider: string;
                    maskedApiKey: string;
                    defaultModel: string | null;
                };
            };
            expect(body.data).toEqual(expect.objectContaining({
                provider: 'openai',
                maskedApiKey: 'sk-o...7890',
                defaultModel: 'gpt-4o',
            }));
        } finally {
            await app.close();
        }
    });

    it('requires admin scope to create workforce agents', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'writer=content:write';
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/workforce/agents',
                headers: {
                    'x-api-key': 'writer'
                },
                payload: {
                    name: 'Software Proposal Writer',
                    slug: 'software-proposal-writer',
                    purpose: 'Draft software proposals from inbound requirement forms.',
                    soul: 'You are a senior solution consultant.',
                }
            });

            expect(response.statusCode).toBe(403);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('ADMIN_REQUIRED');
        } finally {
            await app.close();
        }
    });

    it('lists tenant-managed workforce agents', async () => {
        const app = await buildServer();
        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: () => ({
                    orderBy: vi.fn().mockResolvedValue([{
                        id: 7,
                        domainId: 1,
                        name: 'Software Proposal Writer',
                        slug: 'software-proposal-writer',
                        purpose: 'Draft software proposals from inbound requirement forms.',
                        soul: 'You are a senior solution consultant.',
                        provider: {
                            type: 'openai',
                            model: 'gpt-4o',
                        },
                        active: true,
                        createdAt: new Date('2026-04-01T10:00:00.000Z'),
                        updatedAt: new Date('2026-04-01T11:00:00.000Z'),
                    }]),
                }),
            }),
        }));

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/workforce/agents',
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: Array<{
                    slug: string;
                    provider: {
                        type: string;
                        model?: string;
                    };
                    active: boolean;
                }>;
            };
            expect(body.data).toEqual([expect.objectContaining({
                slug: 'software-proposal-writer',
                provider: {
                    type: 'openai',
                    model: 'gpt-4o',
                },
                active: true,
            })]);
        } finally {
            await app.close();
        }
    });

    it('creates a tenant-managed workforce agent', async () => {
        const app = await buildServer();
        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([]),
            }),
        }));
        mocks.dbMock.insert.mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{
                    id: 7,
                    domainId: 1,
                    name: 'Software Proposal Writer',
                    slug: 'software-proposal-writer',
                    purpose: 'Draft software proposals from inbound requirement forms.',
                    soul: 'You are a senior solution consultant.',
                    provider: {
                        type: 'openai',
                        model: 'gpt-4o',
                    },
                    active: true,
                    createdAt: new Date('2026-04-01T10:00:00.000Z'),
                    updatedAt: new Date('2026-04-01T10:00:00.000Z'),
                }]),
            }),
        });

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/workforce/agents',
                payload: {
                    name: 'Software Proposal Writer',
                    slug: 'software-proposal-writer',
                    purpose: 'Draft software proposals from inbound requirement forms.',
                    soul: 'You are a senior solution consultant.',
                    provider: {
                        type: 'openai',
                        model: 'gpt-4o',
                    },
                    active: true,
                }
            });

            expect(response.statusCode).toBe(201);
            const body = response.json() as {
                data: {
                    id: number;
                    slug: string;
                    provider: {
                        type: string;
                        model?: string;
                    };
                };
            };
            expect(body.data).toEqual(expect.objectContaining({
                id: 7,
                slug: 'software-proposal-writer',
                provider: {
                    type: 'openai',
                    model: 'gpt-4o',
                },
            }));
        } finally {
            await app.close();
        }
    });

    it('returns EMPTY_UPDATE_BODY for webhook update with empty body', async () => {
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'PUT',
                url: '/api/webhooks/1',
                payload: {}
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('EMPTY_UPDATE_BODY');
        } finally {
            await app.close();
        }
    });

    it('supports dry-run batch create without executing a transaction', async () => {
        const app = await buildServer();

        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    id: 4,
                    schema: '{"type":"object"}'
                }]),
            }),
        }));

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-items/batch?mode=dry_run&atomic=true',
                payload: {
                    items: [{
                        contentTypeId: 4,
                        data: '{"title":"ok"}',
                        status: 'draft'
                    }]
                }
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as { data?: { atomic?: boolean; results?: Array<{ ok?: boolean }> }; meta?: { dryRun?: boolean } };
            expect(body.data?.atomic).toBe(true);
            expect(body.data?.results?.[0]?.ok).toBe(true);
            expect(body.meta?.dryRun).toBe(true);
            expect(mocks.dbMock.transaction).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('issues scoped preview tokens for content items', async () => {
        const app = await buildServer();
        const licensingSpy = vi.spyOn(LicensingService, 'getActiveOffersForItemRead').mockResolvedValue([]);

        mocks.dbMock.select.mockImplementationOnce(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    id: 42,
                    domainId: 1,
                    contentTypeId: 7,
                    data: '{"title":"Draft copy"}',
                    status: 'draft',
                    version: 4,
                    createdAt: new Date('2026-03-28T10:00:00.000Z'),
                    updatedAt: new Date('2026-03-29T10:00:00.000Z')
                }]),
            }),
        }));

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-items/42/preview-token',
                payload: {
                    draft: false,
                    locale: 'nl',
                    fallbackLocale: 'en',
                    ttlSeconds: 120
                }
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: {
                    token: string;
                    previewPath: string;
                    contentItemId: number;
                    draft: boolean;
                    ttlSeconds: number;
                    locale?: string;
                    fallbackLocale?: string;
                };
            };

            expect(body.data).toMatchObject({
                contentItemId: 42,
                draft: false,
                ttlSeconds: 120,
                locale: 'nl',
                fallbackLocale: 'en'
            });
            expect(body.data.previewPath).toContain('/api/preview/content-items/42?token=');
            expect(new URL(`http://localhost${body.data.previewPath}`).searchParams.get('token')).toBe(body.data.token);
            expect(mocks.logAuditMock).toHaveBeenCalledWith(
                1,
                'preview',
                'content_item',
                42,
                expect.objectContaining({
                    source: 'issue_preview_token',
                    target: 'content_item',
                    draft: false,
                    ttlSeconds: 120
                }),
                expect.anything(),
                expect.any(String)
            );
        } finally {
            licensingSpy.mockRestore();
            await app.close();
        }
    });

    it('issues scoped preview tokens for globals', async () => {
        const app = await buildServer();
        const licensingSpy = vi.spyOn(LicensingService, 'getActiveOffersForItemRead').mockResolvedValue([]);

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 11,
                        domainId: 1,
                        name: 'Site Settings',
                        slug: 'site-settings',
                        kind: 'singleton',
                        description: null,
                        schema: '{"type":"object"}',
                        basePrice: 0,
                        createdAt: new Date('2026-03-28T10:00:00.000Z'),
                        updatedAt: new Date('2026-03-29T10:00:00.000Z')
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn(() => ({
                        orderBy: vi.fn().mockResolvedValue([{
                            id: 81,
                            domainId: 1,
                            contentTypeId: 11,
                            data: '{"title":"Site Settings"}',
                            status: 'published',
                            version: 2,
                            createdAt: new Date('2026-03-28T10:00:00.000Z'),
                            updatedAt: new Date('2026-03-29T10:00:00.000Z')
                        }]),
                    })),
                }),
            }));

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/globals/site-settings/preview-token'
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: {
                    token: string;
                    previewPath: string;
                    slug: string;
                    draft: boolean;
                };
            };

            expect(body.data).toMatchObject({
                slug: 'site-settings',
                draft: true
            });
            expect(body.data.previewPath).toContain('/api/preview/globals/site-settings?token=');
            expect(new URL(`http://localhost${body.data.previewPath}`).searchParams.get('token')).toBe(body.data.token);
        } finally {
            licensingSpy.mockRestore();
            await app.close();
        }
    });

    it('returns the published snapshot for content item preview reads when draft=false', async () => {
        const app = await buildServer();
        const licensingSpy = vi.spyOn(LicensingService, 'getActiveOffersForItemRead').mockResolvedValue([]);
        const token = issuePreviewToken({
            domainId: 1,
            kind: 'content_item',
            contentItemId: 42,
            draft: false
        }).token;

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    innerJoin: () => ({
                        where: vi.fn().mockResolvedValue([{
                            item: {
                                id: 42,
                                domainId: 1,
                                contentTypeId: 7,
                                data: '{"title":"Draft copy"}',
                                status: 'draft',
                                version: 4,
                                createdAt: new Date('2026-03-28T10:00:00.000Z'),
                                updatedAt: new Date('2026-03-29T10:00:00.000Z')
                            },
                            schema: '{"type":"object","properties":{"title":{"type":"string"}}}',
                        }]),
                    }),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn(() => ({
                        orderBy: vi.fn().mockResolvedValue([{
                            id: 9,
                            contentItemId: 42,
                            version: 2,
                            data: '{"title":"Published copy"}',
                            status: 'published',
                            createdAt: new Date('2026-03-27T08:00:00.000Z')
                        }]),
                    })),
                }),
            }));

        try {
            const response = await app.inject({
                method: 'GET',
                url: `/api/preview/content-items/42?token=${encodeURIComponent(token)}`
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as {
                data: {
                    data: string;
                    status: string;
                    version: number;
                    publicationState: string;
                    workingCopyVersion: number;
                    publishedVersion: number | null;
                };
            };

            expect(body.data).toMatchObject({
                status: 'published',
                version: 2,
                embeddingStatus: 'disabled',
                embeddingChunks: 0,
                embeddingUpdatedAt: null,
                embeddingErrorCode: null,
                publicationState: 'changed',
                workingCopyVersion: 4,
                publishedVersion: 2
            });
            expect(JSON.parse(body.data.data)).toEqual({
                title: 'Published copy'
            });
            expect(mocks.logAuditMock).toHaveBeenCalledWith(
                1,
                'preview',
                'content_item',
                42,
                expect.objectContaining({
                    source: 'preview_token_read',
                    target: 'content_item',
                    draft: false
                }),
                expect.objectContaining({
                    actorId: 'preview_token:content_item:42',
                    actorType: 'preview_token',
                    actorSource: 'token'
                }),
                expect.any(String)
            );
        } finally {
            licensingSpy.mockRestore();
            await app.close();
        }
    });

    it('returns PREVIEW_TARGET_UNPUBLISHED for published-only preview reads without a published snapshot', async () => {
        const app = await buildServer();
        const licensingSpy = vi.spyOn(LicensingService, 'getActiveOffersForItemRead').mockResolvedValue([]);
        const token = issuePreviewToken({
            domainId: 1,
            kind: 'content_item',
            contentItemId: 42,
            draft: false
        }).token;

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    innerJoin: () => ({
                        where: vi.fn().mockResolvedValue([{
                            item: {
                                id: 42,
                                domainId: 1,
                                contentTypeId: 7,
                                data: '{"title":"Draft copy"}',
                                status: 'draft',
                                version: 1,
                                createdAt: new Date('2026-03-28T10:00:00.000Z'),
                                updatedAt: new Date('2026-03-29T10:00:00.000Z')
                            },
                            schema: '{"type":"object","properties":{"title":{"type":"string"}}}',
                        }]),
                    }),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn(() => ({
                        orderBy: vi.fn().mockResolvedValue([]),
                    })),
                }),
            }));

        try {
            const response = await app.inject({
                method: 'GET',
                url: `/api/preview/content-items/42?token=${encodeURIComponent(token)}`
            });

            expect(response.statusCode).toBe(404);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('PREVIEW_TARGET_UNPUBLISHED');
        } finally {
            licensingSpy.mockRestore();
            await app.close();
        }
    });

    it('returns PREVIEW_TOKEN_SCOPE_MISMATCH when a preview token targets a different item', async () => {
        const app = await buildServer();
        const token = issuePreviewToken({
            domainId: 1,
            kind: 'content_item',
            contentItemId: 99
        }).token;

        try {
            const response = await app.inject({
                method: 'GET',
                url: `/api/preview/content-items/42?token=${encodeURIComponent(token)}`
            });

            expect(response.statusCode).toBe(403);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('PREVIEW_TOKEN_SCOPE_MISMATCH');
        } finally {
            await app.close();
        }
    });
});
