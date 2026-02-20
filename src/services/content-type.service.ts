import { db } from '../db/index.js';
import { contentTypes } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { logAudit } from './audit.js';

// --- Types ---

export interface CreateContentTypeInput {
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
    await logAudit('create', 'content_type', created.id, created as unknown as Record<string, unknown>);
    return created;
}

export async function listContentTypes() {
    return db.select().from(contentTypes);
}

export async function getContentType(id: number) {
    const [type] = await db.select().from(contentTypes).where(eq(contentTypes.id, id));
    return type ?? null;
}

export async function getContentTypeBySlug(slug: string) {
    const [type] = await db.select().from(contentTypes).where(eq(contentTypes.slug, slug));
    return type ?? null;
}

export async function updateContentType(id: number, input: UpdateContentTypeInput) {
    const [updated] = await db.update(contentTypes)
        .set(input)
        .where(eq(contentTypes.id, id))
        .returning();

    if (updated) {
        await logAudit('update', 'content_type', updated.id, { ...input, previous: 'n/a' });
    }
    return updated ?? null;
}

export async function deleteContentType(id: number) {
    const [deleted] = await db.delete(contentTypes)
        .where(eq(contentTypes.id, id))
        .returning();

    if (deleted) {
        await logAudit('delete', 'content_type', deleted.id, deleted as unknown as Record<string, unknown>);
    }
    return deleted ?? null;
}
