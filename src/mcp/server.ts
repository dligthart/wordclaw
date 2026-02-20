import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db/index.js';
import { auditLogs, contentItemVersions, contentItems, contentTypes } from '../db/schema.js';
import { logAudit } from '../services/audit.js';
import { ValidationFailure, validateContentDataAgainstSchema, validateContentTypeSchema } from '../services/content-schema.js';

const server = new McpServer({
    name: 'WordClaw CMS',
    version: '1.0.0'
});

const TARGET_VERSION_NOT_FOUND = 'Target version not found';

type ToolResult = {
    content: Array<{ type: 'text'; text: string }>;
    isError?: true;
};

function ok(text: string): ToolResult {
    return {
        content: [{ type: 'text', text }]
    };
}

function okJson(data: unknown): ToolResult {
    return ok(JSON.stringify(data, null, 2));
}

function err(text: string): ToolResult {
    return {
        isError: true,
        content: [{ type: 'text', text }]
    };
}

function validationFailureToText(failure: ValidationFailure): string {
    const context = failure.context ? ` Context: ${JSON.stringify(failure.context)}` : '';
    return `${failure.code}: ${failure.error}. ${failure.remediation}${context}`;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined)
    ) as Partial<T>;
}

function hasDefinedValues<T extends Record<string, unknown>>(value: T): boolean {
    return Object.keys(stripUndefined(value)).length > 0;
}

server.tool(
    'create_content_type',
    'Create a new content type schema',
    {
        name: z.string().describe('Name of the content type'),
        slug: z.string().describe('Unique slug for the content type'),
        description: z.string().optional().describe('Description of the content type'),
        schema: z.string().describe('JSON schema definition as a string'),
        dryRun: z.boolean().optional().describe('If true, simulates the action without making changes')
    },
    async ({ name, slug, description, schema, dryRun }) => {
        try {
            const schemaFailure = validateContentTypeSchema(schema);
            if (schemaFailure) {
                return err(validationFailureToText(schemaFailure));
            }

            if (dryRun) {
                return ok(`[Dry Run] Would create content type '${name}' with slug '${slug}'`);
            }

            const [newItem] = await db.insert(contentTypes).values({
                name,
                slug,
                description,
                schema
            }).returning();

            await logAudit('create', 'content_type', newItem.id, newItem);

            return ok(`Created content type '${newItem.name}' (ID: ${newItem.id})`);
        } catch (error) {
            return err(`Error creating content type: ${(error as Error).message}`);
        }
    }
);

server.tool(
    'list_content_types',
    'List all available content types',
    {},
    async () => {
        const types = await db.select().from(contentTypes);
        return okJson(types);
    }
);

server.tool(
    'get_content_type',
    'Get a content type by ID or Slug',
    {
        id: z.number().optional().describe('ID of the content type'),
        slug: z.string().optional().describe('Slug of the content type')
    },
    async ({ id, slug }) => {
        if (id === undefined && !slug) {
            return err("Must provide either 'id' or 'slug'");
        }

        const [type] = id !== undefined
            ? await db.select().from(contentTypes).where(eq(contentTypes.id, id))
            : await db.select().from(contentTypes).where(eq(contentTypes.slug, slug!));

        if (!type) {
            return err('Content type not found');
        }

        return okJson(type);
    }
);

server.tool(
    'update_content_type',
    'Update an existing content type',
    {
        id: z.number().describe('ID of the content type to update'),
        name: z.string().optional(),
        slug: z.string().optional(),
        description: z.string().optional(),
        schema: z.string().optional(),
        dryRun: z.boolean().optional()
    },
    async ({ id, name, slug, description, schema, dryRun }) => {
        try {
            const updateData = stripUndefined({ name, slug, description, schema });
            if (!hasDefinedValues({ name, slug, description, schema })) {
                return err('At least one update field is required (name, slug, description, schema).');
            }

            if (typeof updateData.schema === 'string') {
                const schemaFailure = validateContentTypeSchema(updateData.schema);
                if (schemaFailure) {
                    return err(validationFailureToText(schemaFailure));
                }
            }

            if (dryRun) {
                return ok(`[Dry Run] Would update content type ${id}`);
            }

            const [updated] = await db.update(contentTypes)
                .set(updateData)
                .where(eq(contentTypes.id, id))
                .returning();

            if (!updated) {
                return err(`Content type ${id} not found`);
            }

            await logAudit('update', 'content_type', updated.id, updateData);

            return ok(`Updated content type '${updated.name}' (ID: ${updated.id})`);
        } catch (error) {
            return err(`Error updating content type: ${(error as Error).message}`);
        }
    }
);

