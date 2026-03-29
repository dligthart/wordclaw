import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const dbMock = {
        select: vi.fn(),
        update: vi.fn(),
        transaction: vi.fn(),
    };

    const deleteWhereMock = vi.fn().mockResolvedValue(undefined);
    const insertValuesMock = vi.fn().mockResolvedValue(undefined);
    const updateWhereMock = vi.fn().mockResolvedValue(undefined);

    const txMock = {
        delete: vi.fn(() => ({ where: deleteWhereMock })),
        insert: vi.fn(() => ({ values: insertValuesMock })),
        update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhereMock })) })),
    };

    const embeddingsCreateMock = vi.fn();
    const openAIMock = vi.fn(function OpenAIMock() {
        return {
            embeddings: {
                create: embeddingsCreateMock,
            },
        };
    });

    return {
        dbMock,
        txMock,
        deleteWhereMock,
        insertValuesMock,
        updateWhereMock,
        embeddingsCreateMock,
        openAIMock,
    };
});

vi.mock('../db/index.js', () => ({
    db: mocks.dbMock,
}));

vi.mock('openai', () => ({
    default: mocks.openAIMock,
}));

import { EmbeddingService, EmbeddingServiceError } from '../services/embedding.js';

function mockSingleSelectResult(result: unknown) {
    mocks.dbMock.select.mockImplementation(() => ({
        from: () => ({
            where: vi.fn().mockResolvedValue(result),
        }),
    }));
}

