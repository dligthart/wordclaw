import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const dbMock = {
        select: vi.fn(),
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
    mocks.dbMock.insert.mockReset();
    mocks.dbMock.update.mockReset();
    mocks.dbMock.delete.mockReset();
    mocks.dbMock.transaction.mockReset();
    mocks.logAuditMock.mockReset();
    mocks.isSafeWebhookUrlMock.mockReset();
    mocks.isSafeWebhookUrlMock.mockImplementation(async () => true);
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
