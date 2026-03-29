import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    };
});

vi.mock('../db/index.js', () => ({
    db: mocks.dbMock,
}));

vi.mock('../services/audit.js', () => ({
    logAudit: mocks.logAuditMock,
}));

import { resolvers } from './resolvers.js';
import { WorkflowService } from '../services/workflow.js';
import { AgentRunService, AgentRunServiceError } from '../services/agent-runs.js';
import * as assetService from '../services/assets.js';
import * as contentTypeService from '../services/content-type.service.js';
import * as formsService from '../services/forms.js';
import * as jobsService from '../services/jobs.js';
import * as referenceUsageService from '../services/reference-usage.js';
import { jobsWorker } from '../workers/jobs.worker.js';
import { EmbeddingService } from '../services/embedding.js';

type GraphQLErrorLike = {
    extensions?: {
        code?: string;
    };
};

function resetMocks() {
    mocks.dbMock.select.mockReset();
    mocks.dbMock.insert.mockReset();
    mocks.dbMock.update.mockReset();
    mocks.dbMock.delete.mockReset();
    mocks.dbMock.transaction.mockReset();
    mocks.logAuditMock.mockReset();
}

describe('GraphQL Resolver Contracts', () => {
    beforeEach(() => {
        EmbeddingService.resetRuntimeStateForTests();
        delete process.env.OPENAI_API_KEY;
        resetMocks();
    });

    it('createContentType dry-run does not write to the database', async () => {
        const result = await resolvers.Mutation.createContentType({}, {
            name: 'Dry Run Type',
            slug: 'dry-run-type',
            schema: '{"type":"object"}',
            dryRun: true
        }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {});

        expect(result.id).toBe(0);
        expect(result.name).toBe('Dry Run Type');
        expect(result.kind).toBe('collection');
        expect(mocks.dbMock.insert).not.toHaveBeenCalled();
        expect(mocks.logAuditMock).not.toHaveBeenCalled();
    });

    it('createContentType dry-run compiles schema manifests without writes', async () => {
        const result = await resolvers.Mutation.createContentType({}, {
            name: 'Manifest Type',
            slug: 'manifest-type',
            schemaManifest: {
                fields: [
                    {
                        name: 'title',
                        type: 'text',
                        required: true
                    }
                ]
            },
            dryRun: true
        }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {});

        expect(result.id).toBe(0);
        expect(result.schemaManifest).toContain('"fields"');
        expect(JSON.parse(result.schema)).toMatchObject({
            type: 'object',
            required: ['title']
        });
        expect(mocks.dbMock.insert).not.toHaveBeenCalled();
    });

    it('updateContentItem rejects empty payload with EMPTY_UPDATE_BODY', async () => {
        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([])
            })
        }));

        await expect(
            resolvers.Mutation.updateContentItem({}, { id: '1' }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'EMPTY_UPDATE_BODY'
            }
        } satisfies GraphQLErrorLike);

        expect(mocks.dbMock.transaction).not.toHaveBeenCalled();
    });

    it('createContentType rejects invalid schema JSON', async () => {
        await expect(
            resolvers.Mutation.createContentType({}, {
                name: 'Bad Type',
                slug: 'bad-type',
                schema: '{bad-json}'
            }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'INVALID_CONTENT_SCHEMA_JSON'
            }
        } satisfies GraphQLErrorLike);
    });

    it('createContentType maps duplicate slug to CONTENT_TYPE_SLUG_CONFLICT', async () => {
        const duplicateError = Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
            constraint: 'content_types_domain_slug_unique'
        });

        mocks.dbMock.insert.mockImplementation(() => ({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockRejectedValue(duplicateError)
            })
        }));

        await expect(
            resolvers.Mutation.createContentType({}, {
                name: 'Duplicate Type',
                slug: 'article',
                schema: '{"type":"object"}'
            }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'CONTENT_TYPE_SLUG_CONFLICT'
            }
        } satisfies GraphQLErrorLike);
    });

    it('updateContentType rejects singleton conversion when multiple items already exist', async () => {
        const countSpy = vi.spyOn(contentTypeService, 'countContentItemsForContentType').mockResolvedValue(2);

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
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    }]),
                }),
            }));

        await expect(
            resolvers.Mutation.updateContentType({}, {
                id: '1',
                kind: 'singleton'
            }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'SINGLETON_CONTENT_TYPE_REQUIRES_ONE_ITEM'
            }
        } satisfies GraphQLErrorLike);

        countSpy.mockRestore();
    });

    it('updateContentType maps duplicate slug to CONTENT_TYPE_SLUG_CONFLICT', async () => {
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
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }]),
            }),
        }));

        mocks.dbMock.update.mockImplementation(() => ({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockRejectedValue(duplicateError)
                })
            })
        }));

        await expect(
            resolvers.Mutation.updateContentType({}, {
                id: '1',
                slug: 'article'
            }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'CONTENT_TYPE_SLUG_CONFLICT'
            }
        } satisfies GraphQLErrorLike);
    });

    it('lists form definitions through GraphQL', async () => {
        const listFormsSpy = vi.spyOn(formsService, 'listFormDefinitions').mockResolvedValue([{
            id: 7,
            domainId: 1,
            name: 'Contact',
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
            successMessage: 'Submitted',
            fields: [{
                name: 'email',
                label: 'Email',
                type: 'text',
                required: true,
            }],
            defaultData: {},
            createdAt: new Date('2026-03-29T10:00:00.000Z'),
            updatedAt: new Date('2026-03-29T10:05:00.000Z'),
        }]);

        const result = await resolvers.Query.forms(
            {},
            {},
            { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } },
            {},
        );

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            id: 7,
            slug: 'contact',
            contentTypeSlug: 'lead',
            fields: [{ name: 'email', type: 'text', required: true }],
        });

        listFormsSpy.mockRestore();
    });

    it('createForm maps duplicate slug to FORM_DEFINITION_SLUG_CONFLICT', async () => {
        const duplicateError = Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
            constraint: 'form_definitions_domain_slug_unique'
        });
        const createFormSpy = vi.spyOn(formsService, 'createFormDefinition').mockRejectedValue(duplicateError);

        await expect(
            resolvers.Mutation.createForm({}, {
                name: 'Contact',
                slug: 'contact',
                contentTypeId: '12',
                fields: [{ name: 'email', type: 'text', required: true }]
            }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'FORM_DEFINITION_SLUG_CONFLICT'
            }
        } satisfies GraphQLErrorLike);

        createFormSpy.mockRestore();
    });

    it('cancelJob maps non-queued jobs to JOB_CANCEL_FORBIDDEN', async () => {
        const cancelJobSpy = vi.spyOn(jobsService, 'cancelJob').mockImplementation(async () => null as never);
        const getJobSpy = vi.spyOn(jobsService, 'getJob').mockResolvedValue({
            id: 14,
            domainId: 1,
            kind: 'outbound_webhook',
            queue: 'webhooks',
            status: 'running',
            payload: { url: 'https://example.com', body: { ok: true } },
            result: null,
            attempts: 1,
            maxAttempts: 4,
            runAt: new Date('2026-03-29T10:00:00.000Z'),
            claimedAt: new Date('2026-03-29T10:01:00.000Z'),
            startedAt: new Date('2026-03-29T10:01:00.000Z'),
            completedAt: null,
            lastError: null,
            createdAt: new Date('2026-03-29T10:00:00.000Z'),
            updatedAt: new Date('2026-03-29T10:01:00.000Z'),
        });

        await expect(
            resolvers.Mutation.cancelJob({}, {
                id: '14',
            }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'JOB_CANCEL_FORBIDDEN'
            }
        } satisfies GraphQLErrorLike);

        cancelJobSpy.mockRestore();
        getJobSpy.mockRestore();
    });

    it('exposes background jobs worker status through GraphQL', async () => {
        const workerSpy = vi.spyOn(jobsWorker, 'getStatus').mockReturnValue({
            started: true,
            sweepInProgress: false,
            intervalMs: 30000,
            maxJobsPerSweep: 25,
            lastSweepStartedAt: '2026-03-29T10:00:00.000Z',
            lastSweepCompletedAt: '2026-03-29T10:00:01.000Z',
            lastSweepProcessedJobs: 3,
            totalSweeps: 5,
            totalProcessedJobs: 9,
            lastError: null,
        });

        const result = await resolvers.Query.jobsWorkerStatus(
            {},
            {},
            { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } },
            {},
        );

        expect(result).toMatchObject({
            started: true,
            totalProcessedJobs: 9,
            lastError: null,
        });

        workerSpy.mockRestore();
    });

    it('maps TARGET_VERSION_NOT_FOUND to GraphQL error code', async () => {
        let callCount = 0;
        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: vi.fn().mockImplementation(() => {
                    callCount++;
                    if (callCount === 1) {
                        // First select is for L402 wrapper contentItems check
                        return Promise.resolve([{
                            id: 5,
                            contentTypeId: 1,
                            data: '{"title":"current"}',
                            status: 'published',
                            version: 2,
                        }]);
                    } else if (callCount === 2) {
                        // Second select is for L402 wrapper contentTypes check
                        return Promise.resolve([{
                            id: 1,
                            schema: '{}',
                            basePrice: 0
                        }]);
                    } else if (callCount === 3) {
                        // Third select is the actual contentItems fetch inside rollbackContentItem
                        return Promise.resolve([{
                            id: 5,
                            contentTypeId: 1,
                            data: '{"title":"current"}',
                            status: 'published',
                            version: 2,
                        }]);
                    }
                    // Fourth select is the contentItemVersions fetch
                    return Promise.resolve([]);
                })
            })
        }));

        await expect(
            resolvers.Mutation.rollbackContentItem({}, { id: '5', version: 99 }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'TARGET_VERSION_NOT_FOUND'
            }
        } satisfies GraphQLErrorLike);
    });

    it('updateContentItem logs audit on successful update', async () => {
        const workflowSpy = vi.spyOn(WorkflowService, 'getActiveWorkflow').mockResolvedValue(null as any);

        let callCount = 0;
        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: vi.fn().mockImplementation(() => {
                    callCount++;
                    if (callCount === 1) {
                        return Promise.resolve([{
                            id: 7,
                            contentTypeId: 1,
                            data: '{"title":"v1"}',
                            status: 'draft',
                            version: 1,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        }]);
                    }
                    return Promise.resolve([{
                        id: 1,
                        schema: '{"type":"object","required":["title"],"properties":{"title":{"type":"string"}}}',
                        basePrice: 0
                    }]);
                })
            })
        }));

        mocks.dbMock.transaction.mockResolvedValue({
            id: 7,
            contentTypeId: 1,
            data: '{"title":"v2"}',
            status: 'published',
            version: 2,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const result = await resolvers.Mutation.updateContentItem({}, {
            id: '7',
            data: '{"title":"v2"}',
            status: 'published'
        }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {});

        expect(result.version).toBe(2);
        expect(mocks.logAuditMock).toHaveBeenCalledWith(
            1,
            'update',
            'content_item',
            7,
            {
                data: '{"title":"v2"}',
                status: 'published'
            },
            undefined,
            undefined
        );

        workflowSpy.mockRestore();
    });

    it('createContentItemsBatch supports dry-run without writes', async () => {
        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    id: 4,
                    schema: '{"type":"object"}'
                }]),
            }),
        }));

        const result = await resolvers.Mutation.createContentItemsBatch({}, {
            atomic: true,
            dryRun: true,
            items: [{
                contentTypeId: 4,
                data: '{"title":"ok"}',
                status: 'draft'
            }]
        }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {});

        expect(result.atomic).toBe(true);
        expect(result.results[0].ok).toBe(true);
        expect(result.results[0].id).toBe(0);
        expect(mocks.dbMock.insert).not.toHaveBeenCalled();
    });

    it('contentItems rejects invalid createdAfter filter with deterministic code', async () => {
        await expect(
            resolvers.Query.contentItems({}, { createdAfter: 'not-a-date' }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'INVALID_CREATED_AFTER'
            }
        } satisfies GraphQLErrorLike);
    });

    it('contentItems rejects fallbackLocale without locale with deterministic code', async () => {
        await expect(
            resolvers.Query.contentItems({}, { fallbackLocale: 'en' }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'CONTENT_LOCALE_REQUIRED'
            }
        } satisfies GraphQLErrorLike);
    });

    it('contentItems rejects field filters without contentTypeId with deterministic code', async () => {
        await expect(
            resolvers.Query.contentItems({}, { fieldName: 'enabled', fieldValue: 'true' }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'CONTENT_ITEMS_FIELD_QUERY_REQUIRES_CONTENT_TYPE'
            }
        } satisfies GraphQLErrorLike);
    });

    it('contentItems rejects unknown schema field filters with deterministic code', async () => {
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

        await expect(
            resolvers.Query.contentItems({}, { contentTypeId: '7', fieldName: 'missingField', fieldValue: 'true' }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'CONTENT_ITEMS_FIELD_FILTER_FIELD_UNKNOWN'
            }
        } satisfies GraphQLErrorLike);
    });

    it('contentItems rejects malformed cursor with deterministic code', async () => {
        await expect(
            resolvers.Query.contentItems({}, { cursor: 'not-a-cursor' }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'INVALID_CONTENT_ITEMS_CURSOR'
            }
        } satisfies GraphQLErrorLike);
    });

    it('contentItemProjection rejects unknown group fields with deterministic code', async () => {
        mocks.dbMock.select.mockImplementationOnce(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    schema: JSON.stringify({
                        type: 'object',
                        properties: {
                            score: { type: 'integer' }
                        }
                    })
                }])
            })
        }));

        await expect(
            resolvers.Query.contentItemProjection({}, { contentTypeId: '7', groupBy: 'characterClass' }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'CONTENT_ITEMS_PROJECTION_GROUP_FIELD_UNKNOWN'
            }
        } satisfies GraphQLErrorLike);
    });

    it('contentItemProjection rejects numeric metrics without metricField', async () => {
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

        await expect(
            resolvers.Query.contentItemProjection({}, { contentTypeId: '7', groupBy: 'characterClass', metric: 'avg' }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'CONTENT_ITEMS_PROJECTION_METRIC_FIELD_REQUIRED'
            }
        } satisfies GraphQLErrorLike);
    });

    it('contentItems rejects cursor and offset together with deterministic code', async () => {
        const cursor = Buffer.from(JSON.stringify({
            createdAt: '2026-03-09T11:00:00.000Z',
            id: 88
        }), 'utf8').toString('base64url');

        await expect(
            resolvers.Query.contentItems({}, { cursor, offset: 0 }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'CONTENT_ITEMS_CURSOR_OFFSET_CONFLICT'
            }
        } satisfies GraphQLErrorLike);
    });

    it('contentItems resolves localized fields when locale-aware reads are requested', async () => {
        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ total: 1 }])
                })
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    innerJoin: vi.fn(() => ({
                        where: vi.fn(() => ({
                            orderBy: vi.fn(() => ({
                                limit: vi.fn(() => ({
                                    offset: vi.fn().mockResolvedValue([{
                                        item: {
                                            id: 9,
                                            domainId: 1,
                                            contentTypeId: 7,
                                            data: JSON.stringify({
                                                title: {
                                                    en: 'Hello',
                                                    nl: 'Hallo'
                                                }
                                            }),
                                            status: 'published',
                                            version: 3,
                                            createdAt: new Date('2026-03-28T10:00:00.000Z'),
                                            updatedAt: new Date('2026-03-29T10:00:00.000Z')
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
                                    }])
                                }))
                            }))
                        }))
                    }))
                })
            }));

        const result = await resolvers.Query.contentItems({}, {
            locale: 'nl'
        }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {});

        expect(result).toHaveLength(1);
        expect(JSON.parse(result[0].data)).toEqual({
            title: 'Hallo'
        });
        expect(result[0].localeResolution).toMatchObject({
            requestedLocale: 'nl',
            fallbackLocale: 'en',
            resolvedFieldCount: 1
        });
    });

    it('contentItem returns the published snapshot when draft=false and a newer working copy exists', async () => {
        mocks.dbMock.select
            .mockImplementationOnce(() => ({
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
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 7,
                        domainId: 1,
                        name: 'Article',
                        slug: 'article',
                        kind: 'collection',
                        description: null,
                        schema: '{"type":"object","properties":{"title":{"type":"string"}}}',
                        basePrice: 0,
                        createdAt: new Date('2026-03-28T10:00:00.000Z'),
                        updatedAt: new Date('2026-03-29T10:00:00.000Z')
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn(() => ({
                        limit: vi.fn().mockResolvedValue([]),
                    })),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    innerJoin: vi.fn(() => ({
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
                            basePrice: 0,
                            schema: '{"type":"object","properties":{"title":{"type":"string"}}}'
                        }]),
                    })),
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

        const result = await resolvers.Query.contentItem({}, {
            id: '42',
            draft: false
        }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {});

        expect(result).toMatchObject({
            id: 42,
            status: 'published',
            version: 2,
            publicationState: 'changed',
            workingCopyVersion: 4,
            publishedVersion: 2,
            embeddingReadiness: {
                enabled: false,
                state: 'disabled',
                searchable: false,
                model: null,
                targetVersion: 2,
                indexedChunkCount: 0,
                expectedChunkCount: 0,
                inFlight: false,
                queueDepth: 0,
                note: 'Semantic indexing is disabled because OPENAI_API_KEY is not configured.',
            }
        });
        expect(JSON.parse(result!.data)).toEqual({
            title: 'Published copy'
        });
    });

    it('global returns the published snapshot when draft=false and a newer working copy exists', async () => {
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
                        schema: '{"type":"object","properties":{"title":{"type":"string"}}}',
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
                            data: '{"title":"Draft settings"}',
                            status: 'draft',
                            version: 4,
                            createdAt: new Date('2026-03-28T10:00:00.000Z'),
                            updatedAt: new Date('2026-03-29T10:00:00.000Z')
                        }]),
                    })),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn(() => ({
                        orderBy: vi.fn().mockResolvedValue([{
                            id: 10,
                            contentItemId: 81,
                            version: 2,
                            data: '{"title":"Published settings"}',
                            status: 'published',
                            createdAt: new Date('2026-03-27T08:00:00.000Z')
                        }]),
                    })),
                }),
            }));

        const result = await resolvers.Query.global({}, {
            slug: 'site-settings',
            draft: false
        }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {});

        expect(result?.contentType.slug).toBe('site-settings');
        expect(result?.item).toMatchObject({
            id: 81,
            status: 'published',
            version: 2,
            publicationState: 'changed',
            workingCopyVersion: 4,
            publishedVersion: 2
        });
        expect(JSON.parse(result!.item!.data)).toEqual({
            title: 'Published settings'
        });
    });

    it('agentRuns rejects invalid status filter with deterministic code', async () => {
        await expect(
            resolvers.Query.agentRuns!({}, { status: 'not-a-status' }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'AGENT_RUN_INVALID_STATUS'
            }
        } satisfies GraphQLErrorLike);
    });

    it('agentRunDefinitions forwards runType filter to service layer', async () => {
        const listDefinitionsSpy = vi.spyOn(AgentRunService, 'listDefinitions').mockResolvedValue({
            items: [],
            total: 0,
            limit: 50,
            offset: 0,
            hasMore: false
        });

        const result = await resolvers.Query.agentRunDefinitions!({}, {
            active: true,
            runType: 'quality_refiner',
            limit: 25,
            offset: 5
        }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {});

        expect(result).toEqual([]);
        expect(listDefinitionsSpy).toHaveBeenCalledWith(1, {
            active: true,
            runType: 'quality_refiner',
            limit: 25,
            offset: 5
        });

        listDefinitionsSpy.mockRestore();
    });

    it('controlAgentRun rejects invalid action with deterministic code', async () => {
        await expect(
            resolvers.Mutation.controlAgentRun!({}, { id: '1', action: 'launch' }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'AGENT_RUN_INVALID_ACTION'
            }
        } satisfies GraphQLErrorLike);
    });

    it('updateAgentRunDefinition rejects empty payload with deterministic code', async () => {
        await expect(
            resolvers.Mutation.updateAgentRunDefinition!({}, { id: '1' }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'AGENT_RUN_DEFINITION_EMPTY_UPDATE'
            }
        } satisfies GraphQLErrorLike);
    });

    it('createAgentRun maps inactive definition to deterministic GraphQL error', async () => {
        const createRunSpy = vi.spyOn(AgentRunService, 'createRun')
            .mockRejectedValue(new AgentRunServiceError('AGENT_RUN_DEFINITION_INACTIVE', 'inactive'));

        await expect(
            resolvers.Mutation.createAgentRun!({}, {
                goal: 'test',
                definitionId: '1'
            }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'AGENT_RUN_DEFINITION_INACTIVE'
            }
        } satisfies GraphQLErrorLike);

        createRunSpy.mockRestore();
    });

    it('createWorkflow maps CONTENT_TYPE_NOT_FOUND to deterministic GraphQL error', async () => {
        const createWorkflowSpy = vi.spyOn(WorkflowService, 'createWorkflow')
            .mockRejectedValue(new Error('CONTENT_TYPE_NOT_FOUND'));

        await expect(
            resolvers.Mutation.createWorkflow({}, {
                name: 'Cross Domain Workflow',
                contentTypeId: '99999',
                active: true
            }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'CONTENT_TYPE_NOT_FOUND'
            }
        } satisfies GraphQLErrorLike);

        createWorkflowSpy.mockRestore();
    });

    it('createWorkflowTransition maps WORKFLOW_NOT_FOUND to deterministic GraphQL error', async () => {
        const createTransitionSpy = vi.spyOn(WorkflowService, 'createWorkflowTransition')
            .mockRejectedValue(new Error('WORKFLOW_NOT_FOUND'));

        await expect(
            resolvers.Mutation.createWorkflowTransition({}, {
                workflowId: '99999',
                fromState: 'draft',
                toState: 'published',
                requiredRoles: ['admin']
            }, { authPrincipal: { scopes: new Set(['admin']), domainId: 1 } }, {})
        ).rejects.toMatchObject({
            extensions: {
                code: 'WORKFLOW_NOT_FOUND'
            }
        } satisfies GraphQLErrorLike);

        createTransitionSpy.mockRestore();
    });

    it('addReviewComment forwards canonical actor identity to the workflow service', async () => {
        const addCommentSpy = vi.spyOn(WorkflowService, 'addComment').mockResolvedValue({
            id: 77,
            domainId: 1,
            contentItemId: 12,
            authorId: 'api_key:7',
            authorActorId: 'api_key:7',
            authorActorType: 'api_key',
            authorActorSource: 'db',
            comment: 'Looks good.',
            createdAt: new Date('2026-03-12T10:00:00.000Z'),
        } as any);

        try {
            const result = await resolvers.Mutation.addReviewComment({}, {
                contentItemId: '12',
                comment: 'Looks good.'
            }, {
                authPrincipal: {
                    actorRef: 7,
                    domainId: 1,
                    scopes: new Set(['content:write']),
                    actorId: 'api_key:7',
                    actorType: 'api_key',
                    actorSource: 'db'
                }
            }, {});

            expect(addCommentSpy).toHaveBeenCalledWith(
                1,
                12,
                expect.objectContaining({
                    actorId: 'api_key:7',
                    actorType: 'api_key',
                    actorSource: 'db'
                }),
                'Looks good.'
            );
            expect(result).toMatchObject({
                authorId: 'api_key:7',
                authorActorId: 'api_key:7',
                authorActorType: 'api_key',
                authorActorSource: 'db',
                comment: 'Looks good.',
                createdAt: '2026-03-12T10:00:00.000Z'
            });
        } finally {
            addCommentSpy.mockRestore();
        }
    });

    it('contentItemUsedBy returns reverse-reference counts', async () => {
        mocks.dbMock.select.mockReturnValue({
            from: () => ({
                where: vi.fn().mockResolvedValue([{ id: 42 }])
            })
        });
        const usageSpy = vi.spyOn(referenceUsageService, 'findContentItemUsage').mockResolvedValue({
            activeReferences: [{
                contentItemId: 90,
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
            const result = await resolvers.Query.contentItemUsedBy({}, {
                id: '42'
            }, {
                authPrincipal: { scopes: new Set(['admin']), domainId: 1 }
            }, {});

            expect(result).toMatchObject({
                activeReferenceCount: 1,
                historicalReferenceCount: 0
            });
            expect(usageSpy).toHaveBeenCalledWith(1, 42);
        } finally {
            usageSpy.mockRestore();
        }
    });

    it('assetUsedBy returns reverse-reference counts', async () => {
        const assetSpy = vi.spyOn(assetService, 'getAsset').mockResolvedValue({
            id: 18,
            domainId: 1,
            sourceAssetId: null,
            variantKey: null,
            transformSpec: null,
            filename: 'hero.png',
            originalFilename: 'hero.png',
            mimeType: 'image/png',
            sizeBytes: 2048,
            byteHash: 'hash-18',
            storageProvider: 'local',
            storageKey: '1/hero.png',
            accessMode: 'public',
            entitlementScopeType: null,
            entitlementScopeRef: null,
            status: 'active',
            metadata: {},
            uploaderActorId: null,
            uploaderActorType: null,
            uploaderActorSource: null,
            createdAt: new Date('2026-03-29T08:00:00.000Z'),
            updatedAt: new Date('2026-03-29T08:00:00.000Z'),
            deletedAt: null
        } as any);
        const usageSpy = vi.spyOn(referenceUsageService, 'findAssetUsage').mockResolvedValue({
            activeReferences: [],
            historicalReferences: [{
                contentItemId: 91,
                contentItemVersionId: 12,
                contentTypeId: 8,
                contentTypeName: 'Landing Page',
                contentTypeSlug: 'landing-page',
                path: '/hero',
                version: 2
            }]
        });

        try {
            const result = await resolvers.Query.assetUsedBy({}, {
                id: '18'
            }, {
                authPrincipal: { scopes: new Set(['admin']), domainId: 1 }
            }, {});

            expect(result).toMatchObject({
                activeReferenceCount: 0,
                historicalReferenceCount: 1
            });
            expect(assetSpy).toHaveBeenCalledWith(18, 1, { includeDeleted: true });
            expect(usageSpy).toHaveBeenCalledWith(1, 18);
        } finally {
            assetSpy.mockRestore();
            usageSpy.mockRestore();
        }
    });
});
