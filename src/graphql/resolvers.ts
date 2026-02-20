import { and, desc, eq, gte, lt, lte, or } from 'drizzle-orm';
import { GraphQLError } from 'graphql';

import { db } from '../db/index.js';
import { auditLogs, contentItemVersions, contentItems, contentTypes } from '../db/schema.js';
import { logAudit } from '../services/audit.js';
import { ValidationFailure, validateContentDataAgainstSchema, validateContentTypeSchema } from '../services/content-schema.js';

const TARGET_VERSION_NOT_FOUND = 'TARGET_VERSION_NOT_FOUND';

type IdValue = string | number;

type IdArg = { id: IdValue };
type OptionalContentTypeArg = {
    contentTypeId?: IdValue;
    status?: string;
    createdAfter?: string;
    createdBefore?: string;
    limit?: number;
    offset?: number;
};
type ContentTypesArgs = {
    limit?: number;
    offset?: number;
};
type AuditLogArgs = {
    entityType?: string;
    entityId?: IdValue;
    action?: string;
    limit?: number;
    cursor?: string;
};
type CreateContentTypeArgs = {
    name: string;
    slug: string;
    description?: string;
    schema: string;
    dryRun?: boolean;
};
type UpdateContentTypeArgs = {
    id: IdValue;
    name?: string;
    slug?: string;
    description?: string;
    schema?: string;
    dryRun?: boolean;
};
type DeleteContentTypeArgs = {
    id: IdValue;
    dryRun?: boolean;
};
type CreateContentItemArgs = {
    contentTypeId: IdValue;
    data: string;
    status?: string;
    dryRun?: boolean;
};
type UpdateContentItemArgs = {
    id: IdValue;
    contentTypeId?: IdValue;
    data?: string;
    status?: string;
    dryRun?: boolean;
};
type DeleteContentItemArgs = {
    id: IdValue;
    dryRun?: boolean;
};
type RollbackContentItemArgs = {
    id: IdValue;
    version: number;
    dryRun?: boolean;
};

type BatchCreateContentItemsArgs = {
    items: Array<{
        contentTypeId: IdValue;
        data: string;
        status?: string;
    }>;
    atomic?: boolean;
    dryRun?: boolean;
};

type BatchUpdateContentItemsArgs = {
    items: Array<{
        id: IdValue;
        contentTypeId?: IdValue;
        data?: string;
        status?: string;
    }>;
    atomic?: boolean;
    dryRun?: boolean;
};

type BatchDeleteContentItemsArgs = {
    ids: IdValue[];
    atomic?: boolean;
    dryRun?: boolean;
};

type BatchResultRow = {
    index: number;
    ok: boolean;
    id?: number;
    version?: number;
    code?: string;
    error?: string;
};

type ContentItemUpdateInput = {
    contentTypeId?: number;
    data?: string;
    status?: string;
};

function toError(message: string, code: string, remediation: string, context?: Record<string, unknown>): GraphQLError {
    return new GraphQLError(message, {
        extensions: {
            code,
            remediation,
            ...(context ? { context } : {})
        }
    });
}

function toErrorFromValidation(failure: ValidationFailure): GraphQLError {
    return new GraphQLError(failure.error, {
        extensions: {
            code: failure.code,
            remediation: failure.remediation,
            ...(failure.context ? { context: failure.context } : {})
        }
    });
}

function parseId(id: IdValue, fieldName = 'id'): number {
    const parsed = Number.parseInt(String(id), 10);
    if (Number.isNaN(parsed)) {
        throw toError(
            `Invalid ${fieldName}`,
            'INVALID_ID',
            `Provide a numeric ${fieldName}. Received '${id}'.`
        );
    }

    return parsed;
}

function parseOptionalId(id: IdValue | undefined, fieldName: string): number | undefined {
    if (id === undefined) {
        return undefined;
    }

    return parseId(id, fieldName);
}

function clampLimit(limit: number | undefined, fallback = 50, max = 500): number {
    if (limit === undefined) {
        return fallback;
    }

    return Math.max(1, Math.min(limit, max));
}

