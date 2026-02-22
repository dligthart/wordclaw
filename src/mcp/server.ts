import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { and, desc, eq, gte, lt, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db/index.js';
import { auditLogs, contentItemVersions, contentItems, contentTypes, payments } from '../db/schema.js';
import { logAudit } from '../services/audit.js';
import { ValidationFailure, validateContentDataAgainstSchema, validateContentTypeSchema } from '../services/content-schema.js';
import { createApiKey, listApiKeys, normalizeScopes, revokeApiKey } from '../services/api-key.js';
import { createWebhook, deleteWebhook, getWebhookById, listWebhooks, normalizeWebhookEvents, parseWebhookEvents, updateWebhook } from '../services/webhook.js';

import { PolicyEngine } from '../services/policy.js';
import { buildOperationContext } from '../services/policy-adapters.js';

function withMCPPolicy<T>(operation: string, extractResource: (args: T) => any, handler: (args: T, extra: any) => Promise<ToolResult>) {
    return async (args: T, extra: any) => {
        const principal = { keyId: 'mcp-local', scopes: new Set(['admin']), source: 'local' };
        const resource = extractResource(args) || { type: 'system' };
        const operationContext = buildOperationContext('mcp', principal, operation, resource);
        const decision = await PolicyEngine.evaluate(operationContext);
        if (decision.outcome !== 'allow') {
            return err(`${decision.code}: Access Denied by Policy. ${decision.remediation || ''}`);
        }
        return handler(args, extra);
    };
}

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

function parseDateArg(value: string | undefined, fieldName: string): Date | null {
    if (!value) {
        return null;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid ${fieldName}: expected ISO-8601 date-time string`);
    }

    return parsed;
}

function isValidUrl(url: string): boolean {
    try {
        // eslint-disable-next-line no-new
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

function encodeCursor(createdAt: Date, id: number): string {
    return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id }), 'utf8').toString('base64url');
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

server.tool(
    'create_content_type',
    'Create a new content type schema',
    {
        name: z.string().describe('Name of the content type'),
        slug: z.string().describe('Unique slug for the content type'),
        description: z.string().optional().describe('Description of the content type'),
        schema: z.union([z.string(), z.record(z.string(), z.any())]).describe('JSON schema definition as a string or object'),
        dryRun: z.boolean().optional().describe('If true, simulates the action without making changes')
    },
    withMCPPolicy('content.write', () => ({ type: 'system' }), async ({ name, slug, description, schema, dryRun }) => {
        try {
            const schemaStr = typeof schema === 'string' ? schema : JSON.stringify(schema);
            const schemaFailure = validateContentTypeSchema(schemaStr);
            if (schemaFailure) {
                return err(validationFailureToText(schemaFailure));
            }

            if (dryRun) {
                return ok(`[Dry Run] Would create content type '${name}' with slug '${slug}'`);
            }

            const [newItem] = await db.insert(contentTypes).values({
                domainId: 1,
                name,
                slug,
                description,
                schema: schemaStr
            }).returning();

            await logAudit(1, 'create', 'content_type', newItem.id, newItem);

            return ok(`Created content type '${newItem.name}' (ID: ${newItem.id})`);
        } catch (error) {
            return err(`Error creating content type: ${(error as Error).message}`);
        }
    }
    ));

server.tool(
    'list_content_types',
    'List all available content types',
    {
        limit: z.number().optional().describe('Page size (default 50, max 500)'),
        offset: z.number().optional().describe('Row offset (default 0)')
    },
    withMCPPolicy('content.read', () => ({ type: 'system' }), async ({ limit: rawLimit, offset: rawOffset }) => {
        const limit = clampLimit(rawLimit);
        const offset = clampOffset(rawOffset);
        const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(contentTypes);
        const types = await db.select()
            .from(contentTypes)
            .limit(limit)
            .offset(offset);

        return okJson({
            items: types,
            total,
            limit,
            offset,
            hasMore: offset + types.length < total
        });
    }
    ));

server.tool(
    'get_content_type',
    'Get a content type by ID or Slug',
    {
        id: z.number().optional().describe('ID of the content type'),
        slug: z.string().optional().describe('Slug of the content type')
    },
    withMCPPolicy('content.read', (args) => ({ type: 'content_type', id: args.id }), async ({ id, slug }) => {
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
    ));

server.tool(
    'update_content_type',
    'Update an existing content type',
    {
        id: z.number().describe('ID of the content type to update'),
        name: z.string().optional(),
        slug: z.string().optional(),
        description: z.string().optional(),
        schema: z.union([z.string(), z.record(z.string(), z.any())]).optional(),
        dryRun: z.boolean().optional()
    },
    withMCPPolicy('content.write', (args) => ({ type: 'content_type', id: args.id }), async ({ id, name, slug, description, schema, dryRun }) => {
        try {
            const schemaStr = schema ? (typeof schema === 'string' ? schema : JSON.stringify(schema)) : undefined;
            const updateData = stripUndefined({ name, slug, description, schema: schemaStr });
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

            await logAudit(1, 'update', 'content_type', updated.id, updateData);

            return ok(`Updated content type '${updated.name}' (ID: ${updated.id})`);
        } catch (error) {
            return err(`Error updating content type: ${(error as Error).message}`);
        }
    }
    ));

server.tool(
    'delete_content_type',
    'Delete a content type',
    {
        id: z.number().describe('ID of the content type to delete'),
        dryRun: z.boolean().optional()
    },
    withMCPPolicy('content.write', (args) => ({ type: 'content_type', id: args.id }), async ({ id, dryRun }) => {
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

            await logAudit(1, 'delete', 'content_type', deleted.id, deleted);

            return ok(`Deleted content type '${deleted.name}' (ID: ${deleted.id})`);
        } catch (error) {
            return err(`Error deleting content type: ${(error as Error).message}`);
        }
    }
    ));

server.tool(
    'create_api_key',
    'Create a new API key for agent authentication',
    {
        name: z.string().describe('Human-readable name'),
        scopes: z.array(z.string()).describe('Scopes such as content:read|content:write|audit:read|admin'),
        expiresAt: z.string().optional().describe('Optional ISO expiry timestamp')
    },
    withMCPPolicy('apikey.write', () => ({ type: 'system' }), async ({ name, scopes, expiresAt }) => {
        try {
            let normalizedScopes: string[];
            try {
                normalizedScopes = normalizeScopes(scopes);
            } catch (error) {
                return err(`Invalid scopes: ${(error as Error).message}`);
            }

            let parsedExpiry: Date | null = null;
            if (expiresAt) {
                parsedExpiry = new Date(expiresAt);
                if (Number.isNaN(parsedExpiry.getTime())) {
                    return err('Invalid expiresAt: must be ISO date-time string');
                }
            }

            const { key, plaintext } = await createApiKey({
                domainId: 1, name,
                scopes: normalizedScopes,
                expiresAt: parsedExpiry
            });

            await logAudit(1, 'create', 'api_key', key.id, {
                mcpTool: 'create_api_key',
                name: key.name,
                scopes: normalizedScopes
            });

            return okJson({
                id: key.id,
                name: key.name,
                keyPrefix: key.keyPrefix,
                scopes: normalizedScopes,
                expiresAt: key.expiresAt,
                apiKey: plaintext
            });
        } catch (error) {
            return err(`Error creating API key: ${(error as Error).message}`);
        }
    }
    ));

server.tool(
    'list_api_keys',
    'List API keys and their status',
    {},
    withMCPPolicy('apikey.list', () => ({ type: 'system' }), async () => {
        const keys = await listApiKeys(1);
        return okJson(keys.map((key) => ({
            id: key.id,
            name: key.name,
            keyPrefix: key.keyPrefix,
            scopes: key.scopes.split('|').filter(Boolean),
            createdBy: key.createdBy,
            createdAt: key.createdAt,
            expiresAt: key.expiresAt,
            revokedAt: key.revokedAt,
            lastUsedAt: key.lastUsedAt
        })));
    }
    ));

server.tool(
    'revoke_api_key',
    'Revoke an active API key',
    {
        id: z.number().describe('API key id to revoke')
    },
    withMCPPolicy('apikey.write', (args) => ({ type: 'apikey', id: args.id }), async ({ id }) => {
        const revoked = await revokeApiKey(id, 1);
        if (!revoked) {
            return err(`API key ${id} not found or already revoked`);
        }

        await logAudit(1, 'delete', 'api_key', revoked.id, {
            mcpTool: 'revoke_api_key',
            keyPrefix: revoked.keyPrefix
        });

        return ok(`Revoked API key ${revoked.id}`);
    }
    ));

server.tool(
    'create_webhook',
    'Register a webhook endpoint for audit events',
    {
        url: z.string().describe('Absolute callback URL'),
        events: z.array(z.string()).describe('Subscribed event patterns, e.g. content_item.create'),
        secret: z.string().describe('Shared secret for HMAC signing'),
        active: z.boolean().optional().describe('Whether webhook is active immediately')
    },
    withMCPPolicy('webhook.write', () => ({ type: 'system' }), async ({ url, events, secret, active }) => {
        try {
            if (!isValidUrl(url)) {
                return err('INVALID_WEBHOOK_URL: Provide a valid absolute URL.');
            }

            let normalizedEvents: string[];
            try {
                normalizedEvents = normalizeWebhookEvents(events);
            } catch (error) {
                return err(`INVALID_WEBHOOK_EVENTS: ${(error as Error).message}`);
            }

            const created = await createWebhook({
                domainId: 1, url,
                events: normalizedEvents,
                secret,
                active
            });

            await logAudit(1, 'create', 'webhook', created.id, {
                mcpTool: 'create_webhook',
                url: created.url,
                events: normalizedEvents,
                active: created.active
            });

            return okJson({
                id: created.id,
                url: created.url,
                events: parseWebhookEvents(created.events),
                active: created.active,
                createdAt: created.createdAt
            });
        } catch (error) {
            return err(`Error creating webhook: ${(error as Error).message}`);
        }
    }
    ));

server.tool(
    'list_webhooks',
    'List registered webhooks',
    {},
    withMCPPolicy('webhook.list', () => ({ type: 'system' }), async () => {
        try {
            const hooks = await listWebhooks(1);
            return okJson(hooks.map((hook) => ({
                id: hook.id,
                url: hook.url,
                events: parseWebhookEvents(hook.events),
                active: hook.active,
                createdAt: hook.createdAt
            })));
        } catch (error) {
            return err(`Error listing webhooks: ${(error as Error).message}`);
        }
    }
    ));

server.tool(
    'get_webhook',
    'Get webhook by ID',
    {
        id: z.number().describe('Webhook ID')
    },
    withMCPPolicy('webhook.list', (args) => ({ type: 'webhook', id: args.id }), async ({ id }) => {
        try {
            const hook = await getWebhookById(id, 1);
            if (!hook) {
                return err(`WEBHOOK_NOT_FOUND: Webhook ${id} not found`);
            }

            return okJson({
                id: hook.id,
                url: hook.url,
                events: parseWebhookEvents(hook.events),
                active: hook.active,
                createdAt: hook.createdAt
            });
        } catch (error) {
            return err(`Error reading webhook: ${(error as Error).message}`);
        }
    }
    ));

server.tool(
    'update_webhook',
    'Update webhook URL, events, secret, or active state',
    {
        id: z.number().describe('Webhook ID'),
        url: z.string().optional(),
        events: z.array(z.string()).optional(),
        secret: z.string().optional(),
        active: z.boolean().optional()
    },
    withMCPPolicy('webhook.write', (args) => ({ type: 'webhook', id: args.id }), async ({ id, url, events, secret, active }) => {
        try {
            if (url !== undefined && !isValidUrl(url)) {
                return err('INVALID_WEBHOOK_URL: Provide a valid absolute URL.');
            }

            let normalizedEvents: string[] | undefined;
            if (events !== undefined) {
                try {
                    normalizedEvents = normalizeWebhookEvents(events);
                } catch (error) {
                    return err(`INVALID_WEBHOOK_EVENTS: ${(error as Error).message}`);
                }
            }

            if (url === undefined && normalizedEvents === undefined && secret === undefined && active === undefined) {
                return err('EMPTY_UPDATE_BODY: Provide at least one update field.');
            }

            const updated = await updateWebhook(id, 1, {
                url,
                events: normalizedEvents,
                secret,
                active
            });

            if (!updated) {
                return err(`WEBHOOK_NOT_FOUND: Webhook ${id} not found`);
            }

            await logAudit(1, 'update', 'webhook', updated.id, {
                mcpTool: 'update_webhook',
                url: updated.url,
                events: parseWebhookEvents(updated.events),
                active: updated.active
            });

            return okJson({
                id: updated.id,
                url: updated.url,
                events: parseWebhookEvents(updated.events),
                active: updated.active,
                createdAt: updated.createdAt
            });
        } catch (error) {
            return err(`Error updating webhook: ${(error as Error).message}`);
        }
    }
    ));

server.tool(
    'delete_webhook',
    'Delete a webhook registration',
    {
        id: z.number().describe('Webhook ID')
    },
    withMCPPolicy('webhook.write', (args) => ({ type: 'webhook', id: args.id }), async ({ id }) => {
        try {
            const existing = await getWebhookById(id, 1);
            if (!existing) {
                return err(`WEBHOOK_NOT_FOUND: Webhook ${id} not found`);
            }

            await deleteWebhook(id, 1);
            await logAudit(1, 'delete', 'webhook', existing.id, {
                mcpTool: 'delete_webhook',
                url: existing.url,
                events: parseWebhookEvents(existing.events)
            });

            return ok(`Deleted webhook ${id}`);
        } catch (error) {
            return err(`Error deleting webhook: ${(error as Error).message}`);
        }
    }
    ));

server.tool(
    'create_content_item',
    'Create a new content item',
    {
        contentTypeId: z.number().describe('ID of the content type'),
        data: z.union([z.string(), z.record(z.string(), z.any())]).describe('JSON string or object of the content data conforming to the schema'),
        status: z.enum(['draft', 'published', 'archived']).optional().describe('Status of the item'),
        dryRun: z.boolean().optional().describe('If true, simulates the action without making changes')
    },
    withMCPPolicy('content.write', (args) => ({ type: 'content_type', id: args.contentTypeId }), async ({ contentTypeId, data, status, dryRun }) => {
        try {
            const [contentType] = await db.select().from(contentTypes).where(eq(contentTypes.id, contentTypeId));
            if (!contentType) {
                return err(`Content type ${contentTypeId} not found`);
            }

            const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
            const contentFailure = validateContentDataAgainstSchema(contentType.schema, dataStr);
            if (contentFailure) {
                return err(validationFailureToText(contentFailure));
            }

            if (dryRun) {
                return ok(`[Dry Run] Would create content item for type ${contentTypeId} with status '${status || 'draft'}'`);
            }

            const [newItem] = await db.insert(contentItems).values({
                domainId: 1,
                contentTypeId,
                data: dataStr,
                status: status || 'draft'
            }).returning();

            await logAudit(1, 'create', 'content_item', newItem.id, newItem);

            return ok(`Created content item ID: ${newItem.id}`);
        } catch (error) {
            return err(`Error creating content item: ${(error as Error).message}`);
        }
    }
    ));

server.tool(
    'create_content_items_batch',
    'Create multiple content items in one operation',
    {
        items: z.array(z.object({
            contentTypeId: z.number(),
            data: z.union([z.string(), z.record(z.string(), z.any())]),
            status: z.string().optional()
        })),
        atomic: z.boolean().optional(),
        dryRun: z.boolean().optional()
    },
    withMCPPolicy('content.write', () => ({ type: 'batch' }), async ({ items, atomic, dryRun }) => {
        if (items.length === 0) {
            return err('EMPTY_BATCH: Provide at least one item.');
        }

        const buildItemError = (index: number, code: string, errorText: string) => ({ index, ok: false, code, error: errorText });
        const isAtomic = atomic === true;

        if (dryRun) {
            const results = await Promise.all(items.map(async (item, index) => {
                const [contentType] = await db.select().from(contentTypes).where(eq(contentTypes.id, item.contentTypeId));
                if (!contentType) {
                    return buildItemError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${item.contentTypeId} not found`);
                }

                const itemDataStr = typeof item.data === 'string' ? item.data : JSON.stringify(item.data);
                const validation = validateContentDataAgainstSchema(contentType.schema, itemDataStr);
                if (validation) {
                    return buildItemError(index, validation.code, validation.error);
                }

                return {
                    index,
                    ok: true,
                    id: 0,
                    version: 1
                };
            }));

            return okJson({ atomic: isAtomic, results });
        }

        if (isAtomic) {
            try {
                const results = await db.transaction(async (tx) => {
                    const output: Array<Record<string, unknown>> = [];

                    for (const [index, item] of items.entries()) {
                        const [contentType] = await tx.select().from(contentTypes).where(eq(contentTypes.id, item.contentTypeId));
                        if (!contentType) {
                            throw new Error(JSON.stringify(buildItemError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${item.contentTypeId} not found`)));
                        }

                        const itemDataStr = typeof item.data === 'string' ? item.data : JSON.stringify(item.data);
                        const validation = validateContentDataAgainstSchema(contentType.schema, itemDataStr);
                        if (validation) {
                            throw new Error(JSON.stringify(buildItemError(index, validation.code, validation.error)));
                        }

                        const [created] = await tx.insert(contentItems).values({
                            domainId: 1,
                            contentTypeId: item.contentTypeId,
                            data: itemDataStr,
                            status: item.status || 'draft'
                        }).returning();

                        output.push({
                            index,
                            ok: true,
                            id: created.id,
                            version: created.version
                        });
                    }

                    return output;
                });

                for (const row of results) {
                    const id = row.id;
                    if (typeof id === 'number') {
                        await logAudit(1, 'create', 'content_item', id, { batch: true, mode: 'atomic' });
                    }
                }

                return okJson({
                    atomic: true,
                    results
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                try {
                    return err(`BATCH_ATOMIC_FAILED: ${JSON.stringify(JSON.parse(message))}`);
                } catch {
                    return err(`BATCH_ATOMIC_FAILED: ${message}`);
                }
            }
        }

        const results: Array<Record<string, unknown>> = [];
        for (const [index, item] of items.entries()) {
            try {
                const [contentType] = await db.select().from(contentTypes).where(eq(contentTypes.id, item.contentTypeId));
                if (!contentType) {
                    results.push(buildItemError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${item.contentTypeId} not found`));
                    continue;
                }

                const itemDataStr = typeof item.data === 'string' ? item.data : JSON.stringify(item.data);
                const validation = validateContentDataAgainstSchema(contentType.schema, itemDataStr);
                if (validation) {
                    results.push(buildItemError(index, validation.code, validation.error));
                    continue;
                }

                const [created] = await db.insert(contentItems).values({
                    domainId: 1,
                    contentTypeId: item.contentTypeId,
                    data: itemDataStr,
                    status: item.status || 'draft'
                }).returning();

                await logAudit(1, 'create', 'content_item', created.id, { batch: true, mode: 'partial' });

                results.push({
                    index,
                    ok: true,
                    id: created.id,
                    version: created.version
                });
            } catch (error) {
                results.push(buildItemError(index, 'BATCH_ITEM_FAILED', error instanceof Error ? error.message : String(error)));
            }
        }

        return okJson({
            atomic: false,
            results
        });
    }
    ));

