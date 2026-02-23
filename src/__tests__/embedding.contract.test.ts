import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const dbMock = {
        select: vi.fn(),
        transaction: vi.fn(),
    };

    const deleteWhereMock = vi.fn().mockResolvedValue(undefined);
    const insertValuesMock = vi.fn().mockResolvedValue(undefined);

    const txMock = {
        delete: vi.fn(() => ({ where: deleteWhereMock })),
        insert: vi.fn(() => ({ values: insertValuesMock })),
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
        mocks.dbMock.select.mockReset();
        mocks.dbMock.transaction.mockReset();
        mocks.txMock.delete.mockClear();
        mocks.txMock.insert.mockClear();
        mocks.deleteWhereMock.mockClear();
        mocks.insertValuesMock.mockClear();
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

    it('syncItemEmbeddings deduplicates concurrent sync requests for the same item', async () => {
        mockSingleSelectResult([
            {
                id: 7,
                domainId: 1,
                contentTypeId: 1,
                data: { title: 'Hello', body: 'World' },
            },
        ]);

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
    });

    it('syncItemEmbeddings replaces existing embeddings on repeated syncs', async () => {
        mockSingleSelectResult([
            {
                id: 9,
                domainId: 1,
                contentTypeId: 1,
                data: { title: 'Title', body: 'Body' },
            },
        ]);

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
    });
});