function clampOffset(offset: number | undefined): number {
    if (offset === undefined) {
        return 0;
    }

    return Math.max(0, offset);
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined)
    ) as Partial<T>;
}

function hasDefinedValues<T extends Record<string, unknown>>(value: T): boolean {
    return Object.keys(stripUndefined(value)).length > 0;
}

function decodeCursor(cursor: string): { createdAt: Date; id: number } | null {
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

function parseDateArg(value: string | undefined, fieldName: string): Date | null {
    if (!value) {
        return null;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        const codeSuffix = fieldName.replace(/([A-Z])/g, '_$1').toUpperCase();
        throw toError(
            `Invalid ${fieldName}`,
            `INVALID_${codeSuffix}`,
            `Provide ${fieldName} as a valid ISO-8601 date-time string.`
        );
    }

    return parsed;
}

function notFoundContentTypeError(id: number): GraphQLError {
    return toError(
        'Content type not found',
        'CONTENT_TYPE_NOT_FOUND',
        `The content type with ID ${id} does not exist. Query contentTypes to find a valid ID.`
    );
}

function notFoundContentItemError(id: number): GraphQLError {
    return toError(
        'Content item not found',
        'CONTENT_ITEM_NOT_FOUND',
        `The content item with ID ${id} does not exist. Query contentItems to find a valid ID.`
    );
}

function emptyUpdateBodyError(fields: string): GraphQLError {
    return toError(
        'Empty update payload',
        'EMPTY_UPDATE_BODY',
        `Provide at least one update field: ${fields}.`
    );
}

function targetVersionNotFoundError(id: number, version: number): GraphQLError {
    return toError(
        'Target version not found',
        TARGET_VERSION_NOT_FOUND,
        `Version ${version} does not exist for content item ${id}. Query contentItemVersions(id: "${id}") first.`
    );
}

function buildBatchError(index: number, code: string, error: string): BatchResultRow {
    return { index, ok: false, code, error };
}

async function validateContentItemUpdateInput(item: {
    id: number;
    contentTypeId?: number;
    data?: string;
    status?: string;
}, index: number): Promise<{
    ok: true;
    existing: typeof contentItems.$inferSelect;
    updateData: ContentItemUpdateInput;
} | {
    ok: false;
    error: BatchResultRow;
}> {
    const updateData = stripUndefined({
        contentTypeId: item.contentTypeId,
        data: item.data,
        status: item.status
    }) as ContentItemUpdateInput;

    if (!hasDefinedValues(updateData)) {
        return {
            ok: false,
            error: buildBatchError(index, 'EMPTY_UPDATE_BODY', `No update fields provided for item ${item.id}`)
        };
    }

    const [existing] = await db.select().from(contentItems).where(eq(contentItems.id, item.id));
    if (!existing) {
        return {
            ok: false,
            error: buildBatchError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${item.id} not found`)
        };
    }

    const targetContentTypeId = updateData.contentTypeId ?? existing.contentTypeId;
    const [targetContentType] = await db.select().from(contentTypes).where(eq(contentTypes.id, targetContentTypeId));
    if (!targetContentType) {
        return {
            ok: false,
            error: buildBatchError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${targetContentTypeId} not found`)
        };
    }

    const targetData = updateData.data ?? existing.data;
    const contentValidation = validateContentDataAgainstSchema(targetContentType.schema, targetData);
    if (contentValidation) {
        return {
            ok: false,
            error: buildBatchError(index, contentValidation.code, contentValidation.error)
        };
    }

    return {
        ok: true,
        existing,
        updateData
    };
}

