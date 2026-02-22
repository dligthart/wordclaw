import { db } from '../db/index.js';
import { contentItems, contentItemVersions } from '../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { logAudit } from './audit.js';

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

export async function listContentItems(domainId: number, contentTypeId?: number) {
    if (contentTypeId) {
        return db.select().from(contentItems).where(and(eq(contentItems.domainId, domainId), eq(contentItems.contentTypeId, contentTypeId)));
    }
    return db.select().from(contentItems).where(eq(contentItems.domainId, domainId));
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
