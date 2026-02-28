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
        expect(mocks.dbMock.insert).not.toHaveBeenCalled();
        expect(mocks.logAuditMock).not.toHaveBeenCalled();
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

    it('updateContentType maps duplicate slug to CONTENT_TYPE_SLUG_CONFLICT', async () => {
        const duplicateError = Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
            constraint: 'content_types_domain_slug_unique'
        });

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
});
