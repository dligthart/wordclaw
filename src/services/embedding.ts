import { db } from '../db/index.js';
import { contentItems, contentItemEmbeddings, contentItemVersions, contentTypes } from '../db/schema.js';
import { eq, and, asc, inArray } from 'drizzle-orm';
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

export type EmbeddingRuntimeStatus = {
    enabled: boolean;
    model: string | null;
    queueDepth: number;
    inFlightSyncCount: number;
    pendingItemCount: number;
    maxRequestsPerMinute: number;
    dailyBudget: number;
    dailyBudgetRemaining: number;
    lastSyncCompletedAt: string | null;
    lastSyncErrorMessage: string | null;
    lastSyncErroredAt: string | null;
};

export type ContentEmbeddingReadinessState =
    | 'disabled'
    | 'unpublished'
    | 'empty'
    | 'syncing'
    | 'ready'
    | 'missing'
    | 'stale';

export type ContentEmbeddingReadiness = {
    enabled: boolean;
    state: ContentEmbeddingReadinessState;
    searchable: boolean;
    model: string | null;
    targetVersion: number | null;
    indexedChunkCount: number;
    expectedChunkCount: number;
    inFlight: boolean;
    queueDepth: number;
    note: string;
};

export class EmbeddingService {
    private static syncQueue: Promise<void> = Promise.resolve();
    private static inFlightSyncs = new Map<string, Promise<void>>();
    private static recentEmbeddingCalls: number[] = [];
    private static budgetDay = '';
    private static budgetUsed = 0;
    private static queuedSyncCount = 0;
    private static activeSyncCount = 0;
    private static lastSyncCompletedAt: string | null = null;
    private static lastSyncErrorMessage: string | null = null;
    private static lastSyncErroredAt: string | null = null;
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

    static getRuntimeStatus(): EmbeddingRuntimeStatus {
        this.resetDailyBudgetIfNeeded();

        return {
            enabled: Boolean(process.env.OPENAI_API_KEY),
            model: process.env.OPENAI_API_KEY ? this.embeddingModel : null,
            queueDepth: this.queuedSyncCount,
            inFlightSyncCount: this.activeSyncCount,
            pendingItemCount: this.inFlightSyncs.size,
            maxRequestsPerMinute: this.maxRequestsPerMinute,
            dailyBudget: this.dailyBudget,
            dailyBudgetRemaining: Math.max(0, this.dailyBudget - this.budgetUsed),
            lastSyncCompletedAt: this.lastSyncCompletedAt,
            lastSyncErrorMessage: this.lastSyncErrorMessage,
            lastSyncErroredAt: this.lastSyncErroredAt,
        };
    }

    static resetRuntimeStateForTests() {
        this.syncQueue = Promise.resolve();
        this.inFlightSyncs.clear();
        this.recentEmbeddingCalls = [];
        this.budgetDay = '';
        this.budgetUsed = 0;
        this.queuedSyncCount = 0;
        this.activeSyncCount = 0;
        this.lastSyncCompletedAt = null;
        this.lastSyncErrorMessage = null;
        this.lastSyncErroredAt = null;
    }

    static isItemSyncInFlight(domainId: number, contentItemId: number): boolean {
        return this.inFlightSyncs.has(`${domainId}:${contentItemId}`);
    }

