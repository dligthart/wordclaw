import { and, eq, lte, ne } from 'drizzle-orm';

import { db } from '../db/index.js';
import { contentItems, contentItemVersions } from '../db/schema.js';
import { logAudit } from './audit.js';
import { getContentLifecycleSchemaConfig, type ContentLifecycleSchemaConfig } from './content-schema.js';

type ContentItemRow = typeof contentItems.$inferSelect;

function getLifecycleReferenceTime(item: ContentItemRow, config: ContentLifecycleSchemaConfig) {
    return config.clock === 'createdAt' ? item.createdAt : item.updatedAt;
}

export function isContentItemLifecycleExpired(
    item: ContentItemRow,
    config: ContentLifecycleSchemaConfig,
    now = new Date(),
) {
    return getLifecycleReferenceTime(item, config).getTime() + (config.ttlSeconds * 1000) <= now.getTime();
}

async function archiveContentItemForLifecycle(
    item: ContentItemRow,
    config: ContentLifecycleSchemaConfig,
    archivedAt: Date,
) {
    const result = await db.transaction(async (tx) => {
        await tx.insert(contentItemVersions).values({
            contentItemId: item.id,
            version: item.version,
            data: item.data,
            status: item.status,
            createdAt: item.updatedAt,
        });

        const [updated] = await tx.update(contentItems)
            .set({
                status: config.archiveStatus,
                version: item.version + 1,
                updatedAt: archivedAt,
            })
            .where(and(
                eq(contentItems.id, item.id),
                eq(contentItems.domainId, item.domainId),
            ))
            .returning();

        return updated ?? null;
    });

    if (result) {
        await logAudit(item.domainId, 'update', 'content_item', result.id, {
            lifecycleAutoArchived: true,
            archiveStatus: config.archiveStatus,
            ttlSeconds: config.ttlSeconds,
            clock: config.clock,
        });
    }

    return result;
}

export async function archiveExpiredContentItemsForSchema(
    domainId: number,
    contentTypeId: number,
    schemaText: string,
    now = new Date(),
) {
    const config = getContentLifecycleSchemaConfig(schemaText);
    if (!config) {
        return 0;
    }

    const cutoff = new Date(now.getTime() - (config.ttlSeconds * 1000));
    const timeColumn = config.clock === 'createdAt' ? contentItems.createdAt : contentItems.updatedAt;
    const expiredItems = await db.select()
        .from(contentItems)
        .where(and(
            eq(contentItems.domainId, domainId),
            eq(contentItems.contentTypeId, contentTypeId),
            ne(contentItems.status, config.archiveStatus),
            lte(timeColumn, cutoff),
        ));

    let archivedCount = 0;
    for (const item of expiredItems) {
        const updated = await archiveContentItemForLifecycle(item, config, now);
        if (updated) {
            archivedCount += 1;
        }
    }

    return archivedCount;
}

export async function ensureContentItemLifecycleState(
    item: ContentItemRow,
    schemaText: string,
    now = new Date(),
) {
    const config = getContentLifecycleSchemaConfig(schemaText);
    if (!config || item.status === config.archiveStatus || !isContentItemLifecycleExpired(item, config, now)) {
        return item;
    }

    return (await archiveContentItemForLifecycle(item, config, now)) ?? item;
}
