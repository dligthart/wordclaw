import { db } from '../db/index.js';
import { contentItems, contentItemVersions, contentTypes } from '../db/schema.js';
import { and, asc, desc, eq, gte, ilike, lt, lte, ne, or, sql } from 'drizzle-orm';
import { logAudit } from './audit.js';
import {
    getContentLifecycleSchemaConfig,
    listQueryableContentFields,
    type QueryableContentFieldType,
    redactPremiumFields
} from './content-schema.js';
import { archiveExpiredContentItemsForSchema, ensureContentItemLifecycleState } from './content-lifecycle.js';

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
    fieldName?: string;
    fieldOp?: 'eq' | 'contains' | 'gte' | 'lte';
    fieldValue?: string;
    sortField?: string;
    sortBy?: 'updatedAt' | 'createdAt' | 'version';
    sortDir?: 'asc' | 'desc';
    includeArchived?: boolean;
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

export type ContentProjectionMetric = 'count' | 'sum' | 'avg' | 'min' | 'max';
export type ContentProjectionOrderBy = 'value' | 'group';

export type ProjectContentItemsInput = {
    contentTypeId: number;
    status?: string;
    createdAfter?: Date | null;
    createdBefore?: Date | null;
    fieldName?: string;
    fieldOp?: 'eq' | 'contains' | 'gte' | 'lte';
    fieldValue?: string;
    groupBy: string;
    metric?: ContentProjectionMetric;
    metricField?: string;
    orderBy?: ContentProjectionOrderBy;
    orderDir?: 'asc' | 'desc';
    includeArchived?: boolean;
    limit?: number;
};

export type ContentProjectionBucket = {
    group: string | number | boolean | null;
    value: number;
    count: number;
};

