import { and, desc, eq, ilike, lt, or, sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import { assets } from '../db/schema.js';
import { logAudit } from './audit.js';
import { getAssetStorageProvider } from './asset-storage.js';
import type { AuditActor } from './actor-identity.js';

export type AssetAccessMode = 'public' | 'signed';
export type AssetStatus = 'active' | 'deleted';

export type CreateAssetInput = {
    domainId: number;
    filename: string;
    originalFilename?: string;
    mimeType: string;
    contentBase64: string;
    accessMode?: AssetAccessMode;
    metadata?: Record<string, unknown>;
    actor?: AuditActor;
};

export type ListAssetsInput = {
    q?: string;
    accessMode?: AssetAccessMode;
    status?: AssetStatus;
    limit?: number;
    offset?: number;
    cursor?: string;
};

export type AssetCursor = {
    createdAt: Date;
    id: number;
};

export type ListAssetsResult = {
    items: Array<typeof assets.$inferSelect>;
    total: number;
    limit: number;
    offset?: number;
    hasMore: boolean;
    nextCursor: string | null;
};

export class AssetListError extends Error {
    code: string;
    remediation: string;

    constructor(message: string, code: string, remediation: string) {
        super(message);
        this.name = 'AssetListError';
        this.code = code;
        this.remediation = remediation;
    }
}

function normalizeBase64(raw: string): string {
    return raw.replace(/\s+/g, '');
}

export function decodeAssetContentBase64(contentBase64: string): Buffer {
    const normalized = normalizeBase64(contentBase64);
    if (!normalized || normalized.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(normalized)) {
        throw new AssetListError(
            'Invalid base64 asset content',
            'INVALID_ASSET_CONTENT_BASE64',
            'Provide contentBase64 as a valid base64-encoded string.'
        );
    }

    const bytes = Buffer.from(normalized, 'base64');
    if (bytes.length === 0) {
        throw new AssetListError(
            'Empty asset content',
            'EMPTY_ASSET_CONTENT',
            'Provide non-empty base64-encoded asset content.'
        );
    }

    return bytes;
}

export function encodeAssetsCursor(createdAt: Date, id: number): string {
    return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id }), 'utf8').toString('base64url');
}

export function decodeAssetsCursor(cursor: string): AssetCursor | null {
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

export async function createAsset(input: CreateAssetInput) {
    const bytes = decodeAssetContentBase64(input.contentBase64);
    const storage = getAssetStorageProvider();
    const stored = await storage.put(input.domainId, input.filename, bytes);

    try {
        const [created] = await db.insert(assets).values({
            domainId: input.domainId,
            filename: input.filename,
            originalFilename: input.originalFilename || input.filename,
            mimeType: input.mimeType,
            sizeBytes: stored.sizeBytes,
            byteHash: stored.byteHash,
            storageProvider: stored.provider,
            storageKey: stored.storageKey,
            accessMode: input.accessMode || 'public',
            status: 'active',
            metadata: input.metadata || {},
            uploaderActorId: input.actor?.actorId ?? null,
            uploaderActorType: input.actor?.actorType ?? null,
            uploaderActorSource: input.actor?.actorSource ?? null,
        }).returning();

        await logAudit(
            input.domainId,
            'create',
            'asset',
            created.id,
            {
                filename: created.filename,
                mimeType: created.mimeType,
                sizeBytes: created.sizeBytes,
                accessMode: created.accessMode
            },
            input.actor
        );

        return created;
    } catch (error) {
        await storage.remove(stored.storageKey).catch(() => undefined);
        throw error;
    }
}

export async function listAssets(domainId: number, input: ListAssetsInput = {}): Promise<ListAssetsResult> {
    const {
        q,
        accessMode,
        status = 'active',
        limit = 50,
        offset,
        cursor
    } = input;

    if (cursor && offset !== undefined) {
        throw new AssetListError(
            'Cursor and offset pagination cannot be combined',
            'ASSETS_CURSOR_OFFSET_CONFLICT',
            'Provide either cursor or offset when listing assets, not both.'
        );
    }

    const decodedCursor = cursor ? decodeAssetsCursor(cursor) : null;
    if (cursor && !decodedCursor) {
        throw new AssetListError(
            'Invalid assets cursor',
            'INVALID_ASSETS_CURSOR',
            'Provide cursor returned by the previous assets response.'
        );
    }

    const searchQuery = q?.trim();
    const searchPattern = searchQuery ? `%${searchQuery}%` : null;

    const baseConditions = [
        eq(assets.domainId, domainId),
        status ? eq(assets.status, status) : undefined,
        accessMode ? eq(assets.accessMode, accessMode) : undefined,
        searchPattern
            ? or(
                ilike(assets.filename, searchPattern),
                ilike(assets.originalFilename, searchPattern),
                ilike(assets.mimeType, searchPattern),
                sql<boolean>`CAST(${assets.id} AS TEXT) ILIKE ${searchPattern}`
            )
            : undefined
    ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

    const baseWhereClause = baseConditions.length > 0 ? and(...baseConditions) : undefined;
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
        .from(assets)
        .where(baseWhereClause);

    const cursorCondition = decodedCursor
        ? or(
            lt(assets.createdAt, decodedCursor.createdAt),
            and(eq(assets.createdAt, decodedCursor.createdAt), lt(assets.id, decodedCursor.id))
        )
        : undefined;

    const whereConditions = [
        ...baseConditions,
        cursorCondition
    ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;
    const baseQuery = db.select().from(assets).where(whereClause);
    const rawItems = cursor
        ? await baseQuery.orderBy(desc(assets.createdAt), desc(assets.id)).limit(limit + 1)
        : await baseQuery.orderBy(desc(assets.createdAt), desc(assets.id)).limit(limit).offset(offset ?? 0);

    const hasMore = cursor ? rawItems.length > limit : (offset ?? 0) + rawItems.length < total;
    const page = cursor && hasMore ? rawItems.slice(0, limit) : rawItems;
    const last = page[page.length - 1];
    const nextCursor = cursor && hasMore && last ? encodeAssetsCursor(last.createdAt, last.id) : null;

    return {
        items: page,
        total,
        limit,
        ...(cursor ? {} : { offset: offset ?? 0 }),
        hasMore,
        nextCursor
    };
}

export async function getAsset(id: number, domainId: number, options: { includeDeleted?: boolean } = {}) {
    const conditions = [
        eq(assets.id, id),
        eq(assets.domainId, domainId),
        options.includeDeleted ? undefined : eq(assets.status, 'active')
    ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

    const [asset] = await db.select().from(assets).where(and(...conditions));
    return asset ?? null;
}

export async function getPublicAsset(id: number) {
    const [asset] = await db.select().from(assets).where(and(
        eq(assets.id, id),
        eq(assets.status, 'active'),
        eq(assets.accessMode, 'public')
    ));

    return asset ?? null;
}

export async function readAssetContent(storageKey: string) {
    return getAssetStorageProvider().read(storageKey);
}

export async function softDeleteAsset(id: number, domainId: number, actor?: AuditActor) {
    const [deleted] = await db.update(assets).set({
        status: 'deleted',
        deletedAt: new Date(),
        updatedAt: new Date()
    }).where(and(
        eq(assets.id, id),
        eq(assets.domainId, domainId),
        eq(assets.status, 'active')
    )).returning();

    if (!deleted) {
        return null;
    }

    await logAudit(
        domainId,
        'delete',
        'asset',
        deleted.id,
        {
            filename: deleted.filename,
            accessMode: deleted.accessMode
        },
        actor
    );

    return deleted;
}
