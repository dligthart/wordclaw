import { db } from '../db/index.js';
import { contentItems, contentItemVersions, contentTypes } from '../db/schema.js';
import { and, asc, desc, eq, gte, ilike, lt, lte, or, sql } from 'drizzle-orm';
import { logAudit } from './audit.js';
import { redactPremiumFields } from './content-schema.js';

// --- Types ---

export interface CreateContentItemInput {
    domainId: number;
    contentTypeId: number;
    data: string;
    status?: string;
}

export interface UpdateContentItemInput {
    contentTypeId?: number;
    data?: string;
    status?: string;
}

export type ListContentItemsInput = {
    contentTypeId?: number;
    status?: string;
    q?: string;
    createdAfter?: Date | null;
    createdBefore?: Date | null;
    sortBy?: 'updatedAt' | 'createdAt' | 'version';
    sortDir?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
    cursor?: string;
};

export type ContentItemCursor = {
    createdAt: Date;
    id: number;
};

export type ListContentItemsResult = {
    items: Array<typeof contentItems.$inferSelect>;
    total: number;
    limit: number;
    offset?: number;
    hasMore: boolean;
    nextCursor: string | null;
};

export class ContentItemListError extends Error {
    code: string;
    remediation: string;

    constructor(message: string, code: string, remediation: string) {
        super(message);
        this.name = 'ContentItemListError';
        this.code = code;
        this.remediation = remediation;
    }
}

export function encodeContentItemsCursor(createdAt: Date, id: number): string {
    return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id }), 'utf8').toString('base64url');
}

export function decodeContentItemsCursor(cursor: string): ContentItemCursor | null {
    try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
            createdAt?: string;
            id?: number;
        };

        if (!decoded.createdAt || typeof decoded.id !== 'number') {
            return null;
        }

        const createdAt = new Date(decoded.createdAt);
        if (Number.isNaN(createdAt.getTime())) {
            return null;
        }

        return {
            createdAt,
            id: decoded.id
        };
    } catch {
        return null;
    }
}

// --- Service functions ---

export async function createContentItem(input: CreateContentItemInput) {
    const [created] = await db.insert(contentItems).values({
        domainId: input.domainId,
        contentTypeId: input.contentTypeId,
        data: input.data,
        status: input.status || 'draft',
    }).returning();

    await logAudit(input.domainId, 'create', 'content_item', created.id, created as unknown as Record<string, unknown>);
    return created;
}

export async function listContentItems(domainId: number, input: ListContentItemsInput = {}): Promise<ListContentItemsResult> {
    const {
        contentTypeId,
        status,
        q,
        createdAfter,
        createdBefore,
        sortBy,
        sortDir,
        limit = 50,
        offset,
        cursor
    } = input;

    if (cursor && offset !== undefined) {
        throw new ContentItemListError(
            'Cursor and offset pagination cannot be combined',
            'CONTENT_ITEMS_CURSOR_OFFSET_CONFLICT',
            'Provide either cursor or offset when listing content items, not both.'
        );
    }

    if (cursor && ((sortBy && sortBy !== 'createdAt') || (sortDir && sortDir !== 'desc'))) {
        throw new ContentItemListError(
            'Cursor pagination only supports createdAt descending order',
            'CONTENT_ITEMS_CURSOR_SORT_UNSUPPORTED',
            'Use sortBy=createdAt and sortDir=desc, or omit sorting when providing a cursor.'
        );
    }

    const decodedCursor = cursor ? decodeContentItemsCursor(cursor) : null;
    if (cursor && !decodedCursor) {
        throw new ContentItemListError(
            'Invalid content items cursor',
            'INVALID_CONTENT_ITEMS_CURSOR',
            'Provide cursor returned by the previous content items response.'
        );
    }

    const searchQuery = q?.trim();
    const searchPattern = searchQuery ? `%${searchQuery}%` : null;

    const baseConditions = [
        eq(contentItems.domainId, domainId),
        contentTypeId !== undefined ? eq(contentItems.contentTypeId, contentTypeId) : undefined,
        status ? eq(contentItems.status, status) : undefined,
        searchPattern
            ? or(
                ilike(contentItems.data, searchPattern),
                ilike(contentItems.status, searchPattern),
                sql<boolean>`CAST(${contentItems.id} AS TEXT) ILIKE ${searchPattern}`
            )
            : undefined,
        createdAfter ? gte(contentItems.createdAt, createdAfter) : undefined,
        createdBefore ? lte(contentItems.createdAt, createdBefore) : undefined,
    ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

    const baseWhereClause = baseConditions.length > 0 ? and(...baseConditions) : undefined;
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
        .from(contentItems)
        .where(baseWhereClause);

    const cursorCondition = decodedCursor
        ? or(
            lt(contentItems.createdAt, decodedCursor.createdAt),
            and(eq(contentItems.createdAt, decodedCursor.createdAt), lt(contentItems.id, decodedCursor.id))
        )
        : undefined;

    const whereConditions = [
        ...baseConditions,
        cursorCondition
    ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;
    const baseQuery = db.select({
        item: contentItems,
        schema: contentTypes.schema,
        basePrice: contentTypes.basePrice
    })
        .from(contentItems)
        .innerJoin(contentTypes, eq(contentItems.contentTypeId, contentTypes.id))
        .where(whereClause);

    const rawItems = cursor
        ? await baseQuery
            .orderBy(desc(contentItems.createdAt), desc(contentItems.id))
            .limit(limit + 1)
        : await baseQuery
            .orderBy(
                sortDir === 'asc'
                    ? asc(
                        sortBy === 'createdAt'
                            ? contentItems.createdAt
                            : sortBy === 'version'
                                ? contentItems.version
                                : contentItems.updatedAt
                    )
                    : desc(
                        sortBy === 'createdAt'
                            ? contentItems.createdAt
                            : sortBy === 'version'
                                ? contentItems.version
                                : contentItems.updatedAt
                    ),
                sortDir === 'asc' ? asc(contentItems.id) : desc(contentItems.id)
            )
            .limit(limit)
            .offset(offset ?? 0);

    const hasMore = cursor ? rawItems.length > limit : (offset ?? 0) + rawItems.length < total;
    const page = cursor && hasMore ? rawItems.slice(0, limit) : rawItems;
    const last = page[page.length - 1];
    const nextCursor = cursor && hasMore && last ? encodeContentItemsCursor(last.item.createdAt, last.item.id) : null;
    const items = page.map((row) => {
        if ((row.basePrice || 0) > 0) {
            return {
                ...row.item,
                data: redactPremiumFields(row.schema, row.item.data)
            };
        }

        return row.item;
    });

    return {
        items,
        total,
        limit,
        ...(cursor ? {} : { offset: offset ?? 0 }),
        hasMore,
        nextCursor
    };
}

export async function getContentItem(id: number, domainId: number) {
    const [item] = await db.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId)));
    return item ?? null;
}

