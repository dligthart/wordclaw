import { and, desc, eq, gte, lt, lte, or } from 'drizzle-orm';
import { getDomainId } from '../api/auth.js';
import { GraphQLError } from 'graphql';
import GraphQLJSON from 'graphql-type-json';

import { db } from '../db/index.js';
import { auditLogs, contentItemVersions, contentItems, contentTypes, payments, workflows, workflowTransitions } from '../db/schema.js';
import { logAudit } from '../services/audit.js';
import { ValidationFailure, validateContentDataAgainstSchema, validateContentTypeSchema, redactPremiumFields } from '../services/content-schema.js';
import { createWebhook, deleteWebhook, getWebhookById, listWebhooks, normalizeWebhookEvents, parseWebhookEvents, updateWebhook, isSafeWebhookUrl } from '../services/webhook.js';
import { enforceL402Payment } from '../middleware/l402.js';
import { globalL402Options } from '../services/l402-config.js';
import { WorkflowService } from '../services/workflow.js';
import { EmbeddingService } from '../services/embedding.js';
import { AgentRunService, AgentRunServiceError, isAgentRunControlAction, isAgentRunStatus } from '../services/agent-runs.js';

const TARGET_VERSION_NOT_FOUND = 'TARGET_VERSION_NOT_FOUND';
const CONTENT_TYPE_SLUG_CONSTRAINTS = new Set([
    'content_types_slug_unique',
    'content_types_domain_slug_unique'
]);

type ResolverContext = {
    requestId?: string;
    authPrincipal?: { keyId: number | string; scopes: Set<string>; source: string };
    headers?: Record<string, string>;
    url?: string;
};

function contextView(context: unknown): ResolverContext {
    if (!context || typeof context !== 'object') {
        return {};
    }

    return context as ResolverContext;
}

function toActorId(context: unknown): number | undefined {
    const view = contextView(context);
    return typeof view.authPrincipal?.keyId === 'number' ? view.authPrincipal.keyId : undefined;
}