describe('Embedding Service Contracts', () => {
    beforeEach(() => {
        EmbeddingService.resetRuntimeStateForTests();
        mocks.dbMock.select.mockReset();
        mocks.dbMock.update.mockReset();
        mocks.dbMock.transaction.mockReset();
        mocks.txMock.delete.mockClear();
        mocks.txMock.insert.mockClear();
        mocks.txMock.update.mockClear();
        mocks.deleteWhereMock.mockClear();
        mocks.insertValuesMock.mockClear();
        mocks.updateWhereMock.mockClear();
        mocks.embeddingsCreateMock.mockReset();
        process.env.OPENAI_API_KEY = 'test-openai-key';
    });

    it('chunkContent splits long payloads and handles edge cases', () => {
        const chunks = EmbeddingService.chunkContent({
            title: 'x'.repeat(1800),
            body: 'y'.repeat(1900),
        });

        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.every((chunk) => chunk.length <= 1000)).toBe(true);
        expect(EmbeddingService.chunkContent(null)).toEqual([]);
        expect(EmbeddingService.chunkContent('hello world')).toEqual([
            'hello world',
        ]);
    });

    it('searchSemanticKnowledge returns deterministic domain-isolated results', async () => {
        mocks.embeddingsCreateMock.mockResolvedValue({
            data: [{ embedding: [0.1, 0.2, 0.3] }],
        });

        const limitMock = vi.fn().mockResolvedValue([
            {
                id: 10,
                domainId: 1,
                contentItemId: 100,
                chunkIndex: 0,
                textChunk: 'domain-1-match',
                similarity: 0.98,
                contentItemData: { title: 'Allowed' },
                contentTypeSlug: 'article',
            },
            {
                id: 11,
                domainId: 2,
                contentItemId: 200,
                chunkIndex: 0,
                textChunk: 'domain-2-leak',
                similarity: 0.99,
                contentItemData: { title: 'Blocked' },
                contentTypeSlug: 'article',
            },
        ]);

        const orderByMock = vi.fn(() => ({ limit: limitMock }));
        const whereMock = vi.fn(() => ({ orderBy: orderByMock }));
        const innerJoin2 = vi.fn(() => ({ where: whereMock }));
        const innerJoin1 = vi.fn(() => ({ innerJoin: innerJoin2 }));

        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({ innerJoin: innerJoin1 }),
        }));

        const results = await EmbeddingService.searchSemanticKnowledge(
            1,
            'policy',
            5
        );

        expect(results).toHaveLength(1);
        expect(results[0].textChunk).toBe('domain-1-match');
        expect((results[0] as { domainId?: number }).domainId).toBeUndefined();
    });

    it('searchSemanticKnowledge returns disabled error when OPENAI_API_KEY is missing', async () => {
        delete process.env.OPENAI_API_KEY;

        await expect(
            EmbeddingService.searchSemanticKnowledge(1, 'policy')
        ).rejects.toMatchObject({
            code: 'SEMANTIC_SEARCH_DISABLED',
            statusCode: 503,
        } satisfies Partial<EmbeddingServiceError>);
    });

    it('reports disabled runtime status and content readiness when semantic search is not configured', async () => {
        delete process.env.OPENAI_API_KEY;

        const runtime = EmbeddingService.getRuntimeStatus();
        const readiness = await EmbeddingService.getContentItemEmbeddingReadinessBatch(1, [{
            item: {
                id: 7,
                domainId: 1,
                contentTypeId: 1,
                data: JSON.stringify({ title: 'Hello world' }),
                status: 'published',
                embeddingStatus: 'disabled',
                embeddingChunks: 0,
                embeddingUpdatedAt: null,
                embeddingErrorCode: null,
                version: 3,
                createdAt: new Date('2026-03-29T10:00:00.000Z'),
                updatedAt: new Date('2026-03-29T10:05:00.000Z'),
            },
        }]);

        expect(runtime).toMatchObject({
            enabled: false,
            model: null,
            queueDepth: 0,
            inFlightSyncCount: 0,
            pendingItemCount: 0,
        });
        expect(readiness.get(7)).toEqual({
            enabled: false,
            state: 'disabled',
            searchable: false,
            model: null,
            targetVersion: 3,
            indexedChunkCount: 0,
            expectedChunkCount: 0,
            inFlight: false,
            queueDepth: 0,
            note: 'Semantic indexing is disabled because OPENAI_API_KEY is not configured.',
        });
    });

    it('reports ready content readiness when published chunk counts match the current index', async () => {
        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: vi.fn(() => ({
                    groupBy: vi.fn().mockResolvedValue([{
                        contentItemId: 11,
                        chunkCount: 1,
                    }]),
                })),
            }),
        }));

        const readiness = await EmbeddingService.getContentItemEmbeddingReadinessBatch(1, [{
            item: {
                id: 11,
                domainId: 1,
                contentTypeId: 1,
                data: JSON.stringify({ title: 'Published copy' }),
                status: 'published',
                embeddingStatus: 'synced',
                embeddingChunks: 1,
                embeddingUpdatedAt: new Date('2026-03-29T10:00:00.000Z'),
                embeddingErrorCode: null,
                version: 2,
                createdAt: new Date('2026-03-28T10:00:00.000Z'),
                updatedAt: new Date('2026-03-29T10:00:00.000Z'),
            },
        }]);

        expect(readiness.get(11)).toEqual({
            enabled: true,
            state: 'ready',
            searchable: true,
            model: 'text-embedding-3-small',
            targetVersion: 2,
            indexedChunkCount: 1,
            expectedChunkCount: 1,
            inFlight: false,
            queueDepth: 0,
            note: 'Semantic search is ready for the latest published snapshot.',
        });
    });

    it('syncItemEmbeddings deduplicates concurrent sync requests for the same item', async () => {
        mockSingleSelectResult([
            {
                id: 7,
                domainId: 1,
                contentTypeId: 1,
                data: { title: 'Hello', body: 'World' },
                status: 'published',
                embeddingStatus: 'disabled',
                embeddingChunks: 0,
                embeddingUpdatedAt: null,
                embeddingErrorCode: null,
            },
        ]);

        mocks.dbMock.update.mockImplementation(() => ({
            set: vi.fn(() => ({
                where: vi.fn().mockResolvedValue(undefined),
            })),
        }));
        mocks.embeddingsCreateMock.mockResolvedValue({
            data: [{ embedding: [0.12, 0.34] }],
        });

        mocks.dbMock.transaction.mockImplementation(async (callback: any) => {
            await callback(mocks.txMock);
        });

        await Promise.all([
            EmbeddingService.syncItemEmbeddings(1, 7),
            EmbeddingService.syncItemEmbeddings(1, 7),
        ]);

        expect(mocks.embeddingsCreateMock).toHaveBeenCalledTimes(1);
        expect(mocks.txMock.delete).toHaveBeenCalledTimes(1);
        expect(mocks.txMock.insert).toHaveBeenCalledTimes(1);
        expect(mocks.txMock.update).toHaveBeenCalledTimes(1);
    });

    it('syncItemEmbeddings replaces existing embeddings on repeated syncs', async () => {
        mockSingleSelectResult([
            {
                id: 9,
                domainId: 1,
                contentTypeId: 1,
                data: { title: 'Title', body: 'Body' },
                status: 'published',
                embeddingStatus: 'disabled',
                embeddingChunks: 0,
                embeddingUpdatedAt: null,
                embeddingErrorCode: null,
            },
        ]);

        mocks.dbMock.update.mockImplementation(() => ({
            set: vi.fn(() => ({
                where: vi.fn().mockResolvedValue(undefined),
            })),
        }));
        mocks.embeddingsCreateMock.mockResolvedValue({
            data: [{ embedding: [0.91, 0.82] }],
        });

        mocks.dbMock.transaction.mockImplementation(async (callback: any) => {
            await callback(mocks.txMock);
        });

        await EmbeddingService.syncItemEmbeddings(1, 9);
        await EmbeddingService.syncItemEmbeddings(1, 9);

        expect(mocks.txMock.delete).toHaveBeenCalledTimes(2);
        expect(mocks.txMock.insert).toHaveBeenCalledTimes(2);
        expect(mocks.txMock.update).toHaveBeenCalledTimes(2);
    });

    it('marks embedding sync metadata disabled when semantic search is not configured', async () => {
        delete process.env.OPENAI_API_KEY;
        const updateWhereMock = vi.fn().mockResolvedValue(undefined);
        const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
        mocks.dbMock.update.mockImplementation(() => ({
            set: updateSetMock,
        }));

        await EmbeddingService.syncItemEmbeddings(1, 41);

        expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
            embeddingStatus: 'disabled',
            embeddingChunks: 0,
            embeddingErrorCode: 'SEMANTIC_SEARCH_DISABLED',
            embeddingUpdatedAt: expect.any(Date),
        }));
    });

    it('deleteItemEmbeddings clears persisted metadata alongside vector rows', async () => {
        mocks.dbMock.transaction.mockImplementation(async (callback: any) => {
            await callback(mocks.txMock);
        });

        await EmbeddingService.deleteItemEmbeddings(1, 51);

        expect(mocks.txMock.delete).toHaveBeenCalledTimes(1);
        expect(mocks.txMock.update).toHaveBeenCalledTimes(1);
    });
});