export const resolvers = {
    Query: {
        contentTypes: async (_parent: unknown, { limit: rawLimit, offset: rawOffset }: ContentTypesArgs) => {
            const limit = clampLimit(rawLimit);
            const offset = clampOffset(rawOffset);
            return db.select()
                .from(contentTypes)
                .limit(limit)
                .offset(offset);
        },

        contentType: async (_parent: unknown, { id }: IdArg) => {
            const numericId = parseId(id);
            const [type] = await db.select().from(contentTypes).where(eq(contentTypes.id, numericId));
            return type || null;
        },

        contentItems: async (_parent: unknown, {
            contentTypeId,
            status,
            createdAfter,
            createdBefore,
            limit: rawLimit,
            offset: rawOffset
        }: OptionalContentTypeArg) => {
            const numericTypeId = parseOptionalId(contentTypeId, 'contentTypeId');
            const afterDate = parseDateArg(createdAfter, 'createdAfter');
            const beforeDate = parseDateArg(createdBefore, 'createdBefore');
            const limit = clampLimit(rawLimit);
            const offset = clampOffset(rawOffset);

            const conditions = [
                numericTypeId !== undefined ? eq(contentItems.contentTypeId, numericTypeId) : undefined,
                status ? eq(contentItems.status, status) : undefined,
                afterDate ? gte(contentItems.createdAt, afterDate) : undefined,
                beforeDate ? lte(contentItems.createdAt, beforeDate) : undefined,
            ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

            return db.select()
                .from(contentItems)
                .where(conditions.length > 0 ? and(...conditions) : undefined)
                .limit(limit)
                .offset(offset);
        },

        contentItem: async (_parent: unknown, { id }: IdArg) => {
            const numericId = parseId(id);
            const [item] = await db.select().from(contentItems).where(eq(contentItems.id, numericId));
            return item || null;
        },

        contentItemVersions: async (_parent: unknown, { id }: IdArg) => {
            const numericId = parseId(id);
            return db.select()
                .from(contentItemVersions)
                .where(eq(contentItemVersions.contentItemId, numericId))
                .orderBy(desc(contentItemVersions.version));
        },

        auditLogs: async (_parent: unknown, { entityType, entityId, action, limit: rawLimit, cursor }: AuditLogArgs) => {
            const numericEntityId = parseOptionalId(entityId, 'entityId');
            const limit = clampLimit(rawLimit);
            const decodedCursor = cursor ? decodeCursor(cursor) : null;

            if (cursor && !decodedCursor) {
                throw toError(
                    'Invalid audit cursor',
                    'INVALID_AUDIT_CURSOR',
                    'Provide cursor returned by previous auditLogs query.'
                );
            }

            const baseConditions = [
                entityType ? eq(auditLogs.entityType, entityType) : undefined,
                numericEntityId !== undefined ? eq(auditLogs.entityId, numericEntityId) : undefined,
                action ? eq(auditLogs.action, action) : undefined,
            ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

            const cursorCondition = decodedCursor
                ? or(
                    lt(auditLogs.createdAt, decodedCursor.createdAt),
                    and(eq(auditLogs.createdAt, decodedCursor.createdAt), lt(auditLogs.id, decodedCursor.id))
                )
                : undefined;

            const conditions = [
                ...baseConditions,
                cursorCondition
            ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

            return db.select({
                id: auditLogs.id,
                action: auditLogs.action,
                entityType: auditLogs.entityType,
                entityId: auditLogs.entityId,
                details: auditLogs.details,
                createdAt: auditLogs.createdAt
            })
                .from(auditLogs)
                .where(conditions.length > 0 ? and(...conditions) : undefined)
                .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
                .limit(limit);
        }
    },

    Mutation: {
        createContentType: async (_parent: unknown, args: CreateContentTypeArgs) => {
            const now = new Date();
            const schemaFailure = validateContentTypeSchema(args.schema);
            if (schemaFailure) {
                throw toErrorFromValidation(schemaFailure);
            }

            if (args.dryRun) {
                return {
                    id: 0,
                    name: args.name,
                    slug: args.slug,
                    description: args.description,
                    schema: args.schema,
                    createdAt: now,
                    updatedAt: now
                };
            }

            const [newItem] = await db.insert(contentTypes).values({
                name: args.name,
                slug: args.slug,
                description: args.description,
                schema: args.schema
            }).returning();

            await logAudit('create', 'content_type', newItem.id, newItem);
            return newItem;
        },

        updateContentType: async (_parent: unknown, args: UpdateContentTypeArgs) => {
            const id = parseId(args.id);
            const updateData = stripUndefined({
                name: args.name,
                slug: args.slug,
                description: args.description,
                schema: args.schema
            });

            if (!hasDefinedValues(updateData)) {
                throw emptyUpdateBodyError('name, slug, description, schema');
            }

            if (typeof updateData.schema === 'string') {
                const schemaFailure = validateContentTypeSchema(updateData.schema);
                if (schemaFailure) {
                    throw toErrorFromValidation(schemaFailure);
                }
            }

            if (args.dryRun) {
                const [existing] = await db.select().from(contentTypes).where(eq(contentTypes.id, id));
                if (!existing) {
                    throw notFoundContentTypeError(id);
                }

                return { ...existing, ...updateData };
            }

            const [updated] = await db.update(contentTypes)
                .set(updateData)
                .where(eq(contentTypes.id, id))
                .returning();

            if (!updated) {
                throw notFoundContentTypeError(id);
            }

            await logAudit('update', 'content_type', updated.id, updateData);
            return updated;
        },

        deleteContentType: async (_parent: unknown, args: DeleteContentTypeArgs) => {
            const id = parseId(args.id);

            if (args.dryRun) {
                const [existing] = await db.select().from(contentTypes).where(eq(contentTypes.id, id));
                if (!existing) {
                    throw notFoundContentTypeError(id);
                }

                return {
                    id,
                    message: `[Dry Run] Content type '${existing.name}' would be deleted`
                };
            }

            const [deleted] = await db.delete(contentTypes)
                .where(eq(contentTypes.id, id))
                .returning();

            if (!deleted) {
                throw notFoundContentTypeError(id);
            }

            await logAudit('delete', 'content_type', deleted.id, deleted);

            return {
                id: deleted.id,
                message: `Content type '${deleted.name}' deleted successfully`
            };
        },

        createContentItem: async (_parent: unknown, args: CreateContentItemArgs) => {
            const contentTypeId = parseId(args.contentTypeId, 'contentTypeId');
            const status = args.status || 'draft';
            const now = new Date();
            const [contentType] = await db.select().from(contentTypes).where(eq(contentTypes.id, contentTypeId));
            if (!contentType) {
                throw notFoundContentTypeError(contentTypeId);
            }

            const contentFailure = validateContentDataAgainstSchema(contentType.schema, args.data);
            if (contentFailure) {
                throw toErrorFromValidation(contentFailure);
            }

            if (args.dryRun) {
                return {
                    id: 0,
                    contentTypeId,
                    data: args.data,
                    status,
                    version: 1,
                    createdAt: now,
                    updatedAt: now
                };
            }

            const [newItem] = await db.insert(contentItems).values({
                contentTypeId,
                data: args.data,
                status
            }).returning();

            await logAudit('create', 'content_item', newItem.id, newItem);
            return newItem;
        },

        createContentItemsBatch: async (_parent: unknown, args: BatchCreateContentItemsArgs) => {
            const isAtomic = args.atomic === true;
            if (args.items.length === 0) {
                throw toError(
                    'Batch request is empty',
                    'EMPTY_BATCH',
                    'Provide at least one item in items.'
                );
            }

            const normalizedItems = args.items.map((item) => ({
                contentTypeId: parseId(item.contentTypeId, 'contentTypeId'),
                data: item.data,
                status: item.status
            }));

            if (args.dryRun) {
                const results: BatchResultRow[] = [];
                for (const [index, item] of normalizedItems.entries()) {
                    const [contentType] = await db.select().from(contentTypes).where(eq(contentTypes.id, item.contentTypeId));
                    if (!contentType) {
                        results.push(buildBatchError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${item.contentTypeId} not found`));
                        continue;
                    }

                    const validation = validateContentDataAgainstSchema(contentType.schema, item.data);
                    if (validation) {
                        results.push(buildBatchError(index, validation.code, validation.error));
                        continue;
                    }

                    results.push({
                        index,
                        ok: true,
                        id: 0,
                        version: 1
                    });
                }

                return {
                    atomic: isAtomic,
                    results
                };
            }

            if (isAtomic) {
                try {
                    const results = await db.transaction(async (tx) => {
                        const createdRows: BatchResultRow[] = [];
                        for (const [index, item] of normalizedItems.entries()) {
                            const [contentType] = await tx.select().from(contentTypes).where(eq(contentTypes.id, item.contentTypeId));
                            if (!contentType) {
                                throw new Error(JSON.stringify(buildBatchError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${item.contentTypeId} not found`)));
                            }

                            const validation = validateContentDataAgainstSchema(contentType.schema, item.data);
                            if (validation) {
                                throw new Error(JSON.stringify(buildBatchError(index, validation.code, validation.error)));
                            }

                            const [created] = await tx.insert(contentItems).values({
                                contentTypeId: item.contentTypeId,
                                data: item.data,
                                status: item.status || 'draft'
                            }).returning();

                            createdRows.push({
                                index,
                                ok: true,
                                id: created.id,
                                version: created.version
                            });
                        }

                        return createdRows;
                    });

                    for (const row of results) {
                        if (row.id !== undefined) {
                            await logAudit('create', 'content_item', row.id, { batch: true, mode: 'atomic' });
                        }
                    }

                    return {
                        atomic: true,
                        results
                    };
                } catch (error) {
                    let context: Record<string, unknown> | undefined;
                    if (error instanceof Error) {
                        try {
                            context = JSON.parse(error.message) as Record<string, unknown>;
                        } catch {
                            context = { details: error.message };
                        }
                    }

                    throw toError(
                        'Atomic batch create failed',
                        'BATCH_ATOMIC_FAILED',
                        'Fix the failing item and retry; atomic mode rolls back all items on failure.',
                        context
                    );
                }
            }

            const results: BatchResultRow[] = [];
            for (const [index, item] of normalizedItems.entries()) {
                try {
                    const [contentType] = await db.select().from(contentTypes).where(eq(contentTypes.id, item.contentTypeId));
                    if (!contentType) {
                        results.push(buildBatchError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${item.contentTypeId} not found`));
                        continue;
                    }

                    const validation = validateContentDataAgainstSchema(contentType.schema, item.data);
                    if (validation) {
                        results.push(buildBatchError(index, validation.code, validation.error));
                        continue;
                    }

                    const [created] = await db.insert(contentItems).values({
                        contentTypeId: item.contentTypeId,
                        data: item.data,
                        status: item.status || 'draft'
                    }).returning();

                    await logAudit('create', 'content_item', created.id, { batch: true, mode: 'partial' });

                    results.push({
                        index,
                        ok: true,
                        id: created.id,
                        version: created.version
                    });
                } catch (error) {
                    results.push(buildBatchError(index, 'BATCH_ITEM_FAILED', error instanceof Error ? error.message : String(error)));
                }
            }

            return {
                atomic: false,
                results
            };
        },

        updateContentItem: async (_parent: unknown, args: UpdateContentItemArgs) => {
            const id = parseId(args.id);
            const contentTypeId = parseOptionalId(args.contentTypeId, 'contentTypeId');
            const updateData = stripUndefined({
                contentTypeId,
                data: args.data,
                status: args.status
            });

            if (!hasDefinedValues(updateData)) {
                throw emptyUpdateBodyError('contentTypeId, data, status');
            }

            const [existing] = await db.select().from(contentItems).where(eq(contentItems.id, id));
            if (!existing) {
                throw notFoundContentItemError(id);
            }

            const targetContentTypeId = typeof updateData.contentTypeId === 'number'
                ? updateData.contentTypeId
                : existing.contentTypeId;
            const [contentType] = await db.select().from(contentTypes).where(eq(contentTypes.id, targetContentTypeId));
            if (!contentType) {
                throw notFoundContentTypeError(targetContentTypeId);
            }

            const targetData = typeof updateData.data === 'string' ? updateData.data : existing.data;
            const contentFailure = validateContentDataAgainstSchema(contentType.schema, targetData);
            if (contentFailure) {
                throw toErrorFromValidation(contentFailure);
            }

            if (args.dryRun) {
                return { ...existing, ...updateData };
            }

            const result = await db.transaction(async (tx) => {
                const [current] = await tx.select().from(contentItems).where(eq(contentItems.id, id));
                if (!current) {
                    return null;
                }

                await tx.insert(contentItemVersions).values({
                    contentItemId: current.id,
                    version: current.version,
                    data: current.data,
                    status: current.status,
                    createdAt: current.updatedAt
                });

                const [updated] = await tx.update(contentItems)
                    .set({
                        ...updateData,
                        version: current.version + 1,
                        updatedAt: new Date()
                    })
                    .where(eq(contentItems.id, id))
                    .returning();

                return updated;
            });

            if (!result) {
                throw notFoundContentItemError(id);
            }

            await logAudit('update', 'content_item', result.id, updateData);
            return result;
        },

        updateContentItemsBatch: async (_parent: unknown, args: BatchUpdateContentItemsArgs) => {
            const isAtomic = args.atomic === true;
            if (args.items.length === 0) {
                throw toError(
                    'Batch request is empty',
                    'EMPTY_BATCH',
                    'Provide at least one item in items.'
                );
            }

            const normalizedItems = args.items.map((item) => ({
                id: parseId(item.id, 'id'),
                contentTypeId: item.contentTypeId !== undefined ? parseId(item.contentTypeId, 'contentTypeId') : undefined,
                data: item.data,
                status: item.status
            }));

            if (args.dryRun) {
                const results: BatchResultRow[] = [];
                for (const [index, item] of normalizedItems.entries()) {
                    const validated = await validateContentItemUpdateInput(item, index);
                    if (!validated.ok) {
                        results.push(validated.error);
                        continue;
                    }

                    results.push({
                        index,
                        ok: true,
                        id: item.id,
                        version: validated.existing.version + 1
                    });
                }

                return {
                    atomic: isAtomic,
                    results
                };
            }

            if (isAtomic) {
                try {
                    const results = await db.transaction(async (tx) => {
                        const output: BatchResultRow[] = [];
                        for (const [index, item] of normalizedItems.entries()) {
                            const updateData = stripUndefined({
                                contentTypeId: item.contentTypeId,
                                data: item.data,
                                status: item.status
                            }) as ContentItemUpdateInput;

                            if (!hasDefinedValues(updateData)) {
                                throw new Error(JSON.stringify(buildBatchError(index, 'EMPTY_UPDATE_BODY', `No update fields provided for item ${item.id}`)));
                            }

                            const [existing] = await tx.select().from(contentItems).where(eq(contentItems.id, item.id));
                            if (!existing) {
                                throw new Error(JSON.stringify(buildBatchError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${item.id} not found`)));
                            }

                            const targetContentTypeId = updateData.contentTypeId ?? existing.contentTypeId;
                            const [targetContentType] = await tx.select().from(contentTypes).where(eq(contentTypes.id, targetContentTypeId));
                            if (!targetContentType) {
                                throw new Error(JSON.stringify(buildBatchError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${targetContentTypeId} not found`)));
                            }

                            const targetData = updateData.data ?? existing.data;
                            const validation = validateContentDataAgainstSchema(targetContentType.schema, targetData);
                            if (validation) {
                                throw new Error(JSON.stringify(buildBatchError(index, validation.code, validation.error)));
                            }

                            await tx.insert(contentItemVersions).values({
                                contentItemId: existing.id,
                                version: existing.version,
                                data: existing.data,
                                status: existing.status,
                                createdAt: existing.updatedAt
                            });

                            const [updated] = await tx.update(contentItems)
                                .set({
                                    ...updateData,
                                    version: existing.version + 1,
                                    updatedAt: new Date()
                                })
                                .where(eq(contentItems.id, item.id))
                                .returning();

                            output.push({
                                index,
                                ok: true,
                                id: updated.id,
                                version: updated.version
                            });
                        }

                        return output;
                    });

                    for (const row of results) {
                        if (row.id !== undefined) {
                            await logAudit('update', 'content_item', row.id, { batch: true, mode: 'atomic' });
                        }
                    }

                    return {
                        atomic: true,
                        results
                    };
                } catch (error) {
                    let context: Record<string, unknown> | undefined;
                    if (error instanceof Error) {
                        try {
                            context = JSON.parse(error.message) as Record<string, unknown>;
                        } catch {
                            context = { details: error.message };
                        }
                    }

                    throw toError(
                        'Atomic batch update failed',
                        'BATCH_ATOMIC_FAILED',
                        'Fix the failing item and retry; atomic mode rolls back all items on failure.',
                        context
                    );
                }
            }

            const results: BatchResultRow[] = [];
            for (const [index, item] of normalizedItems.entries()) {
                const validated = await validateContentItemUpdateInput(item, index);
                if (!validated.ok) {
                    results.push(validated.error);
                    continue;
                }

                const result = await db.transaction(async (tx) => {
                    await tx.insert(contentItemVersions).values({
                        contentItemId: validated.existing.id,
                        version: validated.existing.version,
                        data: validated.existing.data,
                        status: validated.existing.status,
                        createdAt: validated.existing.updatedAt
                    });

                    const [updated] = await tx.update(contentItems)
                        .set({
                            ...validated.updateData,
                            version: validated.existing.version + 1,
                            updatedAt: new Date()
                        })
                        .where(eq(contentItems.id, validated.existing.id))
                        .returning();

                    return updated;
                });

                await logAudit('update', 'content_item', result.id, { batch: true, mode: 'partial' });

                results.push({
                    index,
                    ok: true,
                    id: result.id,
                    version: result.version
                });
            }

            return {
                atomic: false,
                results
            };
        },

        deleteContentItem: async (_parent: unknown, args: DeleteContentItemArgs) => {
            const id = parseId(args.id);

            if (args.dryRun) {
                const [existing] = await db.select().from(contentItems).where(eq(contentItems.id, id));
                if (!existing) {
                    throw notFoundContentItemError(id);
                }

                return {
                    id,
                    message: `[Dry Run] Content item ${id} would be deleted`
                };
            }

            const [deleted] = await db.delete(contentItems)
                .where(eq(contentItems.id, id))
                .returning();

            if (!deleted) {
                throw notFoundContentItemError(id);
            }

            await logAudit('delete', 'content_item', deleted.id, deleted);

            return {
                id: deleted.id,
                message: `Content item ${deleted.id} deleted successfully`
            };
        },

        deleteContentItemsBatch: async (_parent: unknown, args: BatchDeleteContentItemsArgs) => {
            const isAtomic = args.atomic === true;
            if (args.ids.length === 0) {
                throw toError(
                    'Batch request is empty',
                    'EMPTY_BATCH',
                    'Provide at least one id in ids.'
                );
            }

            const ids = args.ids.map((id) => parseId(id, 'id'));

            if (args.dryRun) {
                const results: BatchResultRow[] = [];
                for (const [index, id] of ids.entries()) {
                    const [existing] = await db.select().from(contentItems).where(eq(contentItems.id, id));
                    if (!existing) {
                        results.push(buildBatchError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${id} not found`));
                        continue;
                    }

                    results.push({
                        index,
                        ok: true,
                        id
                    });
                }

                return {
                    atomic: isAtomic,
                    results
                };
            }

            if (isAtomic) {
                try {
                    const results = await db.transaction(async (tx) => {
                        const rows: BatchResultRow[] = [];
                        for (const [index, id] of ids.entries()) {
                            const [deleted] = await tx.delete(contentItems).where(eq(contentItems.id, id)).returning();
                            if (!deleted) {
                                throw new Error(JSON.stringify(buildBatchError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${id} not found`)));
                            }

                            rows.push({
                                index,
                                ok: true,
                                id: deleted.id
                            });
                        }

                        return rows;
                    });

                    for (const row of results) {
                        if (row.id !== undefined) {
                            await logAudit('delete', 'content_item', row.id, { batch: true, mode: 'atomic' });
                        }
                    }

                    return {
                        atomic: true,
                        results
                    };
                } catch (error) {
                    let context: Record<string, unknown> | undefined;
                    if (error instanceof Error) {
                        try {
                            context = JSON.parse(error.message) as Record<string, unknown>;
                        } catch {
                            context = { details: error.message };
                        }
                    }

                    throw toError(
                        'Atomic batch delete failed',
                        'BATCH_ATOMIC_FAILED',
                        'Fix the failing item and retry; atomic mode rolls back all items on failure.',
                        context
                    );
                }
            }

            const results: BatchResultRow[] = [];
            for (const [index, id] of ids.entries()) {
                const [deleted] = await db.delete(contentItems).where(eq(contentItems.id, id)).returning();
                if (!deleted) {
                    results.push(buildBatchError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${id} not found`));
                    continue;
                }

                await logAudit('delete', 'content_item', deleted.id, { batch: true, mode: 'partial' });
                results.push({
                    index,
                    ok: true,
                    id: deleted.id
                });
            }

            return {
                atomic: false,
                results
            };
        },

        rollbackContentItem: async (_parent: unknown, args: RollbackContentItemArgs) => {
            const id = parseId(args.id);
            const targetVersion = args.version;
            const [currentItem] = await db.select().from(contentItems).where(eq(contentItems.id, id));
            if (!currentItem) {
                throw notFoundContentItemError(id);
            }

            const [target] = await db.select()
                .from(contentItemVersions)
                .where(and(eq(contentItemVersions.contentItemId, id), eq(contentItemVersions.version, targetVersion)));

            if (!target) {
                throw targetVersionNotFoundError(id, targetVersion);
            }

            const [contentType] = await db.select().from(contentTypes).where(eq(contentTypes.id, currentItem.contentTypeId));
            if (!contentType) {
                throw notFoundContentTypeError(currentItem.contentTypeId);
            }

            const contentFailure = validateContentDataAgainstSchema(contentType.schema, target.data);
            if (contentFailure) {
                throw toErrorFromValidation(contentFailure);
            }

            if (args.dryRun) {
                return {
                    id,
                    version: currentItem.version + 1,
                    message: `[Dry Run] Would rollback item ${id} to version ${targetVersion}`
                };
            }

            try {
                const result = await db.transaction(async (tx) => {
                    const [current] = await tx.select().from(contentItems).where(eq(contentItems.id, id));
                    if (!current) {
                        return null;
                    }

                    const [target] = await tx.select()
                        .from(contentItemVersions)
                        .where(and(eq(contentItemVersions.contentItemId, id), eq(contentItemVersions.version, targetVersion)));

                    if (!target) {
                        throw new Error(TARGET_VERSION_NOT_FOUND);
                    }

                    await tx.insert(contentItemVersions).values({
                        contentItemId: current.id,
                        version: current.version,
                        data: current.data,
                        status: current.status,
                        createdAt: current.updatedAt
                    });

                    const [restored] = await tx.update(contentItems)
                        .set({
                            data: target.data,
                            status: target.status,
                            version: current.version + 1,
                            updatedAt: new Date()
                        })
                        .where(eq(contentItems.id, id))
                        .returning();

                    return restored;
                });

                if (!result) {
                    throw notFoundContentItemError(id);
                }

                await logAudit('rollback', 'content_item', result.id, {
                    fromVersion: result.version - 1,
                    toVersion: targetVersion
                });

                return {
                    id: result.id,
                    version: result.version,
                    message: `Rolled back to content from version ${targetVersion}`
                };
            } catch (error) {
                if (error instanceof Error && error.message === TARGET_VERSION_NOT_FOUND) {
                    throw targetVersionNotFoundError(id, targetVersion);
                }

                throw error;
            }
        }
    }
};
