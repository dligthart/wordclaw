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
        });

        expect(result.id).toBe(0);
        expect(result.name).toBe('Dry Run Type');
        expect(mocks.dbMock.insert).not.toHaveBeenCalled();
        expect(mocks.logAuditMock).not.toHaveBeenCalled();
    });

    it('updateContentItem rejects empty payload with EMPTY_UPDATE_BODY', async () => {
        await expect(
            resolvers.Mutation.updateContentItem({}, { id: '1' })
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
            })
        ).rejects.toMatchObject({
            extensions: {
                code: 'INVALID_CONTENT_SCHEMA_JSON'
            }
        } satisfies GraphQLErrorLike);
    });

    it('maps TARGET_VERSION_NOT_FOUND to GraphQL error code', async () => {
        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 5,
                        contentTypeId: 1,
                        data: '{"title":"current"}',
                        status: 'published',
                        version: 2,
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([]),
                }),
            }));

        await expect(
            resolvers.Mutation.rollbackContentItem({}, { id: '5', version: 99 })
        ).rejects.toMatchObject({
            extensions: {
                code: 'TARGET_VERSION_NOT_FOUND'
            }
        } satisfies GraphQLErrorLike);
    });

    it('updateContentItem logs audit on successful update', async () => {
        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 7,
                        contentTypeId: 1,
                        data: '{"title":"v1"}',
                        status: 'draft',
                        version: 1,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 1,
                        schema: '{"type":"object","required":["title"],"properties":{"title":{"type":"string"}}}'
                    }]),
                }),
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
        });

        expect(result.version).toBe(2);
        expect(mocks.logAuditMock).toHaveBeenCalledWith(
            'update',
            'content_item',
            7,
            {
                data: '{"title":"v2"}',
                status: 'published'
            }
        );
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
        });

        expect(result.atomic).toBe(true);
        expect(result.results[0].ok).toBe(true);
        expect(result.results[0].id).toBe(0);
        expect(mocks.dbMock.insert).not.toHaveBeenCalled();
    });

    it('contentItems rejects invalid createdAfter filter with deterministic code', async () => {
        await expect(
            resolvers.Query.contentItems({}, { createdAfter: 'not-a-date' })
        ).rejects.toMatchObject({
            extensions: {
                code: 'INVALID_CREATED_AFTER'
            }
        } satisfies GraphQLErrorLike);
    });
});