    static async getContentItemEmbeddingReadinessBatch(
        domainId: number,
        items: Array<{
            item: typeof contentItems.$inferSelect;
            publishedVersion?: typeof contentItemVersions.$inferSelect | null;
        }>
    ): Promise<Map<number, ContentEmbeddingReadiness>> {
        const runtime = this.getRuntimeStatus();
        const itemIds = items.map((entry) => entry.item.id);
        const chunkCounts = new Map<number, number>();

        if (runtime.enabled && itemIds.length > 0) {
            const rows = await db.select({
                contentItemId: contentItemEmbeddings.contentItemId,
                chunkCount: sql<number>`count(*)::int`,
            })
                .from(contentItemEmbeddings)
                .where(and(
                    eq(contentItemEmbeddings.domainId, domainId),
                    inArray(contentItemEmbeddings.contentItemId, itemIds),
                ))
                .groupBy(contentItemEmbeddings.contentItemId);

            for (const row of rows) {
                chunkCounts.set(row.contentItemId, Number(row.chunkCount) || 0);
            }
        }

        const readiness = new Map<number, ContentEmbeddingReadiness>();

        for (const entry of items) {
            const { item, publishedVersion } = entry;
            const inFlight = this.isItemSyncInFlight(domainId, item.id);
            const indexedChunkCount = chunkCounts.get(item.id) ?? 0;

            if (!runtime.enabled) {
                readiness.set(item.id, {
                    enabled: false,
                    state: 'disabled',
                    searchable: false,
                    model: null,
                    targetVersion: item.status === 'published'
                        ? item.version
                        : publishedVersion?.version ?? null,
                    indexedChunkCount,
                    expectedChunkCount: 0,
                    inFlight,
                    queueDepth: runtime.queueDepth + runtime.inFlightSyncCount,
                    note: 'Semantic indexing is disabled because OPENAI_API_KEY is not configured.',
                });
                continue;
            }

            const target = item.status === 'published'
                ? {
                    data: item.data,
                    version: item.version,
                }
                : publishedVersion
                    ? {
                        data: publishedVersion.data,
                        version: publishedVersion.version,
                    }
                    : null;

            if (!target) {
                readiness.set(item.id, {
                    enabled: true,
                    state: 'unpublished',
                    searchable: false,
                    model: runtime.model,
                    targetVersion: null,
                    indexedChunkCount,
                    expectedChunkCount: 0,
                    inFlight,
                    queueDepth: runtime.queueDepth + runtime.inFlightSyncCount,
                    note: 'Semantic indexing only applies to published content.',
                });
                continue;
            }

            const expectedChunkCount = this.chunkContent(target.data).length;
            if (expectedChunkCount === 0) {
                readiness.set(item.id, {
                    enabled: true,
                    state: 'empty',
                    searchable: false,
                    model: runtime.model,
                    targetVersion: target.version,
                    indexedChunkCount,
                    expectedChunkCount,
                    inFlight,
                    queueDepth: runtime.queueDepth + runtime.inFlightSyncCount,
                    note: 'The published payload does not currently produce any semantic text chunks.',
                });
                continue;
            }

            if (inFlight) {
                readiness.set(item.id, {
                    enabled: true,
                    state: 'syncing',
                    searchable: indexedChunkCount > 0,
                    model: runtime.model,
                    targetVersion: target.version,
                    indexedChunkCount,
                    expectedChunkCount,
                    inFlight,
                    queueDepth: runtime.queueDepth + runtime.inFlightSyncCount,
                    note: indexedChunkCount > 0
                        ? 'Semantic indexing is refreshing in the background for the latest published snapshot.'
                        : 'Semantic indexing has been queued for the latest published snapshot.',
                });
                continue;
            }

            if (indexedChunkCount === 0) {
                readiness.set(item.id, {
                    enabled: true,
                    state: 'missing',
                    searchable: false,
                    model: runtime.model,
                    targetVersion: target.version,
                    indexedChunkCount,
                    expectedChunkCount,
                    inFlight,
                    queueDepth: runtime.queueDepth + runtime.inFlightSyncCount,
                    note: 'No semantic index exists yet for the latest published snapshot.',
                });
                continue;
            }

            if (indexedChunkCount !== expectedChunkCount) {
                readiness.set(item.id, {
                    enabled: true,
                    state: 'stale',
                    searchable: true,
                    model: runtime.model,
                    targetVersion: target.version,
                    indexedChunkCount,
                    expectedChunkCount,
                    inFlight,
                    queueDepth: runtime.queueDepth + runtime.inFlightSyncCount,
                    note: 'The semantic index does not match the latest published chunk count and should be refreshed.',
                });
                continue;
            }

            readiness.set(item.id, {
                enabled: true,
                state: 'ready',
                searchable: true,
                model: runtime.model,
                targetVersion: target.version,
                indexedChunkCount,
                expectedChunkCount,
                inFlight,
                queueDepth: runtime.queueDepth + runtime.inFlightSyncCount,
                note: 'Semantic search is ready for the latest published snapshot.',
            });
        }

        return readiness;
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
        let parsedData = data;
        if (typeof data === 'string') {
            try { parsedData = JSON.parse(data); } catch (e) { }
        }

        if (typeof parsedData === 'object' && parsedData !== null) {
            for (const [key, value] of Object.entries(parsedData)) {
                // Skip metadata fields that add noise to vectors and search results
                if (['slug', 'coverImage', 'authorId', 'category', 'readTimeMinutes', 'avatarUrl', 'socialLinks', 'id'].includes(key)) continue;

                if (value && typeof value === 'string') {
                    flatText += `${value}\n\n`;
                } else if (value && typeof value !== 'object') {
                    flatText += `${value}\n\n`;
                } else if (Array.isArray(value)) {
                    flatText += `${value.join(', ')}\n\n`;
                }
            }
        } else {
            flatText = String(parsedData);
        }

        flatText = flatText.trim();
        if (!flatText) return [];

        // Chunk on sentence/newline boundaries, falling back to word boundaries
        const chunkSize = 1000;
        if (flatText.length <= chunkSize) {
            chunks.push(flatText);
        } else {
            let remaining = flatText;
            while (remaining.length > 0) {
                if (remaining.length <= chunkSize) {
                    chunks.push(remaining);
                    break;
                }

                let splitAt = -1;
                // Try to split at a sentence boundary (.\n or .\s)
                for (let i = chunkSize; i > chunkSize * 0.5; i--) {
                    const ch = remaining[i];
                    if (ch === '\n' || (ch === ' ' && i > 0 && '.!?'.includes(remaining[i - 1]))) {
                        splitAt = i + 1;
                        break;
                    }
                }

                // Fall back to word boundary
                if (splitAt === -1) {
                    for (let i = chunkSize; i > chunkSize * 0.5; i--) {
                        if (remaining[i] === ' ' || remaining[i] === '\n') {
                            splitAt = i + 1;
                            break;
                        }
                    }
                }

                // Last resort: hard split at chunkSize
                if (splitAt === -1) {
                    splitAt = chunkSize;
                }

                chunks.push(remaining.slice(0, splitAt).trimEnd());
                remaining = remaining.slice(splitAt).trimStart();
            }
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

        this.queuedSyncCount += 1;
        const run = this.syncQueue
            .catch(() => undefined)
            .then(async () => {
                this.queuedSyncCount = Math.max(0, this.queuedSyncCount - 1);
                this.activeSyncCount += 1;

                try {
                    const itemResults = await db.select()
                        .from(contentItems)
                        .where(and(eq(contentItems.domainId, domainId), eq(contentItems.id, contentItemId)));

                    const item = itemResults[0];
                    if (!item) {
                        this.lastSyncErrorMessage = null;
                        return;
                    }

                    const chunks = this.chunkContent(item.data);
                    if (chunks.length === 0) {
                        this.lastSyncErrorMessage = null;
                        this.lastSyncCompletedAt = new Date().toISOString();
                        return;
                    }

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

                    this.lastSyncErrorMessage = null;
                    this.lastSyncErroredAt = null;
                    this.lastSyncCompletedAt = new Date().toISOString();
                } catch (error) {
                    this.lastSyncErrorMessage = (error as Error).message;
                    this.lastSyncErroredAt = new Date().toISOString();
                    throw error;
                } finally {
                    this.activeSyncCount = Math.max(0, this.activeSyncCount - 1);
                }
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
