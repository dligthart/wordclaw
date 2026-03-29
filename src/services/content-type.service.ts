import { db } from '../db/index.js';
import { contentItems, contentTypes } from '../db/schema.js';
import { eq, and, desc, ne, sql } from 'drizzle-orm';
import { logAudit } from './audit.js';

export const CONTENT_TYPE_KINDS = ['collection', 'singleton'] as const;
export type ContentTypeKind = typeof CONTENT_TYPE_KINDS[number];

export function normalizeContentTypeKind(value: unknown): ContentTypeKind | null {
    if (value === 'collection' || value === 'singleton') {
        return value;
    }

    return null;
}

export function resolveContentTypeKind(value: unknown): ContentTypeKind {
    return normalizeContentTypeKind(value) ?? 'collection';
}

export function isSingletonContentType(value: unknown): boolean {
    return resolveContentTypeKind(value) === 'singleton';
}

// --- Types ---

export interface CreateContentTypeInput {
    domainId: number;
    name: string;
    slug: string;
    kind?: ContentTypeKind;
    description?: string;
    schemaManifest?: string | null;
    schema: string;
}

export interface UpdateContentTypeInput {
    name?: string;
    slug?: string;
    kind?: ContentTypeKind;
    description?: string;
    schemaManifest?: string | null;
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

export async function listGlobalContentTypes(domainId: number) {
    return db.select()
        .from(contentTypes)
        .where(and(
            eq(contentTypes.domainId, domainId),
            eq(contentTypes.kind, 'singleton')
        ));
}

export async function getGlobalContentTypeBySlug(slug: string, domainId: number) {
    const [type] = await db.select()
        .from(contentTypes)
        .where(and(
            eq(contentTypes.slug, slug),
            eq(contentTypes.domainId, domainId),
            eq(contentTypes.kind, 'singleton')
        ));

    return type ?? null;
}

export async function getSingletonContentItem(domainId: number, contentTypeId: number) {
    const [item] = await db.select()
        .from(contentItems)
        .where(and(
            eq(contentItems.domainId, domainId),
            eq(contentItems.contentTypeId, contentTypeId)
        ))
        .orderBy(desc(contentItems.updatedAt), desc(contentItems.id));

    return item ?? null;
}

export async function countContentItemsForContentType(domainId: number, contentTypeId: number) {
    const [result] = await db.select({
        total: sql<number>`count(*)::int`
    })
        .from(contentItems)
        .where(and(
            eq(contentItems.domainId, domainId),
            eq(contentItems.contentTypeId, contentTypeId)
        ));

    return result?.total ?? 0;
}

export async function findSingletonContentConflict(domainId: number, contentTypeId: number, excludeContentItemId?: number) {
    const [existing] = await db.select({
        id: contentItems.id,
        contentTypeId: contentItems.contentTypeId
    })
        .from(contentItems)
        .where(and(
            eq(contentItems.domainId, domainId),
            eq(contentItems.contentTypeId, contentTypeId),
            excludeContentItemId !== undefined ? ne(contentItems.id, excludeContentItemId) : undefined
        ))
        .orderBy(desc(contentItems.updatedAt), desc(contentItems.id));

    return existing ?? null;
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
