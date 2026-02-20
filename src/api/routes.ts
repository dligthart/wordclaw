import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { and, desc, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { auditLogs, contentItemVersions, contentItems, contentTypes } from '../db/schema.js';
import { logAudit } from '../services/audit.js';
import { validateContentDataAgainstSchema, validateContentTypeSchema, ValidationFailure } from '../services/content-schema.js';
import { AIErrorResponse, DryRunQuery, createAIResponse } from './types.js';
import { authorizeApiRequest } from './auth.js';

type DryRunQueryType = { mode?: 'dry_run' };
type IdParams = { id: number };
type ContentTypeUpdate = Partial<typeof contentTypes.$inferInsert>;
type ContentItemUpdate = Partial<typeof contentItems.$inferInsert>;
type ContentItemsQuery = {
    contentTypeId?: number;
};
type AuditLogQuery = {
    entityType?: string;
    entityId?: number;
    action?: string;
    limit: number;
};

type AIErrorPayload = {
    error: string;
    code: string;
    remediation: string;
    context?: Record<string, unknown>;
};

const TARGET_VERSION_NOT_FOUND = 'TARGET_VERSION_NOT_FOUND';

function toErrorPayload(error: string, code: string, remediation: string): AIErrorPayload {
    return { error, code, remediation };
}

function fromValidationFailure(failure: ValidationFailure): AIErrorPayload {
    return {
        error: failure.error,
        code: failure.code,
        remediation: failure.remediation,
        ...(failure.context ? { context: failure.context } : {})
    };
}

function buildMeta(
    recommendedNextAction: string,
    availableActions: string[],
    actionPriority: 'low' | 'medium' | 'high' | 'critical',
    cost: number,
    dryRun = false
) {
    return {
        recommendedNextAction,
        availableActions,
        actionPriority,
        cost,
        ...(dryRun ? { dryRun: true } : {})
    };
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined)
    ) as Partial<T>;
}

function hasDefinedValues<T extends Record<string, unknown>>(value: T): boolean {
    return Object.keys(stripUndefined(value)).length > 0;
}

function isDryRun(mode?: 'dry_run'): boolean {
    return mode === 'dry_run';
}

function notFoundContentType(id: number): AIErrorPayload {
    return toErrorPayload(
        'Content type not found',
        'CONTENT_TYPE_NOT_FOUND',
        `The content type with ID ${id} does not exist. List available types with GET /api/content-types to find valid IDs.`
    );
}

function notFoundContentItem(id: number): AIErrorPayload {
    return toErrorPayload(
        'Content item not found',
        'CONTENT_ITEM_NOT_FOUND',
        `The content item with ID ${id} does not exist. List available items with GET /api/content-items to find valid IDs.`
    );
}