server.tool(
    'delete_content_type',
    'Delete a content type',
    {
        id: z.number().describe('ID of the content type to delete'),
        dryRun: z.boolean().optional()
    },
    async ({ id, dryRun }) => {
        try {
            if (dryRun) {
                return ok(`[Dry Run] Would delete content type ${id}`);
            }

            const [deleted] = await db.delete(contentTypes)
                .where(eq(contentTypes.id, id))
                .returning();

            if (!deleted) {
                return err(`Content type ${id} not found`);
            }

            await logAudit('delete', 'content_type', deleted.id, deleted);

            return ok(`Deleted content type '${deleted.name}' (ID: ${deleted.id})`);
        } catch (error) {
            return err(`Error deleting content type: ${(error as Error).message}`);
        }
    }
);

server.tool(
    'create_content_item',
    'Create a new content item',
    {
        contentTypeId: z.number().describe('ID of the content type'),
        data: z.string().describe('JSON string of the content data conforming to the schema'),
        status: z.enum(['draft', 'published', 'archived']).optional().describe('Status of the item'),
        dryRun: z.boolean().optional().describe('If true, simulates the action without making changes')
    },
    async ({ contentTypeId, data, status, dryRun }) => {
        try {
            const [contentType] = await db.select().from(contentTypes).where(eq(contentTypes.id, contentTypeId));
            if (!contentType) {
                return err(`Content type ${contentTypeId} not found`);
            }

            const contentFailure = validateContentDataAgainstSchema(contentType.schema, data);
            if (contentFailure) {
                return err(validationFailureToText(contentFailure));
            }

            if (dryRun) {
                return ok(`[Dry Run] Would create content item for type ${contentTypeId} with status '${status || 'draft'}'`);
            }

            const [newItem] = await db.insert(contentItems).values({
                contentTypeId,
                data,
                status: status || 'draft'
            }).returning();

            await logAudit('create', 'content_item', newItem.id, newItem);

            return ok(`Created content item ID: ${newItem.id}`);
        } catch (error) {
            return err(`Error creating content item: ${(error as Error).message}`);
        }
    }
);

server.tool(
    'get_content_items',
    'Get content items, optionally filtering by type',
    {
        contentTypeId: z.number().optional().describe('Filter by content type ID')
    },
    async ({ contentTypeId }) => {
        const items = contentTypeId === undefined
            ? await db.select().from(contentItems)
            : await db.select().from(contentItems).where(eq(contentItems.contentTypeId, contentTypeId));

        return okJson(items);
    }
);

server.tool(
    'get_content_item',
    'Get a single content item by ID',
    {
        id: z.number().describe('ID of the content item')
    },
    async ({ id }) => {
        const [item] = await db.select().from(contentItems).where(eq(contentItems.id, id));
        if (!item) {
            return err('Content item not found');
        }
        return okJson(item);
    }
);

server.tool(
    'update_content_item',
    'Update a content item with versioning',
    {
        id: z.number().describe('ID of the content item'),
        data: z.string().optional().describe('New JSON data'),
        status: z.enum(['draft', 'published', 'archived']).optional(),
        dryRun: z.boolean().optional()
    },
    async ({ id, data, status, dryRun }) => {
        try {
            const updateData = stripUndefined({ data, status });
            if (!hasDefinedValues({ data, status })) {
                return err('At least one update field is required (data, status).');
            }

            const [existing] = await db.select().from(contentItems).where(eq(contentItems.id, id));
            if (!existing) {
                return err('Content item not found');
            }

            const [contentType] = await db.select().from(contentTypes).where(eq(contentTypes.id, existing.contentTypeId));
            if (!contentType) {
                return err(`Content type ${existing.contentTypeId} not found`);
            }

            const targetData = typeof updateData.data === 'string' ? updateData.data : existing.data;
            const contentFailure = validateContentDataAgainstSchema(contentType.schema, targetData);
            if (contentFailure) {
                return err(validationFailureToText(contentFailure));
            }

            if (dryRun) {
                return ok(`[Dry Run] Would update content item ${id} (creating new version)`);
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
                return err('Content item not found');
            }

            await logAudit('update', 'content_item', result.id, updateData);

            return ok(`Updated content item ${result.id} to version ${result.version}`);
        } catch (error) {
            return err(`Error updating content item: ${(error as Error).message}`);
        }
    }
);

server.tool(
    'delete_content_item',
    'Delete a content item',
    {
        id: z.number().describe('ID of the content item'),
        dryRun: z.boolean().optional()
    },
    async ({ id, dryRun }) => {
        try {
            if (dryRun) {
                return ok(`[Dry Run] Would delete content item ${id}`);
            }

            const [deleted] = await db.delete(contentItems)
                .where(eq(contentItems.id, id))
                .returning();

            if (!deleted) {
                return err('Content item not found');
            }

            await logAudit('delete', 'content_item', deleted.id, deleted);

            return ok(`Deleted content item ${deleted.id}`);
        } catch (error) {
            return err(`Error deleting content item: ${(error as Error).message}`);
        }
    }
);