server.tool(
    'get_content_items',
    'Get content items with optional filters and pagination',
    {
        contentTypeId: z.number().optional().describe('Filter by content type ID'),
        status: z.string().optional().describe('Filter by status'),
        createdAfter: z.string().optional().describe('ISO-8601 created-at lower bound'),
        createdBefore: z.string().optional().describe('ISO-8601 created-at upper bound'),
        limit: z.number().optional().describe('Page size (default 50, max 500)'),
        offset: z.number().optional().describe('Row offset (default 0)')
    },
    async ({ contentTypeId, status, createdAfter, createdBefore, limit: rawLimit, offset: rawOffset }) => {
        try {
            const limit = clampLimit(rawLimit);
            const offset = clampOffset(rawOffset);
            const afterDate = parseDateArg(createdAfter, 'createdAfter');
            const beforeDate = parseDateArg(createdBefore, 'createdBefore');

            const conditions = [
                contentTypeId !== undefined ? eq(contentItems.contentTypeId, contentTypeId) : undefined,
                status ? eq(contentItems.status, status) : undefined,
                afterDate ? gte(contentItems.createdAt, afterDate) : undefined,
                beforeDate ? lte(contentItems.createdAt, beforeDate) : undefined,
            ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

            const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
            const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
                .from(contentItems)
                .where(whereClause);

            const items = await db.select()
                .from(contentItems)
                .where(whereClause)
                .limit(limit)
                .offset(offset);

            return okJson({
                items,
                total,
                limit,
                offset,
                hasMore: offset + items.length < total
            });
        } catch (error) {
            return err(`Error listing content items: ${(error as Error).message}`);
        }
    }
);

server.tool(
    'get_content_item',
    'Get a single content item by ID',
    {
        id: z.number().describe('ID of the content item')
    },
    withMCPPolicy('content.read', (args) => ({ type: 'content_item', id: args.id }), async ({ id }) => {
        const [item] = await db.select().from(contentItems).where(eq(contentItems.id, id));
        if (!item) {
            return err('Content item not found');
        }
        return okJson(item);
    }
    ));

server.tool(
    'update_content_item',
    'Update a content item with versioning',
    {
        id: z.number().describe('ID of the content item'),
        data: z.union([z.string(), z.record(z.string(), z.any())]).optional().describe('New JSON data or object'),
        status: z.enum(['draft', 'published', 'archived']).optional(),
        dryRun: z.boolean().optional()
    },
    withMCPPolicy('content.write', (args) => ({ type: 'content_item', id: args.id }), async ({ id, data, status, dryRun }) => {
        try {
            const dataStr = data ? (typeof data === 'string' ? data : JSON.stringify(data)) : undefined;
            const updateData = stripUndefined({ data: dataStr, status });
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

            await logAudit(1, 'update', 'content_item', result.id, updateData);

            return ok(`Updated content item ${result.id} to version ${result.version}`);
        } catch (error) {
            return err(`Error updating content item: ${(error as Error).message}`);
        }
    }
    ));

server.tool(
    'update_content_items_batch',
    'Update multiple content items in one operation',
    {
        items: z.array(z.object({
            id: z.number(),
            contentTypeId: z.number().optional(),
            data: z.string().optional(),
            status: z.string().optional()
        })),
        atomic: z.boolean().optional(),
        dryRun: z.boolean().optional()
    },
    withMCPPolicy('content.write', () => ({ type: 'batch' }), async ({ items, atomic, dryRun }) => {
        if (items.length === 0) {
            return err('EMPTY_BATCH: Provide at least one item.');
        }

        const buildItemError = (index: number, code: string, errorText: string) => ({ index, ok: false, code, error: errorText });
        const isAtomic = atomic === true;

        const validateInput = async (
            item: { id: number; contentTypeId?: number; data?: string; status?: string },
            index: number
        ) => {
            const updateData = stripUndefined({
                contentTypeId: item.contentTypeId,
                data: item.data,
                status: item.status
            });

            if (!hasDefinedValues(updateData)) {
                return {
                    ok: false,
                    error: buildItemError(index, 'EMPTY_UPDATE_BODY', `No update fields provided for item ${item.id}`)
                } as const;
            }

            const [existing] = await db.select().from(contentItems).where(eq(contentItems.id, item.id));
            if (!existing) {
                return {
                    ok: false,
                    error: buildItemError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${item.id} not found`)
                } as const;
            }

            const targetContentTypeId = item.contentTypeId ?? existing.contentTypeId;
            const [contentType] = await db.select().from(contentTypes).where(eq(contentTypes.id, targetContentTypeId));
            if (!contentType) {
                return {
                    ok: false,
                    error: buildItemError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${targetContentTypeId} not found`)
                } as const;
            }

            const targetData = item.data ?? existing.data;
            const validation = validateContentDataAgainstSchema(contentType.schema, targetData);
            if (validation) {
                return {
                    ok: false,
                    error: buildItemError(index, validation.code, validation.error)
                } as const;
            }

            return {
                ok: true,
                existing,
                updateData
            } as const;
        };

        if (dryRun) {
            const results: Array<Record<string, unknown>> = [];
            for (const [index, item] of items.entries()) {
                const validated = await validateInput(item, index);
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

            return okJson({
                atomic: isAtomic,
                results
            });
        }

        if (isAtomic) {
            try {
                const results = await db.transaction(async (tx) => {
                    const output: Array<Record<string, unknown>> = [];

                    for (const [index, item] of items.entries()) {
                        const updateData = stripUndefined({
                            contentTypeId: item.contentTypeId,
                            data: item.data,
                            status: item.status
                        });

                        if (!hasDefinedValues(updateData)) {
                            throw new Error(JSON.stringify(buildItemError(index, 'EMPTY_UPDATE_BODY', `No update fields provided for item ${item.id}`)));
                        }

                        const [existing] = await tx.select().from(contentItems).where(eq(contentItems.id, item.id));
                        if (!existing) {
                            throw new Error(JSON.stringify(buildItemError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${item.id} not found`)));
                        }

                        const targetContentTypeId = item.contentTypeId ?? existing.contentTypeId;
                        const [contentType] = await tx.select().from(contentTypes).where(eq(contentTypes.id, targetContentTypeId));
                        if (!contentType) {
                            throw new Error(JSON.stringify(buildItemError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${targetContentTypeId} not found`)));
                        }

                        const targetData = item.data ?? existing.data;
                        const validation = validateContentDataAgainstSchema(contentType.schema, targetData);
                        if (validation) {
                            throw new Error(JSON.stringify(buildItemError(index, validation.code, validation.error)));
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
                    const id = row.id;
                    if (typeof id === 'number') {
                        await logAudit(1, 'update', 'content_item', id, { batch: true, mode: 'atomic' });
                    }
                }

                return okJson({
                    atomic: true,
                    results
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                try {
                    return err(`BATCH_ATOMIC_FAILED: ${JSON.stringify(JSON.parse(message))}`);
                } catch {
                    return err(`BATCH_ATOMIC_FAILED: ${message}`);
                }
            }
        }

        const results: Array<Record<string, unknown>> = [];
        for (const [index, item] of items.entries()) {
            const validated = await validateInput(item, index);
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

            await logAudit(1, 'update', 'content_item', result.id, { batch: true, mode: 'partial' });

            results.push({
                index,
                ok: true,
                id: result.id,
                version: result.version
            });
        }

        return okJson({
            atomic: false,
            results
        });
    }
    ));

server.tool(
    'delete_content_item',
    'Delete a content item',
    {
        id: z.number().describe('ID of the content item'),
        dryRun: z.boolean().optional()
    },
    withMCPPolicy('content.write', (args) => ({ type: 'content_item', id: args.id }), async ({ id, dryRun }) => {
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

            await logAudit(1, 'delete', 'content_item', deleted.id, deleted);

            return ok(`Deleted content item ${deleted.id}`);
        } catch (error) {
            return err(`Error deleting content item: ${(error as Error).message}`);
        }
    }
    ));

server.tool(
    'delete_content_items_batch',
    'Delete multiple content items in one operation',
    {
        ids: z.array(z.number()),
        atomic: z.boolean().optional(),
        dryRun: z.boolean().optional()
    },
    withMCPPolicy('content.write', () => ({ type: 'batch' }), async ({ ids, atomic, dryRun }) => {
        if (ids.length === 0) {
            return err('EMPTY_BATCH: Provide at least one id.');
        }

        const buildItemError = (index: number, code: string, errorText: string) => ({ index, ok: false, code, error: errorText });
        const isAtomic = atomic === true;

        if (dryRun) {
            const results = await Promise.all(ids.map(async (id, index) => {
                const [existing] = await db.select().from(contentItems).where(eq(contentItems.id, id));
                if (!existing) {
                    return buildItemError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${id} not found`);
                }

                return {
                    index,
                    ok: true,
                    id
                };
            }));

            return okJson({
                atomic: isAtomic,
                results
            });
        }

        if (isAtomic) {
            try {
                const results = await db.transaction(async (tx) => {
                    const rows: Array<Record<string, unknown>> = [];
                    for (const [index, id] of ids.entries()) {
                        const [deleted] = await tx.delete(contentItems).where(eq(contentItems.id, id)).returning();
                        if (!deleted) {
                            throw new Error(JSON.stringify(buildItemError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${id} not found`)));
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
                    const id = row.id;
                    if (typeof id === 'number') {
                        await logAudit(1, 'delete', 'content_item', id, { batch: true, mode: 'atomic' });
                    }
                }

                return okJson({
                    atomic: true,
                    results
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                try {
                    return err(`BATCH_ATOMIC_FAILED: ${JSON.stringify(JSON.parse(message))}`);
                } catch {
                    return err(`BATCH_ATOMIC_FAILED: ${message}`);
                }
            }
        }

        const results: Array<Record<string, unknown>> = [];
        for (const [index, id] of ids.entries()) {
            const [deleted] = await db.delete(contentItems).where(eq(contentItems.id, id)).returning();
            if (!deleted) {
                results.push(buildItemError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${id} not found`));
                continue;
            }

            await logAudit(1, 'delete', 'content_item', deleted.id, { batch: true, mode: 'partial' });
            results.push({
                index,
                ok: true,
                id: deleted.id
            });
        }

        return okJson({
            atomic: false,
            results
        });
    }
    ));

server.tool(
    'get_content_item_versions',
    'Get version history for a content item',
    {
        id: z.number().describe('ID of the content item')
    },
    withMCPPolicy('content.read', (args) => ({ type: 'content_item', id: args.id }), async ({ id }) => {
        const versions = await db.select()
            .from(contentItemVersions)
            .where(eq(contentItemVersions.contentItemId, id))
            .orderBy(desc(contentItemVersions.version));

        return okJson(versions);
    }
    ));

server.tool(
    'rollback_content_item',
    'Rollback content item to a previous version',
    {
        id: z.number().describe('ID of the content item'),
        version: z.number().describe('Target version number to rollback to'),
        dryRun: z.boolean().optional()
    },
    withMCPPolicy('content.write', (args) => ({ type: 'content_item', id: args.id }), async ({ id, version, dryRun }) => {
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

            await logAudit(1, 'rollback', 'content_item', result.id, { from: result.version - 1, to: version });

            return ok(`Rolled back item ${result.id} to version ${version} (new version ${result.version})`);

        } catch (error) {
            const message = (error as Error).message;
            if (message === TARGET_VERSION_NOT_FOUND) {
                return err(TARGET_VERSION_NOT_FOUND);
            }
            return err(`Error rolling back: ${message}`);
        }
    }
    ));

server.tool(
    'get_audit_logs',
    'Get audit logs',
    {
        limit: z.number().optional().default(50),
        entityType: z.string().optional(),
        entityId: z.number().optional(),
        action: z.string().optional(),
        cursor: z.string().optional().describe('Opaque cursor from previous call')
    },
    async ({ limit: rawLimit, entityType, entityId, action, cursor }) => {
        try {
            const limit = clampLimit(rawLimit);
            const decodedCursor = cursor ? decodeCursor(cursor) : null;
            if (cursor && !decodedCursor) {
                return err('INVALID_AUDIT_CURSOR: Provide cursor returned by previous get_audit_logs call.');
            }

            const baseConditions = [
                entityType ? eq(auditLogs.entityType, entityType) : undefined,
                entityId !== undefined ? eq(auditLogs.entityId, entityId) : undefined,
                action ? eq(auditLogs.action, action) : undefined,
            ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

            const cursorCondition = decodedCursor
                ? or(
                    lt(auditLogs.createdAt, decodedCursor.createdAt),
                    and(eq(auditLogs.createdAt, decodedCursor.createdAt), lt(auditLogs.id, decodedCursor.id))
                )
                : undefined;

            const whereConditions = [
                ...baseConditions,
                cursorCondition
            ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

            const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;
            const baseWhereClause = baseConditions.length > 0 ? and(...baseConditions) : undefined;

            const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
                .from(auditLogs)
                .where(baseWhereClause);

            const logs = await db.select({
                id: auditLogs.id,
                action: auditLogs.action,
                entityType: auditLogs.entityType,
                entityId: auditLogs.entityId,
                details: auditLogs.details,
                createdAt: auditLogs.createdAt
            })
                .from(auditLogs)
                .where(whereClause)
                .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
                .limit(limit + 1);

            const hasMore = logs.length > limit;
            const page = hasMore ? logs.slice(0, limit) : logs;
            const last = page[page.length - 1];

            return okJson({
                items: page,
                total,
                hasMore,
                nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null
            });
        } catch (error) {
            return err(`Error listing audit logs: ${(error as Error).message}`);
        }
    }
);

server.tool(
    'list_payments',
    'List all payments with optional pagination',
    {
        limit: z.number().min(1).max(500).default(50).describe('Maximum number of items to return'),
        offset: z.number().min(0).default(0).describe('Number of items to skip for pagination')
    },
    async ({ limit, offset }) => {
        try {
            const results = await db.select().from(payments)
                .orderBy(desc(payments.createdAt))
                .limit(limit)
                .offset(offset);

            return ok(JSON.stringify({
                message: `Found ${results.length} payments.`,
                payments: results
            }, null, 2));
        } catch (error) {
            return err(`Error listing payments: ${(error as Error).message}`);
        }
    }
);

server.tool(
    'get_payment',
    'Get a single payment by its numeric ID',
    {
        id: z.number().describe('The numeric ID of the payment to retrieve')
    },
    async ({ id }) => {
        try {
            const [payment] = await db.select().from(payments).where(eq(payments.id, id));

            if (!payment) {
                return err(`Payment with ID ${id} not found.`);
            }

            return ok(JSON.stringify({
                message: `Payment ${id} retrieved successfully.`,
                payment
            }, null, 2));
        } catch (error) {
            return err(`Error retrieving payment: ${(error as Error).message}`);
        }
    }
);

server.tool(
    'evaluate_policy',
    'Evaluate a policy decision without side effects (Simulation/Dry-Run)',
    {
        operation: z.string().describe('The operation string (e.g. content.read, content.write)'),
        resourceType: z.string().describe('The type of resource (e.g. content_item, system)'),
        resourceId: z.string().optional().describe('The ID of the resource'),
        contentTypeId: z.string().optional().describe('The content type ID of the resource')
    },
    withMCPPolicy('policy.read', () => ({ type: 'system' }), async ({ operation, resourceType, resourceId, contentTypeId }) => {
        const operationContext = buildOperationContext(
            'mcp',
            { keyId: 'mcp-local', scopes: new Set(['admin']), source: 'local' },
            operation,
            { type: resourceType, id: resourceId, contentTypeId }
        );
        const decision = await PolicyEngine.evaluate(operationContext);
        return okJson(decision);
    })
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
