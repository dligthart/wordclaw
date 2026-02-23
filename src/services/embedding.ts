import { db } from '../db/index.js';
import { contentItems, contentItemEmbeddings, contentTypes } from '../db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import { cosineDistance, sql } from 'drizzle-orm';
import OpenAI from 'openai';

// Initialize OpenAI conditionally. Will throw later if used without key.
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'missing-key'
});

export class EmbeddingService {

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

        const itemResults = await db.select()
            .from(contentItems)
            .where(and(eq(contentItems.domainId, domainId), eq(contentItems.id, contentItemId)));

        const item = itemResults[0];
        if (!item) return;

        // Extract chunks
        const chunks = this.chunkContent(item.data);
        if (chunks.length === 0) return;

        // Generate embeddings via OpenAI
        const response = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: chunks,
        });

        const embeddings = response.data;

        await db.transaction(async (tx) => {
            // Delete old vectors
            await tx.delete(contentItemEmbeddings)
                .where(and(
                    eq(contentItemEmbeddings.domainId, domainId),
                    eq(contentItemEmbeddings.contentItemId, contentItemId)
                ));

            // Insert new vectors
            const insertPayload = chunks.map((chunk, index) => ({
                domainId,
                contentItemId,
                chunkIndex: index,
                textChunk: chunk,
                embedding: embeddings[index].embedding
            }));

            await tx.insert(contentItemEmbeddings).values(insertPayload);
        });
    }

    /**
     * Search the knowledge base for semantic similarity.
     */
    static async searchSemanticKnowledge(domainId: number, query: string, limit: number = 5) {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY missing, semantic search disabled');
        }

        // Embed the search query
        const queryResponse = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: query,
        });
        const queryVector = queryResponse.data[0].embedding;

        // Compute cosine distance natively in pgvector using Drizzle
        const similarity = sql`1 - (${cosineDistance(contentItemEmbeddings.embedding, queryVector)})`;

        const results = await db.select({
            id: contentItemEmbeddings.id,
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

        return results;
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