server.tool(
    'get_content_item_versions',
    'Get version history for a content item',
    {
        id: z.number().describe('ID of the content item')
    },
    async ({ id }) => {
        const versions = await db.select()
            .from(contentItemVersions)
            .where(eq(contentItemVersions.contentItemId, id))
            .orderBy(desc(contentItemVersions.version));

        return okJson(versions);
    }
);

server.tool(
    'rollback_content_item',
    'Rollback content item to a previous version',
    {
        id: z.number().describe('ID of the content item'),
        version: z.number().describe('Target version number to rollback to'),
        dryRun: z.boolean().optional()
    },
    async ({ id, version, dryRun }) => {
        try {
            const [currentItem] = await db.select().from(contentItems).where(eq(contentItems.id, id));
            if (!currentItem) {
                return err('Content item not found');
            }

            const [targetVersion] = await db.select()
                .from(contentItemVersions)
                .where(and(eq(contentItemVersions.contentItemId, id), eq(contentItemVersions.version, version)));

            if (!targetVersion) {
                return err(TARGET_VERSION_NOT_FOUND);
            }

            const [contentType] = await db.select().from(contentTypes).where(eq(contentTypes.id, currentItem.contentTypeId));
            if (!contentType) {
                return err(`Content type ${currentItem.contentTypeId} not found`);
            }

            const contentFailure = validateContentDataAgainstSchema(contentType.schema, targetVersion.data);
            if (contentFailure) {
                return err(validationFailureToText(contentFailure));
            }

            if (dryRun) {
                return ok(`[Dry Run] Would rollback item ${id} to version ${version}`);
            }

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

                const [restored] = await tx.update(contentItems)
                    .set({
                        data: targetVersion.data,
                        status: targetVersion.status,
                        version: currentItem.version + 1,
                        updatedAt: new Date()
                    })
                    .where(eq(contentItems.id, id))
                    .returning();

                return restored;
            });

            if (!result) {
                return err('Content item not found');
            }

            await logAudit('rollback', 'content_item', result.id, { from: result.version - 1, to: version });

            return ok(`Rolled back item ${result.id} to version ${version} (new version ${result.version})`);

        } catch (error) {
            const message = (error as Error).message;
            if (message === TARGET_VERSION_NOT_FOUND) {
                return err(TARGET_VERSION_NOT_FOUND);
            }
            return err(`Error rolling back: ${message}`);
        }
    }
);

server.tool(
    'get_audit_logs',
    'Get audit logs',
    {
        limit: z.number().optional().default(50),
        entityType: z.string().optional(),
        entityId: z.number().optional(),
        action: z.string().optional()
    },
    async ({ limit, entityType, entityId, action }) => {
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

        return okJson(logs);
    }
);

server.resource(
    'content-types',
    'content://types',
    async (uri) => {
        const types = await db.select().from(contentTypes);
        return {
            contents: [{
                uri: uri.href,
                text: JSON.stringify(types, null, 2)
            }]
        };
    }
);

server.prompt(
    'content-generation-template',
    'Generate content based on a schema',
    {
        contentTypeId: z.string().describe('ID of the content type to generate content for'),
        topic: z.string().describe('Topic or subject of the content')
    },
    async ({ contentTypeId, topic }) => {
        const id = Number.parseInt(contentTypeId, 10);
        const [type] = await db.select().from(contentTypes).where(eq(contentTypes.id, id));

        if (!type) {
            return {
                messages: [{
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `Error: Content type with ID ${contentTypeId} not found.`
                    }
                }]
            };
        }

        return {
            messages: [{
                role: 'user',
                content: {
                    type: 'text',
                    text: `Please generate a content item for "${type.name}" about "${topic}".\n\nThe content must adhere to this JSON schema:\n${type.schema}\n\nProvide ONLY the JSON data.`
                }
            }]
        };
    }
);

server.prompt(
    'workflow-guidance',
    'Guide the agent through the content creation workflow',
    {},
    async () => {
        return {
            messages: [{
                role: 'user',
                content: {
                    type: 'text',
                    text: `You are an AI assistant helping with content management in WordClaw.\n\nHere is the recommended workflow:\n1. List available content types using 'list_content_types'.\n2. If a suitable type exists, use 'get_content_items' to see existing examples.\n3. Create a new item using 'create_content_item'.\n4. If no suitable type exists, create one using 'create_content_type'.\n\nAlways check for 'recommendedNextAction' in API responses.`
                }
            }]
        };
    }
);

export async function startServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('WordClaw MCP Server running on stdio');
}