export default async function apiRoutes(server: FastifyInstance) {
    server.addHook('preHandler', async (request, reply) => {
        const path = request.url.split('?')[0];
        const auth = authorizeApiRequest(request.method, path, request.headers);
        if (!auth.ok) {
            return reply.status(auth.statusCode).send(auth.payload);
        }

        return undefined;
    });

    server.post('/content-types', {
        schema: {
            querystring: DryRunQuery,
            body: Type.Object({
                name: Type.String(),
                slug: Type.String(),
                description: Type.Optional(Type.String()),
                schema: Type.String(),
            }),
            response: {
                201: createAIResponse(Type.Object({
                    id: Type.Number(),
                    name: Type.String(),
                    slug: Type.String(),
                })),
                200: createAIResponse(Type.Object({
                    id: Type.Number(),
                    name: Type.String(),
                    slug: Type.String(),
                })),
                400: AIErrorResponse
            },
        },
    }, async (request, reply) => {
        const { mode } = request.query as DryRunQueryType;
        const data = request.body as typeof contentTypes.$inferInsert;
        const schemaFailure = validateContentTypeSchema(data.schema);

        if (schemaFailure) {
            return reply.status(400).send(fromValidationFailure(schemaFailure));
        }

        if (isDryRun(mode)) {
            return reply.status(200).send({
                data: { ...data, id: 0 },
                meta: buildMeta(
                    `Execute creation of content type '${data.name}'`,
                    ['POST /api/content-types'],
                    'medium',
                    0,
                    true
                )
            });
        }

        const [newItem] = await db.insert(contentTypes).values(data).returning();
        await logAudit('create', 'content_type', newItem.id, newItem);

        return reply.status(201).send({
            data: newItem,
            meta: buildMeta(
                `Create content items for type '${newItem.name}'`,
                ['GET /api/content-types', 'POST /api/content-items'],
                'medium',
                1
            )
        });
    });

    server.get('/content-types', {
        schema: {
            response: {
                200: createAIResponse(Type.Array(Type.Object({
                    id: Type.Number(),
                    name: Type.String(),
                    slug: Type.String(),
                    description: Type.Optional(Type.String()),
                    schema: Type.String(),
                    createdAt: Type.String(),
                    updatedAt: Type.String()
                })))
            }
        }
    }, async () => {
        const types = await db.select().from(contentTypes);
        return {
            data: types,
            meta: buildMeta(
                types.length > 0 ? 'Select a content type to create items' : 'Create a new content type',
                ['POST /api/content-types'],
                'low',
                1
            )
        };
    });

    server.get('/content-types/:id', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                200: createAIResponse(Type.Object({
                    id: Type.Number(),
                    name: Type.String(),
                    slug: Type.String(),
                    description: Type.Optional(Type.String()),
                    schema: Type.String(),
                    createdAt: Type.String(),
                    updatedAt: Type.String()
                })),
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        const [type] = await db.select().from(contentTypes).where(eq(contentTypes.id, id));

        if (!type) {
            return reply.status(404).send(notFoundContentType(id));
        }

        return {
            data: type,
            meta: buildMeta(
                `Create content items for '${type.name}'`,
                ['PUT /api/content-types/:id', 'DELETE /api/content-types/:id', 'POST /api/content-items'],
                'medium',
                1
            )
        };
    });

    server.put('/content-types/:id', {
        schema: {
            querystring: DryRunQuery,
            params: Type.Object({
                id: Type.Number()
            }),
            body: Type.Object({
                name: Type.Optional(Type.String()),
                slug: Type.Optional(Type.String()),
                description: Type.Optional(Type.String()),
                schema: Type.Optional(Type.String()),
            }),
            response: {
                200: createAIResponse(Type.Object({
                    id: Type.Number(),
                    name: Type.Optional(Type.String()),
                    slug: Type.Optional(Type.String()),
                    description: Type.Optional(Type.String()),
                    schema: Type.Optional(Type.String()),
                    createdAt: Type.Optional(Type.String()),
                    updatedAt: Type.Optional(Type.String())
                })),
                400: AIErrorResponse,
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        const { mode } = request.query as DryRunQueryType;
        const payload = request.body as ContentTypeUpdate;
        const updateData = stripUndefined(payload);

        if (!hasDefinedValues(payload)) {
            return reply.status(400).send(toErrorPayload(
                'Empty update payload',
                'EMPTY_UPDATE_BODY',
                'The request body must contain at least one field to update (name, slug, description, or schema). Send a body like { "name": "New Name" }.'
            ));
        }

        if (typeof updateData.schema === 'string') {
            const schemaFailure = validateContentTypeSchema(updateData.schema);
            if (schemaFailure) {
                return reply.status(400).send(fromValidationFailure(schemaFailure));
            }
        }

        if (isDryRun(mode)) {
            const [existing] = await db.select().from(contentTypes).where(eq(contentTypes.id, id));
            if (!existing) {
                return reply.status(404).send(notFoundContentType(id));
            }

            return {
                data: { ...existing, ...updateData },
                meta: buildMeta(
                    `Execute update for '${updateData.name || existing.name}'`,
                    ['PUT /api/content-types/:id'],
                    'low',
                    0,
                    true
                )
            };
        }

        const [updatedType] = await db.update(contentTypes)
            .set(updateData)
            .where(eq(contentTypes.id, id))
            .returning();

        if (!updatedType) {
            return reply.status(404).send(notFoundContentType(id));
        }

        await logAudit('update', 'content_type', updatedType.id, { ...updateData, previous: 'n/a' });

        return {
            data: updatedType,
            meta: buildMeta(
                `Verify changes for '${updatedType.name}'`,
                ['GET /api/content-types/:id', 'DELETE /api/content-types/:id'],
                'low',
                1
            )
        };
    });

    server.delete('/content-types/:id', {
        schema: {
            querystring: DryRunQuery,
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                200: createAIResponse(Type.Object({
                    id: Type.Number(),
                    message: Type.String()
                })),
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        const { mode } = request.query as DryRunQueryType;

        if (isDryRun(mode)) {
            const [existing] = await db.select().from(contentTypes).where(eq(contentTypes.id, id));
            if (!existing) {
                return reply.status(404).send(notFoundContentType(id));
            }

            return {
                data: {
                    id,
                    message: `[Dry Run] Content type '${existing.name}' would be deleted`
                },
                meta: buildMeta(
                    'Execute deletion if confirmed',
                    ['DELETE /api/content-types/:id'],
                    'medium',
                    0,
                    true
                )
            };
        }

        const [deletedType] = await db.delete(contentTypes)
            .where(eq(contentTypes.id, id))
            .returning();

        if (!deletedType) {
            return reply.status(404).send(notFoundContentType(id));
        }

        await logAudit('delete', 'content_type', deletedType.id, deletedType);

        return {
            data: {
                id: deletedType.id,
                message: `Content type '${deletedType.name}' deleted successfully`
            },
            meta: buildMeta(
                'List remaining content types',
                ['GET /api/content-types', 'POST /api/content-types'],
                'medium',
                1
            )
        };
    });

    server.post('/content-items', {
        schema: {
            querystring: DryRunQuery,
            body: Type.Object({
                contentTypeId: Type.Number(),
                data: Type.String(),
                status: Type.Optional(Type.String()),
            }),
            response: {
                201: createAIResponse(Type.Object({
                    id: Type.Number(),
                    contentTypeId: Type.Number(),
                    version: Type.Number()
                })),
                200: createAIResponse(Type.Object({
                    id: Type.Number(),
                    contentTypeId: Type.Number(),
                    version: Type.Number()
                })),
                400: AIErrorResponse,
                404: AIErrorResponse
            }
        },
    }, async (request, reply) => {
        const { mode } = request.query as DryRunQueryType;
        const data = request.body as typeof contentItems.$inferInsert;
        const [contentType] = await db.select().from(contentTypes).where(eq(contentTypes.id, data.contentTypeId));

        if (!contentType) {
            return reply.status(404).send(notFoundContentType(data.contentTypeId));
        }

        const contentValidation = validateContentDataAgainstSchema(contentType.schema, data.data);
        if (contentValidation) {
            return reply.status(400).send(fromValidationFailure(contentValidation));
        }

        if (isDryRun(mode)) {
            return reply.status(200).send({
                data: { ...data, id: 0, version: 1 },
                meta: buildMeta(
                    'Execute creation of content item',
                    ['POST /api/content-items'],
                    'medium',
                    0,
                    true
                )
            });
        }

        const [newItem] = await db.insert(contentItems).values(data).returning();
        await logAudit('create', 'content_item', newItem.id, newItem);

        return reply.status(201).send({
            data: newItem,
            meta: buildMeta(
                `Review or publish content item ${newItem.id}`,
                ['GET /api/content-items/:id', 'PUT /api/content-items/:id'],
                'medium',
                1
            )
        });
    });

    server.get('/content-items', {
        schema: {
            querystring: Type.Object({
                contentTypeId: Type.Optional(Type.Number())
            }),
            response: {
                200: createAIResponse(Type.Array(Type.Object({
                    id: Type.Number(),
                    contentTypeId: Type.Number(),
                    data: Type.String(),
                    status: Type.String(),
                    version: Type.Number(),
                    createdAt: Type.String(),
                    updatedAt: Type.String()
                })))
            }
        }
    }, async (request) => {
        const { contentTypeId } = request.query as ContentItemsQuery;
        const items = contentTypeId === undefined
            ? await db.select().from(contentItems)
            : await db.select().from(contentItems).where(eq(contentItems.contentTypeId, contentTypeId));

        return {
            data: items,
            meta: buildMeta(
                'Filter or select a content item',
                ['POST /api/content-items'],
                'low',
                1
            )
        };
    });

    server.get('/content-items/:id', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                200: createAIResponse(Type.Object({
                    id: Type.Number(),
                    contentTypeId: Type.Number(),
                    data: Type.String(),
                    status: Type.String(),
                    version: Type.Number(),
                    createdAt: Type.String(),
                    updatedAt: Type.String()
                })),
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        const [item] = await db.select().from(contentItems).where(eq(contentItems.id, id));

        if (!item) {
            return reply.status(404).send(notFoundContentItem(id));
        }

        return {
            data: item,
            meta: buildMeta(
                'Update or publish this item',
                ['PUT /api/content-items/:id', 'DELETE /api/content-items/:id'],
                'medium',
                1
            )
        };
    });

    server.put('/content-items/:id', {
        schema: {
            querystring: DryRunQuery,
            params: Type.Object({
                id: Type.Number()
            }),
            body: Type.Object({
                contentTypeId: Type.Optional(Type.Number()),
                data: Type.Optional(Type.String()),
                status: Type.Optional(Type.String()),
            }),
            response: {
                200: createAIResponse(Type.Object({
                    id: Type.Number(),
                    contentTypeId: Type.Number(),
                    data: Type.String(),
                    status: Type.String(),
                    version: Type.Number(),
                    createdAt: Type.Optional(Type.String()),
                    updatedAt: Type.Optional(Type.String())
                })),
                400: AIErrorResponse,
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        const { mode } = request.query as DryRunQueryType;
        const payload = request.body as ContentItemUpdate;
        const updateData = stripUndefined(payload);

        if (!hasDefinedValues(payload)) {
            return reply.status(400).send(toErrorPayload(
                'Empty update payload',
                'EMPTY_UPDATE_BODY',
                'The request body must contain at least one field to update (contentTypeId, data, or status). Send a body like { "data": "...", "status": "published" }.'
            ));
        }

        const [existing] = await db.select().from(contentItems).where(eq(contentItems.id, id));
        if (!existing) {
            return reply.status(404).send(notFoundContentItem(id));
        }

        const targetContentTypeId = typeof updateData.contentTypeId === 'number'
            ? updateData.contentTypeId
            : existing.contentTypeId;
        const [targetContentType] = await db.select().from(contentTypes).where(eq(contentTypes.id, targetContentTypeId));
        if (!targetContentType) {
            return reply.status(404).send(notFoundContentType(targetContentTypeId));
        }

        const targetData = typeof updateData.data === 'string'
            ? updateData.data
            : existing.data;
        const contentValidation = validateContentDataAgainstSchema(targetContentType.schema, targetData);
        if (contentValidation) {
            return reply.status(400).send(fromValidationFailure(contentValidation));
        }

        if (isDryRun(mode)) {
            return {
                data: { ...existing, ...updateData },
                meta: buildMeta(
                    `Execute update for item ${id}`,
                    ['PUT /api/content-items/:id'],
                    'low',
                    0,
                    true
                )
            };
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
            return reply.status(404).send(notFoundContentItem(id));
        }

        await logAudit('update', 'content_item', result.id, updateData);

        return {
            data: result,
            meta: buildMeta(
                `Review changes for item ${result.id} (v${result.version})`,
                ['GET /api/content-items/:id', 'GET /api/content-items/:id/versions', 'POST /api/content-items/:id/rollback'],
                'low',
                1
            )
        };
    });

    server.get('/content-items/:id/versions', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                200: createAIResponse(Type.Array(Type.Object({
                    id: Type.Number(),
                    version: Type.Number(),
                    data: Type.String(),
                    status: Type.String(),
                    createdAt: Type.String()
                })))
            }
        }
    }, async (request) => {
        const { id } = request.params as IdParams;
        const versions = await db.select()
            .from(contentItemVersions)
            .where(eq(contentItemVersions.contentItemId, id))
            .orderBy(desc(contentItemVersions.version));

        return {
            data: versions,
            meta: buildMeta(
                'Review history or rollback',
                ['POST /api/content-items/:id/rollback'],
                'low',
                1
            )
        };
    });

    server.post('/content-items/:id/rollback', {
        schema: {
            querystring: DryRunQuery,
            params: Type.Object({
                id: Type.Number()
            }),
            body: Type.Object({
                version: Type.Number()
            }),
            response: {
                200: createAIResponse(Type.Object({
                    id: Type.Number(),
                    version: Type.Number(),
                    message: Type.String()
                })),
                400: AIErrorResponse,
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        const { mode } = request.query as DryRunQueryType;
        const { version } = request.body as { version: number };

        const [currentItem] = await db.select().from(contentItems).where(eq(contentItems.id, id));
        if (!currentItem) {
            return reply.status(404).send(notFoundContentItem(id));
        }

        const [targetVersion] = await db.select()
            .from(contentItemVersions)
            .where(and(eq(contentItemVersions.contentItemId, id), eq(contentItemVersions.version, version)));

        if (!targetVersion) {
            return reply.status(404).send(toErrorPayload(
                'Target version not found',
                TARGET_VERSION_NOT_FOUND,
                `Version ${version} does not exist for content item ${id}. Use GET /api/content-items/${id}/versions to list available versions.`
            ));
        }

        const [contentType] = await db.select().from(contentTypes).where(eq(contentTypes.id, currentItem.contentTypeId));
        if (!contentType) {
            return reply.status(404).send(notFoundContentType(currentItem.contentTypeId));
        }

        const contentValidation = validateContentDataAgainstSchema(contentType.schema, targetVersion.data);
        if (contentValidation) {
            return reply.status(400).send(fromValidationFailure(contentValidation));
        }

        if (isDryRun(mode)) {
            return {
                data: {
                    id,
                    version: currentItem.version + 1,
                    message: `[Dry Run] Content item ${id} would be rolled back to version ${version}`
                },
                meta: buildMeta(
                    `Execute rollback to version ${version} if confirmed`,
                    ['POST /api/content-items/:id/rollback'],
                    'high',
                    0,
                    true
                )
            };
        }

        try {
            const result = await db.transaction(async (tx) => {
                const [currentItem] = await tx.select().from(contentItems).where(eq(contentItems.id, id));
                if (!currentItem) {
                    return null;
                }

                const [targetVersion] = await tx.select()
                    .from(contentItemVersions)
                    .where(and(eq(contentItemVersions.contentItemId, id), eq(contentItemVersions.version, version)));

                if (!targetVersion) {
                    throw new Error(TARGET_VERSION_NOT_FOUND);
                }

                await tx.insert(contentItemVersions).values({
                    contentItemId: currentItem.id,
                    version: currentItem.version,
                    data: currentItem.data,
                    status: currentItem.status,
                    createdAt: currentItem.updatedAt
                });

                const [restoredItem] = await tx.update(contentItems)
                    .set({
                        data: targetVersion.data,
                        status: targetVersion.status,
                        version: currentItem.version + 1,
                        updatedAt: new Date()
                    })
                    .where(eq(contentItems.id, id))
                    .returning();

                return restoredItem;
            });

            if (!result) {
                return reply.status(404).send(notFoundContentItem(id));
            }

            await logAudit('rollback', 'content_item', result.id, { fromVersion: result.version - 1, toVersion: version });

            return {
                data: {
                    id: result.id,
                    version: result.version,
                    message: `Rolled back to content from version ${version}`
                },
                meta: buildMeta(
                    `Verify rollback to v${version}`,
                    ['GET /api/content-items/:id'],
                    'high',
                    1
                )
            };
        } catch (error) {
            if (error instanceof Error && error.message === TARGET_VERSION_NOT_FOUND) {
                return reply.status(404).send(toErrorPayload(
                    'Target version not found',
                    TARGET_VERSION_NOT_FOUND,
                    `Version ${version} does not exist for content item ${id}. Use GET /api/content-items/${id}/versions to list available versions.`
                ));
            }

            throw error;
        }
    });

    server.delete('/content-items/:id', {
        schema: {
            querystring: DryRunQuery,
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                200: createAIResponse(Type.Object({
                    id: Type.Number(),
                    message: Type.String()
                })),
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        const { mode } = request.query as DryRunQueryType;

        if (isDryRun(mode)) {
            const [existing] = await db.select().from(contentItems).where(eq(contentItems.id, id));
            if (!existing) {
                return reply.status(404).send(notFoundContentItem(id));
            }

            return {
                data: {
                    id,
                    message: `[Dry Run] Content item ${id} would be deleted`
                },
                meta: buildMeta(
                    'Execute deletion if confirmed',
                    ['DELETE /api/content-items/:id'],
                    'medium',
                    0,
                    true
                )
            };
        }

        const [deletedItem] = await db.delete(contentItems)
            .where(eq(contentItems.id, id))
            .returning();

        if (!deletedItem) {
            return reply.status(404).send(notFoundContentItem(id));
        }

        await logAudit('delete', 'content_item', deletedItem.id, deletedItem);

        return {
            data: {
                id: deletedItem.id,
                message: `Content item ${deletedItem.id} deleted successfully`
            },
            meta: buildMeta(
                'List remaining content items',
                ['GET /api/content-items', 'POST /api/content-items'],
                'medium',
                1
            )
        };
    });

    server.get('/audit-logs', {
        schema: {
            querystring: Type.Object({
                entityType: Type.Optional(Type.String()),
                entityId: Type.Optional(Type.Number()),
                action: Type.Optional(Type.String()),
                limit: Type.Optional(Type.Number({ default: 50 }))
            }),
            response: {
                200: createAIResponse(Type.Array(Type.Object({
                    id: Type.Number(),
                    action: Type.String(),
                    entityType: Type.String(),
                    entityId: Type.Number(),
                    details: Type.Optional(Type.String()),
                    createdAt: Type.String()
                })))
            }
        }
    }, async (request) => {
        const { entityType, entityId, action, limit } = request.query as AuditLogQuery;

        const conditions = [
            entityType ? eq(auditLogs.entityType, entityType) : undefined,
            entityId !== undefined ? eq(auditLogs.entityId, entityId) : undefined,
            action ? eq(auditLogs.action, action) : undefined,
        ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

        const logs = await db.select({
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
            .limit(limit);

        return {
            data: logs,
            meta: buildMeta(
                'Monitor system activity',
                ['GET /api/audit-logs'],
                'low',
                1
            )
        };
    });
}