/**
 * Update a content item with automatic versioning.
 * Archives the current state and increments the version number.
 */
export async function updateContentItem(id: number, domainId: number, input: UpdateContentItemInput) {
    const result = await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId)));
        if (!existing) return null;

        // Archive current version
        await tx.insert(contentItemVersions).values({
            contentItemId: existing.id,
            version: existing.version,
            data: existing.data,
            status: existing.status,
            createdAt: existing.updatedAt,
        });

        // Build update payload
        const updateData: Record<string, unknown> = {
            version: existing.version + 1,
            updatedAt: new Date(),
        };
        if (input.data !== undefined) updateData.data = input.data;
        if (input.status !== undefined) updateData.status = input.status;
        if (input.contentTypeId !== undefined) updateData.contentTypeId = input.contentTypeId;

        const [updated] = await tx.update(contentItems)
            .set(updateData)
            .where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId)))
            .returning();

        return updated;
    });

    if (result) {
        await logAudit(domainId, 'update', 'content_item', result.id, input as Record<string, unknown>);
    }
    return result;
}

export async function deleteContentItem(id: number, domainId: number) {
    const [deleted] = await db.delete(contentItems)
        .where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId)))
        .returning();

    if (deleted) {
        await logAudit(domainId, 'delete', 'content_item', deleted.id, deleted as unknown as Record<string, unknown>);
    }
    return deleted ?? null;
}

// --- Versioning ---

export async function getContentItemVersions(itemId: number) {
    return db.select()
        .from(contentItemVersions)
        .where(eq(contentItemVersions.contentItemId, itemId))
        .orderBy(desc(contentItemVersions.version));
}

/**
 * Rollback a content item to a previous version.
 * Throws 'TARGET_VERSION_NOT_FOUND' if the target version doesn't exist.
 * Returns null if the content item doesn't exist.
 */
export async function rollbackContentItem(id: number, domainId: number, targetVersion: number) {
    const result = await db.transaction(async (tx) => {
        const [currentItem] = await tx.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId)));
        if (!currentItem) return null;

        const [target] = await tx.select()
            .from(contentItemVersions)
            .where(and(
                eq(contentItemVersions.contentItemId, id),
                eq(contentItemVersions.version, targetVersion),
            ));

        if (!target) throw new Error('TARGET_VERSION_NOT_FOUND');

        // Archive current state
        await tx.insert(contentItemVersions).values({
            contentItemId: currentItem.id,
            version: currentItem.version,
            data: currentItem.data,
            status: currentItem.status,
            createdAt: currentItem.updatedAt,
        });

        // Restore target version data with incremented version number
        const [restored] = await tx.update(contentItems)
            .set({
                data: target.data,
                status: target.status,
                version: currentItem.version + 1,
                updatedAt: new Date(),
            })
            .where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId)))
            .returning();

        return restored;
    });

    if (result) {
        await logAudit(domainId, 'rollback', 'content_item', result.id, {
            fromVersion: result.version - 1,
            toVersion: targetVersion,
        });
    }
    return result;
}
