import { and, desc, eq } from 'drizzle-orm';
import { GraphQLError } from 'graphql';

import { db } from '../db/index.js';
import { auditLogs, contentItemVersions, contentItems, contentTypes } from '../db/schema.js';
import { logAudit } from '../services/audit.js';
import { ValidationFailure, validateContentDataAgainstSchema, validateContentTypeSchema } from '../services/content-schema.js';

const TARGET_VERSION_NOT_FOUND = 'TARGET_VERSION_NOT_FOUND';

type IdValue = string | number;
type IdArg = { id: IdValue };
type OptionalContentTypeArg = { contentTypeId?: IdValue };
type AuditLogArgs = {
    entityType?: string;
    entityId?: IdValue;
    action?: string;
    limit?: number;
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

function toError(message: string, code: string, remediation: string): GraphQLError {
    return new GraphQLError(message, {
        extensions: {
            code,
            remediation
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

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined)
    ) as Partial<T>;
}

function hasDefinedValues<T extends Record<string, unknown>>(value: T): boolean {
    return Object.keys(stripUndefined(value)).length > 0;
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

export const resolvers = {
    Query: {
        contentTypes: async () => db.select().from(contentTypes),

        contentType: async (_parent: unknown, { id }: IdArg) => {
            const numericId = parseId(id);
            const [type] = await db.select().from(contentTypes).where(eq(contentTypes.id, numericId));
            return type || null;
        },

        contentItems: async (_parent: unknown, { contentTypeId }: OptionalContentTypeArg) => {
            const numericTypeId = parseOptionalId(contentTypeId, 'contentTypeId');
            if (numericTypeId === undefined) {
                return db.select().from(contentItems);
            }

            return db.select().from(contentItems).where(eq(contentItems.contentTypeId, numericTypeId));
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

        auditLogs: async (_parent: unknown, { entityType, entityId, action, limit }: AuditLogArgs) => {
            const numericEntityId = parseOptionalId(entityId, 'entityId');
            const safeLimit = typeof limit === 'number' ? Math.max(1, Math.min(limit, 200)) : 50;

            const conditions = [
                entityType ? eq(auditLogs.entityType, entityType) : undefined,
                numericEntityId !== undefined ? eq(auditLogs.entityId, numericEntityId) : undefined,
                action ? eq(auditLogs.action, action) : undefined,
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
                .orderBy(desc(auditLogs.createdAt))
                .limit(safeLimit);
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
                const [existing] = await tx.select().from(contentItems).where(eq(contentItems.id, id));
                if (!existing) {
                    return null;
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
                    const [currentItem] = await tx.select().from(contentItems).where(eq(contentItems.id, id));
                    if (!currentItem) {
                        return null;
                    }

                    const [target] = await tx.select()
                        .from(contentItemVersions)
                        .where(and(eq(contentItemVersions.contentItemId, id), eq(contentItemVersions.version, targetVersion)));

                    if (!target) {
                        throw new Error(TARGET_VERSION_NOT_FOUND);
                    }

                    await tx.insert(contentItemVersions).values({
                        contentItemId: currentItem.id,
                        version: currentItem.version,
                        data: currentItem.data,
                        status: currentItem.status,
                        createdAt: currentItem.updatedAt
                    });

                    const [restored] = await tx.update(contentItems)
                        .set({
                            data: target.data,
                            status: target.status,
                            version: currentItem.version + 1,
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
