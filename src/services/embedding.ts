import { db } from '../db/index.js';
import { contentItems, contentItemEmbeddings, contentTypes } from '../db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import { cosineDistance, sql } from 'drizzle-orm';
import OpenAI from 'openai';

// Initialize OpenAI conditionally. Will throw later if used without key.
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'missing-key'
});

export class EmbeddingServiceError extends Error {
    code: string;
    statusCode: number;

    constructor(code: string, message: string, statusCode = 500) {
        super(message);
        this.name = 'EmbeddingServiceError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

export class EmbeddingService {
    private static syncQueue: Promise<void> = Promise.resolve();
    private static inFlightSyncs = new Map<string, Promise<void>>();
    private static recentEmbeddingCalls: number[] = [];
    private static budgetDay = '';
    private static budgetUsed = 0;
    private static readonly maxRequestsPerMinute = Number(process.env.OPENAI_EMBEDDING_MAX_PER_MINUTE || 30);
    private static readonly dailyBudget = Number(process.env.OPENAI_EMBEDDING_DAILY_BUDGET || 2000);
    private static readonly retryAttempts = Number(process.env.OPENAI_EMBEDDING_RETRIES || 3);
    private static readonly retryBaseMs = Number(process.env.OPENAI_EMBEDDING_RETRY_BASE_MS || 500);
    private static readonly embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

    private static assertSemanticSearchEnabled() {
        if (!process.env.OPENAI_API_KEY) {
            throw new EmbeddingServiceError(
                'SEMANTIC_SEARCH_DISABLED',
                'Semantic search is disabled because OPENAI_API_KEY is not configured.',
                503
            );
        }
    }

    private static resetDailyBudgetIfNeeded() {
        const today = new Date().toISOString().slice(0, 10);
        if (this.budgetDay !== today) {
            this.budgetDay = today;
            this.budgetUsed = 0;
        }
    }

    private static ensureBudgetAvailable(requests = 1) {
        this.resetDailyBudgetIfNeeded();
        if (this.budgetUsed + requests > this.dailyBudget) {
            throw new EmbeddingServiceError(
                'EMBEDDING_DAILY_BUDGET_EXCEEDED',
                `Embedding requests exceeded the configured daily budget (${this.dailyBudget}).`,
                429
            );
        }
    }

    private static async waitForRateLimitSlot() {
        const now = Date.now();
        this.recentEmbeddingCalls = this.recentEmbeddingCalls.filter((timestamp) => now - timestamp < 60_000);

        while (this.recentEmbeddingCalls.length >= this.maxRequestsPerMinute) {
            const oldest = this.recentEmbeddingCalls[0];
            const waitMs = Math.max(100, 60_000 - (Date.now() - oldest));
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            const tick = Date.now();
            this.recentEmbeddingCalls = this.recentEmbeddingCalls.filter((timestamp) => tick - timestamp < 60_000);
        }
    }

    private static markEmbeddingRequest() {
        this.budgetUsed += 1;
        this.recentEmbeddingCalls.push(Date.now());
    }

    private static shouldRetryEmbeddingError(error: any): boolean {
        const status = typeof error?.status === 'number' ? error.status : undefined;
        if (status === undefined) return true;
        return status === 429 || status >= 500;
    }

    private static async withRetry<T>(operation: () => Promise<T>): Promise<T> {
        let attempt = 0;
        let lastError: unknown = null;

        while (attempt < this.retryAttempts) {
            attempt += 1;
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                if (!this.shouldRetryEmbeddingError(error) || attempt >= this.retryAttempts) {
                    break;
                }
                const backoff = this.retryBaseMs * 2 ** (attempt - 1);
                await new Promise((resolve) => setTimeout(resolve, backoff));
            }
        }

        throw lastError;
    }

    private static async requestEmbeddings(input: string | string[]) {
        this.assertSemanticSearchEnabled();
        await this.waitForRateLimitSlot();
        this.ensureBudgetAvailable(1);

        const response = await this.withRetry(() =>
            openai.embeddings.create({
                model: this.embeddingModel,
                input,
            })
        );

        this.markEmbeddingRequest();
        return response.data;
    }

    /**
     * Chunk a JSON data payload into distinct semantic text segments.
     * Simple naive chunking for v1.
     */
    static chunkContent(data: any): string[] {
        if (!data) return [];
        const chunks: string[] = [];

        // Flatten object into readable text
        let flatText = '';
        if (typeof data === 'object') {
            for (const [key, value] of Object.entries(data)) {
                if (value && typeof value !== 'object') {
                    flatText += `${key}: ${value}\n`;
                } else if (value) {
                    flatText += `${key}: ${JSON.stringify(value)}\n`;
                }
            }
        } else {
            flatText = String(data);
        }

        // Chunk by arbitrary length as fallback, but keep intact if possible
        const chunkSize = 1000;
        for (let i = 0; i < flatText.length; i += chunkSize) {
            chunks.push(flatText.slice(i, i + chunkSize));
        }

        return chunks;
    }

    /**
     * Delete existing embeddings and generate new ones for a published item.
     */
    static async syncItemEmbeddings(domainId: number, contentItemId: number) {
        if (!process.env.OPENAI_API_KEY) {
            console.warn('OPENAI_API_KEY missing, skipping semantic embedding sync');
            return;
        }

        const syncKey = `${domainId}:${contentItemId}`;
        const existingSync = this.inFlightSyncs.get(syncKey);
        if (existingSync) {
            return existingSync;
        }

        const run = this.syncQueue
            .catch(() => undefined)
            .then(async () => {
                const itemResults = await db.select()
                    .from(contentItems)
                    .where(and(eq(contentItems.domainId, domainId), eq(contentItems.id, contentItemId)));

                const item = itemResults[0];
                if (!item) return;

                const chunks = this.chunkContent(item.data);
                if (chunks.length === 0) return;

                const embeddings = await this.requestEmbeddings(chunks);
                if (embeddings.length !== chunks.length) {
                    throw new EmbeddingServiceError(
                        'EMBEDDING_RESPONSE_SIZE_MISMATCH',
                        `Embedding response size mismatch for content item ${contentItemId}.`,
                        502
                    );
                }

                await db.transaction(async (tx) => {
                    await tx.delete(contentItemEmbeddings)
                        .where(and(
                            eq(contentItemEmbeddings.domainId, domainId),
                            eq(contentItemEmbeddings.contentItemId, contentItemId)
                        ));

                    const insertPayload = chunks.map((chunk, index) => ({
                        domainId,
                        contentItemId,
                        chunkIndex: index,
                        textChunk: chunk,
                        embedding: embeddings[index].embedding
                    }));

                    await tx.insert(contentItemEmbeddings).values(insertPayload);
                });
            });

        this.syncQueue = run.then(() => undefined, () => undefined);
        const trackedRun = run.finally(() => {
            this.inFlightSyncs.delete(syncKey);
        });
        this.inFlightSyncs.set(syncKey, trackedRun);
        return trackedRun;
    }

    /**
     * Search the knowledge base for semantic similarity.
     */
    static async searchSemanticKnowledge(domainId: number, query: string, limit: number = 5) {
        this.assertSemanticSearchEnabled();

        // Embed the search query
        const queryEmbeddings = await this.requestEmbeddings(query);
        const queryVector = queryEmbeddings[0]?.embedding;
        if (!queryVector) {
            throw new EmbeddingServiceError(
                'EMBEDDING_QUERY_EMPTY',
                'The embedding provider returned no query embedding.',
                502
            );
        }

        // Compute cosine distance natively in pgvector using Drizzle
        const similarity = sql`1 - (${cosineDistance(contentItemEmbeddings.embedding, queryVector)})`;

        const results = await db.select({
            id: contentItemEmbeddings.id,
            domainId: contentItemEmbeddings.domainId,
            contentItemId: contentItemEmbeddings.contentItemId,
            chunkIndex: contentItemEmbeddings.chunkIndex,
            textChunk: contentItemEmbeddings.textChunk,
            similarity: similarity,
            contentItemData: contentItems.data,
            contentTypeSlug: contentTypes.slug
        })
            .from(contentItemEmbeddings)
            .innerJoin(contentItems, eq(contentItemEmbeddings.contentItemId, contentItems.id))
            .innerJoin(contentTypes, eq(contentItems.contentTypeId, contentTypes.id))
            .where(eq(contentItemEmbeddings.domainId, domainId))
            .orderBy(asc(sql`${cosineDistance(contentItemEmbeddings.embedding, queryVector)}`))
            .limit(limit);

        return results
            .filter((result) => result.domainId === domainId)
            .map(({ domainId: _domainId, ...result }) => result);
    }

    /**
     * Remove embeddings for an item (e.g. when unpublished)
     */
    static async deleteItemEmbeddings(domainId: number, contentItemId: number) {
        await db.delete(contentItemEmbeddings)
            .where(and(
                eq(contentItemEmbeddings.domainId, domainId),
                eq(contentItemEmbeddings.contentItemId, contentItemId)
            ));
    }
}
