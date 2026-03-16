import { and, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import { assets, contentItems, contentItemVersions, contentTypes } from '../db/schema.js';
import { logAudit } from './audit.js';
import { getAssetStorageProvider } from './asset-storage.js';
import type { AuditActor } from './actor-identity.js';
import { extractAssetReferencesFromContent } from './content-schema.js';

export type AssetAccessMode = 'public' | 'signed' | 'entitled';
export type AssetStatus = 'active' | 'deleted';
export type AssetEntitlementScopeType = 'item' | 'type' | 'subscription';
export type AssetEntitlementScope = {
    type: AssetEntitlementScopeType;
    ref?: number | null;
};

export type CreateAssetInput = {
    domainId: number;
    filename: string;
    originalFilename?: string;
    mimeType: string;
    contentBase64?: string;
    contentBytes?: Buffer;
    accessMode?: AssetAccessMode;
    entitlementScope?: AssetEntitlementScope;
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
    context?: Record<string, unknown>;

    constructor(message: string, code: string, remediation: string, context?: Record<string, unknown>) {
        super(message);
        this.name = 'AssetListError';
        this.code = code;
        this.remediation = remediation;
        this.context = context;
    }
}

export type AssetReferenceUsage = {
    contentItemId: number;
    contentTypeId: number;
    contentTypeName: string;
    contentTypeSlug: string;
    path: string;
    version: number;
    status?: string;
    contentItemVersionId?: number;
};

export type AssetUsageSummary = {
    activeReferences: AssetReferenceUsage[];
    historicalReferences: AssetReferenceUsage[];
};

function isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

async function normalizeEntitlementScope(
    domainId: number,
    accessMode: AssetAccessMode,
    entitlementScope?: AssetEntitlementScope
): Promise<{ type: AssetEntitlementScopeType | null; ref: number | null }> {
    if (accessMode !== 'entitled') {
        if (entitlementScope) {
            throw new AssetListError(
                'Entitlement scope is only valid for entitled assets',
                'ASSET_ENTITLEMENT_SCOPE_UNEXPECTED',
                'Remove entitlementScope or switch accessMode to "entitled".'
            );
        }

        return { type: null, ref: null };
    }

    if (!entitlementScope) {
        throw new AssetListError(
            'Entitlement scope is required for entitled assets',
            'ASSET_ENTITLEMENT_SCOPE_REQUIRED',
            'Provide entitlementScope with type "item", "type", or "subscription".'
        );
    }

    if (entitlementScope.type === 'subscription') {
        if (entitlementScope.ref !== undefined && entitlementScope.ref !== null) {
            throw new AssetListError(
                'Subscription-scoped entitled assets cannot include a reference ID',
                'ASSET_ENTITLEMENT_SCOPE_INVALID',
                'Omit entitlementScope.ref when entitlementScope.type is "subscription".'
            );
        }

        return { type: 'subscription', ref: null };
    }

    if (entitlementScope.type !== 'item' && entitlementScope.type !== 'type') {
        throw new AssetListError(
            'Invalid entitlement scope type',
            'ASSET_ENTITLEMENT_SCOPE_INVALID',
            'Use entitlementScope.type of "item", "type", or "subscription".'
        );
    }

    if (!isPositiveInteger(entitlementScope.ref)) {
        throw new AssetListError(
            'Entitlement scope reference must be a positive integer',
            'ASSET_ENTITLEMENT_SCOPE_INVALID',
            `Provide entitlementScope.ref as a positive integer when entitlementScope.type is "${entitlementScope.type}".`
        );
    }

    if (entitlementScope.type === 'item') {
        const [item] = await db.select({ id: contentItems.id }).from(contentItems).where(and(
            eq(contentItems.id, entitlementScope.ref),
            eq(contentItems.domainId, domainId)
        ));

        if (!item) {
            throw new AssetListError(
                'Entitlement content item not found',
                'ASSET_ENTITLEMENT_SCOPE_TARGET_NOT_FOUND',
                'Provide an entitlementScope.ref that points to a content item in the current domain.'
            );
        }
    } else {
        const [contentType] = await db.select({ id: contentTypes.id }).from(contentTypes).where(and(
            eq(contentTypes.id, entitlementScope.ref),
            eq(contentTypes.domainId, domainId)
        ));

        if (!contentType) {
            throw new AssetListError(
                'Entitlement content type not found',
                'ASSET_ENTITLEMENT_SCOPE_TARGET_NOT_FOUND',
                'Provide an entitlementScope.ref that points to a content type in the current domain.'
            );
        }
    }

    return {
        type: entitlementScope.type,
        ref: entitlementScope.ref
    };
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

export function resolveAssetContentBytes(input: Pick<CreateAssetInput, 'contentBase64' | 'contentBytes'>): Buffer {
    const hasBase64 = typeof input.contentBase64 === 'string' && input.contentBase64.trim().length > 0;
    const contentBytes = Buffer.isBuffer(input.contentBytes) ? input.contentBytes : null;
    const hasBytes = contentBytes !== null;

    if (hasBase64 && hasBytes) {
        throw new AssetListError(
            'Provide either raw asset bytes or base64 asset content, not both',
            'ASSET_CONTENT_CONFLICT',
            'Send multipart file bytes or contentBase64 in JSON, but not both in the same request.'
        );
    }

    if (hasBytes) {
        if (contentBytes.byteLength === 0) {
            throw new AssetListError(
                'Empty asset content',
                'EMPTY_ASSET_CONTENT',
                'Provide non-empty asset bytes.'
            );
        }

        return contentBytes;
    }

    if (hasBase64) {
        return decodeAssetContentBase64(input.contentBase64!);
    }

    throw new AssetListError(
        'Asset content is required',
        'ASSET_CONTENT_REQUIRED',
        'Provide contentBase64 in JSON uploads or attach a file in multipart uploads.'
    );
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
    const accessMode = input.accessMode || 'public';
    const entitlementScope = await normalizeEntitlementScope(input.domainId, accessMode, input.entitlementScope);
    const bytes = resolveAssetContentBytes(input);
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
            accessMode,
            entitlementScopeType: entitlementScope.type,
            entitlementScopeRef: entitlementScope.ref,
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
                accessMode: created.accessMode,
                entitlementScopeType: created.entitlementScopeType,
                entitlementScopeRef: created.entitlementScopeRef
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

export function getAssetEntitlementScope(asset: {
    accessMode: string;
    entitlementScopeType: string | null;
    entitlementScopeRef: number | null;
}): AssetEntitlementScope | null {
    if (asset.accessMode !== 'entitled' || !asset.entitlementScopeType) {
        return null;
    }

    if (asset.entitlementScopeType === 'subscription') {
        return { type: 'subscription', ref: null };
    }

    if ((asset.entitlementScopeType === 'item' || asset.entitlementScopeType === 'type')
        && isPositiveInteger(asset.entitlementScopeRef)) {
        return {
            type: asset.entitlementScopeType,
            ref: asset.entitlementScopeRef
        };
    }

    return null;
}

export async function readAssetContent(asset: {
    storageKey: string;
    storageProvider: string;
}) {
    return getAssetStorageProvider(asset.storageProvider).read(asset.storageKey);
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

export async function restoreAsset(id: number, domainId: number, actor?: AuditActor) {
    const existing = await getAsset(id, domainId, { includeDeleted: true });
    if (!existing) {
        return null;
    }

    if (existing.status !== 'deleted') {
        throw new AssetListError(
            'Asset is not deleted',
            'ASSET_RESTORE_NOT_DELETED',
            'Soft-delete the asset before attempting to restore it.'
        );
    }

    const [restored] = await db.update(assets).set({
        status: 'active',
        deletedAt: null,
        updatedAt: new Date()
    }).where(and(
        eq(assets.id, id),
        eq(assets.domainId, domainId),
        eq(assets.status, 'deleted')
    )).returning();

    if (!restored) {
        return null;
    }

    await logAudit(
        domainId,
        'restore',
        'asset',
        restored.id,
        {
            filename: restored.filename,
            accessMode: restored.accessMode
        },
        actor
    );

    return restored;
}

export async function findAssetUsage(domainId: number, assetId: number): Promise<AssetUsageSummary> {
    const candidateTypes = await db.select({
        id: contentTypes.id,
        name: contentTypes.name,
        slug: contentTypes.slug,
        schema: contentTypes.schema
    })
        .from(contentTypes)
        .where(and(
            eq(contentTypes.domainId, domainId),
            sql<boolean>`${contentTypes.schema} like '%x-wordclaw-field-kind%'`
        ));

    if (candidateTypes.length === 0) {
        return {
            activeReferences: [],
            historicalReferences: []
        };
    }

    const schemaByTypeId = new Map(candidateTypes.map((contentType) => [contentType.id, contentType]));
    const contentTypeIds = candidateTypes.map((contentType) => contentType.id);

    const currentRows = await db.select({
        contentItemId: contentItems.id,
        contentTypeId: contentItems.contentTypeId,
        status: contentItems.status,
        version: contentItems.version,
        data: contentItems.data
    })
        .from(contentItems)
        .where(and(
            eq(contentItems.domainId, domainId),
            inArray(contentItems.contentTypeId, contentTypeIds)
        ));

    const historicalRows = await db.select({
        contentItemVersionId: contentItemVersions.id,
        contentItemId: contentItemVersions.contentItemId,
        version: contentItemVersions.version,
        data: contentItemVersions.data,
        contentTypeId: contentItems.contentTypeId
    })
        .from(contentItemVersions)
        .innerJoin(contentItems, eq(contentItemVersions.contentItemId, contentItems.id))
        .where(and(
            eq(contentItems.domainId, domainId),
            inArray(contentItems.contentTypeId, contentTypeIds)
        ));

    const activeReferences = currentRows.flatMap((row) => {
        const contentType = schemaByTypeId.get(row.contentTypeId);
        if (!contentType) {
            return [];
        }

        return extractAssetReferencesFromContent(contentType.schema, row.data)
            .filter((reference) => reference.assetId === assetId)
            .map((reference) => ({
                contentItemId: row.contentItemId,
                contentTypeId: row.contentTypeId,
                contentTypeName: contentType.name,
                contentTypeSlug: contentType.slug,
                path: reference.path,
                version: row.version,
                status: row.status
            }));
    });

    const historicalReferences = historicalRows.flatMap((row) => {
        const contentType = schemaByTypeId.get(row.contentTypeId);
        if (!contentType) {
            return [];
        }

        return extractAssetReferencesFromContent(contentType.schema, row.data)
            .filter((reference) => reference.assetId === assetId)
            .map((reference) => ({
                contentItemId: row.contentItemId,
                contentItemVersionId: row.contentItemVersionId,
                contentTypeId: row.contentTypeId,
                contentTypeName: contentType.name,
                contentTypeSlug: contentType.slug,
                path: reference.path,
                version: row.version
            }));
    });

    return {
        activeReferences,
        historicalReferences
    };
}

export async function purgeAsset(id: number, domainId: number, actor?: AuditActor) {
    const existing = await getAsset(id, domainId, { includeDeleted: true });
    if (!existing) {
        return null;
    }

    if (existing.status !== 'deleted') {
        throw new AssetListError(
            'Asset must be soft-deleted before purge',
            'ASSET_PURGE_REQUIRES_SOFT_DELETE',
            'Call DELETE /api/assets/:id first, then retry the purge.'
        );
    }

    const usage = await findAssetUsage(domainId, id);
    if (usage.activeReferences.length > 0 || usage.historicalReferences.length > 0) {
        throw new AssetListError(
            'Asset purge blocked by retained references',
            'ASSET_PURGE_BLOCKED',
            'Remove or archive current and historical content references before purging this asset.',
            {
                activeReferences: usage.activeReferences,
                historicalReferences: usage.historicalReferences
            }
        );
    }

    const storage = getAssetStorageProvider(existing.storageProvider);
    await storage.remove(existing.storageKey);

    const [purged] = await db.delete(assets).where(and(
        eq(assets.id, id),
        eq(assets.domainId, domainId),
        eq(assets.status, 'deleted')
    )).returning();

    if (!purged) {
        return null;
    }

    await logAudit(
        domainId,
        'purge',
        'asset',
        existing.id,
        {
            filename: existing.filename,
            accessMode: existing.accessMode,
            storageKey: existing.storageKey
        },
        actor
    );

    return {
        asset: existing,
        usage
    };
}
