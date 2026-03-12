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
import { agentRunWorker } from '../workers/agent-run.worker.js';

type ApiErrorBody = {
    error: string;
    code: string;
    remediation: string;
};

async function buildServer(): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });
    app.setErrorHandler(errorHandler);
    await app.register(apiRoutes, { prefix: '/api' });
    return app;
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
}

describe('API Route Contracts', () => {
    beforeEach(() => {
        resetMocks();
        process.env.AUTH_REQUIRED = 'false';
        process.env.ALLOW_INSECURE_LOCAL_ADMIN = 'true';
        delete process.env.API_KEYS;
        delete process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS;
    });

    afterEach(() => {
        resetMocks();
        restoreAuthEnv();
    });

    it('exposes a public capability manifest without requiring auth', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.ENABLE_EXPERIMENTAL_REVENUE = 'false';
        process.env.ENABLE_EXPERIMENTAL_DELEGATION = 'false';
        process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = 'false';
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
                                supportedFilterFields: string[];
                            };
                        };
                    };
                    auth: {
                        mcp: {
                            endpoint: string;
                            supervisorHeader: string;
                        };
                    };
                    modules: Array<{
                        id: string;
                        enabled: boolean;
                    }>;
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
            }));
            expect(body.data.protocolSurfaces.mcp.reactive.supportedTopics).toEqual(
                expect.arrayContaining(['content_item.published', 'workflow.review.approved']),
            );
            expect(body.data.protocolSurfaces.mcp.reactive.supportedFilterFields).toEqual(
                expect.arrayContaining(['contentTypeId', 'entityId', 'status', 'decision']),
            );
            expect(body.data.auth.mcp.endpoint).toBe('/mcp');
            expect(body.data.auth.mcp.supervisorHeader).toBe('x-wordclaw-domain');
            expect(body.data.modules).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ id: 'content-runtime', enabled: true }),
                    expect.objectContaining({ id: 'agent-runs', enabled: false }),
                ]),
            );
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
                        id: 'verify-provenance',
                        preferredSurface: 'mcp',
                        preferredActorProfile: 'api-key',
                        recommendedApiKeyScopes: ['audit:read'],
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
                                supportedFilterFields: string[];
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
                    supportedFilterFields: expect.arrayContaining(['contentTypeId', 'entityId']),
                }),
            }));
            expect(body.data.checks.agentRuns).toEqual(expect.objectContaining({
                status: 'disabled',
                enabled: false,
            }));
            expect(body.data.warnings).toEqual([]);
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

    it('returns CONTENT_TYPE_SLUG_CONFLICT for content-type update duplicate slug in domain', async () => {
        const app = await buildServer();
        const duplicateError = Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
            constraint: 'content_types_domain_slug_unique'
        });

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
});