function toRequestId(context: unknown): string | undefined {
    const view = contextView(context);
    return typeof view.requestId === 'string' ? view.requestId : undefined;
}

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
    schema: string | Record<string, any>;
    dryRun?: boolean;
};
type UpdateContentTypeArgs = {
    id: IdValue;
    name?: string;
    slug?: string;
    description?: string;
    schema?: string | Record<string, any>;
    dryRun?: boolean;
};
type DeleteContentTypeArgs = {
    id: IdValue;
    dryRun?: boolean;
};
type CreateContentItemArgs = {
    contentTypeId: IdValue;
    data: string | Record<string, any>;
    status?: string;
    dryRun?: boolean;
};
type UpdateContentItemArgs = {
    id: IdValue;
    contentTypeId?: IdValue;
    data?: string | Record<string, any>;
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
type CreateWebhookArgs = {
    url: string;
    events: string[];
    secret: string;
    active?: boolean;
};
type UpdateWebhookArgs = {
    id: IdValue;
    url?: string;
    events?: string[];
    secret?: string;
    active?: boolean;
};
type DeleteWebhookArgs = {
    id: IdValue;
};
type AgentRunsArgs = {
    status?: string;
    limit?: number;
    offset?: number;
};
type AgentRunDefinitionsArgs = {
    active?: boolean;
    limit?: number;
    offset?: number;
};
type CreateAgentRunDefinitionArgs = {
    name: string;
    runType: string;
    strategyConfig?: Record<string, unknown>;
    active?: boolean;
};
type UpdateAgentRunDefinitionArgs = {
    id: IdValue;
    name?: string;
    runType?: string;
    strategyConfig?: Record<string, unknown>;
    active?: boolean;
};
type CreateAgentRunArgs = {
    goal: string;
    runType?: string;
    definitionId?: IdValue;
    requireApproval?: boolean;
    metadata?: Record<string, unknown>;
};
type ControlAgentRunArgs = {
    id: IdValue;
    action: string;
};

type BatchCreateContentItemsArgs = {
    items: Array<{
        contentTypeId: IdValue;
        data: string | Record<string, any>;
        status?: string;
    }>;
    atomic?: boolean;
    dryRun?: boolean;
};

type BatchUpdateContentItemsArgs = {
    items: Array<{
        id: IdValue;
        contentTypeId?: IdValue;
        data?: string | Record<string, any>;
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

function isUniqueViolation(error: unknown, constraints: Set<string>): boolean {
    const visited = new Set<unknown>();
    let candidate: unknown = error;

    while (candidate && typeof candidate === 'object' && !visited.has(candidate)) {
        visited.add(candidate);
        const maybeDbError = candidate as { code?: string; constraint?: string; cause?: unknown };
        if (
            maybeDbError.code === '23505'
            && typeof maybeDbError.constraint === 'string'
            && constraints.has(maybeDbError.constraint)
        ) {
            return true;
        }
        candidate = maybeDbError.cause;
    }

    return false;
}

function contentTypeSlugConflictError(slug: string): GraphQLError {
    return toError(
        'Content type slug already exists',
        'CONTENT_TYPE_SLUG_CONFLICT',
        `Choose a different slug than '${slug}' or update the existing content type in this domain.`
    );
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

// Removed isValidUrl in favor of isSafeWebhookUrl

function toIsoString(value: Date | null): string | null {
    if (!value) {
        return null;
    }
    return value.toISOString();
}

function serializeAgentRunDefinition(definition: {
    id: number;
    domainId: number;
    name: string;
    runType: string;
    strategyConfig: unknown;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        id: definition.id,
        domainId: definition.domainId,
        name: definition.name,
        runType: definition.runType,
        strategyConfig: definition.strategyConfig,
        active: definition.active,
        createdAt: definition.createdAt.toISOString(),
        updatedAt: definition.updatedAt.toISOString()
    };
}

function serializeAgentRun(run: {
    id: number;
    domainId: number;
    definitionId: number | null;
    goal: string;
    runType: string;
    status: string;
    requestedBy: string | null;
    metadata: unknown;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        id: run.id,
        domainId: run.domainId,
        definitionId: run.definitionId,
        goal: run.goal,
        runType: run.runType,
        status: run.status,
        requestedBy: run.requestedBy,
        metadata: run.metadata,
        startedAt: toIsoString(run.startedAt),
        completedAt: toIsoString(run.completedAt),
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
        steps: [],
        checkpoints: []
    };
}

function serializeAgentRunStep(step: {
    id: number;
    runId: number;
    domainId: number;
    stepIndex: number;
    stepKey: string;
    actionType: string;
    status: string;
    requestSnapshot: unknown;
    responseSnapshot: unknown;
    errorMessage: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        id: step.id,
        runId: step.runId,
        domainId: step.domainId,
        stepIndex: step.stepIndex,
        stepKey: step.stepKey,
        actionType: step.actionType,
        status: step.status,
        requestSnapshot: step.requestSnapshot,
        responseSnapshot: step.responseSnapshot,
        errorMessage: step.errorMessage,
        startedAt: toIsoString(step.startedAt),
        completedAt: toIsoString(step.completedAt),
        createdAt: step.createdAt.toISOString(),
        updatedAt: step.updatedAt.toISOString()
    };
}

function serializeAgentRunCheckpoint(checkpoint: {
    id: number;
    runId: number;
    domainId: number;
    checkpointKey: string;
    payload: unknown;
    createdAt: Date;
}) {
    return {
        id: checkpoint.id,
        runId: checkpoint.runId,
        domainId: checkpoint.domainId,
        checkpointKey: checkpoint.checkpointKey,
        payload: checkpoint.payload,
        createdAt: checkpoint.createdAt.toISOString()
    };
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
    data?: string | Record<string, any>;
    status?: string;
}, index: number, domainId: number): Promise<{
    ok: true;
    existing: typeof contentItems.$inferSelect;
    updateData: ContentItemUpdateInput;
} | {
    ok: false;
    error: BatchResultRow;
}> {
    const dataStr = item.data ? (typeof item.data === 'string' ? item.data : JSON.stringify(item.data)) : undefined;

    const updateData = stripUndefined({
        contentTypeId: item.contentTypeId,
        data: dataStr,
        status: item.status
    }) as ContentItemUpdateInput;

    if (!hasDefinedValues(updateData)) {
        return {
            ok: false,
            error: buildBatchError(index, 'EMPTY_UPDATE_BODY', `No update fields provided for item ${item.id}`)
        };
    }

    const [existing] = await db.select().from(contentItems).where(and(
        eq(contentItems.id, item.id),
        eq(contentItems.domainId, domainId)
    ));
    if (!existing) {
        return {
            ok: false,
            error: buildBatchError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${item.id} not found`)
        };
    }

    const targetContentTypeId = updateData.contentTypeId ?? existing.contentTypeId;
    const [targetContentType] = await db.select().from(contentTypes).where(and(
        eq(contentTypes.id, targetContentTypeId),
        eq(contentTypes.domainId, domainId)
    ));
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

    const activeWorkflow = await WorkflowService.getActiveWorkflow(domainId, targetContentTypeId);
    if (activeWorkflow && updateData.status && updateData.status !== existing.status) {
        return {
            ok: false,
            error: buildBatchError(index, 'WORKFLOW_TRANSITION_FORBIDDEN', `Content type governed by workflow. Assign 'draft' or submit transitions exclusively.`)
        };
    }

    return {
        ok: true,
        existing,
        updateData
    };
}


import { PolicyEngine } from '../services/policy.js';
import { buildOperationContext } from '../services/policy-adapters.js';

function withPolicy(
    operation: string,
    extractResource: (args: any) => any,
    resolver: any
) {
    return async (parent: any, args: any, context: any, info: any) => {
        const resource = extractResource(args) || { type: 'system' };
        const operationContext = buildOperationContext('graphql', context?.authPrincipal, operation, resource);
        const decision = await PolicyEngine.evaluate(operationContext);

        if (decision.outcome !== 'allow') {
            throw toError(
                'Access Denied by Policy',
                decision.code,
                decision.remediation || 'Contact administrator.',
                decision.metadata
            );
        }

        let l402Result;
        // Apply L402 Payment Check for create/update/delete on content items
        if (resource.type === 'content_item' || resource.type === 'batch' || (operation === 'content.write' && !['content_type', 'webhook', 'agent_run', 'agent_run_definition'].includes(resource.type))) {
            const pricingContext = {
                resourceType: 'content-item',
                operation: operation.includes('write') ? (args.id ? 'update' : 'create') : 'read',
                contentTypeId: args.contentTypeId ? parseOptionalId(args.contentTypeId, 'contentTypeId') : undefined,
                resourceId: args.id ? parseOptionalId(args.id, 'id') : undefined,
                batchSize: args.items?.length || args.ids?.length || 1
            };

            l402Result = await enforceL402Payment(
                globalL402Options,
                pricingContext,
                context?.headers?.authorization,
                {
                    path: context?.url || '/graphql',
                    domainId: getDomainId(context),
                    requestInfo: {
                        method: 'POST',
                        headers: context?.headers || {}
                    }
                }
            );

            if (!l402Result.ok) {
                if (l402Result.mustChallenge && l402Result.challengeHeaders) {
                    const authenticateHeader = l402Result.challengeHeaders['WWW-Authenticate'] || '';
                    const macaroonMatch = /macaroon="([^"]+)"/.exec(authenticateHeader);
                    const invoiceMatch = /invoice="([^"]+)"/.exec(authenticateHeader);

                    throw toError(
                        'Payment Required',
                        'PAYMENT_REQUIRED',
                        `L402 Payment Required`,
                        {
                            macaroon: macaroonMatch ? macaroonMatch[1] : undefined,
                            invoice: invoiceMatch ? invoiceMatch[1] : undefined
                        }
                    );
                } else if (l402Result.errorPayload) {
                    const l402ErrorPayload = l402Result.errorPayload as {
                        error?: {
                            code?: string;
                            message?: string;
                        };
                    };
                    throw toError(
                        'Payment Error',
                        l402ErrorPayload.error?.code || 'PAYMENT_ERROR',
                        l402ErrorPayload.error?.message || 'Payment processing failed.'
                    );
                } else {
                    throw toError('Payment Required', 'PAYMENT_REQUIRED', 'L402 payment required');
                }
            }
        }

        const result = await resolver(parent, args, context, info);

        // If a payment was made and processing is finished, we should mark it consumed if a callback was returned
        if (l402Result && typeof l402Result.onFinish === 'function') {
            await l402Result.onFinish();
        }

        return result;
    };
}

export const resolvers = {
    JSON: GraphQLJSON,
    Query: {
        contentTypes: withPolicy('content.read', () => ({ type: 'system' }), async (_parent: unknown, { limit: rawLimit, offset: rawOffset }: ContentTypesArgs, context: unknown) => {
            const limit = clampLimit(rawLimit);
            const offset = clampOffset(rawOffset);
            return db.select()
                .from(contentTypes)
                .where(eq(contentTypes.domainId, getDomainId(context)))
                .limit(limit)
                .offset(offset);
        }),

        contentType: withPolicy('content.read', (args) => ({ type: 'content_type', id: args.id }), async (_parent: unknown, { id }: IdArg, context: unknown) => {
            const numericId = parseId(id);
            const [type] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, numericId), eq(contentTypes.domainId, getDomainId(context))));
            return type || null;
        }),

        contentItems: withPolicy('content.read', (args) => ({ type: 'system' }), async (_parent: unknown, {
            contentTypeId,
            status,
            createdAfter,
            createdBefore,
            limit: rawLimit,
            offset: rawOffset
        }: OptionalContentTypeArg, context: unknown) => {
            const numericTypeId = parseOptionalId(contentTypeId, 'contentTypeId');
            const afterDate = parseDateArg(createdAfter, 'createdAfter');
            const beforeDate = parseDateArg(createdBefore, 'createdBefore');
            const limit = clampLimit(rawLimit);
            const offset = clampOffset(rawOffset);

            const conditions = [
                eq(contentItems.domainId, getDomainId(context)),
                numericTypeId !== undefined ? eq(contentItems.contentTypeId, numericTypeId) : undefined,
                status ? eq(contentItems.status, status) : undefined,
                afterDate ? gte(contentItems.createdAt, afterDate) : undefined,
                beforeDate ? lte(contentItems.createdAt, beforeDate) : undefined,
            ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

            const rawItems = await db.select({
                item: contentItems,
                schema: contentTypes.schema,
                basePrice: contentTypes.basePrice
            })
                .from(contentItems)
                .innerJoin(contentTypes, eq(contentItems.contentTypeId, contentTypes.id))
                .where(conditions.length > 0 ? and(...conditions) : undefined)
                .limit(limit)
                .offset(offset);

            return rawItems.map(row => {
                if ((row.basePrice || 0) > 0) {
                    return {
                        ...row.item,
                        data: redactPremiumFields(row.schema, row.item.data)
                    };
                }
                return row.item;
            });
        }),

        contentItem: withPolicy('content.read', (args) => ({ type: 'content_item', id: args.id }), async (_parent: unknown, { id }: IdArg, context: unknown) => {
            const numericId = parseId(id);
            const [row] = await db.select({
                item: contentItems,
                basePrice: contentTypes.basePrice
            })
                .from(contentItems)
                .innerJoin(contentTypes, eq(contentItems.contentTypeId, contentTypes.id))
                .where(and(eq(contentItems.id, numericId), eq(contentItems.domainId, getDomainId(context))));

            if (!row) return null;
            if ((row.basePrice || 0) > 0) {
                throw toError(
                    'L402 Payment Required',
                    'PAYMENT_REQUIRED',
                    'This content item is paywalled. You must use the REST API /api/content-items/:id to fulfill the L402 payment challenge.'
                );
            }
            return row.item;
        }),

        contentItemVersions: withPolicy('content.read', (args) => ({ type: 'content_item', id: args.id }), async (_parent: unknown, { id }: IdArg, context: unknown) => {
            const numericId = parseId(id);
            return db.select({
                id: contentItemVersions.id,
                contentItemId: contentItemVersions.contentItemId,
                version: contentItemVersions.version,
                data: contentItemVersions.data,
                status: contentItemVersions.status,
                createdAt: contentItemVersions.createdAt
            })
                .from(contentItemVersions)
                .innerJoin(contentItems, eq(contentItemVersions.contentItemId, contentItems.id))
                .where(and(eq(contentItemVersions.contentItemId, numericId), eq(contentItems.domainId, getDomainId(context))))
                .orderBy(desc(contentItemVersions.version));
        }),

        auditLogs: withPolicy('audit.read', () => ({ type: 'system' }), async (_parent: unknown, { entityType, entityId, action, limit: rawLimit, cursor }: AuditLogArgs, context: unknown) => {
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
                eq(auditLogs.domainId, getDomainId(context)),
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
        }),

        payments: withPolicy('payment.read', () => ({ type: 'system' }), async (_parent: unknown, { limit: rawLimit, offset: rawOffset }: { limit?: number; offset?: number }, context: unknown) => {
            const limit = clampLimit(rawLimit);
            const offset = clampOffset(rawOffset);
            const results = await db.select().from(payments)
                .where(eq(payments.domainId, getDomainId(context)))
                .orderBy(desc(payments.createdAt))
                .limit(limit)
                .offset(offset);

            return results.map(row => ({
                ...row,
                createdAt: row.createdAt.toISOString(),
                details: row.details ? JSON.stringify(row.details) : null
            }));
        }),

        payment: withPolicy('payment.read', (args) => ({ type: 'payment', id: args.id }), async (_parent: unknown, { id }: IdArg, context: unknown) => {
            const numericId = parseId(id);
            const [payment] = await db.select().from(payments).where(and(eq(payments.id, numericId), eq(payments.domainId, getDomainId(context))));
            if (!payment) return null;
            return {
                ...payment,
                createdAt: payment.createdAt.toISOString(),
                details: payment.details ? JSON.stringify(payment.details) : null
            };
        }),

        webhooks: withPolicy('webhook.list', () => ({ type: 'system' }), async (_parent: unknown, _args: unknown, context?: unknown) => {
            const hooks = await listWebhooks(getDomainId(context));
            return hooks.map((hook) => ({
                id: hook.id,
                url: hook.url,
                events: parseWebhookEvents(hook.events),
                active: hook.active,
                createdAt: hook.createdAt
            }));
        }),

        webhook: withPolicy('webhook.list', (args) => ({ type: 'webhook', id: args.id }), async (_parent: unknown, { id }: IdArg, context?: unknown) => {
            const numericId = parseId(id);
            const hook = await getWebhookById(numericId, getDomainId(context));
            if (!hook) {
                return null;
            }

            return {
                id: hook.id,
                url: hook.url,
                events: parseWebhookEvents(hook.events),
                active: hook.active,
                createdAt: hook.createdAt
            };
        }),

        agentRuns: withPolicy('content.read', () => ({ type: 'agent_run' }), async (_parent: unknown, { status, limit, offset }: AgentRunsArgs, context?: unknown) => {
            if (status && !isAgentRunStatus(status)) {
                throw toError(
                    'Invalid run status',
                    'AGENT_RUN_INVALID_STATUS',
                    'Use one of: queued, planning, waiting_approval, running, succeeded, failed, cancelled.'
                );
            }

            const runs = await AgentRunService.listRuns(getDomainId(context), {
                status: status as any,
                limit,
                offset
            });

            return runs.items.map(serializeAgentRun);
        }),

        agentRun: withPolicy('content.read', (args) => ({ type: 'agent_run', id: args.id }), async (_parent: unknown, { id }: IdArg, context?: unknown) => {
            const numericId = parseId(id);
            const details = await AgentRunService.getRun(getDomainId(context), numericId);
            if (!details) {
                return null;
            }

            return {
                ...serializeAgentRun(details.run),
                steps: details.steps.map(serializeAgentRunStep),
                checkpoints: details.checkpoints.map(serializeAgentRunCheckpoint)
            };
        }),

        agentRunDefinitions: withPolicy('content.read', () => ({ type: 'agent_run_definition' }), async (_parent: unknown, { active, limit, offset }: AgentRunDefinitionsArgs, context?: unknown) => {
            const definitions = await AgentRunService.listDefinitions(getDomainId(context), {
                active,
                limit,
                offset
            });
            return definitions.items.map(serializeAgentRunDefinition);
        }),

        agentRunDefinition: withPolicy('content.read', (args) => ({ type: 'agent_run_definition', id: args.id }), async (_parent: unknown, { id }: IdArg, context?: unknown) => {
            const numericId = parseId(id);
            const definition = await AgentRunService.getDefinition(getDomainId(context), numericId);
            return definition ? serializeAgentRunDefinition(definition) : null;
        }),

        semanticSearch: withPolicy('content.read', () => ({ type: 'system' }), async (_parent: unknown, args: { query: string, limit?: number }, context: unknown) => {
            return await EmbeddingService.searchSemanticKnowledge(getDomainId(context), args.query, args.limit);
        })
    },

    Mutation: {
        createContentType: withPolicy('content.write', () => ({ type: 'system' }), async (_parent: unknown, args: CreateContentTypeArgs, context?: unknown) => {
            const now = new Date();
            const schemaStr = typeof args.schema === 'string' ? args.schema : JSON.stringify(args.schema);
            const schemaFailure = validateContentTypeSchema(schemaStr);
            if (schemaFailure) {
                throw toErrorFromValidation(schemaFailure);
            }

            if (args.dryRun) {
                return {
                    id: 0,
                    name: args.name,
                    slug: args.slug,
                    description: args.description,
                    schema: schemaStr,
                    createdAt: now,
                    updatedAt: now
                };
            }

            let newItem;
            try {
                [newItem] = await db.insert(contentTypes).values({
                    domainId: getDomainId(context),
                    name: args.name,
                    slug: args.slug,
                    description: args.description,
                    schema: schemaStr
                }).returning();
            } catch (error) {
                if (isUniqueViolation(error, CONTENT_TYPE_SLUG_CONSTRAINTS)) {
                    throw contentTypeSlugConflictError(args.slug);
                }
                throw error;
            }

            await logAudit(getDomainId(context), 'create', 'content_type', newItem.id, newItem, toActorId(context), toRequestId(context));
            return newItem;
        }),

        updateContentType: withPolicy('content.write', (args) => ({ type: 'content_type', id: args.id }), async (_parent: unknown, args: UpdateContentTypeArgs, context?: unknown) => {
            const id = parseId(args.id);
            const schemaStr = args.schema ? (typeof args.schema === 'string' ? args.schema : JSON.stringify(args.schema)) : undefined;
            const updateData = stripUndefined({
                name: args.name,
                slug: args.slug,
                description: args.description,
                schema: schemaStr
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
                const [existing] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, id), eq(contentTypes.domainId, getDomainId(context))));
                if (!existing) {
                    throw notFoundContentTypeError(id);
                }

                return { ...existing, ...updateData };
            }

            let updated;
            try {
                [updated] = await db.update(contentTypes)
                    .set(updateData)
                    .where(and(eq(contentTypes.id, id), eq(contentTypes.domainId, getDomainId(context))))
                    .returning();
            } catch (error) {
                if (isUniqueViolation(error, CONTENT_TYPE_SLUG_CONSTRAINTS)) {
                    throw contentTypeSlugConflictError(args.slug ?? '');
                }
                throw error;
            }

            if (!updated) {
                throw notFoundContentTypeError(id);
            }

            await logAudit(getDomainId(context), 'update', 'content_type', updated.id, updateData, toActorId(context), toRequestId(context));
            return updated;
        }),

        deleteContentType: withPolicy('content.write', (args) => ({ type: 'content_type', id: args.id }), async (_parent: unknown, args: DeleteContentTypeArgs, context?: unknown) => {
            const id = parseId(args.id);

            if (args.dryRun) {
                const [existing] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, id), eq(contentTypes.domainId, getDomainId(context))));
                if (!existing) {
                    throw notFoundContentTypeError(id);
                }

                return {
                    id,
                    message: `[Dry Run] Content type '${existing.name}' would be deleted`
                };
            }

            const [deleted] = await db.delete(contentTypes)
                .where(and(eq(contentTypes.id, id), eq(contentTypes.domainId, getDomainId(context))))
                .returning();

            if (!deleted) {
                throw notFoundContentTypeError(id);
            }

            await logAudit(getDomainId(context), 'delete', 'content_type', deleted.id, deleted, toActorId(context), toRequestId(context));

            return {
                id: deleted.id,
                message: `Content type '${deleted.name}' deleted successfully`
            };
        }),

        createContentItem: withPolicy('content.write', () => ({ type: 'system' }), async (_parent: unknown, args: CreateContentItemArgs, context?: unknown) => {
            const contentTypeId = parseId(args.contentTypeId, 'contentTypeId');
            const status = args.status || 'draft';
            const now = new Date();
            const dataStr = typeof args.data === 'string' ? args.data : JSON.stringify(args.data);
            const [contentType] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, contentTypeId), eq(contentTypes.domainId, getDomainId(context))));
            if (!contentType) {
                throw notFoundContentTypeError(contentTypeId);
            }

            const contentFailure = validateContentDataAgainstSchema(contentType.schema, dataStr);
            if (contentFailure) {
                throw toErrorFromValidation(contentFailure);
            }

            const activeWorkflow = await WorkflowService.getActiveWorkflow(getDomainId(context), contentTypeId);
            if (activeWorkflow && status !== 'draft') {
                throw toError(
                    'Workflow transition forbidden',
                    'WORKFLOW_TRANSITION_FORBIDDEN',
                    `This content type is governed by an active workflow. You cannot manually set the status. Save as a 'draft' and submit for review.`
                );
            }

            if (args.dryRun) {
                return {
                    id: 0,
                    contentTypeId,
                    data: dataStr,
                    status,
                    version: 1,
                    createdAt: now,
                    updatedAt: now
                };
            }

            const [newItem] = await db.insert(contentItems).values({
                domainId: getDomainId(context),
                contentTypeId,
                data: dataStr,
                status
            }).returning();

            if (newItem.status === 'published') {
                EmbeddingService.syncItemEmbeddings(getDomainId(context), newItem.id).catch(console.error);
            } else {
                EmbeddingService.deleteItemEmbeddings(getDomainId(context), newItem.id).catch(console.error);
            }

            await logAudit(getDomainId(context), 'create', 'content_item', newItem.id, newItem, toActorId(context), toRequestId(context));
            return newItem;
        }),

        createContentItemsBatch: withPolicy('content.write', () => ({ type: 'batch' }), async (_parent: unknown, args: BatchCreateContentItemsArgs, context?: unknown) => {
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
                data: typeof item.data === 'string' ? item.data : JSON.stringify(item.data),
                status: item.status
            }));

            if (args.dryRun) {
                const results: BatchResultRow[] = [];
                for (const [index, item] of normalizedItems.entries()) {
                    const [contentType] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, item.contentTypeId), eq(contentTypes.domainId, getDomainId(context))));
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
                            const [contentType] = await tx.select().from(contentTypes).where(and(eq(contentTypes.id, item.contentTypeId), eq(contentTypes.domainId, getDomainId(context))));
                            if (!contentType) {
                                throw new Error(JSON.stringify(buildBatchError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${item.contentTypeId} not found`)));
                            }

                            const validation = validateContentDataAgainstSchema(contentType.schema, item.data);
                            if (validation) {
                                throw new Error(JSON.stringify(buildBatchError(index, validation.code, validation.error)));
                            }

                            const activeWorkflow = await WorkflowService.getActiveWorkflow(getDomainId(context), item.contentTypeId as number);
                            if (activeWorkflow && item.status && item.status !== 'draft') {
                                throw new Error(JSON.stringify(buildBatchError(index, 'WORKFLOW_TRANSITION_FORBIDDEN', `Content type governed by workflow. Assign 'draft' during batch creations.`)));
                            }

                            const [created] = await tx.insert(contentItems).values({
                                domainId: getDomainId(context),
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
                            await logAudit(getDomainId(context), 'create', 'content_item', row.id, { batch: true, mode: 'atomic' }, toActorId(context), toRequestId(context));
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
                    const [contentType] = await db.select().from(contentTypes).where(and(
                        eq(contentTypes.id, item.contentTypeId),
                        eq(contentTypes.domainId, getDomainId(context))
                    ));
                    if (!contentType) {
                        results.push(buildBatchError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${item.contentTypeId} not found`));
                        continue;
                    }

                    const validation = validateContentDataAgainstSchema(contentType.schema, item.data);
                    if (validation) {
                        results.push(buildBatchError(index, validation.code, validation.error));
                        continue;
                    }

                    const activeWorkflow = await WorkflowService.getActiveWorkflow(getDomainId(context), item.contentTypeId as number);
                    if (activeWorkflow && item.status && item.status !== 'draft') {
                        results.push(buildBatchError(index, 'WORKFLOW_TRANSITION_FORBIDDEN', `Content type governed by workflow. Assign 'draft' during batch creations.`));
                        continue;
                    }

                    const [created] = await db.insert(contentItems).values({
                        domainId: getDomainId(context),
                        contentTypeId: item.contentTypeId,
                        data: item.data,
                        status: item.status || 'draft'
                    }).returning();

                    await logAudit(getDomainId(context), 'create', 'content_item', created.id, { batch: true, mode: 'partial' }, toActorId(context), toRequestId(context));

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
        }),

        updateContentItem: withPolicy('content.write', (args) => ({ type: 'content_item', id: args.id }), async (_parent: unknown, args: UpdateContentItemArgs, context?: unknown) => {
            const id = parseId(args.id);
            const contentTypeId = parseOptionalId(args.contentTypeId, 'contentTypeId');
            const dataStr = args.data ? (typeof args.data === 'string' ? args.data : JSON.stringify(args.data)) : undefined;
            const updateData = stripUndefined({
                contentTypeId,
                data: dataStr,
                status: args.status
            });

            if (!hasDefinedValues(updateData)) {
                throw emptyUpdateBodyError('contentTypeId, data, status');
            }

            const [existing] = await db.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(context))));
            if (!existing) {
                throw notFoundContentItemError(id);
            }

            const targetContentTypeId = typeof updateData.contentTypeId === 'number'
                ? updateData.contentTypeId
                : existing.contentTypeId;
            const [contentType] = await db.select().from(contentTypes).where(and(
                eq(contentTypes.id, targetContentTypeId),
                eq(contentTypes.domainId, getDomainId(context))
            ));
            if (!contentType) {
                throw notFoundContentTypeError(targetContentTypeId);
            }

            const targetData = typeof updateData.data === 'string' ? updateData.data : existing.data;
            const contentFailure = validateContentDataAgainstSchema(contentType.schema, targetData);
            if (contentFailure) {
                throw toErrorFromValidation(contentFailure);
            }

            const activeWorkflow = await WorkflowService.getActiveWorkflow(getDomainId(context), targetContentTypeId);
            if (activeWorkflow && args.status && args.status !== existing.status) {
                throw toError(
                    'Workflow transition forbidden',
                    'WORKFLOW_TRANSITION_FORBIDDEN',
                    `This content type is governed by an active workflow. You cannot manually set the status. Submit for review instead.`
                );
            }

            if (args.dryRun) {
                return { ...existing, ...updateData };
            }

            const result = await db.transaction(async (tx) => {
                const [current] = await tx.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(context))));
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
                    .where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(context))))
                    .returning();

                return updated;
            });

            if (!result) {
                throw notFoundContentItemError(id);
            }

            if (result.status === 'published') {
                EmbeddingService.syncItemEmbeddings(getDomainId(context), result.id).catch(console.error);
            } else {
                EmbeddingService.deleteItemEmbeddings(getDomainId(context), result.id).catch(console.error);
            }

            await logAudit(getDomainId(context), 'update', 'content_item', result.id, updateData, toActorId(context), toRequestId(context));
            return result;
        }),

        updateContentItemsBatch: withPolicy('content.write', () => ({ type: 'batch' }), async (_parent: unknown, args: BatchUpdateContentItemsArgs, context?: unknown) => {
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
                    const validated = await validateContentItemUpdateInput(item, index, getDomainId(context));
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

                            const [existing] = await tx.select().from(contentItems).where(and(eq(contentItems.id, item.id), eq(contentItems.domainId, getDomainId(context))));
                            if (!existing) {
                                throw new Error(JSON.stringify(buildBatchError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${item.id} not found`)));
                            }

                            const targetContentTypeId = updateData.contentTypeId ?? existing.contentTypeId;
                            const [targetContentType] = await tx.select().from(contentTypes).where(and(
                                eq(contentTypes.id, targetContentTypeId),
                                eq(contentTypes.domainId, getDomainId(context))
                            ));
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
                                .where(and(
                                    eq(contentItems.id, item.id),
                                    eq(contentItems.domainId, getDomainId(context))
                                ))
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
                            await logAudit(getDomainId(context), 'update', 'content_item', row.id, { batch: true, mode: 'atomic' }, toActorId(context), toRequestId(context));
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
                const validated = await validateContentItemUpdateInput(item, index, getDomainId(context));
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
                        .where(and(
                            eq(contentItems.id, validated.existing.id),
                            eq(contentItems.domainId, getDomainId(context))
                        ))
                        .returning();

                    return updated;
                });

                await logAudit(getDomainId(context), 'update', 'content_item', result.id, { batch: true, mode: 'partial' }, toActorId(context), toRequestId(context));

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
        }),

        deleteContentItem: withPolicy('content.write', (args) => ({ type: 'content_item', id: args.id }), async (_parent: unknown, args: DeleteContentItemArgs, context?: unknown) => {
            const id = parseId(args.id);

            if (args.dryRun) {
                const [existing] = await db.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(context))));
                if (!existing) {
                    throw notFoundContentItemError(id);
                }

                return {
                    id,
                    message: `[Dry Run] Content item ${id} would be deleted`
                };
            }

            const [deleted] = await db.delete(contentItems)
                .where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(context))))
                .returning();

            if (!deleted) {
                throw notFoundContentItemError(id);
            }

            await logAudit(getDomainId(context), 'delete', 'content_item', deleted.id, deleted, toActorId(context), toRequestId(context));

            return {
                id: deleted.id,
                message: `Content item ${deleted.id} deleted successfully`
            };
        }),

        deleteContentItemsBatch: withPolicy('content.write', () => ({ type: 'batch' }), async (_parent: unknown, args: BatchDeleteContentItemsArgs, context?: unknown) => {
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
                    const [existing] = await db.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(context))));
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
                            const [deleted] = await tx.delete(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(context)))).returning();
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
                            await logAudit(getDomainId(context), 'delete', 'content_item', row.id, { batch: true, mode: 'atomic' }, toActorId(context), toRequestId(context));
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
                const [deleted] = await db.delete(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(context)))).returning();
                if (!deleted) {
                    results.push(buildBatchError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${id} not found`));
                    continue;
                }

                await logAudit(getDomainId(context), 'delete', 'content_item', deleted.id, { batch: true, mode: 'partial' }, toActorId(context), toRequestId(context));
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
        }),

        createWebhook: withPolicy('webhook.write', () => ({ type: 'system' }), async (_parent: unknown, args: CreateWebhookArgs, context?: unknown) => {
            if (!await isSafeWebhookUrl(args.url)) {
                throw toError(
                    'Invalid webhook URL',
                    'INVALID_WEBHOOK_URL',
                    'Provide a valid absolute URL such as https://example.com/hooks/wordclaw.'
                );
            }

            let events: string[];
            try {
                events = normalizeWebhookEvents(args.events);
            } catch (error) {
                throw toError(
                    'Invalid webhook events',
                    'INVALID_WEBHOOK_EVENTS',
                    (error as Error).message
                );
            }

            const created = await createWebhook({
                domainId: getDomainId(context), url: args.url,
                events,
                secret: args.secret,
                active: args.active
            });

            await logAudit(getDomainId(context), 'create',
                'webhook',
                created.id,
                { url: created.url, events, active: created.active },
                toActorId(context),
                toRequestId(context)
            );

            return {
                id: created.id,
                url: created.url,
                events: parseWebhookEvents(created.events),
                active: created.active,
                createdAt: created.createdAt
            };
        }),

        updateWebhook: withPolicy('webhook.write', (args) => ({ type: 'webhook', id: args.id }), async (_parent: unknown, args: UpdateWebhookArgs, context?: unknown) => {
            const id = parseId(args.id);
            const updateData = stripUndefined({
                url: args.url,
                events: args.events,
                secret: args.secret,
                active: args.active
            });

            if (!hasDefinedValues(updateData)) {
                throw emptyUpdateBodyError('url, events, secret, active');
            }

            if (typeof args.url === 'string' && !await isSafeWebhookUrl(args.url)) {
                throw toError(
                    'Invalid webhook URL',
                    'INVALID_WEBHOOK_URL',
                    'Provide a valid absolute URL such as https://example.com/hooks/wordclaw.'
                );
            }

            let normalizedEvents: string[] | undefined;
            if (args.events !== undefined) {
                try {
                    normalizedEvents = normalizeWebhookEvents(args.events);
                } catch (error) {
                    throw toError(
                        'Invalid webhook events',
                        'INVALID_WEBHOOK_EVENTS',
                        (error as Error).message
                    );
                }
            }

            const updated = await updateWebhook(id, getDomainId(context), {
                url: args.url,
                events: normalizedEvents,
                secret: args.secret,
                active: args.active
            });

            if (!updated) {
                throw toError(
                    'Webhook not found',
                    'WEBHOOK_NOT_FOUND',
                    `No webhook exists with ID ${id}.`
                );
            }

            await logAudit(getDomainId(context), 'update',
                'webhook',
                updated.id,
                { url: updated.url, events: parseWebhookEvents(updated.events), active: updated.active },
                toActorId(context),
                toRequestId(context)
            );

            return {
                id: updated.id,
                url: updated.url,
                events: parseWebhookEvents(updated.events),
                active: updated.active,
                createdAt: updated.createdAt
            };
        }),

        deleteWebhook: withPolicy('webhook.write', (args) => ({ type: 'webhook', id: args.id }), async (_parent: unknown, args: DeleteWebhookArgs, context?: unknown) => {
            const id = parseId(args.id);
            const existing = await getWebhookById(id, getDomainId(context));
            if (!existing) {
                throw toError(
                    'Webhook not found',
                    'WEBHOOK_NOT_FOUND',
                    `No webhook exists with ID ${id}.`
                );
            }

            await deleteWebhook(id, getDomainId(context));
            await logAudit(getDomainId(context), 'delete',
                'webhook',
                existing.id,
                { url: existing.url, events: parseWebhookEvents(existing.events) },
                toActorId(context),
                toRequestId(context)
            );

            return {
                id: existing.id,
                message: `Webhook ${id} deleted successfully`
            };
        }),

        rollbackContentItem: withPolicy('content.write', (args) => ({ type: 'content_item', id: args.id }), async (_parent: unknown, args: RollbackContentItemArgs, context?: unknown) => {
            const id = parseId(args.id);
            const targetVersion = args.version;
            const [currentItem] = await db.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(context))));
            if (!currentItem) {
                throw notFoundContentItemError(id);
            }

            const [target] = await db.select()
                .from(contentItemVersions)
                .where(and(eq(contentItemVersions.contentItemId, id), eq(contentItemVersions.version, targetVersion)));

            if (!target) {
                throw targetVersionNotFoundError(id, targetVersion);
            }

            const [contentType] = await db.select().from(contentTypes).where(and(
                eq(contentTypes.id, currentItem.contentTypeId),
                eq(contentTypes.domainId, getDomainId(context))
            ));
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
                    const [current] = await tx.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(context))));
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
                        .where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(context))))
                        .returning();

                    return restored;
                });

                if (!result) {
                    throw notFoundContentItemError(id);
                }

                await logAudit(getDomainId(context), 'rollback', 'content_item', result.id, {
                    fromVersion: result.version - 1,
                    toVersion: targetVersion
                }, toActorId(context), toRequestId(context));

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
        }),

        policyEvaluate: withPolicy('policy.read', () => ({ type: 'system' }), async (_parent: unknown, { operation, resource }: { operation: string, resource: { type: string, id?: string, contentTypeId?: string } }, context?: unknown) => {
            const operationContext = buildOperationContext(
                'graphql',
                (context as any)?.authPrincipal,
                operation,
                resource
            );
            return PolicyEngine.evaluate(operationContext);
        }),

        createAgentRunDefinition: withPolicy('content.write', () => ({ type: 'agent_run_definition' }), async (_parent: unknown, args: CreateAgentRunDefinitionArgs, context?: unknown) => {
            try {
                const definition = await AgentRunService.createDefinition(getDomainId(context), {
                    name: args.name,
                    runType: args.runType,
                    strategyConfig: args.strategyConfig,
                    active: args.active
                });
                return serializeAgentRunDefinition(definition);
            } catch (error) {
                if (error instanceof AgentRunServiceError) {
                    if (error.code === 'AGENT_RUN_DEFINITION_NAME_CONFLICT') {
                        throw toError(
                            'Run definition name already exists',
                            error.code,
                            'Choose a unique run definition name in this domain.'
                        );
                    }
                    if (error.code === 'AGENT_RUN_DEFINITION_INVALID_NAME' || error.code === 'AGENT_RUN_DEFINITION_INVALID_RUN_TYPE') {
                        throw toError(
                            'Invalid run definition payload',
                            error.code,
                            error.message
                        );
                    }
                }
                throw error;
            }
        }),

        updateAgentRunDefinition: withPolicy('content.write', (args) => ({ type: 'agent_run_definition', id: args.id }), async (_parent: unknown, args: UpdateAgentRunDefinitionArgs, context?: unknown) => {
            const definitionId = parseId(args.id);

            try {
                const definition = await AgentRunService.updateDefinition(getDomainId(context), definitionId, {
                    name: args.name,
                    runType: args.runType,
                    strategyConfig: args.strategyConfig,
                    active: args.active
                });
                return serializeAgentRunDefinition(definition);
            } catch (error) {
                if (error instanceof AgentRunServiceError) {
                    if (error.code === 'AGENT_RUN_DEFINITION_NOT_FOUND') {
                        throw toError(
                            'Run definition not found',
                            error.code,
                            `The run definition with ID ${definitionId} does not exist in this domain.`
                        );
                    }
                    if (error.code === 'AGENT_RUN_DEFINITION_NAME_CONFLICT') {
                        throw toError(
                            'Run definition name already exists',
                            error.code,
                            'Choose a unique run definition name in this domain.'
                        );
                    }
                    if (
                        error.code === 'AGENT_RUN_DEFINITION_INVALID_NAME'
                        || error.code === 'AGENT_RUN_DEFINITION_INVALID_RUN_TYPE'
                        || error.code === 'AGENT_RUN_DEFINITION_EMPTY_UPDATE'
                    ) {
                        throw toError(
                            'Invalid run definition update',
                            error.code,
                            error.message
                        );
                    }
                }
                throw error;
            }
        }),

        createAgentRun: withPolicy('content.write', () => ({ type: 'agent_run' }), async (_parent: unknown, args: CreateAgentRunArgs, context?: unknown) => {
            const definitionId = args.definitionId !== undefined
                ? parseId(args.definitionId, 'definitionId')
                : undefined;
            const requestedBy = contextView(context).authPrincipal?.keyId?.toString();

            try {
                const run = await AgentRunService.createRun(getDomainId(context), {
                    goal: args.goal,
                    runType: args.runType,
                    definitionId,
                    requireApproval: args.requireApproval,
                    metadata: args.metadata,
                    requestedBy
                });
                return serializeAgentRun(run);
            } catch (error) {
                if (error instanceof AgentRunServiceError) {
                    if (error.code === 'AGENT_RUN_DEFINITION_NOT_FOUND') {
                        throw toError(
                            'Run definition not found',
                            error.code,
                            'Provide a valid definitionId owned by this domain.'
                        );
                    }

                    if (error.code === 'AGENT_RUN_INVALID_GOAL') {
                        throw toError(
                            'Invalid run goal',
                            error.code,
                            'Provide a non-empty goal string.'
                        );
                    }
                }

                throw error;
            }
        }),

        controlAgentRun: withPolicy('content.write', (args) => ({ type: 'agent_run', id: args.id }), async (_parent: unknown, args: ControlAgentRunArgs, context?: unknown) => {
            const runId = parseId(args.id);
            if (!isAgentRunControlAction(args.action)) {
                throw toError(
                    'Invalid control action',
                    'AGENT_RUN_INVALID_ACTION',
                    'Use one of: approve, pause, resume, cancel.'
                );
            }

            try {
                const updated = await AgentRunService.controlRun(getDomainId(context), runId, args.action);
                return serializeAgentRun(updated);
            } catch (error) {
                if (error instanceof AgentRunServiceError) {
                    if (error.code === 'AGENT_RUN_NOT_FOUND') {
                        throw toError(
                            'Agent run not found',
                            error.code,
                            `The agent run with ID ${runId} does not exist in the current domain.`
                        );
                    }

                    if (error.code === 'AGENT_RUN_INVALID_TRANSITION') {
                        throw toError(
                            'Invalid run transition',
                            error.code,
                            error.message
                        );
                    }
                }

                throw error;
            }
        }),

        createWorkflow: withPolicy('system.config', () => ({ type: 'system' }), async (_parent: unknown, args: { name: string; contentTypeId: IdValue; active?: boolean }, context?: unknown) => {
            const contentTypeId = parseId(args.contentTypeId, 'contentTypeId');
            try {
                return await WorkflowService.createWorkflow(
                    getDomainId(context),
                    args.name,
                    contentTypeId,
                    args.active !== undefined ? args.active : true
                );
            } catch (error) {
                if (error instanceof Error && error.message === 'CONTENT_TYPE_NOT_FOUND') {
                    throw notFoundContentTypeError(contentTypeId);
                }
                throw error;
            }
        }),

        createWorkflowTransition: withPolicy('system.config', () => ({ type: 'system' }), async (_parent: unknown, args: { workflowId: IdValue; fromState: string; toState: string; requiredRoles: string[] }, context?: unknown) => {
            const workflowId = parseId(args.workflowId, 'workflowId');
            try {
                return await WorkflowService.createWorkflowTransition(
                    getDomainId(context),
                    workflowId,
                    args.fromState,
                    args.toState,
                    args.requiredRoles
                );
            } catch (error) {
                if (error instanceof Error && error.message === 'WORKFLOW_NOT_FOUND') {
                    throw toError(
                        'Workflow not found',
                        'WORKFLOW_NOT_FOUND',
                        `Provide a valid workflowId owned by this domain. Received '${workflowId}'.`
                    );
                }
                throw error;
            }
        }),

        submitReviewTask: withPolicy('content.write', (args) => ({ type: 'content_item', id: args.contentItemId }), async (_parent: unknown, args: { contentItemId: IdValue; workflowTransitionId: IdValue; assignee?: string }, context?: unknown) => {
            const authPrincipal = context && typeof context === 'object' && 'authPrincipal' in context ? (context.authPrincipal as { scopes: Set<string>; domainId: number }) : undefined;
            return await WorkflowService.submitForReview({
                domainId: getDomainId(context),
                contentItemId: parseId(args.contentItemId),
                workflowTransitionId: parseId(args.workflowTransitionId),
                assignee: args.assignee,
                authPrincipal
            });
        }),

        decideReviewTask: withPolicy('content.write', () => ({ type: 'system' }), async (_parent: unknown, args: { taskId: IdValue; decision: 'approved' | 'rejected' }, context?: unknown) => {
            const authPrincipal = context && typeof context === 'object' && 'authPrincipal' in context ? (context.authPrincipal as { scopes: Set<string>; domainId: number }) : { scopes: new Set<string>(), domainId: 0 };
            return await WorkflowService.decideReviewTask(
                getDomainId(context),
                parseId(args.taskId),
                args.decision,
                authPrincipal
            );
        }),

        addReviewComment: withPolicy('content.write', (args) => ({ type: 'content_item', id: args.contentItemId }), async (_parent: unknown, args: { contentItemId: IdValue; comment: string }, context?: unknown) => {
            const authorId = typeof (context as any)?.authPrincipal?.keyId === 'number'
                ? (context as any).authPrincipal.keyId.toString()
                : 'supervisor';
            const comment = await WorkflowService.addComment(getDomainId(context), parseId(args.contentItemId), authorId, args.comment);
            return {
                ...comment,
                createdAt: comment.createdAt.toISOString()
            };
        })
    }
};