export type ProjectContentItemsResult = {
    buckets: ContentProjectionBucket[];
    contentTypeId: number;
    groupBy: string;
    metric: ContentProjectionMetric;
    metricField: string | null;
    orderBy: ContentProjectionOrderBy;
    orderDir: 'asc' | 'desc';
    limit: number;
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

export class ContentItemProjectionError extends Error {
    code: string;
    remediation: string;

    constructor(message: string, code: string, remediation: string) {
        super(message);
        this.name = 'ContentItemProjectionError';
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

function normalizeQueryableFieldMap(schemaText: string): Map<string, QueryableContentFieldType> {
    return new Map(listQueryableContentFields(schemaText).map((field) => [field.name, field.type]));
}

function parseBooleanFieldValue(value: string): boolean | null {
    if (value === 'true') {
        return true;
    }

    if (value === 'false') {
        return false;
    }

    return null;
}

function getFieldTextExpression(fieldName: string) {
    return sql<string>`((${contentItems.data})::jsonb ->> ${fieldName})`;
}

function getFieldNumericExpression(fieldName: string) {
    return sql<number>`(((${contentItems.data})::jsonb ->> ${fieldName})::numeric)`;
}

function getFieldFloatExpression(fieldName: string) {
    return sql<number>`(((${contentItems.data})::jsonb ->> ${fieldName})::double precision)`;
}

function getFieldBooleanExpression(fieldName: string) {
    return sql<boolean>`(((${contentItems.data})::jsonb ->> ${fieldName})::boolean)`;
}

function buildFieldFilterCondition(fieldName: string, fieldType: QueryableContentFieldType, operator: 'eq' | 'contains' | 'gte' | 'lte', rawValue: string) {
    if (fieldType === 'string') {
        const fieldExpression = getFieldTextExpression(fieldName);
        if (operator === 'eq') {
            return sql<boolean>`${fieldExpression} = ${rawValue}`;
        }

        if (operator === 'contains') {
            return sql<boolean>`${fieldExpression} ILIKE ${`%${rawValue}%`}`;
        }

        throw new ContentItemListError(
            'Unsupported operator for string content field filter',
            'CONTENT_ITEMS_FIELD_FILTER_OPERATOR_UNSUPPORTED',
            'Use eq or contains when filtering string content fields.'
        );
    }

    if (fieldType === 'number') {
        const parsedNumber = Number(rawValue);
        if (!Number.isFinite(parsedNumber)) {
            throw new ContentItemListError(
                'Invalid numeric content field filter value',
                'CONTENT_ITEMS_FIELD_FILTER_VALUE_INVALID',
                'Provide a numeric fieldValue when filtering numeric content fields.'
            );
        }

        const fieldExpression = getFieldNumericExpression(fieldName);
        if (operator === 'eq') {
            return sql<boolean>`${fieldExpression} = ${parsedNumber}`;
        }

        if (operator === 'gte') {
            return sql<boolean>`${fieldExpression} >= ${parsedNumber}`;
        }

        if (operator === 'lte') {
            return sql<boolean>`${fieldExpression} <= ${parsedNumber}`;
        }

        throw new ContentItemListError(
            'Unsupported operator for numeric content field filter',
            'CONTENT_ITEMS_FIELD_FILTER_OPERATOR_UNSUPPORTED',
            'Use eq, gte, or lte when filtering numeric content fields.'
        );
    }

    const parsedBoolean = parseBooleanFieldValue(rawValue);
    if (parsedBoolean === null) {
        throw new ContentItemListError(
            'Invalid boolean content field filter value',
            'CONTENT_ITEMS_FIELD_FILTER_VALUE_INVALID',
            'Provide fieldValue as true or false when filtering boolean content fields.'
        );
    }

    if (operator !== 'eq') {
        throw new ContentItemListError(
            'Unsupported operator for boolean content field filter',
            'CONTENT_ITEMS_FIELD_FILTER_OPERATOR_UNSUPPORTED',
            'Use eq when filtering boolean content fields.'
        );
    }

    return sql<boolean>`${getFieldBooleanExpression(fieldName)} = ${parsedBoolean}`;
}

function buildFieldSortExpression(fieldName: string, fieldType: QueryableContentFieldType) {
    if (fieldType === 'number') {
        return getFieldNumericExpression(fieldName);
    }

    if (fieldType === 'boolean') {
        return getFieldBooleanExpression(fieldName);
    }

    return getFieldTextExpression(fieldName);
}

function buildProjectionGroupExpression(fieldName: string, fieldType: QueryableContentFieldType) {
    if (fieldType === 'number') {
        return getFieldFloatExpression(fieldName);
    }

    if (fieldType === 'boolean') {
        return getFieldBooleanExpression(fieldName);
    }

    return getFieldTextExpression(fieldName);
}

function buildProjectionMetricExpression(metric: ContentProjectionMetric, metricField?: string) {
    if (metric === 'count') {
        return sql<number>`count(*)::int`;
    }

    const numericFieldExpression = getFieldFloatExpression(metricField!);
    if (metric === 'sum') {
        return sql<number>`coalesce(sum(${numericFieldExpression}), 0)::double precision`;
    }

    if (metric === 'avg') {
        return sql<number>`coalesce(avg(${numericFieldExpression}), 0)::double precision`;
    }

    if (metric === 'min') {
        return sql<number>`coalesce(min(${numericFieldExpression}), 0)::double precision`;
    }

    return sql<number>`coalesce(max(${numericFieldExpression}), 0)::double precision`;
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
        fieldName,
        fieldOp,
        fieldValue,
        sortField,
        sortBy,
        sortDir,
        includeArchived = false,
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

    if (cursor && ((sortBy && sortBy !== 'createdAt') || (sortDir && sortDir !== 'desc') || sortField)) {
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

    if ((fieldName && fieldValue === undefined) || (fieldValue !== undefined && !fieldName)) {
        throw new ContentItemListError(
            'Content field filtering requires both fieldName and fieldValue',
            'CONTENT_ITEMS_FIELD_FILTER_INCOMPLETE',
            'Provide both fieldName and fieldValue when filtering content items by content data.'
        );
    }

    if ((fieldName || sortField) && contentTypeId === undefined) {
        throw new ContentItemListError(
            'Content field queries require contentTypeId',
            'CONTENT_ITEMS_FIELD_QUERY_REQUIRES_CONTENT_TYPE',
            'Provide contentTypeId when filtering or sorting by content schema fields.'
        );
    }

    const searchQuery = q?.trim();
    const searchPattern = searchQuery ? `%${searchQuery}%` : null;

    let queryableFields = new Map<string, QueryableContentFieldType>();
    let lifecycleArchiveStatus: string | null = null;
    if (contentTypeId !== undefined) {
        const [contentType] = await db.select({
            schema: contentTypes.schema
        })
            .from(contentTypes)
            .where(and(eq(contentTypes.domainId, domainId), eq(contentTypes.id, contentTypeId)));

        if (!contentType && (fieldName || sortField)) {
            throw new ContentItemListError(
                'Content type not found for field-aware query',
                'CONTENT_ITEMS_FIELD_QUERY_CONTENT_TYPE_NOT_FOUND',
                'Use a valid contentTypeId from the current domain when filtering or sorting by schema fields.'
            );
        }

        if (contentType) {
            queryableFields = normalizeQueryableFieldMap(contentType.schema);
            const lifecycleConfig = getContentLifecycleSchemaConfig(contentType.schema);
            if (lifecycleConfig) {
                await archiveExpiredContentItemsForSchema(domainId, contentTypeId, contentType.schema);
                lifecycleArchiveStatus = lifecycleConfig.archiveStatus;
            }
        }
    }

    const normalizedFieldOp = fieldOp ?? 'eq';
    if (fieldName && !queryableFields.has(fieldName)) {
        throw new ContentItemListError(
            'Unknown or unsupported content field filter',
            'CONTENT_ITEMS_FIELD_FILTER_FIELD_UNKNOWN',
            'Use a top-level scalar field defined by the selected content type schema.'
        );
    }

    if (sortField && !queryableFields.has(sortField)) {
        throw new ContentItemListError(
            'Unknown or unsupported content field sort',
            'CONTENT_ITEMS_FIELD_SORT_FIELD_UNKNOWN',
            'Use a top-level scalar field defined by the selected content type schema when sorting by content data.'
        );
    }

    const fieldCondition = fieldName && fieldValue !== undefined
        ? buildFieldFilterCondition(fieldName, queryableFields.get(fieldName)!, normalizedFieldOp, fieldValue)
        : undefined;

    const baseConditions = [
        eq(contentItems.domainId, domainId),
        contentTypeId !== undefined ? eq(contentItems.contentTypeId, contentTypeId) : undefined,
        status ? eq(contentItems.status, status) : undefined,
        !status && !includeArchived && lifecycleArchiveStatus ? ne(contentItems.status, lifecycleArchiveStatus) : undefined,
        searchPattern
            ? or(
                ilike(contentItems.data, searchPattern),
                ilike(contentItems.status, searchPattern),
                sql<boolean>`CAST(${contentItems.id} AS TEXT) ILIKE ${searchPattern}`
            )
            : undefined,
        createdAfter ? gte(contentItems.createdAt, createdAfter) : undefined,
        createdBefore ? lte(contentItems.createdAt, createdBefore) : undefined,
        fieldCondition,
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
                        sortField
                            ? buildFieldSortExpression(sortField, queryableFields.get(sortField)!)
                            : sortBy === 'createdAt'
                                ? contentItems.createdAt
                                : sortBy === 'version'
                                    ? contentItems.version
                                    : contentItems.updatedAt
                    )
                    : desc(
                        sortField
                            ? buildFieldSortExpression(sortField, queryableFields.get(sortField)!)
                            : sortBy === 'createdAt'
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

export async function projectContentItems(domainId: number, input: ProjectContentItemsInput): Promise<ProjectContentItemsResult> {
    const {
        contentTypeId,
        status,
        createdAfter,
        createdBefore,
        fieldName,
        fieldOp,
        fieldValue,
        groupBy,
        metric = 'count',
        metricField,
        orderBy = 'value',
        orderDir = 'desc',
        includeArchived = false,
        limit = 50
    } = input;

    if (!contentTypeId) {
        throw new ContentItemProjectionError(
            'Content projections require contentTypeId',
            'CONTENT_ITEMS_PROJECTION_REQUIRES_CONTENT_TYPE',
            'Provide contentTypeId when building grouped content projections.'
        );
    }

    if ((fieldName && fieldValue === undefined) || (fieldValue !== undefined && !fieldName)) {
        throw new ContentItemProjectionError(
            'Content projection filtering requires both fieldName and fieldValue',
            'CONTENT_ITEMS_PROJECTION_FILTER_INCOMPLETE',
            'Provide both fieldName and fieldValue when filtering projected content groups.'
        );
    }

    const [contentType] = await db.select({
        schema: contentTypes.schema
    })
        .from(contentTypes)
        .where(and(eq(contentTypes.domainId, domainId), eq(contentTypes.id, contentTypeId)));

    if (!contentType) {
        throw new ContentItemProjectionError(
            'Content type not found for projection query',
            'CONTENT_ITEMS_PROJECTION_CONTENT_TYPE_NOT_FOUND',
            'Use a valid contentTypeId from the current domain when building content projections.'
        );
    }

    const queryableFields = normalizeQueryableFieldMap(contentType.schema);
    const lifecycleConfig = getContentLifecycleSchemaConfig(contentType.schema);
    if (lifecycleConfig) {
        await archiveExpiredContentItemsForSchema(domainId, contentTypeId, contentType.schema);
    }

    if (!queryableFields.has(groupBy)) {
        throw new ContentItemProjectionError(
            'Unknown or unsupported projection group field',
            'CONTENT_ITEMS_PROJECTION_GROUP_FIELD_UNKNOWN',
            'Use a top-level scalar field defined by the selected content type schema for groupBy.'
        );
    }

    const normalizedFieldOp = fieldOp ?? 'eq';
    if (fieldName && !queryableFields.has(fieldName)) {
        throw new ContentItemProjectionError(
            'Unknown or unsupported projection filter field',
            'CONTENT_ITEMS_PROJECTION_FILTER_FIELD_UNKNOWN',
            'Use a top-level scalar field defined by the selected content type schema for field-aware projection filters.'
        );
    }

    if (metric !== 'count' && !metricField) {
        throw new ContentItemProjectionError(
            'Numeric projection metrics require metricField',
            'CONTENT_ITEMS_PROJECTION_METRIC_FIELD_REQUIRED',
            'Provide metricField when using sum, avg, min, or max projection metrics.'
        );
    }

    if (metricField && !queryableFields.has(metricField)) {
        throw new ContentItemProjectionError(
            'Unknown or unsupported projection metric field',
            'CONTENT_ITEMS_PROJECTION_METRIC_FIELD_UNKNOWN',
            'Use a top-level scalar field defined by the selected content type schema for metricField.'
        );
    }

    if (metricField && queryableFields.get(metricField) !== 'number' && metric !== 'count') {
        throw new ContentItemProjectionError(
            'Projection metric field must be numeric',
            'CONTENT_ITEMS_PROJECTION_METRIC_FIELD_NOT_NUMERIC',
            'Use a numeric top-level scalar field for sum, avg, min, or max projections.'
        );
    }

    const fieldCondition = fieldName && fieldValue !== undefined
        ? buildFieldFilterCondition(fieldName, queryableFields.get(fieldName)!, normalizedFieldOp, fieldValue)
        : undefined;

    const whereConditions = [
        eq(contentItems.domainId, domainId),
        eq(contentItems.contentTypeId, contentTypeId),
        status ? eq(contentItems.status, status) : undefined,
        !status && !includeArchived && lifecycleConfig ? ne(contentItems.status, lifecycleConfig.archiveStatus) : undefined,
        createdAfter ? gte(contentItems.createdAt, createdAfter) : undefined,
        createdBefore ? lte(contentItems.createdAt, createdBefore) : undefined,
        fieldCondition
    ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;
    const groupExpression = buildProjectionGroupExpression(groupBy, queryableFields.get(groupBy)!);
    const countExpression = sql<number>`count(*)::int`;
    const valueExpression = buildProjectionMetricExpression(metric, metricField);
    const normalizedLimit = Math.max(1, Math.min(limit, 500));

    const orderExpression = orderBy === 'group' ? groupExpression : valueExpression;
    const buckets = await db.select({
        group: groupExpression,
        value: valueExpression,
        count: countExpression
    })
        .from(contentItems)
        .where(whereClause)
        .groupBy(groupExpression)
        .orderBy(
            orderDir === 'asc' ? asc(orderExpression) : desc(orderExpression),
            asc(groupExpression)
        )
        .limit(normalizedLimit);

    return {
        buckets,
        contentTypeId,
        groupBy,
        metric,
        metricField: metricField ?? null,
        orderBy,
        orderDir,
        limit: normalizedLimit
    };
}

export async function getContentItem(id: number, domainId: number) {
    const [row] = await db.select({
        item: contentItems,
        schema: contentTypes.schema
    })
        .from(contentItems)
        .innerJoin(contentTypes, eq(contentItems.contentTypeId, contentTypes.id))
        .where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId)));

    if (!row) {
        return null;
    }

    return ensureContentItemLifecycleState(row.item, row.schema);
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
