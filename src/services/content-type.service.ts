import { db } from '../db/index.js';
import { contentTypes } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { logAudit } from './audit.js';

// --- Types ---

export interface CreateContentTypeInput {
    domainId: number;
    name: string;
    slug: string;
    description?: string;
    schema: string;
}

export interface UpdateContentTypeInput {
    name?: string;
    slug?: string;
    description?: string;
    schema?: string;
}

// --- Service functions ---

export async function createContentType(input: CreateContentTypeInput) {
    const [created] = await db.insert(contentTypes).values(input).returning();
    await logAudit(input.domainId, 'create', 'content_type', created.id, created as unknown as Record<string, unknown>);
    return created;
}

export async function listContentTypes(domainId: number) {
    return db.select().from(contentTypes).where(eq(contentTypes.domainId, domainId));
}

export async function getContentType(id: number, domainId: number) {
    const [type] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, id), eq(contentTypes.domainId, domainId)));
    return type ?? null;
}

export async function getContentTypeBySlug(slug: string, domainId: number) {
    const [type] = await db.select().from(contentTypes).where(and(eq(contentTypes.slug, slug), eq(contentTypes.domainId, domainId)));
    return type ?? null;
}

export async function updateContentType(id: number, domainId: number, input: UpdateContentTypeInput) {
    const [updated] = await db.update(contentTypes)
        .set(input)
        .where(and(eq(contentTypes.id, id), eq(contentTypes.domainId, domainId)))
        .returning();

    if (updated) {
        await logAudit(domainId, 'update', 'content_type', updated.id, { ...input, previous: 'n/a' });
    }
    return updated ?? null;
}

export async function deleteContentType(id: number, domainId: number) {
    const [deleted] = await db.delete(contentTypes)
        .where(and(eq(contentTypes.id, id), eq(contentTypes.domainId, domainId)))
        .returning();

    if (deleted) {
        await logAudit(domainId, 'delete', 'content_type', deleted.id, deleted as unknown as Record<string, unknown>);
    }
    return deleted ?? null;
}
