import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { and, desc, eq, gte, lte, or, lt, sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import { auditLogs, contentItemVersions, contentItems, contentTypes, domains, paymentProviderEvents, payments, workflows, workflowTransitions, agentProfiles, offers, entitlements } from '../db/schema.js';
import { logAudit } from '../services/audit.js';
import { validateContentDataAgainstSchema, validateContentTypeSchema, ValidationFailure, redactPremiumFields } from '../services/content-schema.js';
import { AIErrorResponse, DryRunQuery, createAIResponse } from './types.js';
import { authenticateApiRequest, getDomainId } from './auth.js';
import { createApiKey, listApiKeys, normalizeScopes, revokeApiKey, rotateApiKey } from '../services/api-key.js';
import { createWebhook, deleteWebhook, getWebhookById, listWebhooks, normalizeWebhookEvents, parseWebhookEvents, updateWebhook, isSafeWebhookUrl } from '../services/webhook.js';
import { PolicyEngine } from '../services/policy.js';
import { buildOperationContext, resolveRestOperation, resolveRestResource } from '../services/policy-adapters.js';
import { createL402Challenge, l402Middleware } from '../middleware/l402.js';
import { globalL402Options } from '../services/l402-config.js';
import { WorkflowService } from '../services/workflow.js';
import { EmbeddingService, EmbeddingServiceError } from '../services/embedding.js';
import { LicensingService } from '../services/licensing.js';
import { transitionPaymentStatus } from '../services/payment-ledger.js';
import { paymentFlowMetrics } from '../services/payment-metrics.js';
import { parsePaymentWebhookEvent, verifyPaymentWebhookSignature } from '../services/payment-webhook.js';
import { AgentRunService, AgentRunServiceError, isAgentRunControlAction, isAgentRunStatus } from '../services/agent-runs.js';

type DryRunQueryType = { mode?: 'dry_run' };
type IdParams = { id: number };
type ContentTypeUpdate = Partial<typeof contentTypes.$inferInsert>;
type ContentItemUpdate = Partial<typeof contentItems.$inferInsert>;
type ContentItemsQuery = {
    contentTypeId?: number;
    status?: string;
    createdAfter?: string;
    createdBefore?: string;
    limit?: number;
    offset?: number;
};
type PaginationQuery = {
    limit?: number;
    offset?: number;
};
type AgentRunsQuery = {
    status?: string;
    runType?: string;
    definitionId?: number;
    limit?: number;
    offset?: number;
};
type AgentRunDefinitionsQuery = {
    active?: boolean;
    runType?: string;
    limit?: number;
    offset?: number;
};
type AuditLogQuery = {
    entityType?: string;
    entityId?: number;
    action?: string;
    limit?: number;
    cursor?: string;
};
type BatchModeQuery = {
    mode?: 'dry_run';
    atomic?: boolean;
};

type AIErrorPayload = {
    error: string;
    code: string;
    remediation: string;
    context?: Record<string, unknown>;
};

type PaymentMethod = 'lightning' | 'ap2';

type ParsedL402Credentials = {
    macaroon: string;
    preimage: string;
};

const TARGET_VERSION_NOT_FOUND = 'TARGET_VERSION_NOT_FOUND';
const CONTENT_TYPE_SLUG_CONSTRAINTS = new Set([
    'content_types_slug_unique',
    'content_types_domain_slug_unique'
]);

function toErrorPayload(error: string, code: string, remediation: string): AIErrorPayload {
    return { error, code, remediation };
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

function contentTypeSlugConflict(slug: string): AIErrorPayload {
    return toErrorPayload(
        'Content type slug already exists',
        'CONTENT_TYPE_SLUG_CONFLICT',
        `Choose a different slug than '${slug}' or update the existing content type in this domain.`
    );
}

function parseL402AuthorizationHeader(authHeader: string | undefined): ParsedL402Credentials | null {
    if (!authHeader || !authHeader.startsWith('L402 ')) {
        return null;
    }

    const credential = authHeader.slice(5).trim();
    if (!credential) {
        return null;
    }

    const separatorIndex = credential.indexOf(':');
    if (separatorIndex <= 0 || separatorIndex === credential.length - 1) {
        return null;
    }

    if (credential.indexOf(':', separatorIndex + 1) !== -1) {
        return null;
    }

    const macaroon = credential.slice(0, separatorIndex).trim();
    const preimage = credential.slice(separatorIndex + 1).trim();
    if (!macaroon || !preimage) {
        return null;
    }

    return { macaroon, preimage };
}

function readSingleHeaderValue(raw: string | string[] | undefined): string | null {
    if (typeof raw === 'string' && raw.length > 0) {
        return raw;
    }
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') {
        return raw[0];
    }
    return null;
}

function parsePositiveIntHeader(raw: string | null): number | null {
    if (!raw) {
        return null;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return null;
    }
    return parsed;
}

function offerScopeRank(scopeType: string): number {
    if (scopeType === 'item') return 0;
    if (scopeType === 'type') return 1;
    if (scopeType === 'subscription') return 2;
    return 99;
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
    dryRun = false,
    extraMeta: Record<string, unknown> = {}
) {
    return {
        recommendedNextAction,
        availableActions,
        actionPriority,
        cost,
        ...(dryRun ? { dryRun: true } : {})
        ,
        ...extraMeta
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

function notFoundAgentRun(id: number): AIErrorPayload {
    return toErrorPayload(
        'Agent run not found',
        'AGENT_RUN_NOT_FOUND',
        `The agent run with ID ${id} does not exist in the current domain.`
    );
}

function notFoundAgentRunDefinition(id: number): AIErrorPayload {
    return toErrorPayload(
        'Agent run definition not found',
        'AGENT_RUN_DEFINITION_NOT_FOUND',
        `The agent run definition with ID ${id} does not exist in the current domain.`
    );
}

function toIsoString(value: Date | null): string | null {
    if (!value) {
        return null;
    }
    return value.toISOString();
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
        updatedAt: run.updatedAt.toISOString()
    };
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

function toAuditActorId(request: { authPrincipal?: { keyId: number | string } }): number | undefined {
    return typeof request.authPrincipal?.keyId === 'number' ? request.authPrincipal.keyId : undefined;
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

        const date = new Date(decoded.createdAt);
        if (Number.isNaN(date.getTime())) {
            return null;
        }

        return {
            createdAt: date,
            id: decoded.id
        };
    } catch {
        return null;
    }
}

// Removed isValidUrl in favor of isSafeWebhookUrl

export default async function apiRoutes(server: FastifyInstance) {
    server.addHook('preHandler', async (request, reply) => {
        let principal: { keyId: number | string; scopes: Set<string>; source: string; domainId?: number } | null = null;
        try {
            await request.jwtVerify({ onlyCookie: true });
            const user = request.user as { sub: number, role: string };
            if (user && user.role === 'supervisor') {
                const headerDomain = request.headers['x-wordclaw-domain'];
                principal = {
                    keyId: `supervisor:${user.sub}`,
                    scopes: new Set(['admin']),
                    source: 'cookie',
                    ...(headerDomain ? { domainId: parseInt(headerDomain as string, 10) } : {})
                };
            }
        } catch {
            // Ignore JWT errors, fallback to normal api key auth
        }

        const path = request.url.split('?')[0];

        // Provider webhooks authenticate via signed payload, not API key/cookie principal.
        if (path.startsWith('/api/payments/webhooks/')) {
            return undefined;
        }

        if (!principal) {
            const auth = await authenticateApiRequest(request.headers);
            if (!auth.ok) {
                return reply.status(auth.statusCode).send(auth.payload);
            }
            principal = auth.principal as { keyId: number | string; scopes: Set<string>; source: string; domainId?: number };
        }

        (request as any).authPrincipal = principal;

        const operationContext = buildOperationContext(
            'rest',
            principal,
            resolveRestOperation(request.method, path),
            resolveRestResource(path, principal.domainId)
        );

        const decision = await PolicyEngine.evaluate(operationContext);
        if (decision.outcome !== 'allow') {
            return reply.status(403).send(toErrorPayload(
                'Access Denied by Policy',
                decision.code,
                decision.remediation || 'Contact administrator.'
            ));
        }

        return undefined;
    });

    server.post('/sandbox/mcp/execute', {
        schema: {
            body: Type.Object({
                tool: Type.String(),
                args: Type.Optional(Type.Object({}, { additionalProperties: true }))
            }),
            response: {
                200: createAIResponse(Type.Object({
                    tool: Type.String(),
                    protocol: Type.Literal('mcp'),
                    result: Type.Unknown()
                })),
                400: AIErrorResponse,
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const body = request.body as {
            tool: string;
            args?: Record<string, unknown>;
        };
        const args = body.args ?? {};

        if (body.tool !== 'get_content_item') {
            return reply.status(400).send(toErrorPayload(
                'Unsupported MCP tool',
                'UNSUPPORTED_MCP_TOOL',
                'Use tool=get_content_item for sandbox protocol parity checks.'
            ));
        }

        const rawId = args.id ?? args.contentItemId;
        const contentItemId = Number(rawId);
        if (!Number.isInteger(contentItemId) || contentItemId <= 0) {
            return reply.status(400).send(toErrorPayload(
                'Invalid content item ID',
                'INVALID_CONTENT_ITEM_ID',
                'Provide args.id (or args.contentItemId) as a positive integer.'
            ));
        }

        const [item] = await db.select()
            .from(contentItems)
            .where(and(eq(contentItems.id, contentItemId), eq(contentItems.domainId, getDomainId(request))));

        if (!item) {
            return reply.status(404).send(notFoundContentItem(contentItemId));
        }

        return reply.status(200).send({
            data: {
                tool: body.tool,
                protocol: 'mcp',
                result: item
            },
            meta: buildMeta(
                'Compare this MCP tool result with REST and GraphQL reads of the same content item.',
                ['GET /api/content-items/:id', 'POST /api/graphql'],
                'low',
                1
            )
        });
    });

    server.post('/auth/keys', {
        schema: {
            body: Type.Object({
                name: Type.String(),
                scopes: Type.Array(Type.String()),
                expiresAt: Type.Optional(Type.String({ format: 'date-time' }))
            }),
            response: {
                201: createAIResponse(Type.Object({
                    id: Type.Number(),
                    name: Type.String(),
                    keyPrefix: Type.String(),
                    scopes: Type.Array(Type.String()),
                    expiresAt: Type.Optional(Type.String()),
                    apiKey: Type.String()
                })),
                400: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const body = request.body as { name: string; scopes: string[]; expiresAt?: string };
        const actorId = toAuditActorId(request as { authPrincipal?: { keyId: number | string } });

        let scopes: string[];
        try {
            scopes = normalizeScopes(body.scopes);
        } catch (error) {
            return reply.status(400).send(toErrorPayload(
                'Invalid scopes',
                'INVALID_KEY_SCOPES',
                `Use only supported scopes: content:read, content:write, audit:read, admin. Details: ${(error as Error).message}`
            ));
        }

        let expiresAt: Date | null = null;
        if (body.expiresAt) {
            expiresAt = new Date(body.expiresAt);
            if (Number.isNaN(expiresAt.getTime())) {
                return reply.status(400).send(toErrorPayload(
                    'Invalid expiresAt timestamp',
                    'INVALID_EXPIRES_AT',
                    'Provide expiresAt as an ISO-8601 date-time string.'
                ));
            }
        }

        const { key, plaintext } = await createApiKey({
            domainId: getDomainId(request), name: body.name,
            scopes,
            createdBy: actorId ?? null,
            expiresAt
        });

        await logAudit(getDomainId(request), 'create',
            'api_key',
            key.id,
            { authKeyCreated: true, scopes, name: key.name },
            actorId,
            request.id
        );

        return reply.status(201).send({
            data: {
                id: key.id,
                name: key.name,
                keyPrefix: key.keyPrefix,
                scopes,
                ...(key.expiresAt ? { expiresAt: key.expiresAt.toISOString() } : {}),
                apiKey: plaintext
            },
            meta: buildMeta(
                'Store this API key securely; plaintext is shown only once',
                ['GET /api/auth/keys', 'PUT /api/auth/keys/:id', 'DELETE /api/auth/keys/:id'],
                'high',
                1
            )
        });
    });

    server.get('/auth/keys', {
        schema: {
            response: {
                200: createAIResponse(Type.Array(Type.Object({
                    id: Type.Number(),
                    name: Type.String(),
                    keyPrefix: Type.String(),
                    scopes: Type.Array(Type.String()),
                    createdBy: Type.Union([Type.Number(), Type.Null()]),
                    createdAt: Type.String(),
                    expiresAt: Type.Union([Type.String(), Type.Null()]),
                    revokedAt: Type.Union([Type.String(), Type.Null()]),
                    lastUsedAt: Type.Union([Type.String(), Type.Null()])
                })))
            }
        }
    }, async (request, reply) => {
        const keys = await listApiKeys(getDomainId(request));

        return {
            data: keys.map((key) => ({
                id: key.id,
                name: key.name,
                keyPrefix: key.keyPrefix,
                scopes: key.scopes.split('|').filter(Boolean),
                createdBy: key.createdBy,
                createdAt: key.createdAt.toISOString(),
                expiresAt: key.expiresAt ? key.expiresAt.toISOString() : null,
                revokedAt: key.revokedAt ? key.revokedAt.toISOString() : null,
                lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null
            })),
            meta: buildMeta(
                'Review key health and rotate stale credentials',
                ['POST /api/auth/keys', 'PUT /api/auth/keys/:id', 'DELETE /api/auth/keys/:id'],
                'medium',
                1
            )
        };
    });

    server.delete('/auth/keys/:id', {
        schema: {
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
        const actorId = toAuditActorId(request as { authPrincipal?: { keyId: number | string } });
        const { id } = request.params as IdParams;
        const revoked = await revokeApiKey(id, getDomainId(request));
        if (!revoked) {
            return reply.status(404).send(toErrorPayload(
                'API key not found',
                'API_KEY_NOT_FOUND',
                `The API key with ID ${id} does not exist or is already revoked.`
            ));
        }

        await logAudit(getDomainId(request), 'delete',
            'api_key',
            revoked.id,
            { apiKeyRevoked: true, keyPrefix: revoked.keyPrefix },
            actorId,
            request.id
        );

        return {
            data: {
                id: revoked.id,
                message: 'API key revoked successfully'
            },
            meta: buildMeta(
                'Create or rotate replacement credentials if needed',
                ['POST /api/auth/keys', 'GET /api/auth/keys'],
                'high',
                1
            )
        };
    });

    server.put('/auth/keys/:id', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                200: createAIResponse(Type.Object({
                    oldId: Type.Number(),
                    newId: Type.Number(),
                    keyPrefix: Type.String(),
                    apiKey: Type.String()
                })),
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const actorId = toAuditActorId(request as { authPrincipal?: { keyId: number | string } });
        const { id } = request.params as IdParams;

        const rotated = await rotateApiKey(id, getDomainId(request), actorId ?? null);
        if (!rotated) {
            return reply.status(404).send(toErrorPayload(
                'API key not found',
                'API_KEY_NOT_FOUND',
                `The API key with ID ${id} does not exist or is already revoked.`
            ));
        }

        await logAudit(getDomainId(request), 'update',
            'api_key',
            rotated.newKey.id,
            { apiKeyRotated: true, oldId: rotated.oldKey.id, newId: rotated.newKey.id },
            actorId,
            request.id
        );

        return {
            data: {
                oldId: rotated.oldKey.id,
                newId: rotated.newKey.id,
                keyPrefix: rotated.newKey.keyPrefix,
                apiKey: rotated.plaintext
            },
            meta: buildMeta(
                'Update clients to use the new key immediately',
                ['GET /api/auth/keys'],
                'critical',
                1
            )
        };
    });

    server.post('/policy/evaluate', {
        schema: {
            body: Type.Object({
                operation: Type.String(),
                resource: Type.Object({
                    type: Type.String(),
                    id: Type.Optional(Type.String()),
                    contentTypeId: Type.Optional(Type.String())
                })
            }),
            response: {
                200: Type.Object({
                    outcome: Type.String(),
                    code: Type.String(),
                    remediation: Type.Optional(Type.String()),
                    metadata: Type.Optional(Type.Record(Type.String(), Type.Any())),
                    policyVersion: Type.String()
                })
            }
        }
    }, async (request) => {
        const body = request.body as { operation: string; resource: { type: string; id?: string; contentTypeId?: string } };

        const operationContext = buildOperationContext(
            'rest',
            (request as any).authPrincipal,
            body.operation,
            body.resource
        );

        const decision = await PolicyEngine.evaluate(operationContext);
        return decision;
    });

    server.post('/webhooks', {
        schema: {
            querystring: DryRunQuery,
            body: Type.Object({
                url: Type.String({ format: 'uri' }),
                events: Type.Array(Type.String()),
                secret: Type.String(),
                active: Type.Optional(Type.Boolean())
            }),
            response: {
                201: createAIResponse(Type.Object({
                    id: Type.Number(),
                    url: Type.String(),
                    events: Type.Array(Type.String()),
                    active: Type.Boolean(),
                    createdAt: Type.String()
                })),
                200: createAIResponse(Type.Object({
                    id: Type.Number(),
                    url: Type.String(),
                    events: Type.Array(Type.String()),
                    active: Type.Boolean(),
                    createdAt: Type.String()
                })),
                400: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const actorId = toAuditActorId(request as { authPrincipal?: { keyId: number | string } });
        const { mode } = request.query as DryRunQueryType;
        const body = request.body as { url: string; events: string[]; secret: string; active?: boolean };

        if (!await isSafeWebhookUrl(body.url)) {
            return reply.status(400).send(toErrorPayload(
                'Invalid webhook URL',
                'INVALID_WEBHOOK_URL',
                'Provide a valid absolute URL such as https://example.com/hooks/wordclaw.'
            ));
        }

        let events: string[];
        try {
            events = normalizeWebhookEvents(body.events);
        } catch (error) {
            return reply.status(400).send(toErrorPayload(
                'Invalid webhook events',
                'INVALID_WEBHOOK_EVENTS',
                (error as Error).message
            ));
        }

        if (isDryRun(mode)) {
            return reply.status(200).send({
                data: {
                    id: 0,
                    url: body.url,
                    events,
                    active: body.active ?? true,
                    createdAt: new Date().toISOString()
                },
                meta: buildMeta(
                    'Create webhook registration',
                    ['POST /api/webhooks'],
                    'medium',
                    0,
                    true
                )
            });
        }

        const created = await createWebhook({
            domainId: getDomainId(request), url: body.url,
            events,
            secret: body.secret,
            active: body.active
        });

        await logAudit(getDomainId(request), 'create',
            'webhook',
            created.id,
            { url: created.url, events, active: created.active },
            actorId,
            request.id
        );

        return reply.status(201).send({
            data: {
                id: created.id,
                url: created.url,
                events: parseWebhookEvents(created.events),
                active: created.active,
                createdAt: created.createdAt.toISOString()
            },
            meta: buildMeta(
                'Verify webhook delivery and active status',
                ['GET /api/webhooks', 'PUT /api/webhooks/:id', 'DELETE /api/webhooks/:id'],
                'medium',
                1
            )
        });
    });

    server.get('/webhooks', {
        schema: {
            response: {
                200: createAIResponse(Type.Array(Type.Object({
                    id: Type.Number(),
                    url: Type.String(),
                    events: Type.Array(Type.String()),
                    active: Type.Boolean(),
                    createdAt: Type.String()
                })))
            }
        }
    }, async (request, reply) => {
        const hooks = await listWebhooks(getDomainId(request));
        return {
            data: hooks.map((hook) => ({
                id: hook.id,
                url: hook.url,
                events: parseWebhookEvents(hook.events),
                active: hook.active,
                createdAt: hook.createdAt.toISOString()
            })),
            meta: buildMeta(
                'Inspect or update a webhook registration',
                ['POST /api/webhooks', 'PUT /api/webhooks/:id', 'DELETE /api/webhooks/:id'],
                'low',
                1
            )
        };
    });

    server.get('/webhooks/:id', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                200: createAIResponse(Type.Object({
                    id: Type.Number(),
                    url: Type.String(),
                    events: Type.Array(Type.String()),
                    active: Type.Boolean(),
                    createdAt: Type.String()
                })),
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        const hook = await getWebhookById(id, getDomainId(request));
        if (!hook) {
            return reply.status(404).send(toErrorPayload(
                'Webhook not found',
                'WEBHOOK_NOT_FOUND',
                `No webhook exists with ID ${id}.`
            ));
        }

        return {
            data: {
                id: hook.id,
                url: hook.url,
                events: parseWebhookEvents(hook.events),
                active: hook.active,
                createdAt: hook.createdAt.toISOString()
            },
            meta: buildMeta(
                'Update or remove this webhook',
                ['PUT /api/webhooks/:id', 'DELETE /api/webhooks/:id'],
                'low',
                1
            )
        };
    });

    server.put('/webhooks/:id', {
        schema: {
            querystring: DryRunQuery,
            params: Type.Object({
                id: Type.Number()
            }),
            body: Type.Object({
                url: Type.Optional(Type.String({ format: 'uri' })),
                events: Type.Optional(Type.Array(Type.String())),
                secret: Type.Optional(Type.String()),
                active: Type.Optional(Type.Boolean())
            }),
            response: {
                200: createAIResponse(Type.Object({
                    id: Type.Number(),
                    url: Type.String(),
                    events: Type.Array(Type.String()),
                    active: Type.Boolean(),
                    createdAt: Type.String()
                })),
                400: AIErrorResponse,
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const actorId = toAuditActorId(request as { authPrincipal?: { keyId: number | string } });
        const { id } = request.params as IdParams;
        const { mode } = request.query as DryRunQueryType;
        const body = request.body as {
            url?: string;
            events?: string[];
            secret?: string;
            active?: boolean;
        };

        if (!hasDefinedValues(body)) {
            return reply.status(400).send(toErrorPayload(
                'Empty update payload',
                'EMPTY_UPDATE_BODY',
                'Provide at least one of url, events, secret, or active.'
            ));
        }

        if (body.url !== undefined && !await isSafeWebhookUrl(body.url)) {
            return reply.status(400).send(toErrorPayload(
                'Invalid webhook URL',
                'INVALID_WEBHOOK_URL',
                'Provide a valid absolute URL such as https://example.com/hooks/wordclaw.'
            ));
        }

        let normalizedEvents: string[] | undefined;
        if (body.events !== undefined) {
            try {
                normalizedEvents = normalizeWebhookEvents(body.events);
            } catch (error) {
                return reply.status(400).send(toErrorPayload(
                    'Invalid webhook events',
                    'INVALID_WEBHOOK_EVENTS',
                    (error as Error).message
                ));
            }
        }

        const existing = await getWebhookById(id, getDomainId(request));
        if (!existing) {
            return reply.status(404).send(toErrorPayload(
                'Webhook not found',
                'WEBHOOK_NOT_FOUND',
                `No webhook exists with ID ${id}.`
            ));
        }

        if (isDryRun(mode)) {
            return {
                data: {
                    id: existing.id,
                    url: body.url ?? existing.url,
                    events: normalizedEvents ?? parseWebhookEvents(existing.events),
                    active: body.active ?? existing.active,
                    createdAt: existing.createdAt.toISOString()
                },
                meta: buildMeta(
                    `Execute webhook update for ID ${id}`,
                    ['PUT /api/webhooks/:id'],
                    'low',
                    0,
                    true
                )
            };
        }

        const updated = await updateWebhook(id, getDomainId(request), {
            url: body.url,
            events: normalizedEvents,
            secret: body.secret,
            active: body.active
        });

        if (!updated) {
            return reply.status(404).send(toErrorPayload(
                'Webhook not found',
                'WEBHOOK_NOT_FOUND',
                `No webhook exists with ID ${id}.`
            ));
        }

        await logAudit(getDomainId(request), 'update',
            'webhook',
            updated.id,
            {
                url: updated.url,
                events: parseWebhookEvents(updated.events),
                active: updated.active
            },
            actorId,
            request.id
        );

        return {
            data: {
                id: updated.id,
                url: updated.url,
                events: parseWebhookEvents(updated.events),
                active: updated.active,
                createdAt: updated.createdAt.toISOString()
            },
            meta: buildMeta(
                'Verify webhook behavior after update',
                ['GET /api/webhooks/:id'],
                'medium',
                1
            )
        };
    });

    server.delete('/webhooks/:id', {
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
        const actorId = toAuditActorId(request as { authPrincipal?: { keyId: number | string } });
        const { mode } = request.query as DryRunQueryType;
        const { id } = request.params as IdParams;

        const existing = await getWebhookById(id, getDomainId(request));
        if (!existing) {
            return reply.status(404).send(toErrorPayload(
                'Webhook not found',
                'WEBHOOK_NOT_FOUND',
                `No webhook exists with ID ${id}.`
            ));
        }

        if (isDryRun(mode)) {
            return {
                data: {
                    id,
                    message: `[Dry Run] Webhook ${id} would be deleted`
                },
                meta: buildMeta(
                    'Execute webhook deletion if confirmed',
                    ['DELETE /api/webhooks/:id'],
                    'high',
                    0,
                    true
                )
            };
        }

        await deleteWebhook(id, getDomainId(request));

        await logAudit(getDomainId(request), 'delete',
            'webhook',
            existing.id,
            { url: existing.url, events: parseWebhookEvents(existing.events) },
            actorId,
            request.id
        );

        return {
            data: {
                id,
                message: `Webhook ${id} deleted successfully`
            },
            meta: buildMeta(
                'Review remaining webhook registrations',
                ['GET /api/webhooks', 'POST /api/webhooks'],
                'medium',
                1
            )
        };
    });

    server.get('/domains', {
        schema: {
            response: {
                200: createAIResponse(Type.Array(Type.Object({
                    id: Type.Number(),
                    name: Type.String(),
                    hostname: Type.String(),
                    createdAt: Type.String()
                })))
            }
        }
    }, async (request) => {
        const principal = (request as { authPrincipal?: { scopes?: Set<string> } }).authPrincipal;
        const isAdmin = principal?.scopes?.has('admin') || principal?.scopes?.has('tenant:admin');
        const accessibleDomains = isAdmin
            ? await db.select().from(domains).orderBy(domains.id)
            : await db.select()
                .from(domains)
                .where(eq(domains.id, getDomainId(request)))
                .orderBy(domains.id);

        return {
            data: accessibleDomains.map((domain) => ({
                id: domain.id,
                name: domain.name,
                hostname: domain.hostname,
                createdAt: domain.createdAt.toISOString()
            })),
            meta: buildMeta(
                'Select the active domain context in the supervisor UI',
                ['GET /api/content-types', 'GET /api/content-items'],
                'low',
                1
            )
        };
    });

    server.post('/content-types', {
        schema: {
            querystring: DryRunQuery,
            body: Type.Object({
                name: Type.String(),
                slug: Type.String(),
                description: Type.Optional(Type.String()),
                schema: Type.Union([Type.String(), Type.Object({}, { additionalProperties: true })]),
                basePrice: Type.Optional(Type.Number()),
            }),
            response: {
                201: createAIResponse(Type.Object({
                    id: Type.Number(),
                    name: Type.String(),
                    slug: Type.String(),
                    basePrice: Type.Optional(Type.Number()),
                })),
                200: createAIResponse(Type.Object({
                    id: Type.Number(),
                    name: Type.String(),
                    slug: Type.String(),
                    basePrice: Type.Optional(Type.Number()),
                })),
                400: AIErrorResponse,
                409: AIErrorResponse
            },
        },
    }, async (request, reply) => {
        const { mode } = request.query as DryRunQueryType;
        const rawBody = request.body as any;
        const schemaStr = typeof rawBody.schema === 'string' ? rawBody.schema : JSON.stringify(rawBody.schema);
        const data = { ...rawBody, schema: schemaStr, domainId: getDomainId(request) } as typeof contentTypes.$inferInsert;
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

        let newItem;
        try {
            [newItem] = await db.insert(contentTypes).values(data).returning();
        } catch (error) {
            if (isUniqueViolation(error, CONTENT_TYPE_SLUG_CONSTRAINTS)) {
                return reply.status(409).send(contentTypeSlugConflict(data.slug));
            }
            throw error;
        }

        await logAudit(getDomainId(request), 'create',
            'content_type',
            newItem.id,
            newItem,
            toAuditActorId(request as { authPrincipal?: { keyId: number | string } }),
            request.id
        );

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
            querystring: Type.Object({
                limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
                offset: Type.Optional(Type.Number({ minimum: 0 }))
            }),
            response: {
                200: createAIResponse(Type.Array(Type.Object({
                    id: Type.Number(),
                    name: Type.String(),
                    slug: Type.String(),
                    description: Type.Optional(Type.String()),
                    schema: Type.String(),
                    basePrice: Type.Optional(Type.Number()),
                    createdAt: Type.String(),
                    updatedAt: Type.String()
                })))
            }
        }
    }, async (request, reply) => {
        const { limit: rawLimit, offset: rawOffset } = request.query as PaginationQuery;
        const limit = clampLimit(rawLimit);
        const offset = clampOffset(rawOffset);
        const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(contentTypes).where(eq(contentTypes.domainId, getDomainId(request)));
        const types = await db.select()
            .from(contentTypes)
            .where(eq(contentTypes.domainId, getDomainId(request)))
            .limit(limit)
            .offset(offset);

        const hasMore = offset + types.length < total;
        return {
            data: types,
            meta: buildMeta(
                types.length > 0 ? 'Select a content type to create items' : 'Create a new content type',
                ['POST /api/content-types'],
                'low',
                1,
                false,
                { total, offset, limit, hasMore }
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
                    basePrice: Type.Optional(Type.Number()),
                    createdAt: Type.String(),
                    updatedAt: Type.String()
                })),
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        const [type] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, id), eq(contentTypes.domainId, getDomainId(request))));

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
                schema: Type.Optional(Type.Union([Type.String(), Type.Object({}, { additionalProperties: true })])),
                basePrice: Type.Optional(Type.Number()),
            }),
            response: {
                200: createAIResponse(Type.Object({
                    id: Type.Number(),
                    name: Type.Optional(Type.String()),
                    slug: Type.Optional(Type.String()),
                    description: Type.Optional(Type.String()),
                    schema: Type.Optional(Type.String()),
                    basePrice: Type.Optional(Type.Number()),
                    createdAt: Type.Optional(Type.String()),
                    updatedAt: Type.Optional(Type.String())
                })),
                400: AIErrorResponse,
                404: AIErrorResponse,
                409: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        const { mode } = request.query as DryRunQueryType;
        const rawPayload = request.body as any;
        if (rawPayload.schema && typeof rawPayload.schema !== 'string') {
            rawPayload.schema = JSON.stringify(rawPayload.schema);
        }
        const payload = rawPayload as ContentTypeUpdate;
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
            const [existing] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, id), eq(contentTypes.domainId, getDomainId(request))));
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

        let updatedType;
        try {
            [updatedType] = await db.update(contentTypes)
                .set(updateData)
                .where(and(eq(contentTypes.id, id), eq(contentTypes.domainId, getDomainId(request))))
                .returning();
        } catch (error) {
            if (isUniqueViolation(error, CONTENT_TYPE_SLUG_CONSTRAINTS)) {
                return reply.status(409).send(contentTypeSlugConflict(updateData.slug || ''));
            }
            throw error;
        }

        if (!updatedType) {
            return reply.status(404).send(notFoundContentType(id));
        }

        await logAudit(getDomainId(request), 'update',
            'content_type',
            updatedType.id,
            { ...updateData, previous: 'n/a' },
            toAuditActorId(request as { authPrincipal?: { keyId: number | string } }),
            request.id
        );

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
            const [existing] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, id), eq(contentTypes.domainId, getDomainId(request))));
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
            .where(and(eq(contentTypes.id, id), eq(contentTypes.domainId, getDomainId(request))))
            .returning();

        if (!deletedType) {
            return reply.status(404).send(notFoundContentType(id));
        }

        await logAudit(getDomainId(request), 'delete',
            'content_type',
            deletedType.id,
            deletedType,
            toAuditActorId(request as { authPrincipal?: { keyId: number | string } }),
            request.id
        );

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
    const globalL402Middleware = l402Middleware(globalL402Options);

    server.post('/content-items', {
        preHandler: globalL402Middleware,
        schema: {
            querystring: DryRunQuery,
            body: Type.Object({
                contentTypeId: Type.Number(),
                data: Type.Union([Type.String(), Type.Object({}, { additionalProperties: true })]),
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
                404: AIErrorResponse,
                403: AIErrorResponse,
                402: Type.Any() // Added 402 for L402 Payment Required response
            }
        },
    }, async (request, reply) => {
        reply.header('Deprecation', 'true');
        const { mode } = request.query as DryRunQueryType;
        const rawBody = request.body as any;
        const dataStr = typeof rawBody.data === 'string' ? rawBody.data : JSON.stringify(rawBody.data);
        const data = { ...rawBody, data: dataStr, domainId: getDomainId(request) } as typeof contentItems.$inferInsert;
        const [contentType] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, data.contentTypeId), eq(contentTypes.domainId, getDomainId(request))));

        if (!contentType) {
            return reply.status(404).send(notFoundContentType(data.contentTypeId));
        }

        const contentValidation = validateContentDataAgainstSchema(contentType.schema, data.data);
        if (contentValidation) {
            return reply.status(400).send(fromValidationFailure(contentValidation));
        }

        const activeWorkflow = await WorkflowService.getActiveWorkflow(getDomainId(request), data.contentTypeId);
        if (activeWorkflow && data.status && data.status !== 'draft') {
            return reply.status(403).send(toErrorPayload(
                'Workflow transition forbidden',
                'WORKFLOW_TRANSITION_FORBIDDEN',
                `This content type is governed by an active workflow. You cannot manually set the status to '${data.status}'. Save as a 'draft' and use POST /api/content-items/:id/submit to request a transition.`
            ));
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

        if (newItem.status === 'published') {
            EmbeddingService.syncItemEmbeddings(getDomainId(request), newItem.id).catch(console.error);
        } else {
            EmbeddingService.deleteItemEmbeddings(getDomainId(request), newItem.id).catch(console.error);
        }

        await logAudit(getDomainId(request), 'create',
            'content_item',
            newItem.id,
            newItem,
            toAuditActorId(request as { authPrincipal?: { keyId: number | string } }),
            request.id
        );

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

    server.post('/content-types/:contentTypeId/items', {
        preHandler: globalL402Middleware,
        schema: {
            querystring: DryRunQuery,
            params: Type.Object({
                contentTypeId: Type.Number(),
            }),
            body: Type.Object({
                data: Type.Union([Type.String(), Type.Object({}, { additionalProperties: true })]),
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
                404: AIErrorResponse,
                403: AIErrorResponse,
                402: Type.Any()
            }
        },
    }, async (request, reply) => {
        const { mode } = request.query as DryRunQueryType;
        const params = request.params as { contentTypeId: number };
        const rawBody = request.body as any;
        const dataStr = typeof rawBody.data === 'string' ? rawBody.data : JSON.stringify(rawBody.data);
        const data = { ...rawBody, data: dataStr, contentTypeId: params.contentTypeId, domainId: getDomainId(request) } as typeof contentItems.$inferInsert;

        const [contentType] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, data.contentTypeId), eq(contentTypes.domainId, getDomainId(request))));

        if (!contentType) {
            return reply.status(404).send(notFoundContentType(data.contentTypeId));
        }

        const contentValidation = validateContentDataAgainstSchema(contentType.schema, data.data);
        if (contentValidation) {
            return reply.status(400).send(fromValidationFailure(contentValidation));
        }

        const activeWorkflow = await WorkflowService.getActiveWorkflow(getDomainId(request), data.contentTypeId);
        if (activeWorkflow && data.status && data.status !== 'draft') {
            return reply.status(403).send(toErrorPayload(
                'Workflow transition forbidden',
                'WORKFLOW_TRANSITION_FORBIDDEN',
                `This content type is governed by an active workflow. You cannot manually set the status to '${data.status}'. Save as a 'draft' and use POST /api/content-items/:id/submit to request a transition.`
            ));
        }

        if (isDryRun(mode)) {
            return reply.status(200).send({
                data: { ...data, id: 0, version: 1 },
                meta: buildMeta(
                    'Execute creation of content item',
                    [`POST /api/content-types/${data.contentTypeId}/items`],
                    'medium',
                    0,
                    true
                )
            });
        }

        const [newItem] = await db.insert(contentItems).values(data).returning();

        if (newItem.status === 'published') {
            EmbeddingService.syncItemEmbeddings(getDomainId(request), newItem.id).catch(console.error);
        } else {
            EmbeddingService.deleteItemEmbeddings(getDomainId(request), newItem.id).catch(console.error);
        }

        await logAudit(getDomainId(request), 'create',
            'content_item',
            newItem.id,
            newItem,
            toAuditActorId(request as { authPrincipal?: { keyId: number | string } }),
            request.id
        );

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

    server.get('/search/semantic', {
        schema: {
            querystring: Type.Object({
                query: Type.String(),
                limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, default: 5 }))
            }),
            response: {
                200: createAIResponse(Type.Array(Type.Object({
                    id: Type.Number(),
                    contentItemId: Type.Number(),
                    chunkIndex: Type.Number(),
                    textChunk: Type.String(),
                    similarity: Type.Number(),
                    contentItemData: Type.Any(),
                    contentTypeSlug: Type.String()
                }))),
                400: AIErrorResponse,
                429: AIErrorResponse,
                503: AIErrorResponse,
                500: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { query, limit } = request.query as { query: string, limit?: number };
        try {
            const results = await EmbeddingService.searchSemanticKnowledge(getDomainId(request), query, limit);
            return {
                data: results,
                meta: buildMeta('Semantic Search Retrieved', [], 'medium', 1)
            };
        } catch (e: any) {
            if (e instanceof EmbeddingServiceError) {
                return reply.status(e.statusCode as any).send(
                    toErrorPayload(
                        'Semantic Search Failed',
                        e.code,
                        e.message
                    )
                );
            }
            return reply.status(500).send(toErrorPayload('Semantic Search Failed', 'EMBEDDING_API_ERROR', e.message));
        }
    });

    server.get('/content-items', {
        schema: {
            querystring: Type.Object({
                contentTypeId: Type.Optional(Type.Number()),
                status: Type.Optional(Type.String()),
                createdAfter: Type.Optional(Type.String()),
                createdBefore: Type.Optional(Type.String()),
                limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
                offset: Type.Optional(Type.Number({ minimum: 0 }))
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
                ,
                400: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const {
            contentTypeId,
            status,
            createdAfter,
            createdBefore,
            limit: rawLimit,
            offset: rawOffset
        } = request.query as ContentItemsQuery;

        const limit = clampLimit(rawLimit);
        const offset = clampOffset(rawOffset);

        const afterDate = createdAfter ? new Date(createdAfter) : null;
        if (afterDate && Number.isNaN(afterDate.getTime())) {
            return reply.status(400).send({
                error: 'Invalid createdAfter timestamp',
                code: 'INVALID_CREATED_AFTER',
                remediation: 'Provide createdAfter as an ISO-8601 date-time string.'
            });
        }

        const beforeDate = createdBefore ? new Date(createdBefore) : null;
        if (beforeDate && Number.isNaN(beforeDate.getTime())) {
            return reply.status(400).send({
                error: 'Invalid createdBefore timestamp',
                code: 'INVALID_CREATED_BEFORE',
                remediation: 'Provide createdBefore as an ISO-8601 date-time string.'
            });
        }

        const conditions = [
            eq(contentItems.domainId, getDomainId(request)),
            contentTypeId !== undefined ? eq(contentItems.contentTypeId, contentTypeId) : undefined,
            status ? eq(contentItems.status, status) : undefined,
            afterDate ? gte(contentItems.createdAt, afterDate) : undefined,
            beforeDate ? lte(contentItems.createdAt, beforeDate) : undefined,
        ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(contentItems).where(whereClause);
        const rawItems = await db.select({
            item: contentItems,
            schema: contentTypes.schema,
            basePrice: contentTypes.basePrice
        })
            .from(contentItems)
            .innerJoin(contentTypes, eq(contentItems.contentTypeId, contentTypes.id))
            .where(whereClause)
            .limit(limit)
            .offset(offset);

        const items = rawItems.map(row => {
            if ((row.basePrice || 0) > 0) {
                return {
                    ...row.item,
                    data: redactPremiumFields(row.schema, row.item.data)
                };
            }
            return row.item;
        });
        const hasMore = offset + items.length < total;

        return {
            data: items,
            meta: buildMeta(
                'Filter or select a content item',
                ['POST /api/content-items'],
                'low',
                1,
                false,
                { total, offset, limit, hasMore }
            )
        };
    });

    server.get('/content-items/:id', {
        preHandler: globalL402Middleware,
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
                400: AIErrorResponse,
                402: AIErrorResponse,
                403: AIErrorResponse,
                404: AIErrorResponse
                ,
                409: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        const domainId = getDomainId(request);
        const [item] = await db.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId)));

        if (!item) {
            return reply.status(404).send(notFoundContentItem(id));
        }

        const matchingOffers = await LicensingService.getActiveOffersForItemRead(domainId, id, item.contentTypeId);
        if (matchingOffers.length > 0) {
            const pKeyId = (request as any).authPrincipal?.keyId;
            if (typeof pKeyId !== 'number') {
                return reply.status(402).send(toErrorPayload(
                    'Offer purchase required',
                    'OFFER_REQUIRED',
                    `This content item is licensed by offer. List offers with GET /api/content-items/${id}/offers and complete POST /api/offers/:id/purchase.`
                ));
            }

            const [profile] = await db.select().from(agentProfiles).where(and(
                eq(agentProfiles.apiKeyId, pKeyId),
                eq(agentProfiles.domainId, domainId)
            ));

            if (!profile) {
                return reply.status(402).send(toErrorPayload(
                    'Offer purchase required',
                    'OFFER_REQUIRED',
                    `You do not have an entitlement for this item. Discover offers with GET /api/content-items/${id}/offers and purchase one first.`
                ));
            }

            const entitlementHeader = readSingleHeaderValue(request.headers['x-entitlement-id']);
            const requestedEntitlementId = entitlementHeader ? parsePositiveIntHeader(entitlementHeader) : null;
            if (entitlementHeader && !requestedEntitlementId) {
                return reply.status(400).send(toErrorPayload(
                    'Invalid entitlement header',
                    'INVALID_ENTITLEMENT_ID',
                    'Provide x-entitlement-id as a positive integer.'
                ));
            }

            const eligibleEntitlements = await LicensingService.getEligibleEntitlementsForItemRead(
                domainId,
                profile.id,
                item.id,
                item.contentTypeId
            );

            let selectedEntitlement = null as typeof eligibleEntitlements[number] | null;
            if (requestedEntitlementId) {
                selectedEntitlement = eligibleEntitlements.find((entry) => entry.id === requestedEntitlementId) ?? null;
                if (!selectedEntitlement) {
                    const existing = await LicensingService.getEntitlementForAgentById(domainId, profile.id, requestedEntitlementId);
                    if (!existing) {
                        return reply.status(404).send(toErrorPayload(
                            'Entitlement not found',
                            'ENTITLEMENT_NOT_FOUND',
                            'Provide a valid entitlement ID owned by this API key and domain.'
                        ));
                    }
                    return reply.status(403).send(toErrorPayload(
                        'Entitlement not active',
                        'ENTITLEMENT_NOT_ACTIVE',
                        'Use an active entitlement or purchase a new offer.'
                    ));
                }
            } else {
                if (eligibleEntitlements.length === 0) {
                    return reply.status(402).send(toErrorPayload(
                        'Offer purchase required',
                        'OFFER_REQUIRED',
                        `No eligible entitlement was found. Purchase an offer via POST /api/offers/:id/purchase.`
                    ));
                }

                if (eligibleEntitlements.length > 1) {
                    return reply.status(409).send({
                        ...toErrorPayload(
                            'Multiple entitlements eligible',
                            'ENTITLEMENT_AMBIGUOUS',
                            'Retry with x-entitlement-id set to the entitlement you want to consume.'
                        ),
                        context: {
                            candidateEntitlementIds: eligibleEntitlements.map((entry) => entry.id)
                        }
                    });
                }
                selectedEntitlement = eligibleEntitlements[0];
            }

            const consumeResult = await LicensingService.atomicallyDecrementRead(domainId, selectedEntitlement.id);
            await LicensingService.recordAccessEvent(
                domainId,
                selectedEntitlement.id,
                request.url.split('?')[0],
                `${request.method.toUpperCase()} /api/content-items/:id`,
                consumeResult.granted,
                consumeResult.reason
            );

            if (!consumeResult.granted) {
                if (consumeResult.reason === 'entitlement_expired') {
                    return reply.status(403).send(toErrorPayload(
                        'Entitlement expired',
                        'ENTITLEMENT_EXPIRED',
                        'Purchase a new offer or use another active entitlement.'
                    ));
                }
                if (consumeResult.reason === 'remaining_reads_exhausted' || consumeResult.reason === 'race_condition_exhaustion') {
                    return reply.status(403).send(toErrorPayload(
                        'Entitlement exhausted',
                        'ENTITLEMENT_EXHAUSTED',
                        'Purchase a new offer or use another entitlement with remaining reads.'
                    ));
                }
                return reply.status(403).send(toErrorPayload(
                    'Entitlement not active',
                    'ENTITLEMENT_NOT_ACTIVE',
                    'Use an active entitlement or purchase a new offer.'
                ));
            }
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

    server.get('/content-items/:id/offers', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                200: createAIResponse(Type.Array(Type.Object({
                    id: Type.Number(),
                    domainId: Type.Number(),
                    slug: Type.String(),
                    name: Type.String(),
                    scopeType: Type.String(),
                    scopeRef: Type.Union([Type.Number(), Type.Null()]),
                    priceSats: Type.Number(),
                    active: Type.Boolean()
                }))),
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        const domainId = getDomainId(request);
        const [item] = await db.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId)));

        if (!item) {
            return reply.status(404).send(notFoundContentItem(id));
        }

        const availableOffers = await LicensingService.getActiveOffersForItemRead(domainId, id, item.contentTypeId);
        availableOffers.sort((left, right) => offerScopeRank(left.scopeType) - offerScopeRank(right.scopeType));

        return {
            data: availableOffers,
            meta: buildMeta(
                availableOffers.length > 0 ? 'Purchase an offer' : 'No offers currently available',
                ['POST /api/offers/:id/purchase'],
                'low',
                0
            )
        };
    });

    server.post('/offers/:id/purchase', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            body: Type.Optional(Type.Object({
                paymentMethod: Type.Optional(Type.Union([
                    Type.Literal('lightning'),
                    Type.Literal('ap2')
                ]))
            })),
            response: {
                402: AIErrorResponse,
                404: AIErrorResponse,
                400: AIErrorResponse,
                403: AIErrorResponse,
                503: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        const body = (request.body ?? {}) as { paymentMethod?: PaymentMethod };
        const domainId = getDomainId(request);
        const pKeyId = (request as any).authPrincipal?.keyId;
        const paymentMethod: PaymentMethod = body.paymentMethod ?? 'lightning';

        if (paymentMethod !== 'lightning') {
            return reply.status(400).send(toErrorPayload(
                'Unsupported payment method',
                'PAYMENT_METHOD_UNSUPPORTED',
                'Only paymentMethod=lightning is currently enabled. AP2 settlement is tracked separately.'
            ));
        }

        if (typeof pKeyId !== 'number') {
            return reply.status(403).send(toErrorPayload('API Key required', 'API_KEY_REQUIRED', 'Only autonomous agents (via API key) can hold entitlements and purchase offers.'));
        }

        let [profile] = await db.select().from(agentProfiles).where(and(
            eq(agentProfiles.apiKeyId, pKeyId),
            eq(agentProfiles.domainId, domainId)
        ));
        if (!profile) {
            [profile] = await db.insert(agentProfiles).values({ domainId, apiKeyId: pKeyId }).returning();
        }

        const [offer] = await db.select().from(offers).where(and(eq(offers.id, id), eq(offers.domainId, domainId), eq(offers.active, true)));
        if (!offer) {
            return reply.status(404).send(toErrorPayload('Offer not found', 'OFFER_NOT_FOUND', 'The offer ID does not exist or is inactive.'));
        }

        try {
            const challenge = await createL402Challenge(
                globalL402Options,
                {
                    resourceType: 'offer',
                    operation: 'purchase',
                    resourceId: offer.id,
                    domainId
                },
                {
                    path: `/api/offers/${id}/purchase`,
                    domainId,
                    requestInfo: { method: 'POST', headers: request.headers as Record<string, string | string[] | undefined> }
                },
                offer.priceSats,
                'initial'
            );

            paymentFlowMetrics.increment('invoice_create_success_total');
            const entitlement = await LicensingService.provisionEntitlementForSale(domainId, offer.id, profile.id, challenge.invoice.hash);

            for (const [header, value] of Object.entries(challenge.headers)) {
                reply.header(header, value);
            }

            const payload = {
                ...challenge.payload,
                paymentHash: challenge.invoice.hash,
                entitlementId: entitlement.id,
                paymentMethod
            };

            return reply.status(402).send(payload);
        } catch (error) {
            paymentFlowMetrics.increment('invoice_create_failure_total');
            return reply.status(503).send(toErrorPayload(
                'Invoice creation failed',
                'PAYMENT_PROVIDER_UNAVAILABLE',
                `Unable to create Lightning invoice: ${(error as Error).message}`
            ));
        }
    });

    server.post('/offers/:id/purchase/confirm', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                200: createAIResponse(Type.Object({
                    id: Type.Number(),
                    domainId: Type.Number(),
                    offerId: Type.Number(),
                    policyId: Type.Number(),
                    policyVersion: Type.Number(),
                    agentProfileId: Type.Number(),
                    paymentHash: Type.String(),
                    status: Type.String(),
                    remainingReads: Type.Union([Type.Number(), Type.Null()]),
                    expiresAt: Type.Union([Type.String(), Type.Null()]),
                    activatedAt: Type.Union([Type.String(), Type.Null()])
                })),
                400: AIErrorResponse,
                402: AIErrorResponse,
                403: AIErrorResponse,
                404: AIErrorResponse,
                409: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        const domainId = getDomainId(request);
        const pKeyId = (request as any).authPrincipal?.keyId;

        if (typeof pKeyId !== 'number') {
            return reply.status(403).send(toErrorPayload(
                'API Key required',
                'API_KEY_REQUIRED',
                'Only autonomous agents (via API key) can confirm offer purchases.'
            ));
        }

        const credentials = parseL402AuthorizationHeader(
            typeof request.headers.authorization === 'string' ? request.headers.authorization : undefined
        );
        if (!credentials) {
            return reply.status(400).send(toErrorPayload(
                'Missing L402 credentials',
                'PAYMENT_CONFIRMATION_REQUIRED',
                'Provide Authorization: L402 <macaroon>:<preimage> for purchase confirmation.'
            ));
        }

        const [profile] = await db.select().from(agentProfiles).where(and(
            eq(agentProfiles.apiKeyId, pKeyId),
            eq(agentProfiles.domainId, domainId)
        ));
        if (!profile) {
            return reply.status(404).send(toErrorPayload(
                'Profile missing',
                'PROFILE_MISSING',
                'No entitlement-capable profile exists for this API key in the selected domain.'
            ));
        }

        const [offer] = await db.select().from(offers).where(and(
            eq(offers.id, id),
            eq(offers.domainId, domainId)
        ));
        if (!offer) {
            return reply.status(404).send(toErrorPayload(
                'Offer not found',
                'OFFER_NOT_FOUND',
                'The offer does not exist in this domain.'
            ));
        }

        const paymentHashHeader = readSingleHeaderValue(request.headers['x-payment-hash']);
        const pendingEntitlements = await LicensingService.getPendingEntitlementsForOffer(domainId, offer.id, profile.id);

        if (pendingEntitlements.length === 0) {
            const [activeEntitlement] = await db.select().from(entitlements).where(and(
                eq(entitlements.domainId, domainId),
                eq(entitlements.offerId, offer.id),
                eq(entitlements.agentProfileId, profile.id),
                eq(entitlements.status, 'active')
            )).orderBy(desc(entitlements.id));

            if (activeEntitlement) {
                return {
                    data: {
                        ...activeEntitlement,
                        expiresAt: activeEntitlement.expiresAt ? activeEntitlement.expiresAt.toISOString() : null,
                        activatedAt: activeEntitlement.activatedAt ? activeEntitlement.activatedAt.toISOString() : null
                    },
                    meta: buildMeta('Use this entitlement to consume paid content', ['GET /api/content-items/:id'], 'low', 1)
                };
            }

            return reply.status(404).send(toErrorPayload(
                'Pending purchase not found',
                'PAYMENT_CONFIRMATION_REQUIRED',
                'Start a purchase via POST /api/offers/:id/purchase before confirming settlement.'
            ));
        }

        let targetEntitlement = null as typeof pendingEntitlements[number] | null;
        if (paymentHashHeader) {
            targetEntitlement = pendingEntitlements.find((entry) => entry.paymentHash === paymentHashHeader) ?? null;
            if (!targetEntitlement) {
                return reply.status(404).send(toErrorPayload(
                    'Entitlement not found',
                    'ENTITLEMENT_NOT_FOUND',
                    'x-payment-hash did not match a pending purchase for this offer.'
                ));
            }
        } else if (pendingEntitlements.length === 1) {
            targetEntitlement = pendingEntitlements[0];
        } else {
            return reply.status(409).send({
                ...toErrorPayload(
                    'Multiple pending entitlements',
                    'ENTITLEMENT_AMBIGUOUS',
                    'Provide x-payment-hash to select which pending purchase to confirm.'
                ),
                context: {
                    candidatePaymentHashes: pendingEntitlements.map((entry) => entry.paymentHash),
                    candidateEntitlementIds: pendingEntitlements.map((entry) => entry.id)
                }
            });
        }

        const verification = await globalL402Options.provider.verifyPayment(targetEntitlement.paymentHash, credentials.preimage);
        if (verification.status === 'pending') {
            return reply.status(402).send(toErrorPayload(
                'Payment settlement pending',
                'PAYMENT_SETTLEMENT_PENDING',
                'Complete settlement and retry confirmation, or wait for provider webhook reconciliation.'
            ));
        }

        if (verification.status === 'expired' || verification.status === 'failed') {
            await transitionPaymentStatus(targetEntitlement.paymentHash, verification.status, {
                providerName: globalL402Options.provider.providerName,
                providerInvoiceId: verification.providerInvoiceId ?? null,
                expiresAt: verification.expiresAt ?? null,
                settledAt: verification.settledAt ?? null,
                failureReason: verification.failureReason ?? null,
                detailsPatch: {
                    purchaseConfirmStatus: verification.status,
                    purchaseConfirmAt: new Date().toISOString()
                }
            });

            return reply.status(402).send(toErrorPayload(
                'Payment verification failed',
                'PAYMENT_VERIFICATION_FAILED',
                'The invoice is no longer payable. Start a new purchase to receive a fresh challenge.'
            ));
        }

        await transitionPaymentStatus(targetEntitlement.paymentHash, 'paid', {
            providerName: globalL402Options.provider.providerName,
            providerInvoiceId: verification.providerInvoiceId ?? null,
            expiresAt: verification.expiresAt ?? null,
            settledAt: verification.settledAt ?? null,
            failureReason: null,
            detailsPatch: {
                purchaseConfirmStatus: 'paid',
                purchaseConfirmAt: new Date().toISOString()
            }
        });

        const entitlement = await LicensingService.activateEntitlementForPayment(domainId, targetEntitlement.paymentHash);
        if (!entitlement || entitlement.status !== 'active') {
            return reply.status(409).send(toErrorPayload(
                'Entitlement not active',
                'ENTITLEMENT_NOT_ACTIVE',
                'Payment settled but entitlement activation failed. Retry confirmation with the same payment hash.'
            ));
        }

        return {
            data: {
                ...entitlement,
                expiresAt: entitlement.expiresAt ? entitlement.expiresAt.toISOString() : null,
                activatedAt: entitlement.activatedAt ? entitlement.activatedAt.toISOString() : null
            },
            meta: buildMeta('Use this entitlement to consume paid content', ['GET /api/content-items/:id'], 'low', 1)
        };
    });

    server.get('/entitlements/me', {
        schema: {
            response: {
                200: createAIResponse(Type.Array(Type.Object({
                    id: Type.Number(),
                    domainId: Type.Number(),
                    offerId: Type.Number(),
                    policyId: Type.Number(),
                    policyVersion: Type.Number(),
                    agentProfileId: Type.Number(),
                    paymentHash: Type.String(),
                    status: Type.String(),
                    remainingReads: Type.Union([Type.Number(), Type.Null()]),
                    expiresAt: Type.Union([Type.String(), Type.Null()]),
                    activatedAt: Type.Union([Type.String(), Type.Null()]),
                    terminatedAt: Type.Union([Type.String(), Type.Null()])
                }))),
                403: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const domainId = getDomainId(request);
        const pKeyId = (request as any).authPrincipal?.keyId;
        if (typeof pKeyId !== 'number') {
            return reply.status(403).send(toErrorPayload(
                'API Key required',
                'API_KEY_REQUIRED',
                'Use an API key principal to list entitlement ownership.'
            ));
        }

        const [profile] = await db.select().from(agentProfiles).where(and(
            eq(agentProfiles.apiKeyId, pKeyId),
            eq(agentProfiles.domainId, domainId)
        ));

        if (!profile) {
            return {
                data: [],
                meta: buildMeta('No entitlements yet', ['POST /api/offers/:id/purchase'], 'low', 0)
            };
        }

        const rows = await LicensingService.getEntitlementsForAgent(domainId, profile.id);
        return {
            data: rows.map((row) => ({
                ...row,
                expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
                activatedAt: row.activatedAt ? row.activatedAt.toISOString() : null,
                terminatedAt: row.terminatedAt ? row.terminatedAt.toISOString() : null
            })),
            meta: buildMeta('Inspect your entitlement access grants', ['GET /api/content-items/:id/offers'], 'low', 1)
        };
    });

    server.get('/entitlements/:id', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                200: createAIResponse(Type.Object({
                    id: Type.Number(),
                    domainId: Type.Number(),
                    offerId: Type.Number(),
                    policyId: Type.Number(),
                    policyVersion: Type.Number(),
                    agentProfileId: Type.Number(),
                    paymentHash: Type.String(),
                    status: Type.String(),
                    remainingReads: Type.Union([Type.Number(), Type.Null()]),
                    expiresAt: Type.Union([Type.String(), Type.Null()]),
                    activatedAt: Type.Union([Type.String(), Type.Null()]),
                    terminatedAt: Type.Union([Type.String(), Type.Null()])
                })),
                403: AIErrorResponse,
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        const domainId = getDomainId(request);
        const pKeyId = (request as any).authPrincipal?.keyId;
        if (typeof pKeyId !== 'number') {
            return reply.status(403).send(toErrorPayload(
                'API Key required',
                'API_KEY_REQUIRED',
                'Use an API key principal to inspect entitlement ownership.'
            ));
        }

        const [profile] = await db.select().from(agentProfiles).where(and(
            eq(agentProfiles.apiKeyId, pKeyId),
            eq(agentProfiles.domainId, domainId)
        ));
        if (!profile) {
            return reply.status(404).send(toErrorPayload(
                'Entitlement not found',
                'ENTITLEMENT_NOT_FOUND',
                'No entitlement profile exists for this API key in the selected domain.'
            ));
        }

        const entitlement = await LicensingService.getEntitlementForAgentById(domainId, profile.id, id);
        if (!entitlement) {
            return reply.status(404).send(toErrorPayload(
                'Entitlement not found',
                'ENTITLEMENT_NOT_FOUND',
                'Provide a valid entitlement ID owned by this API key and domain.'
            ));
        }

        return {
            data: {
                ...entitlement,
                expiresAt: entitlement.expiresAt ? entitlement.expiresAt.toISOString() : null,
                activatedAt: entitlement.activatedAt ? entitlement.activatedAt.toISOString() : null,
                terminatedAt: entitlement.terminatedAt ? entitlement.terminatedAt.toISOString() : null
            },
            meta: buildMeta('Use this entitlement for paid-content reads', ['GET /api/content-items/:id'], 'low', 1)
        };
    });

    server.post('/entitlements/:id/delegate', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            body: Type.Object({
                targetApiKeyId: Type.Number(),
                readsAmount: Type.Number()
            }),
            response: {
                200: createAIResponse(Type.Object({
                    id: Type.Number(),
                    domainId: Type.Number(),
                    offerId: Type.Number(),
                    policyId: Type.Number(),
                    policyVersion: Type.Number(),
                    agentProfileId: Type.Number(),
                    paymentHash: Type.String(),
                    status: Type.String(),
                    remainingReads: Type.Union([Type.Number(), Type.Null()]),
                    expiresAt: Type.Optional(Type.String()),
                    delegatedFrom: Type.Union([Type.Number(), Type.Null()])
                })),
                403: AIErrorResponse,
                404: AIErrorResponse,
                400: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        const { targetApiKeyId, readsAmount } = request.body as { targetApiKeyId: number, readsAmount: number };
        const domainId = getDomainId(request);

        const pKeyId = (request as any).authPrincipal?.keyId;
        if (typeof pKeyId !== 'number') {
            return reply.status(403).send(toErrorPayload('API Key required', 'API_KEY_REQUIRED', 'Supervisors cannot delegate entitlements.'));
        }

        const [sourceProfile] = await db.select().from(agentProfiles).where(and(
            eq(agentProfiles.apiKeyId, pKeyId),
            eq(agentProfiles.domainId, domainId)
        ));
        if (!sourceProfile) return reply.status(403).send(toErrorPayload('Profile missing', 'PROFILE_MISSING', 'You do not have any entitlements.'));

        const [entitlement] = await db.select().from(entitlements).where(and(eq(entitlements.id, id), eq(entitlements.agentProfileId, sourceProfile.id), eq(entitlements.domainId, domainId)));
        if (!entitlement) return reply.status(404).send(toErrorPayload('Entitlement missing', 'ENTITLEMENT_NOT_FOUND', 'Could not locate the parent entitlement.'));

        let [targetProfile] = await db.select().from(agentProfiles).where(and(
            eq(agentProfiles.apiKeyId, targetApiKeyId),
            eq(agentProfiles.domainId, domainId)
        ));
        if (!targetProfile) {
            [targetProfile] = await db.insert(agentProfiles).values({ domainId, apiKeyId: targetApiKeyId }).returning();
        }

        try {
            const delegated = await LicensingService.delegateEntitlement(domainId, entitlement.id, targetProfile.id, readsAmount);
            return {
                data: delegated,
                meta: buildMeta('Share entitlement token', [], 'low', 0)
            };
        } catch (e: any) {
            return reply.status(400).send(toErrorPayload(e.message, 'DELEGATION_FAILED', 'Check delegation rules.'));
        }
    });

    server.put('/content-items/:id', {
        preHandler: globalL402Middleware,
        schema: {
            querystring: DryRunQuery,
            params: Type.Object({
                id: Type.Number()
            }),
            body: Type.Object({
                contentTypeId: Type.Optional(Type.Number()),
                data: Type.Optional(Type.Union([Type.String(), Type.Object({}, { additionalProperties: true })])),
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
                404: AIErrorResponse,
                403: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        const { mode } = request.query as DryRunQueryType;
        const rawPayload = request.body as any;
        if (rawPayload.data && typeof rawPayload.data !== 'string') {
            rawPayload.data = JSON.stringify(rawPayload.data);
        }
        const payload = rawPayload as ContentItemUpdate;
        const updateData = stripUndefined(payload);

        if (!hasDefinedValues(payload)) {
            return reply.status(400).send(toErrorPayload(
                'Empty update payload',
                'EMPTY_UPDATE_BODY',
                'The request body must contain at least one field to update (contentTypeId, data, or status). Send a body like { "data": "...", "status": "published" }.'
            ));
        }

        const [existing] = await db.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(request))));
        if (!existing) {
            return reply.status(404).send(notFoundContentItem(id));
        }

        const targetContentTypeId = typeof updateData.contentTypeId === 'number'
            ? updateData.contentTypeId
            : existing.contentTypeId;
        const [targetContentType] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, targetContentTypeId), eq(contentTypes.domainId, getDomainId(request))));
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

        const activeWorkflow = await WorkflowService.getActiveWorkflow(getDomainId(request), targetContentTypeId);
        if (activeWorkflow && updateData.status && updateData.status !== existing.status) {
            return reply.status(403).send(toErrorPayload(
                'Workflow transition forbidden',
                'WORKFLOW_TRANSITION_FORBIDDEN',
                `This content type is governed by an active workflow. You cannot manually change the status to '${updateData.status}'. Use POST /api/content-items/:id/submit to request a transition.`
            ));
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
            const [current] = await tx.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(request))));
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
                .where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(request))))
                .returning();

            return updated;
        });

        if (!result) {
            return reply.status(404).send(notFoundContentItem(id));
        }

        if (result.status === 'published') {
            EmbeddingService.syncItemEmbeddings(getDomainId(request), result.id).catch(console.error);
        } else {
            EmbeddingService.deleteItemEmbeddings(getDomainId(request), result.id).catch(console.error);
        }

        await logAudit(getDomainId(request), 'update',
            'content_item',
            result.id,
            updateData,
            toAuditActorId(request as { authPrincipal?: { keyId: number | string } }),
            request.id
        );

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
            .innerJoin(contentItems, eq(contentItemVersions.contentItemId, contentItems.id))
            .where(and(eq(contentItemVersions.contentItemId, id), eq(contentItems.domainId, getDomainId(request))))
            .orderBy(desc(contentItemVersions.version));

        return {
            data: versions.map((v) => v.content_item_versions),
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

        const [currentItem] = await db.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(request))));
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
                const [currentItem] = await tx.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(request))));
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
                    .where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(request))))
                    .returning();

                return restoredItem;
            });

            if (!result) {
                return reply.status(404).send(notFoundContentItem(id));
            }

            await logAudit(getDomainId(request), 'rollback',
                'content_item',
                result.id,
                { fromVersion: result.version - 1, toVersion: version },
                toAuditActorId(request as { authPrincipal?: { keyId: number | string } }),
                request.id
            );

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
        preHandler: globalL402Middleware,
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
            const [existing] = await db.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(request))));
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
            .where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(request))))
            .returning();

        if (!deletedItem) {
            return reply.status(404).send(notFoundContentItem(id));
        }

        await logAudit(getDomainId(request), 'delete',
            'content_item',
            deletedItem.id,
            deletedItem,
            toAuditActorId(request as { authPrincipal?: { keyId: number | string } }),
            request.id
        );

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

    server.post('/content-items/batch', {
        preHandler: globalL402Middleware,
        schema: {
            querystring: Type.Object({
                mode: Type.Optional(Type.Literal('dry_run')),
                atomic: Type.Optional(Type.Boolean())
            }),
            body: Type.Object({
                items: Type.Array(Type.Object({
                    contentTypeId: Type.Number(),
                    data: Type.String(),
                    status: Type.Optional(Type.String())
                }))
            }),
            response: {
                200: createAIResponse(Type.Object({
                    atomic: Type.Boolean(),
                    results: Type.Array(Type.Object({
                        index: Type.Number(),
                        ok: Type.Boolean(),
                        id: Type.Optional(Type.Number()),
                        version: Type.Optional(Type.Number()),
                        code: Type.Optional(Type.String()),
                        error: Type.Optional(Type.String())
                    }))
                })),
                400: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { mode, atomic } = request.query as BatchModeQuery;
        const { items } = request.body as {
            items: Array<{ contentTypeId: number; data: string; status?: string }>;
        };
        const actorId = toAuditActorId(request as { authPrincipal?: { keyId: number | string } });
        const isAtomic = atomic === true;

        if (items.length === 0) {
            return reply.status(400).send(toErrorPayload(
                'Batch request is empty',
                'EMPTY_BATCH',
                'Provide at least one item in body.items.'
            ));
        }

        const buildError = (index: number, code: string, error: string) => ({ index, ok: false, code, error });

        if (isDryRun(mode)) {
            const results = await Promise.all(items.map(async (item, index) => {
                const [contentType] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, item.contentTypeId), eq(contentTypes.domainId, getDomainId(request))));
                if (!contentType) {
                    return buildError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${item.contentTypeId} not found`);
                }

                const contentValidation = validateContentDataAgainstSchema(contentType.schema, item.data);
                if (contentValidation) {
                    return buildError(index, contentValidation.code, contentValidation.error);
                }

                return {
                    index,
                    ok: true,
                    id: 0,
                    version: 1
                };
            }));

            return {
                data: {
                    atomic: isAtomic,
                    results
                },
                meta: buildMeta(
                    'Execute batch create when dry-run output is acceptable',
                    ['POST /api/content-items/batch'],
                    'medium',
                    0,
                    true
                )
            };
        }

        if (isAtomic) {
            try {
                const created = await db.transaction(async (tx) => {
                    const results: Array<{ index: number; ok: boolean; id?: number; version?: number }> = [];
                    for (const [index, item] of items.entries()) {
                        const [contentType] = await tx.select().from(contentTypes).where(and(eq(contentTypes.id, item.contentTypeId), eq(contentTypes.domainId, getDomainId(request))));
                        if (!contentType) {
                            throw new Error(JSON.stringify(buildError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${item.contentTypeId} not found`)));
                        }

                        const contentValidation = validateContentDataAgainstSchema(contentType.schema, item.data);
                        if (contentValidation) {
                            throw new Error(JSON.stringify(buildError(index, contentValidation.code, contentValidation.error)));
                        }

                        const [newItem] = await tx.insert(contentItems).values({
                            domainId: getDomainId(request),
                            contentTypeId: item.contentTypeId,
                            data: item.data,
                            status: item.status || 'draft'
                        }).returning();

                        results.push({ index, ok: true, id: newItem.id, version: newItem.version });
                    }
                    return results;
                });

                for (const entry of created) {
                    if (entry.id !== undefined) {
                        await logAudit(getDomainId(request), 'create',
                            'content_item',
                            entry.id,
                            { batch: true, mode: 'atomic' },
                            actorId,
                            request.id
                        );
                    }
                }

                return {
                    data: {
                        atomic: true,
                        results: created
                    },
                    meta: buildMeta(
                        'Review created items',
                        ['GET /api/content-items'],
                        'medium',
                        1
                    )
                };
            } catch (error) {
                const parsed = error instanceof Error ? error.message : String(error);
                let context: Record<string, unknown> | undefined;
                try {
                    context = JSON.parse(parsed);
                } catch {
                    context = { details: parsed };
                }

                return reply.status(400).send({
                    error: 'Atomic batch create failed',
                    code: 'BATCH_ATOMIC_FAILED',
                    remediation: 'Fix the failing item and retry; atomic mode rolls back all items on failure.',
                    ...(context ? { context } : {})
                });
            }
        }

        const results: Array<{ index: number; ok: boolean; id?: number; version?: number; code?: string; error?: string }> = [];
        for (const [index, item] of items.entries()) {
            try {
                const [contentType] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, item.contentTypeId), eq(contentTypes.domainId, getDomainId(request))));
                if (!contentType) {
                    results.push(buildError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${item.contentTypeId} not found`));
                    continue;
                }

                const contentValidation = validateContentDataAgainstSchema(contentType.schema, item.data);
                if (contentValidation) {
                    results.push(buildError(index, contentValidation.code, contentValidation.error));
                    continue;
                }

                const [newItem] = await db.insert(contentItems).values({
                    domainId: getDomainId(request),
                    contentTypeId: item.contentTypeId,
                    data: item.data,
                    status: item.status || 'draft'
                }).returning();

                await logAudit(getDomainId(request), 'create',
                    'content_item',
                    newItem.id,
                    { batch: true, mode: 'partial' },
                    actorId,
                    request.id
                );

                results.push({ index, ok: true, id: newItem.id, version: newItem.version });
            } catch (error) {
                results.push(buildError(index, 'BATCH_ITEM_FAILED', error instanceof Error ? error.message : String(error)));
            }
        }

        return {
            data: {
                atomic: false,
                results
            },
            meta: buildMeta(
                'Review failed items and retry only failures',
                ['POST /api/content-items/batch'],
                'medium',
                1
            )
        };
    });

    server.put('/content-items/batch', {
        preHandler: globalL402Middleware,
        schema: {
            querystring: Type.Object({
                mode: Type.Optional(Type.Literal('dry_run')),
                atomic: Type.Optional(Type.Boolean())
            }),
            body: Type.Object({
                items: Type.Array(Type.Object({
                    id: Type.Number(),
                    contentTypeId: Type.Optional(Type.Number()),
                    data: Type.Optional(Type.String()),
                    status: Type.Optional(Type.String())
                }))
            }),
            response: {
                200: createAIResponse(Type.Object({
                    atomic: Type.Boolean(),
                    results: Type.Array(Type.Object({
                        index: Type.Number(),
                        ok: Type.Boolean(),
                        id: Type.Optional(Type.Number()),
                        version: Type.Optional(Type.Number()),
                        code: Type.Optional(Type.String()),
                        error: Type.Optional(Type.String())
                    }))
                })),
                400: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { mode, atomic } = request.query as BatchModeQuery;
        const { items } = request.body as {
            items: Array<{ id: number; contentTypeId?: number; data?: string; status?: string }>;
        };
        const actorId = toAuditActorId(request as { authPrincipal?: { keyId: number | string } });
        const isAtomic = atomic === true;

        if (items.length === 0) {
            return reply.status(400).send(toErrorPayload(
                'Batch request is empty',
                'EMPTY_BATCH',
                'Provide at least one item in body.items.'
            ));
        }

        const buildError = (index: number, code: string, error: string) => ({ index, ok: false, code, error });

        const validateUpdateInput = async (item: { id: number; contentTypeId?: number; data?: string; status?: string }, index: number) => {
            const updateData = stripUndefined({ contentTypeId: item.contentTypeId, data: item.data, status: item.status });
            if (!hasDefinedValues(updateData)) {
                return { ok: false, error: buildError(index, 'EMPTY_UPDATE_BODY', `No update fields provided for item ${item.id}`) } as const;
            }

            const [existing] = await db.select().from(contentItems).where(and(eq(contentItems.id, item.id), eq(contentItems.domainId, getDomainId(request))));
            if (!existing) {
                return { ok: false, error: buildError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${item.id} not found`) } as const;
            }

            const targetContentTypeId = updateData.contentTypeId ?? existing.contentTypeId;
            const [targetContentType] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, targetContentTypeId), eq(contentTypes.domainId, getDomainId(request))));
            if (!targetContentType) {
                return { ok: false, error: buildError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${targetContentTypeId} not found`) } as const;
            }

            const targetData = updateData.data ?? existing.data;
            const validation = validateContentDataAgainstSchema(targetContentType.schema, targetData);
            if (validation) {
                return { ok: false, error: buildError(index, validation.code, validation.error) } as const;
            }

            return { ok: true, existing, updateData } as const;
        };

        if (isDryRun(mode)) {
            const dryResults: Array<Record<string, unknown>> = [];
            for (const [index, item] of items.entries()) {
                const validated = await validateUpdateInput(item, index);
                if (!validated.ok) {
                    dryResults.push(validated.error);
                    continue;
                }

                dryResults.push({
                    index,
                    ok: true,
                    id: item.id,
                    version: validated.existing.version + 1
                });
            }

            return {
                data: {
                    atomic: isAtomic,
                    results: dryResults
                },
                meta: buildMeta(
                    'Execute batch update when dry-run output is acceptable',
                    ['PUT /api/content-items/batch'],
                    'medium',
                    0,
                    true
                )
            };
        }

        if (isAtomic) {
            try {
                const results = await db.transaction(async (tx) => {
                    const output: Array<{ index: number; ok: boolean; id: number; version: number }> = [];
                    for (const [index, item] of items.entries()) {
                        const updateData = stripUndefined({ contentTypeId: item.contentTypeId, data: item.data, status: item.status });
                        if (!hasDefinedValues(updateData)) {
                            throw new Error(JSON.stringify(buildError(index, 'EMPTY_UPDATE_BODY', `No update fields provided for item ${item.id}`)));
                        }

                        const [existing] = await tx.select().from(contentItems).where(and(eq(contentItems.id, item.id), eq(contentItems.domainId, getDomainId(request))));
                        if (!existing) {
                            throw new Error(JSON.stringify(buildError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${item.id} not found`)));
                        }

                        const targetContentTypeId = updateData.contentTypeId ?? existing.contentTypeId;
                        const [targetContentType] = await tx.select().from(contentTypes).where(and(eq(contentTypes.id, targetContentTypeId), eq(contentTypes.domainId, getDomainId(request))));
                        if (!targetContentType) {
                            throw new Error(JSON.stringify(buildError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${targetContentTypeId} not found`)));
                        }

                        const targetData = updateData.data ?? existing.data;
                        const validation = validateContentDataAgainstSchema(targetContentType.schema, targetData);
                        if (validation) {
                            throw new Error(JSON.stringify(buildError(index, validation.code, validation.error)));
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
                            .where(and(eq(contentItems.id, item.id), eq(contentItems.domainId, getDomainId(request))))
                            .returning();

                        output.push({ index, ok: true, id: updated.id, version: updated.version });
                    }

                    return output;
                });

                for (const row of results) {
                    await logAudit(getDomainId(request), 'update',
                        'content_item',
                        row.id,
                        { batch: true, mode: 'atomic' },
                        actorId,
                        request.id
                    );
                }

                return {
                    data: {
                        atomic: true,
                        results
                    },
                    meta: buildMeta(
                        'Review updated items',
                        ['GET /api/content-items'],
                        'medium',
                        1
                    )
                };
            } catch (error) {
                const parsed = error instanceof Error ? error.message : String(error);
                let context: Record<string, unknown> | undefined;
                try {
                    context = JSON.parse(parsed);
                } catch {
                    context = { details: parsed };
                }

                return reply.status(400).send({
                    error: 'Atomic batch update failed',
                    code: 'BATCH_ATOMIC_FAILED',
                    remediation: 'Fix the failing item and retry; atomic mode rolls back all items on failure.',
                    ...(context ? { context } : {})
                });
            }
        }

        const results: Array<Record<string, unknown>> = [];
        for (const [index, item] of items.entries()) {
            const validated = await validateUpdateInput(item, index);
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

            await logAudit(getDomainId(request), 'update',
                'content_item',
                result.id,
                { batch: true, mode: 'partial' },
                actorId,
                request.id
            );

            results.push({
                index,
                ok: true,
                id: result.id,
                version: result.version
            });
        }

        return {
            data: {
                atomic: false,
                results
            },
            meta: buildMeta(
                'Review failed items and retry only failures',
                ['PUT /api/content-items/batch'],
                'medium',
                1
            )
        };
    });

    server.delete('/content-items/batch', {
        preHandler: globalL402Middleware,
        schema: {
            querystring: Type.Object({
                mode: Type.Optional(Type.Literal('dry_run')),
                atomic: Type.Optional(Type.Boolean())
            }),
            body: Type.Object({
                ids: Type.Array(Type.Number())
            }),
            response: {
                200: createAIResponse(Type.Object({
                    atomic: Type.Boolean(),
                    results: Type.Array(Type.Object({
                        index: Type.Number(),
                        ok: Type.Boolean(),
                        id: Type.Optional(Type.Number()),
                        code: Type.Optional(Type.String()),
                        error: Type.Optional(Type.String())
                    }))
                })),
                400: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { mode, atomic } = request.query as BatchModeQuery;
        const { ids } = request.body as { ids: number[] };
        const actorId = toAuditActorId(request as { authPrincipal?: { keyId: number | string } });
        const isAtomic = atomic === true;

        if (ids.length === 0) {
            return reply.status(400).send(toErrorPayload(
                'Batch request is empty',
                'EMPTY_BATCH',
                'Provide at least one id in body.ids.'
            ));
        }

        const buildError = (index: number, code: string, error: string) => ({ index, ok: false, code, error });

        if (isDryRun(mode)) {
            const results = await Promise.all(ids.map(async (id, index) => {
                const [existing] = await db.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(request))));
                if (!existing) {
                    return buildError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${id} not found`);
                }

                return {
                    index,
                    ok: true,
                    id
                };
            }));

            return {
                data: {
                    atomic: isAtomic,
                    results
                },
                meta: buildMeta(
                    'Execute batch delete when dry-run output is acceptable',
                    ['DELETE /api/content-items/batch'],
                    'high',
                    0,
                    true
                )
            };
        }

        if (isAtomic) {
            try {
                const deleted = await db.transaction(async (tx) => {
                    const rows: Array<{ index: number; ok: boolean; id: number }> = [];
                    for (const [index, id] of ids.entries()) {
                        const [existing] = await tx.delete(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(request)))).returning();
                        if (!existing) {
                            throw new Error(JSON.stringify(buildError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${id} not found`)));
                        }
                        rows.push({ index, ok: true, id: existing.id });
                    }
                    return rows;
                });

                for (const row of deleted) {
                    await logAudit(getDomainId(request), 'delete',
                        'content_item',
                        row.id,
                        { batch: true, mode: 'atomic' },
                        actorId,
                        request.id
                    );
                }

                return {
                    data: {
                        atomic: true,
                        results: deleted
                    },
                    meta: buildMeta(
                        'List remaining content items',
                        ['GET /api/content-items'],
                        'high',
                        1
                    )
                };
            } catch (error) {
                const parsed = error instanceof Error ? error.message : String(error);
                let context: Record<string, unknown> | undefined;
                try {
                    context = JSON.parse(parsed);
                } catch {
                    context = { details: parsed };
                }

                return reply.status(400).send({
                    error: 'Atomic batch delete failed',
                    code: 'BATCH_ATOMIC_FAILED',
                    remediation: 'Fix the failing item and retry; atomic mode rolls back all items on failure.',
                    ...(context ? { context } : {})
                });
            }
        }

        const results: Array<Record<string, unknown>> = [];
        for (const [index, id] of ids.entries()) {
            const [deleted] = await db.delete(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, getDomainId(request)))).returning();
            if (!deleted) {
                results.push(buildError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${id} not found`));
                continue;
            }

            await logAudit(getDomainId(request), 'delete',
                'content_item',
                deleted.id,
                { batch: true, mode: 'partial' },
                actorId,
                request.id
            );

            results.push({
                index,
                ok: true,
                id: deleted.id
            });
        }

        return {
            data: {
                atomic: false,
                results
            },
            meta: buildMeta(
                'Review failed items and retry only failures',
                ['DELETE /api/content-items/batch'],
                'high',
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
                limit: Type.Optional(Type.Number({ default: 50, minimum: 1, maximum: 500 })),
                cursor: Type.Optional(Type.String())
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
                ,
                400: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { entityType, entityId, action, limit: rawLimit, cursor } = request.query as AuditLogQuery;
        const limit = clampLimit(rawLimit);
        const decodedCursor = cursor ? decodeCursor(cursor) : null;
        if (cursor && !decodedCursor) {
            return reply.status(400).send(toErrorPayload(
                'Invalid audit cursor',
                'INVALID_AUDIT_CURSOR',
                'Provide cursor returned by previous GET /api/audit-logs response.'
            ));
        }

        const baseConditions = [
            eq(auditLogs.domainId, getDomainId(request)),
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
        const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

        return {
            data: page,
            meta: buildMeta(
                'Monitor system activity',
                ['GET /api/audit-logs'],
                'low',
                1,
                false,
                {
                    total,
                    hasMore,
                    nextCursor
                }
            )
        };
    });

    server.post('/payments/webhooks/:provider/settled', {
        schema: {
            params: Type.Object({
                provider: Type.String()
            }),
            body: Type.Object({}, { additionalProperties: true }),
            response: {
                200: Type.Object({
                    accepted: Type.Boolean(),
                    eventId: Type.String(),
                    paymentHash: Type.String(),
                    status: Type.String()
                }),
                202: Type.Object({
                    accepted: Type.Boolean(),
                    duplicate: Type.Optional(Type.Boolean()),
                    unknownPayment: Type.Optional(Type.Boolean())
                }),
                400: AIErrorResponse,
                401: AIErrorResponse,
                409: AIErrorResponse,
                503: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET;
        const provider = (request.params as { provider: string }).provider.toLowerCase();
        const signatureRaw = request.headers['x-wordclaw-payment-signature'] ?? request.headers['x-lnbits-signature'];
        const signature = typeof signatureRaw === 'string'
            ? signatureRaw
            : Array.isArray(signatureRaw)
                ? signatureRaw[0]
                : undefined;

        if (!webhookSecret) {
            return reply.status(503).send(toErrorPayload(
                'Payment webhook not configured',
                'PAYMENT_WEBHOOK_NOT_CONFIGURED',
                'Set PAYMENT_WEBHOOK_SECRET before enabling settlement webhooks.'
            ));
        }

        if (!signature || !verifyPaymentWebhookSignature(request.body, signature, webhookSecret)) {
            paymentFlowMetrics.increment('webhook_verify_fail_total');
            return reply.status(401).send(toErrorPayload(
                'Invalid webhook signature',
                'INVALID_PAYMENT_WEBHOOK_SIGNATURE',
                'Ensure the provider signs webhook payloads with the shared PAYMENT_WEBHOOK_SECRET.'
            ));
        }

        const event = parsePaymentWebhookEvent(provider, request.body);
        if (!event) {
            return reply.status(400).send(toErrorPayload(
                'Invalid webhook payload',
                'INVALID_PAYMENT_WEBHOOK_PAYLOAD',
                'Provide eventId, paymentHash, and status in the webhook body.'
            ));
        }

        const [storedEvent] = await db.insert(paymentProviderEvents).values({
            provider: event.provider,
            eventId: event.eventId,
            paymentHash: event.paymentHash,
            status: event.status,
            signature,
            payload: event.payload
        }).onConflictDoNothing({
            target: [paymentProviderEvents.provider, paymentProviderEvents.eventId]
        }).returning();

        if (!storedEvent) {
            return reply.status(202).send({
                accepted: true,
                duplicate: true
            });
        }

        const [payment] = await db.select().from(payments).where(eq(payments.paymentHash, event.paymentHash));
        if (!payment) {
            return reply.status(202).send({
                accepted: true,
                unknownPayment: true
            });
        }

        try {
            const updated = await transitionPaymentStatus(event.paymentHash, event.status, {
                providerName: event.provider,
                providerInvoiceId: event.providerInvoiceId ?? null,
                providerEventId: event.eventId,
                expiresAt: event.expiresAt ?? null,
                settledAt: event.settledAt ?? null,
                failureReason: event.failureReason ?? null,
                detailsPatch: {
                    webhookStatus: event.status,
                    webhookEventId: event.eventId,
                    webhookProvider: event.provider,
                    webhookReceivedAt: new Date().toISOString()
                }
            });

            if (updated && event.status === 'paid') {
                const latency = updated.updatedAt.getTime() - payment.createdAt.getTime();
                paymentFlowMetrics.increment('challenge_to_paid_latency_ms_total', Math.max(0, latency));
                paymentFlowMetrics.increment('challenge_to_paid_latency_samples_total');
            }

            if (updated && (event.status === 'expired' || event.status === 'failed' || event.status === 'paid')) {
                paymentFlowMetrics.increment('reconciliation_corrections_total');
            }
        } catch (error) {
            return reply.status(409).send(toErrorPayload(
                'Invalid payment transition',
                'INVALID_PAYMENT_TRANSITION',
                (error as Error).message
            ));
        }

        return {
            accepted: true,
            eventId: event.eventId,
            paymentHash: event.paymentHash,
            status: event.status
        };
    });

    server.get('/payments/metrics', {
        schema: {
            response: {
                200: createAIResponse(Type.Object({
                    counters: Type.Record(Type.String(), Type.Number()),
                    gauges: Type.Record(Type.String(), Type.Number())
                }))
            }
        }
    }, async () => {
        return {
            data: paymentFlowMetrics.snapshot(),
            meta: buildMeta(
                'Inspect payment flow health indicators',
                ['GET /api/payments', 'GET /api/payments/metrics'],
                'low',
                1
            )
        };
    });

    server.get('/payments', {
        schema: {
            querystring: Type.Object({
                limit: Type.Optional(Type.Number({ default: 50, minimum: 1, maximum: 500 })),
                offset: Type.Optional(Type.Number({ minimum: 0 }))
            }),
            response: {
                200: createAIResponse(Type.Array(Type.Object({
                    id: Type.Number(),
                    paymentHash: Type.String(),
                    amountSatoshis: Type.Number(),
                    status: Type.String(),
                    resourcePath: Type.String(),
                    actorId: Type.Union([Type.String(), Type.Null()]),
                    details: Type.Any(),
                    createdAt: Type.String()
                }))),
                400: AIErrorResponse
            }
        }
    }, async (request) => {
        const { limit: rawLimit, offset: rawOffset } = request.query as PaginationQuery;
        const limit = clampLimit(rawLimit);
        const offset = clampOffset(rawOffset);

        const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
            .from(payments)
            .where(eq(payments.domainId, getDomainId(request)));
        const results = await db.select({
            id: payments.id,
            paymentHash: payments.paymentHash,
            amountSatoshis: payments.amountSatoshis,
            status: payments.status,
            resourcePath: payments.resourcePath,
            actorId: payments.actorId,
            details: payments.details,
            createdAt: payments.createdAt
        })
            .from(payments)
            .where(eq(payments.domainId, getDomainId(request)))
            .orderBy(desc(payments.createdAt))
            .limit(limit)
            .offset(offset);

        const hasMore = offset + results.length < total;

        return {
            data: results,
            meta: buildMeta(
                'Monitor payment activity',
                ['GET /api/payments'],
                'low',
                1,
                false,
                { total, offset, limit, hasMore }
            )
        };
    });

    server.get('/payments/:id', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                200: createAIResponse(Type.Object({
                    id: Type.Number(),
                    paymentHash: Type.String(),
                    amountSatoshis: Type.Number(),
                    status: Type.String(),
                    resourcePath: Type.String(),
                    actorId: Type.Union([Type.String(), Type.Null()]),
                    details: Type.Any(),
                    createdAt: Type.String()
                })),
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as { id: number };
        const [payment] = await db.select().from(payments).where(and(eq(payments.id, id), eq(payments.domainId, getDomainId(request))));
        if (!payment) {
            return reply.status(404).send(toErrorPayload('Payment not found', 'PAYMENT_NOT_FOUND', 'Check the payment ID.'));
        }
        return {
            data: payment,
            meta: buildMeta('Get a specific payment', ['GET /api/payments/:id'], 'low', 1, false)
        };
    });

    const AgentRunSchema = Type.Object({
        id: Type.Number(),
        domainId: Type.Number(),
        definitionId: Type.Union([Type.Number(), Type.Null()]),
        goal: Type.String(),
        runType: Type.String(),
        status: Type.String(),
        requestedBy: Type.Union([Type.String(), Type.Null()]),
        metadata: Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()]),
        startedAt: Type.Union([Type.String(), Type.Null()]),
        completedAt: Type.Union([Type.String(), Type.Null()]),
        createdAt: Type.String(),
        updatedAt: Type.String()
    });

    const AgentRunDefinitionSchema = Type.Object({
        id: Type.Number(),
        domainId: Type.Number(),
        name: Type.String(),
        runType: Type.String(),
        strategyConfig: Type.Object({}, { additionalProperties: true }),
        active: Type.Boolean(),
        createdAt: Type.String(),
        updatedAt: Type.String()
    });

    const AgentRunStepSchema = Type.Object({
        id: Type.Number(),
        runId: Type.Number(),
        domainId: Type.Number(),
        stepIndex: Type.Number(),
        stepKey: Type.String(),
        actionType: Type.String(),
        status: Type.String(),
        requestSnapshot: Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()]),
        responseSnapshot: Type.Union([Type.Object({}, { additionalProperties: true }), Type.Null()]),
        errorMessage: Type.Union([Type.String(), Type.Null()]),
        startedAt: Type.Union([Type.String(), Type.Null()]),
        completedAt: Type.Union([Type.String(), Type.Null()]),
        createdAt: Type.String(),
        updatedAt: Type.String()
    });

    const AgentRunCheckpointSchema = Type.Object({
        id: Type.Number(),
        runId: Type.Number(),
        domainId: Type.Number(),
        checkpointKey: Type.String(),
        payload: Type.Object({}, { additionalProperties: true }),
        createdAt: Type.String()
    });

    // --- Autonomous Agent Run Definitions ---

    server.post('/agent-run-definitions', {
        schema: {
            body: Type.Object({
                name: Type.String({ minLength: 1 }),
                runType: Type.String({ minLength: 1 }),
                strategyConfig: Type.Optional(Type.Object({}, { additionalProperties: true })),
                active: Type.Optional(Type.Boolean())
            }),
            response: {
                201: createAIResponse(AgentRunDefinitionSchema),
                400: AIErrorResponse,
                409: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const payload = request.body as {
            name: string;
            runType: string;
            strategyConfig?: Record<string, unknown>;
            active?: boolean;
        };

        try {
            const definition = await AgentRunService.createDefinition(getDomainId(request), payload);
            return reply.status(201).send({
                data: serializeAgentRunDefinition(definition),
                meta: buildMeta(
                    'Use this definition when creating runs',
                    ['POST /api/agent-runs'],
                    'medium',
                    1
                )
            });
        } catch (error) {
            if (error instanceof AgentRunServiceError) {
                if (error.code === 'AGENT_RUN_DEFINITION_NAME_CONFLICT') {
                    return reply.status(409).send(toErrorPayload(
                        'Run definition name already exists',
                        error.code,
                        'Choose a unique definition name in this domain.'
                    ));
                }
                if (error.code === 'AGENT_RUN_DEFINITION_INVALID_NAME' || error.code === 'AGENT_RUN_DEFINITION_INVALID_RUN_TYPE') {
                    return reply.status(400).send(toErrorPayload(
                        'Invalid run definition payload',
                        error.code,
                        error.message
                    ));
                }
            }
            throw error;
        }
    });

    server.get('/agent-run-definitions', {
        schema: {
            querystring: Type.Object({
                active: Type.Optional(Type.Boolean()),
                runType: Type.Optional(Type.String()),
                limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
                offset: Type.Optional(Type.Number({ minimum: 0 }))
            }),
            response: {
                200: createAIResponse(Type.Array(AgentRunDefinitionSchema))
            }
        }
    }, async (request) => {
        const { active, runType, limit, offset } = request.query as AgentRunDefinitionsQuery;
        const definitions = await AgentRunService.listDefinitions(getDomainId(request), {
            active,
            runType,
            limit,
            offset
        });

        return {
            data: definitions.items.map(serializeAgentRunDefinition),
            meta: buildMeta(
                'Manage reusable run templates',
                ['POST /api/agent-run-definitions', 'POST /api/agent-runs'],
                'low',
                1,
                false,
                {
                    total: definitions.total,
                    offset: definitions.offset,
                    limit: definitions.limit,
                    hasMore: definitions.hasMore
                }
            )
        };
    });

    server.get('/agent-run-definitions/:id', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                200: createAIResponse(AgentRunDefinitionSchema),
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as { id: number };
        const definition = await AgentRunService.getDefinition(getDomainId(request), id);
        if (!definition) {
            return reply.status(404).send(notFoundAgentRunDefinition(id));
        }

        return {
            data: serializeAgentRunDefinition(definition),
            meta: buildMeta('Update this run definition', [`PUT /api/agent-run-definitions/${id}`], 'low', 1)
        };
    });

    server.put('/agent-run-definitions/:id', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            body: Type.Object({
                name: Type.Optional(Type.String({ minLength: 1 })),
                runType: Type.Optional(Type.String({ minLength: 1 })),
                strategyConfig: Type.Optional(Type.Object({}, { additionalProperties: true })),
                active: Type.Optional(Type.Boolean())
            }),
            response: {
                200: createAIResponse(AgentRunDefinitionSchema),
                400: AIErrorResponse,
                404: AIErrorResponse,
                409: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as { id: number };
        const payload = request.body as {
            name?: string;
            runType?: string;
            strategyConfig?: Record<string, unknown>;
            active?: boolean;
        };

        try {
            const definition = await AgentRunService.updateDefinition(getDomainId(request), id, payload);
            return {
                data: serializeAgentRunDefinition(definition),
                meta: buildMeta('Apply updated template to new runs', ['POST /api/agent-runs'], 'low', 1)
            };
        } catch (error) {
            if (error instanceof AgentRunServiceError) {
                if (error.code === 'AGENT_RUN_DEFINITION_NOT_FOUND') {
                    return reply.status(404).send(notFoundAgentRunDefinition(id));
                }
                if (error.code === 'AGENT_RUN_DEFINITION_NAME_CONFLICT') {
                    return reply.status(409).send(toErrorPayload(
                        'Run definition name already exists',
                        error.code,
                        'Choose a unique definition name in this domain.'
                    ));
                }
                if (
                    error.code === 'AGENT_RUN_DEFINITION_INVALID_NAME'
                    || error.code === 'AGENT_RUN_DEFINITION_INVALID_RUN_TYPE'
                    || error.code === 'AGENT_RUN_DEFINITION_EMPTY_UPDATE'
                ) {
                    return reply.status(400).send(toErrorPayload(
                        'Invalid run definition update',
                        error.code,
                        error.message
                    ));
                }
            }
            throw error;
        }
    });

    // --- Autonomous Agent Runs ---

    server.post('/agent-runs', {
        schema: {
            body: Type.Object({
                goal: Type.String({ minLength: 1 }),
                runType: Type.Optional(Type.String()),
                definitionId: Type.Optional(Type.Number()),
                requireApproval: Type.Optional(Type.Boolean()),
                metadata: Type.Optional(Type.Object({}, { additionalProperties: true }))
            }),
            response: {
                201: createAIResponse(AgentRunSchema),
                400: AIErrorResponse,
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const payload = request.body as {
            goal: string;
            runType?: string;
            definitionId?: number;
            requireApproval?: boolean;
            metadata?: Record<string, unknown>;
        };

        try {
            const authPrincipal = (request as any).authPrincipal as { keyId?: number | string } | undefined;
            const run = await AgentRunService.createRun(getDomainId(request), {
                goal: payload.goal,
                runType: payload.runType,
                definitionId: payload.definitionId,
                requireApproval: payload.requireApproval,
                metadata: payload.metadata,
                requestedBy: authPrincipal?.keyId?.toString()
            });

            return reply.status(201).send({
                data: serializeAgentRun(run),
                meta: buildMeta(
                    run.status === 'waiting_approval' ? 'Approve run to start execution' : 'Inspect run progress',
                    [`POST /api/agent-runs/${run.id}/control`, `GET /api/agent-runs/${run.id}`],
                    'medium',
                    1
                )
            });
        } catch (error) {
            if (error instanceof AgentRunServiceError) {
                if (error.code === 'AGENT_RUN_DEFINITION_NOT_FOUND') {
                    return reply.status(404).send(toErrorPayload(
                        'Run definition not found',
                        error.code,
                        'Provide a valid definitionId that belongs to this domain.'
                    ));
                }

                if (error.code === 'AGENT_RUN_DEFINITION_INACTIVE') {
                    return reply.status(400).send(toErrorPayload(
                        'Run definition inactive',
                        error.code,
                        'Activate the run definition before creating new runs from it.'
                    ));
                }

                if (error.code === 'AGENT_RUN_INVALID_GOAL') {
                    return reply.status(400).send(toErrorPayload(
                        'Invalid run goal',
                        error.code,
                        'Provide a non-empty goal string.'
                    ));
                }
            }

            throw error;
        }
    });

    server.get('/agent-runs', {
        schema: {
            querystring: Type.Object({
                status: Type.Optional(Type.String()),
                runType: Type.Optional(Type.String()),
                definitionId: Type.Optional(Type.Number()),
                limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
                offset: Type.Optional(Type.Number({ minimum: 0 }))
            }),
            response: {
                200: createAIResponse(Type.Array(AgentRunSchema)),
                400: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { status, runType, definitionId, limit, offset } = request.query as AgentRunsQuery;
        if (status && !isAgentRunStatus(status)) {
            return reply.status(400).send(toErrorPayload(
                'Invalid run status',
                'AGENT_RUN_INVALID_STATUS',
                `Use one of: queued, planning, waiting_approval, running, succeeded, failed, cancelled.`
            ));
        }

        const runs = await AgentRunService.listRuns(getDomainId(request), {
            status: status as any,
            runType,
            definitionId,
            limit,
            offset
        });

        return {
            data: runs.items.map(serializeAgentRun),
            meta: buildMeta(
                'Inspect run queue',
                ['POST /api/agent-runs'],
                'low',
                1,
                false,
                {
                    total: runs.total,
                    offset: runs.offset,
                    limit: runs.limit,
                    hasMore: runs.hasMore
                }
            )
        };
    });

    server.get('/agent-runs/:id', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                200: createAIResponse(Type.Object({
                    run: AgentRunSchema,
                    steps: Type.Array(AgentRunStepSchema),
                    checkpoints: Type.Array(AgentRunCheckpointSchema)
                })),
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as { id: number };
        const details = await AgentRunService.getRun(getDomainId(request), id);
        if (!details) {
            return reply.status(404).send(notFoundAgentRun(id));
        }

        return {
            data: {
                run: serializeAgentRun(details.run),
                steps: details.steps.map(serializeAgentRunStep),
                checkpoints: details.checkpoints.map(serializeAgentRunCheckpoint)
            },
            meta: buildMeta(
                'Control this run',
                [`POST /api/agent-runs/${id}/control`],
                'medium',
                1
            )
        };
    });

    server.post('/agent-runs/:id/control', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            body: Type.Object({
                action: Type.Union([
                    Type.Literal('approve'),
                    Type.Literal('pause'),
                    Type.Literal('resume'),
                    Type.Literal('cancel')
                ])
            }),
            response: {
                200: createAIResponse(AgentRunSchema),
                400: AIErrorResponse,
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as { id: number };
        const payload = request.body as { action: string };

        if (!isAgentRunControlAction(payload.action)) {
            return reply.status(400).send(toErrorPayload(
                'Invalid control action',
                'AGENT_RUN_INVALID_ACTION',
                'Use one of: approve, pause, resume, cancel.'
            ));
        }

        try {
            const run = await AgentRunService.controlRun(getDomainId(request), id, payload.action);
            return {
                data: serializeAgentRun(run),
                meta: buildMeta(
                    'Control action applied',
                    [`GET /api/agent-runs/${id}`],
                    'low',
                    1
                )
            };
        } catch (error) {
            if (error instanceof AgentRunServiceError) {
                if (error.code === 'AGENT_RUN_NOT_FOUND') {
                    return reply.status(404).send(notFoundAgentRun(id));
                }

                if (error.code === 'AGENT_RUN_INVALID_TRANSITION') {
                    return reply.status(400).send(toErrorPayload(
                        'Invalid run transition',
                        error.code,
                        error.message
                    ));
                }
            }

            throw error;
        }
    });

    // --- Workflows & Review Tasks ---

    server.post('/workflows', {
        schema: {
            body: Type.Object({
                name: Type.String(),
                contentTypeId: Type.Number(),
                active: Type.Optional(Type.Boolean())
            }),
            response: {
                201: createAIResponse(Type.Object({
                    id: Type.Number(),
                    name: Type.String(),
                    contentTypeId: Type.Number(),
                    active: Type.Boolean()
                })),
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const payload = request.body as any;
        let workflow;
        try {
            workflow = await WorkflowService.createWorkflow(
                getDomainId(request),
                payload.name,
                payload.contentTypeId,
                payload.active !== undefined ? payload.active : true
            );
        } catch (error) {
            if (error instanceof Error && error.message === 'CONTENT_TYPE_NOT_FOUND') {
                return reply.status(404).send(notFoundContentType(payload.contentTypeId));
            }
            throw error;
        }

        return reply.status(201).send({
            data: workflow,
            meta: buildMeta('Add transitions to this workflow', [`POST /api/workflows/${workflow.id}/transitions`], 'high', 1)
        });
    });

    server.post('/workflows/:id/transitions', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            body: Type.Object({
                fromState: Type.String(),
                toState: Type.String(),
                requiredRoles: Type.Array(Type.String())
            }),
            response: {
                201: createAIResponse(Type.Object({
                    id: Type.Number(),
                    workflowId: Type.Number(),
                    fromState: Type.String(),
                    toState: Type.String()
                })),
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as { id: number };
        const payload = request.body as any;
        let transition;
        try {
            transition = await WorkflowService.createWorkflowTransition(
                getDomainId(request),
                id,
                payload.fromState,
                payload.toState,
                payload.requiredRoles
            );
        } catch (error) {
            if (error instanceof Error && error.message === 'WORKFLOW_NOT_FOUND') {
                return reply.status(404).send(toErrorPayload(
                    'Workflow not found',
                    'WORKFLOW_NOT_FOUND',
                    'Provide an existing workflow ID in the current domain.'
                ));
            }
            throw error;
        }

        return reply.status(201).send({
            data: transition,
            meta: buildMeta('Workflow transition mapped', [], 'low', 1)
        });
    });

    server.get('/content-types/:id/workflows/active', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                200: createAIResponse(Type.Object({
                    id: Type.Number(),
                    name: Type.String(),
                    contentTypeId: Type.Number(),
                    active: Type.Boolean(),
                    transitions: Type.Array(Type.Object({
                        id: Type.Number(),
                        workflowId: Type.Number(),
                        fromState: Type.String(),
                        toState: Type.String(),
                        requiredRoles: Type.Array(Type.String())
                    }))
                })),
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as { id: number };
        const data = await WorkflowService.getActiveWorkflowWithTransitions(getDomainId(request), id);
        if (!data) return reply.status(404).send(toErrorPayload('No active workflow', 'WORKFLOW_NOT_FOUND', 'No active workflow found for this content type.'));
        return {
            data,
            meta: buildMeta('Fetched active workflow', [], 'low', 1)
        };
    });

    server.post('/content-items/:id/submit', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            body: Type.Object({
                workflowTransitionId: Type.Number(),
                assignee: Type.Optional(Type.String())
            }),
            response: {
                201: createAIResponse(Type.Object({
                    id: Type.Number(),
                    status: Type.String()
                }))
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as { id: number };
        const payload = request.body as any;
        const authPrincipal = (request as any).authPrincipal;

        const task = await WorkflowService.submitForReview({
            domainId: getDomainId(request),
            contentItemId: id,
            workflowTransitionId: payload.workflowTransitionId,
            assignee: payload.assignee,
            authPrincipal
        });

        return reply.status(201).send({
            data: task,
            meta: buildMeta('Item submitted for review', [`POST /api/review-tasks/${task.id}/decide`], 'high', 1)
        });
    });

    server.get('/review-tasks', {
        schema: {
            response: {
                200: createAIResponse(Type.Array(Type.Object({
                    task: Type.Any(),
                    transition: Type.Any(),
                    workflow: Type.Any(),
                    contentItem: Type.Any(),
                    contentType: Type.Any()
                })))
            }
        }
    }, async (request) => {
        const tasks = await WorkflowService.listPendingReviewTasks(getDomainId(request));
        return {
            data: tasks,
            meta: buildMeta('List pending review tasks', [], 'low', 1)
        };
    });

    server.post('/review-tasks/:id/decide', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            body: Type.Object({
                decision: Type.Union([Type.Literal('approved'), Type.Literal('rejected')])
            }),
            response: {
                200: createAIResponse(Type.Object({
                    id: Type.Number(),
                    status: Type.String()
                }))
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as { id: number };
        const payload = request.body as any;
        const authPrincipal = (request as any).authPrincipal;

        const task = await WorkflowService.decideReviewTask(
            getDomainId(request),
            id,
            payload.decision,
            authPrincipal
        );

        return reply.status(200).send({
            data: task,
            meta: buildMeta(`Task ${payload.decision}`, [], 'low', 1)
        });
    });

    server.get('/content-items/:id/comments', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                200: createAIResponse(Type.Array(Type.Object({
                    id: Type.Number(),
                    authorId: Type.String(),
                    comment: Type.String(),
                    createdAt: Type.String() // Typescript requires native String for output serialization
                })))
            }
        }
    }, async (request) => {
        const { id } = request.params as { id: number };
        const comments = await WorkflowService.listComments(getDomainId(request), id);
        return {
            data: comments,
            meta: buildMeta('Add a new comment to thread', [`POST /api/content-items/${id}/comments`], 'medium', 1)
        };
    });

    server.post('/content-items/:id/comments', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            body: Type.Object({
                comment: Type.String()
            }),
            response: {
                201: createAIResponse(Type.Object({
                    id: Type.Number(),
                    authorId: Type.String(),
                    comment: Type.String()
                }))
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as { id: number };
        const payload = request.body as any;
        const authPrincipal = (request as any).authPrincipal;
        const authorId = authPrincipal?.keyId?.toString() || 'supervisor';

        const comment = await WorkflowService.addComment(getDomainId(request), id, authorId, payload.comment);

        return reply.status(201).send({
            data: comment,
            meta: buildMeta('Comment posted successfully', [], 'low', 1)
        });
    });

    server.get('/agents/me/earnings', {
        schema: {
            response: {
                200: createAIResponse(Type.Object({
                    pending: Type.Number(),
                    cleared: Type.Number(),
                    disputed: Type.Number()
                })),
                401: AIErrorResponse,
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const authPrincipal = (request as any).authPrincipal;
        const pKeyId = authPrincipal?.keyId;

        if (typeof pKeyId !== 'number') {
            return reply.status(401).send(toErrorPayload('API Key required', 'API_KEY_REQUIRED', 'Only autonomous agents (via API key) can view earnings.'));
        }

        const domainId = getDomainId(request);
        const [profile] = await db.select().from(agentProfiles).where(and(eq(agentProfiles.apiKeyId, pKeyId), eq(agentProfiles.domainId, domainId)));

        if (!profile) {
            return reply.status(404).send(toErrorPayload('Profile not found', 'PROFILE_NOT_FOUND', 'Agent profile does not exist.'));
        }

        const latestEvents = await db.execute(sql`
            WITH LatestStatus AS (
                SELECT DISTINCT ON (allocation_id) allocation_id, status 
                FROM allocation_status_events 
                ORDER BY allocation_id, created_at DESC
            )
            SELECT ls.status, SUM(ra.amount_sats) as total
            FROM revenue_allocations ra
            JOIN LatestStatus ls ON ls.allocation_id = ra.id
            WHERE ra.agent_profile_id = ${profile.id}
            GROUP BY ls.status
        `);

        const rows: any[] = (latestEvents as any).rows || latestEvents;
        const earnings = {
            pending: 0,
            cleared: 0,
            disputed: 0
        };

        for (const row of rows) {
            const status = row.status as keyof typeof earnings;
            const total = parseInt(row.total || '0', 10);
            if (status in earnings) {
                earnings[status] = total;
            }
        }

        return reply.status(200).send({
            data: earnings,
            meta: buildMeta('View your agent earnings', [], 'low', 1)
        });
    });
}
