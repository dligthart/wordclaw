import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, lt, sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import { auditLogs, contentItemVersions, contentItems, contentTypes, domains, paymentProviderEvents, payments, workflows, workflowTransitions, agentProfiles, offers, entitlements } from '../db/schema.js';
import { logAudit } from '../services/audit.js';
import {
    isExperimentalAgentRunsEnabled,
    isExperimentalDelegationEnabled,
    isExperimentalRevenueEnabled
} from '../config/runtime-features.js';
import { validateContentDataAgainstSchema, validateContentTypeSchema, ValidationFailure, redactPremiumFields } from '../services/content-schema.js';
import { AIErrorResponse, DryRunQuery, createAIResponse } from './types.js';
import { authenticateApiRequest, authorizeApiRequest, getDomainId } from './auth.js';
import { createApiKey, listApiKeys, normalizeScopes, revokeApiKey, rotateApiKey } from '../services/api-key.js';
import { createWebhook, deleteWebhook, getWebhookById, listWebhooks, normalizeWebhookEvents, parseWebhookEvents, updateWebhook, isSafeWebhookUrl } from '../services/webhook.js';
import { PolicyEngine } from '../services/policy.js';
import { buildOperationContext, resolveRestOperation, resolveRestResource } from '../services/policy-adapters.js';
import { createL402Challenge, l402Middleware } from '../middleware/l402.js';
import { globalL402Options } from '../services/l402-config.js';
import { WorkflowService } from '../services/workflow.js';
import { EmbeddingService, EmbeddingServiceError } from '../services/embedding.js';
import { LicensingService, type OfferReadScope } from '../services/licensing.js';
import { transitionPaymentStatus } from '../services/payment-ledger.js';
import { paymentFlowMetrics } from '../services/payment-metrics.js';
import { parsePaymentWebhookEvent, verifyPaymentWebhookSignature } from '../services/payment-webhook.js';
import { AgentRunService, AgentRunServiceError, isAgentRunControlAction, isAgentRunStatus } from '../services/agent-runs.js';
import { AgentRunMetricsService } from '../services/agent-run-metrics.js';
import { parseSupervisorDomainHeader } from './domain-context.js';
import { agentRunWorker } from '../workers/agent-run.worker.js';
import { ContentItemListError, listContentItems } from '../services/content-item.service.js';
import {
    AssetListError,
    type AssetEntitlementScope,
    createAsset,
    getAsset,
    getAssetEntitlementScope,
    getPublicAsset,
    listAssets,
    purgeAsset,
    readAssetContent,
    restoreAsset,
    softDeleteAsset
} from '../services/assets.js';
import {
    buildCurrentActorSnapshot,
    buildSupervisorPrincipal,
    resolveApiKeyId,
    toAuditActor,
    type ActorPrincipal,
    type AuditActor,
    type PrincipalLike,
} from '../services/actor-identity.js';
import { buildCapabilityManifest } from '../services/capability-manifest.js';
import { getDeploymentStatusSnapshot } from '../services/deployment-status.js';
import { getWorkspaceContextSnapshot, resolveWorkspaceTarget } from '../services/workspace-context.js';

type DryRunQueryType = { mode?: 'dry_run' };
type IdParams = { id: number };
type ContentTypeUpdate = Partial<typeof contentTypes.$inferInsert>;
type ContentItemUpdate = Partial<typeof contentItems.$inferInsert>;
type ContentItemsQuery = {
    contentTypeId?: number;
    status?: string;
    q?: string;
    createdAfter?: string;
    createdBefore?: string;
    sortBy?: 'updatedAt' | 'createdAt' | 'version';
    sortDir?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
    cursor?: string;
};
type AssetsQuery = {
    q?: string;
    accessMode?: 'public' | 'signed' | 'entitled';
    status?: 'active' | 'deleted';
    limit?: number;
    offset?: number;
    cursor?: string;
};
type CreateAssetBody = {
    filename: string;
    originalFilename?: string;
    mimeType: string;
    contentBase64: string;
    accessMode?: 'public' | 'signed' | 'entitled';
    entitlementScope?: {
        type: 'item' | 'type' | 'subscription';
        ref?: number;
    };
    metadata?: Record<string, unknown>;
};
type PaginationQuery = {
    limit?: number;
    offset?: number;
};
type ContentTypesQuery = PaginationQuery & {
    includeStats?: boolean;
};
type AgentRunsQuery = {
    status?: string;
    runType?: string;
    definitionId?: number;
    limit?: number;
    offset?: number;
};
type AgentRunMetricsQuery = {
    windowHours?: number;
    runType?: string;
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
    actorId?: string;
    actorType?: string;
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

function toAssetErrorPayload(error: AssetListError): AIErrorPayload {
    return {
        error: error.message,
        code: error.code,
        remediation: error.remediation,
        ...(error.context ? { context: error.context } : {})
    };
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

function toOfferReadScope(entitlementScope: AssetEntitlementScope | null): OfferReadScope | null {
    if (!entitlementScope) {
        return null;
    }

    if (entitlementScope.type === 'subscription') {
        return {
            scopeType: 'subscription',
            scopeRef: null
        };
    }

    if (typeof entitlementScope.ref !== 'number') {
        return null;
    }

    return {
        scopeType: entitlementScope.type,
        scopeRef: entitlementScope.ref
    };
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

function notFoundAsset(id: number): AIErrorPayload {
    return toErrorPayload(
        'Asset not found',
        'ASSET_NOT_FOUND',
        `The asset with ID ${id} does not exist in the current domain or is not available. List assets with GET /api/assets to find valid IDs.`
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

function toIsoString(value: Date | string | null | undefined): string | null {
    if (!value) {
        return null;
    }
    if (typeof value === 'string') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
    }
    return value.toISOString();
}

type ContentTypeStatsSummary = {
    itemCount: number;
    lastItemUpdatedAt: string | null;
    statusCounts: Record<string, number>;
};

type ContentTypeStatsRow = {
    contentTypeId: number;
    status: string;
    itemCount: number;
    lastItemUpdatedAt: Date | string | null;
};

function withContentTypeStats(
    types: Array<typeof contentTypes.$inferSelect>,
    rows: ContentTypeStatsRow[]
): Array<typeof contentTypes.$inferSelect & { stats: ContentTypeStatsSummary }> {
    const statsByType = new Map<number, ContentTypeStatsSummary>();

    for (const row of rows) {
        const existing = statsByType.get(row.contentTypeId) ?? {
            itemCount: 0,
            lastItemUpdatedAt: null,
            statusCounts: {}
        };
        const lastItemUpdatedAt = toIsoString(row.lastItemUpdatedAt);

        existing.itemCount += row.itemCount;
        existing.statusCounts[row.status] = (existing.statusCounts[row.status] ?? 0) + row.itemCount;
        if (lastItemUpdatedAt && (!existing.lastItemUpdatedAt || lastItemUpdatedAt > existing.lastItemUpdatedAt)) {
            existing.lastItemUpdatedAt = lastItemUpdatedAt;
        }

        statsByType.set(row.contentTypeId, existing);
    }

    return types.map((type) => ({
        ...type,
        stats: statsByType.get(type.id) ?? {
            itemCount: 0,
            lastItemUpdatedAt: null,
            statusCounts: {}
        }
    }));
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

type RequestActorCarrier = { authPrincipal?: PrincipalLike };

function toAuditActorFromRequest(request: RequestActorCarrier): AuditActor | undefined {
    return toAuditActor(request.authPrincipal);
}

function toLegacyActorUserId(request: RequestActorCarrier): number | undefined {
    return resolveApiKeyId(request.authPrincipal);
}

function toApiKeyIdFromRequest(request: RequestActorCarrier): number | undefined {
    return resolveApiKeyId(request.authPrincipal);
}

function hasAdminScope(request: RequestActorCarrier): boolean {
    const scopes = (request.authPrincipal as { scopes?: Set<string> } | undefined)?.scopes;
    return Boolean(scopes?.has('admin') || scopes?.has('tenant:admin'));
}

function buildCurrentActorResponse(principal: ActorPrincipal) {
    const manifest = buildCapabilityManifest();
    const snapshot = buildCurrentActorSnapshot(principal);
    const profile = manifest.agentGuidance.actorProfiles.find(
        (candidate) => candidate.id === snapshot.actorProfileId,
    );

    return {
        ...snapshot,
        profile: profile ?? null,
    };
}

const AssetResponseSchema = Type.Object({
    id: Type.Number(),
    filename: Type.String(),
    originalFilename: Type.String(),
    mimeType: Type.String(),
    sizeBytes: Type.Number(),
    byteHash: Type.Union([Type.String(), Type.Null()]),
    storageProvider: Type.String(),
    accessMode: Type.String(),
    entitlementScope: Type.Union([
        Type.Object({
            type: Type.Union([
                Type.Literal('item'),
                Type.Literal('type'),
                Type.Literal('subscription')
            ]),
            ref: Type.Union([Type.Number(), Type.Null()])
        }),
        Type.Null()
    ]),
    status: Type.String(),
    metadata: Type.Object({}, { additionalProperties: true }),
    uploaderActorId: Type.Union([Type.String(), Type.Null()]),
    uploaderActorType: Type.Union([Type.String(), Type.Null()]),
    uploaderActorSource: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    deletedAt: Type.Union([Type.String(), Type.Null()]),
    delivery: Type.Object({
        contentPath: Type.String(),
        requiresAuth: Type.Boolean(),
        requiresEntitlement: Type.Boolean(),
        offersPath: Type.Union([Type.String(), Type.Null()])
    })
});

const OfferResponseSchema = Type.Object({
    id: Type.Number(),
    domainId: Type.Number(),
    slug: Type.String(),
    name: Type.String(),
    scopeType: Type.String(),
    scopeRef: Type.Union([Type.Number(), Type.Null()]),
    priceSats: Type.Number(),
    active: Type.Boolean()
});

const AssetRestoreResponseSchema = AssetResponseSchema;

const AssetPurgeResponseSchema = Type.Object({
    purged: Type.Boolean(),
    asset: AssetResponseSchema,
    referenceSummary: Type.Object({
        activeReferenceCount: Type.Number(),
        historicalReferenceCount: Type.Number()
    })
});

function serializeAsset(asset: {
    id: number;
    filename: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    byteHash: string | null;
    storageProvider: string;
    accessMode: string;
    entitlementScopeType: string | null;
    entitlementScopeRef: number | null;
    status: string;
    metadata: unknown;
    uploaderActorId: string | null;
    uploaderActorType: string | null;
    uploaderActorSource: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
}) {
    return {
        id: asset.id,
        filename: asset.filename,
        originalFilename: asset.originalFilename,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        byteHash: asset.byteHash ?? null,
        storageProvider: asset.storageProvider,
        accessMode: asset.accessMode,
        entitlementScope: getAssetEntitlementScope(asset),
        status: asset.status,
        metadata: asset.metadata && typeof asset.metadata === 'object' ? asset.metadata as Record<string, unknown> : {},
        uploaderActorId: asset.uploaderActorId ?? null,
        uploaderActorType: asset.uploaderActorType ?? null,
        uploaderActorSource: asset.uploaderActorSource ?? null,
        createdAt: asset.createdAt.toISOString(),
        updatedAt: asset.updatedAt.toISOString(),
        deletedAt: asset.deletedAt ? asset.deletedAt.toISOString() : null,
        delivery: {
            contentPath: `/api/assets/${asset.id}/content`,
            requiresAuth: asset.accessMode !== 'public',
            requiresEntitlement: asset.accessMode === 'entitled',
            offersPath: asset.accessMode === 'entitled' ? `/api/assets/${asset.id}/offers` : null
        }
    };
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
        let principal: ActorPrincipal | null = null;
        try {
            await request.jwtVerify({ onlyCookie: true });
            const user = request.user as { sub: number, role: string };
            if (user && user.role === 'supervisor') {
                const domainContext = parseSupervisorDomainHeader(request.headers);
                if (!domainContext.ok) {
                    return reply.status(domainContext.statusCode).send(domainContext.payload);
                }
                principal = buildSupervisorPrincipal(user.sub, domainContext.domainId);
            }
        } catch {
            // Ignore JWT errors, fallback to normal api key auth
        }

        const path = request.url.split('?')[0];

        // Provider webhooks authenticate via signed payload, not API key/cookie principal.
        if (path.startsWith('/api/payments/webhooks/')) {
            return undefined;
        }

        if (path === '/api/capabilities' || path === '/api/deployment-status') {
            return undefined;
        }

        if (/^\/api\/assets\/\d+\/content$/.test(path)) {
            return undefined;
        }

        if (!principal) {
            const auth = await authenticateApiRequest(request.headers);
            if (!auth.ok) {
                return reply.status(auth.statusCode).send(auth.payload);
            }
            principal = auth.principal;
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

    server.get('/capabilities', {
        schema: {
            response: {
                200: createAIResponse(Type.Object({
                    generatedAt: Type.String(),
                    product: Type.Object({
                        name: Type.String(),
                        positioning: Type.String()
                    }),
                    discovery: Type.Object({
                        restManifestPath: Type.String(),
                        restStatusPath: Type.String(),
                        restIdentityPath: Type.String(),
                        restWorkspacePath: Type.String(),
                        restWorkspaceTargetPath: Type.String(),
                        mcpResourceUri: Type.String(),
                        mcpStatusResourceUri: Type.String(),
                        mcpActorResourceUri: Type.String(),
                        mcpWorkspaceResourceUri: Type.String(),
                        mcpWorkspaceTargetToolName: Type.String(),
                        mcpReactiveToolName: Type.String(),
                        mcpReactiveNotificationMethod: Type.String(),
                        cliCommand: Type.String(),
                        cliStatusCommand: Type.String(),
                        cliWhoAmICommand: Type.String(),
                        cliWorkspaceCommand: Type.String(),
                        cliWorkspaceResolveCommand: Type.String()
                    }),
                    protocolSurfaces: Type.Object({
                        rest: Type.Object({
                            role: Type.String(),
                            basePath: Type.String()
                        }),
                        mcp: Type.Object({
                            role: Type.String(),
                            transports: Type.Array(Type.String()),
                            endpoint: Type.String(),
                            attachable: Type.Boolean(),
                            reactive: Type.Object({
                                supported: Type.Boolean(),
                                transport: Type.String(),
                                sessionHeader: Type.String(),
                                standaloneSsePath: Type.String(),
                                subscriptionTool: Type.String(),
                                notificationMethod: Type.String(),
                                supportedTopics: Type.Array(Type.String()),
                                subscriptionRecipes: Type.Array(Type.Object({
                                    id: Type.String(),
                                    title: Type.String(),
                                    description: Type.String(),
                                    topics: Type.Array(Type.String()),
                                    requiredScopes: Type.Array(Type.String()),
                                })),
                                supportedFilterFields: Type.Array(Type.String()),
                            })
                        }),
                        graphql: Type.Object({
                            role: Type.String()
                        })
                    }),
                    auth: Type.Object({
                        rest: Type.Object({
                            apiKeyHeader: Type.String(),
                            bearerHeader: Type.String(),
                            supervisorCookie: Type.String()
                        }),
                        mcp: Type.Object({
                            endpoint: Type.String(),
                            apiKeyHeader: Type.String(),
                            bearerHeader: Type.String(),
                            supervisorCookie: Type.String(),
                            supervisorHeader: Type.String()
                        }),
                        domainContext: Type.Object({
                            supervisorHeader: Type.String(),
                            apiKeysAreDomainScoped: Type.Boolean(),
                            mcpDomainEnv: Type.String()
                        })
                    }),
                    modules: Type.Array(Type.Object({
                        id: Type.String(),
                        tier: Type.String(),
                        enabled: Type.Boolean(),
                        description: Type.String()
                    })),
                    paidContent: Type.Object({
                        l402Enabled: Type.Boolean(),
                        purchaseFlowSurface: Type.String(),
                        entitlementReadSurface: Type.String(),
                        note: Type.String()
                    }),
                    agentGuidance: Type.Object({
                        routingHints: Type.Array(Type.Object({
                            intent: Type.String(),
                            preferredSurface: Type.String(),
                            preferredActorProfile: Type.String(),
                            fallbackSurface: Type.Union([Type.String(), Type.Null()]),
                            rationale: Type.String()
                        })),
                        actorProfiles: Type.Array(Type.Object({
                            id: Type.String(),
                            label: Type.String(),
                            actorType: Type.String(),
                            authMode: Type.String(),
                            availableSurfaces: Type.Array(Type.String()),
                            actorIdExamples: Type.Array(Type.String()),
                            recommendedFor: Type.Array(Type.String()),
                            developmentOnly: Type.Optional(Type.Boolean()),
                            domainContext: Type.Object({
                                required: Type.Boolean(),
                                strategy: Type.String(),
                                header: Type.Optional(Type.String()),
                                environmentVariable: Type.Optional(Type.String()),
                                note: Type.String()
                            }),
                            notes: Type.Array(Type.String())
                        })),
                        taskRecipes: Type.Array(Type.Object({
                            id: Type.String(),
                            goal: Type.String(),
                            preferredSurface: Type.String(),
                            fallbackSurface: Type.Union([Type.String(), Type.Null()]),
                            recommendedAuth: Type.String(),
                            preferredActorProfile: Type.String(),
                            supportedActorProfiles: Type.Array(Type.String()),
                            recommendedApiKeyScopes: Type.Array(Type.String()),
                            requiredModules: Type.Array(Type.String()),
                            dryRunRecommended: Type.Boolean(),
                            steps: Type.Array(Type.Object({
                                title: Type.String(),
                                surface: Type.String(),
                                operation: Type.String(),
                                purpose: Type.String(),
                                optional: Type.Optional(Type.Boolean())
                            })),
                            reactiveFollowUp: Type.Optional(Type.Object({
                                purpose: Type.String(),
                                recipeId: Type.Union([Type.String(), Type.Null()]),
                                topics: Type.Array(Type.String()),
                                recommendedFilters: Type.Array(Type.String()),
                                example: Type.Object({
                                    tool: Type.String(),
                                    arguments: Type.Object({
                                        recipeId: Type.Optional(Type.String()),
                                        topics: Type.Optional(Type.Array(Type.String())),
                                        filters: Type.Optional(Type.Record(Type.String(), Type.String())),
                                    }),
                                }),
                                note: Type.String(),
                            })),
                        }))
                    }),
                    capabilities: Type.Array(Type.Object({
                        id: Type.String(),
                        description: Type.String(),
                        rest: Type.Object({
                            method: Type.String(),
                            path: Type.String()
                        }),
                        mcp: Type.Object({
                            tool: Type.String()
                        }),
                        graphql: Type.Union([
                            Type.Object({
                                operation: Type.String(),
                                field: Type.String()
                            }),
                            Type.Null()
                        ]),
                        dryRun: Type.Boolean()
                    })),
                    protocolContract: Type.Object({
                        required: Type.Array(Type.String()),
                        compatibility: Type.Array(Type.String())
                    }),
                    limitations: Type.Array(Type.String())
                }))
            }
        }
    }, async () => {
        return {
            data: buildCapabilityManifest(),
            meta: buildMeta(
                'Use the deployment manifest to choose protocol, auth path, and enabled module surface before acting.',
                ['GET /api/capabilities'],
                'low',
                1
            )
        };
    });

    server.get('/deployment-status', {
        schema: {
            response: {
                200: createAIResponse(Type.Object({
                    generatedAt: Type.String(),
                    overallStatus: Type.String(),
                    checks: Type.Object({
                        database: Type.Object({
                            status: Type.String(),
                            note: Type.String(),
                        }),
                        restApi: Type.Object({
                            status: Type.String(),
                            basePath: Type.String(),
                            note: Type.String(),
                        }),
                        mcp: Type.Object({
                            status: Type.String(),
                            endpoint: Type.String(),
                            transports: Type.Array(Type.String()),
                            attachable: Type.Boolean(),
                            reactive: Type.Object({
                                supported: Type.Boolean(),
                                transport: Type.String(),
                                subscriptionTool: Type.String(),
                                notificationMethod: Type.String(),
                                supportedTopicCount: Type.Number(),
                                supportedRecipeCount: Type.Number(),
                                supportedFilterFields: Type.Array(Type.String()),
                            }),
                            note: Type.String(),
                        }),
                        agentRuns: Type.Object({
                            status: Type.String(),
                            enabled: Type.Boolean(),
                            workerStarted: Type.Boolean(),
                            sweepInProgress: Type.Boolean(),
                            lastSweepCompletedAt: Type.Union([Type.String(), Type.Null()]),
                            lastErrorMessage: Type.Union([Type.String(), Type.Null()]),
                            note: Type.String(),
                        }),
                    }),
                    warnings: Type.Array(Type.String()),
                })),
                503: createAIResponse(Type.Object({
                    generatedAt: Type.String(),
                    overallStatus: Type.String(),
                    checks: Type.Object({
                        database: Type.Object({
                            status: Type.String(),
                            note: Type.String(),
                        }),
                        restApi: Type.Object({
                            status: Type.String(),
                            basePath: Type.String(),
                            note: Type.String(),
                        }),
                        mcp: Type.Object({
                            status: Type.String(),
                            endpoint: Type.String(),
                            transports: Type.Array(Type.String()),
                            attachable: Type.Boolean(),
                            reactive: Type.Object({
                                supported: Type.Boolean(),
                                transport: Type.String(),
                                subscriptionTool: Type.String(),
                                notificationMethod: Type.String(),
                                supportedTopicCount: Type.Number(),
                                supportedRecipeCount: Type.Number(),
                                supportedFilterFields: Type.Array(Type.String()),
                            }),
                            note: Type.String(),
                        }),
                        agentRuns: Type.Object({
                            status: Type.String(),
                            enabled: Type.Boolean(),
                            workerStarted: Type.Boolean(),
                            sweepInProgress: Type.Boolean(),
                            lastSweepCompletedAt: Type.Union([Type.String(), Type.Null()]),
                            lastErrorMessage: Type.Union([Type.String(), Type.Null()]),
                            note: Type.String(),
                        }),
                    }),
                    warnings: Type.Array(Type.String()),
                })),
            }
        }
    }, async (_request, reply) => {
        const status = await getDeploymentStatusSnapshot();
        const payload = {
            data: status,
            meta: buildMeta(
                'Use the live deployment status to confirm the instance is healthy enough for agent actions.',
                ['GET /api/deployment-status'],
                'low',
                1,
            )
        };

        if (status.overallStatus === 'degraded') {
            return reply.status(503).send(payload);
        }

        return payload;
    });

    server.get('/identity', {
        schema: {
            response: {
                200: createAIResponse(Type.Object({
                    actorId: Type.String(),
                    actorType: Type.String(),
                    actorSource: Type.String(),
                    actorProfileId: Type.String(),
                    domainId: Type.Number(),
                    scopes: Type.Array(Type.String()),
                    assignmentRefs: Type.Array(Type.String()),
                    profile: Type.Union([
                        Type.Object({
                            id: Type.String(),
                            label: Type.String(),
                            actorType: Type.String(),
                            authMode: Type.String(),
                            availableSurfaces: Type.Array(Type.String()),
                            actorIdExamples: Type.Array(Type.String()),
                            recommendedFor: Type.Array(Type.String()),
                            developmentOnly: Type.Optional(Type.Boolean()),
                            domainContext: Type.Object({
                                required: Type.Boolean(),
                                strategy: Type.String(),
                                header: Type.Optional(Type.String()),
                                environmentVariable: Type.Optional(Type.String()),
                                note: Type.String()
                            }),
                            notes: Type.Array(Type.String())
                        }),
                        Type.Null(),
                    ]),
                })),
                401: AIErrorResponse,
                403: AIErrorResponse,
            }
        }
    }, async (request) => {
        const principal = (request as { authPrincipal?: ActorPrincipal }).authPrincipal;
        if (!principal) {
            throw new Error('AUTH_PRINCIPAL_UNAVAILABLE');
        }

        return {
            data: buildCurrentActorResponse(principal),
            meta: buildMeta(
                'Use this actor snapshot to confirm the active credential, domain, and scope set before mutating runtime state.',
                ['GET /api/capabilities'],
                'low',
                1,
            )
        };
    });

    server.get('/workspace-context', {
        schema: {
            querystring: Type.Object({
                intent: Type.Optional(Type.Union([
                    Type.Literal('all'),
                    Type.Literal('authoring'),
                    Type.Literal('review'),
                    Type.Literal('workflow'),
                    Type.Literal('paid'),
                ])),
                search: Type.Optional(Type.String()),
                limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
            }),
            response: {
                200: createAIResponse(Type.Object({
                    generatedAt: Type.String(),
                    currentActor: Type.Object({
                        actorId: Type.String(),
                        actorType: Type.String(),
                        actorSource: Type.String(),
                        actorProfileId: Type.String(),
                        domainId: Type.Number(),
                        scopes: Type.Array(Type.String()),
                        assignmentRefs: Type.Array(Type.String()),
                    }),
                    currentDomain: Type.Object({
                        id: Type.Number(),
                        name: Type.String(),
                        hostname: Type.String(),
                        current: Type.Boolean(),
                    }),
                    accessibleDomains: Type.Array(Type.Object({
                        id: Type.Number(),
                        name: Type.String(),
                        hostname: Type.String(),
                        current: Type.Boolean(),
                    })),
                    filter: Type.Object({
                        intent: Type.String(),
                        search: Type.Union([Type.String(), Type.Null()]),
                        limit: Type.Union([Type.Number(), Type.Null()]),
                        totalContentTypesBeforeFilter: Type.Number(),
                        totalContentTypesAfterSearch: Type.Number(),
                        returnedContentTypes: Type.Number(),
                    }),
                    summary: Type.Object({
                        totalContentTypes: Type.Number(),
                        contentTypesWithContent: Type.Number(),
                        workflowEnabledContentTypes: Type.Number(),
                        paidContentTypes: Type.Number(),
                        pendingReviewTaskCount: Type.Number(),
                    }),
                    targets: Type.Object({
                        authoring: Type.Array(Type.Object({
                            id: Type.Number(),
                            name: Type.String(),
                            slug: Type.String(),
                            itemCount: Type.Number(),
                            pendingReviewTaskCount: Type.Number(),
                            activeWorkflowCount: Type.Number(),
                            activeTypeOfferCount: Type.Number(),
                            reason: Type.String(),
                            recommendedCommands: Type.Object({
                                contentGuide: Type.String(),
                                listContent: Type.String(),
                                workflowActive: Type.String(),
                            }),
                        })),
                        review: Type.Array(Type.Object({
                            id: Type.Number(),
                            name: Type.String(),
                            slug: Type.String(),
                            itemCount: Type.Number(),
                            pendingReviewTaskCount: Type.Number(),
                            activeWorkflowCount: Type.Number(),
                            activeTypeOfferCount: Type.Number(),
                            reason: Type.String(),
                            recommendedCommands: Type.Object({
                                contentGuide: Type.String(),
                                listContent: Type.String(),
                                workflowActive: Type.String(),
                            }),
                        })),
                        workflow: Type.Array(Type.Object({
                            id: Type.Number(),
                            name: Type.String(),
                            slug: Type.String(),
                            itemCount: Type.Number(),
                            pendingReviewTaskCount: Type.Number(),
                            activeWorkflowCount: Type.Number(),
                            activeTypeOfferCount: Type.Number(),
                            reason: Type.String(),
                            recommendedCommands: Type.Object({
                                contentGuide: Type.String(),
                                listContent: Type.String(),
                                workflowActive: Type.String(),
                            }),
                        })),
                        paid: Type.Array(Type.Object({
                            id: Type.Number(),
                            name: Type.String(),
                            slug: Type.String(),
                            itemCount: Type.Number(),
                            pendingReviewTaskCount: Type.Number(),
                            activeWorkflowCount: Type.Number(),
                            activeTypeOfferCount: Type.Number(),
                            reason: Type.String(),
                            recommendedCommands: Type.Object({
                                contentGuide: Type.String(),
                                listContent: Type.String(),
                                workflowActive: Type.String(),
                            }),
                        })),
                    }),
                    contentTypes: Type.Array(Type.Object({
                        id: Type.Number(),
                        name: Type.String(),
                        slug: Type.String(),
                        description: Type.Union([Type.String(), Type.Null()]),
                        fieldCount: Type.Number(),
                        requiredFieldCount: Type.Number(),
                        itemCount: Type.Number(),
                        hasContent: Type.Boolean(),
                        pendingReviewTaskCount: Type.Number(),
                        lastItemUpdatedAt: Type.Union([Type.String(), Type.Null()]),
                        paid: Type.Object({
                            basePrice: Type.Union([Type.Number(), Type.Null()]),
                            activeTypeOfferCount: Type.Number(),
                            lowestTypeOfferSats: Type.Union([Type.Number(), Type.Null()]),
                        }),
                        workflow: Type.Object({
                            activeWorkflowCount: Type.Number(),
                            activeWorkflows: Type.Array(Type.Object({
                                id: Type.Number(),
                                name: Type.String(),
                                transitionCount: Type.Number(),
                            })),
                        }),
                        recommendedCommands: Type.Object({
                            contentGuide: Type.String(),
                            listContent: Type.String(),
                            workflowActive: Type.String(),
                        }),
                    })),
                    warnings: Type.Array(Type.String()),
                })),
                401: AIErrorResponse,
                403: AIErrorResponse,
            }
        }
    }, async (request) => {
        const principal = (request as { authPrincipal?: ActorPrincipal }).authPrincipal;
        if (!principal) {
            throw new Error('AUTH_PRINCIPAL_UNAVAILABLE');
        }

        const query = request.query as {
            intent?: 'all' | 'authoring' | 'review' | 'workflow' | 'paid';
            search?: string;
            limit?: number;
        };
        const snapshot = await getWorkspaceContextSnapshot(buildCurrentActorSnapshot(principal), {
            intent: query.intent,
            search: query.search,
            limit: query.limit,
        });

        return {
            data: snapshot,
            meta: buildMeta(
                'Use the workspace context to choose a domain-aware content model before authoring, review, workflow, or paid-content actions.',
                [
                    'GET /api/identity',
                    'GET /api/content-types',
                ],
                'low',
                2,
            )
        };
    });

    const workspaceResolvedContentTypeSchema = Type.Object({
        id: Type.Number(),
        name: Type.String(),
        slug: Type.String(),
        description: Type.Union([Type.String(), Type.Null()]),
        fieldCount: Type.Number(),
        requiredFieldCount: Type.Number(),
        itemCount: Type.Number(),
        hasContent: Type.Boolean(),
        pendingReviewTaskCount: Type.Number(),
        lastItemUpdatedAt: Type.Union([Type.String(), Type.Null()]),
        paid: Type.Object({
            basePrice: Type.Union([Type.Number(), Type.Null()]),
            activeTypeOfferCount: Type.Number(),
            lowestTypeOfferSats: Type.Union([Type.Number(), Type.Null()]),
        }),
        workflow: Type.Object({
            activeWorkflowCount: Type.Number(),
            activeWorkflows: Type.Array(Type.Object({
                id: Type.Number(),
                name: Type.String(),
                transitionCount: Type.Number(),
            })),
        }),
        recommendedCommands: Type.Object({
            contentGuide: Type.String(),
            listContent: Type.String(),
            workflowActive: Type.String(),
        }),
    });

    const workspaceResolvedWorkTargetSchema = Type.Object({
        kind: Type.Union([
            Type.Literal('content-type'),
            Type.Literal('review-task'),
            Type.Literal('workflow'),
            Type.Literal('paid-content-item'),
        ]),
        status: Type.Union([
            Type.Literal('ready'),
            Type.Literal('warning'),
            Type.Literal('blocked'),
        ]),
        label: Type.String(),
        reason: Type.String(),
        notes: Type.Array(Type.String()),
        recommendedCommands: Type.Array(Type.String()),
        contentType: Type.Object({
            id: Type.Number(),
            name: Type.String(),
            slug: Type.String(),
        }),
        contentItem: Type.Union([
            Type.Object({
                id: Type.Number(),
                label: Type.String(),
                status: Type.String(),
                version: Type.Number(),
                slug: Type.Union([Type.String(), Type.Null()]),
                createdAt: Type.String(),
                updatedAt: Type.String(),
            }),
            Type.Null(),
        ]),
        reviewTask: Type.Union([
            Type.Object({
                id: Type.Number(),
                status: Type.String(),
                assignee: Type.Union([Type.String(), Type.Null()]),
                assigneeActorId: Type.Union([Type.String(), Type.Null()]),
                assigneeActorType: Type.Union([Type.String(), Type.Null()]),
                assigneeActorSource: Type.Union([Type.String(), Type.Null()]),
                workflowTransitionId: Type.Number(),
                actionable: Type.Boolean(),
                fromState: Type.String(),
                toState: Type.String(),
            }),
            Type.Null(),
        ]),
        workflow: Type.Union([
            Type.Object({
                id: Type.Number(),
                name: Type.String(),
                transitionCount: Type.Number(),
            }),
            Type.Null(),
        ]),
        paid: Type.Union([
            Type.Object({
                activeOfferCount: Type.Number(),
                lowestOfferSats: Type.Union([Type.Number(), Type.Null()]),
                offerScope: Type.Union([
                    Type.Literal('item'),
                    Type.Literal('type'),
                    Type.Literal('mixed'),
                    Type.Literal('none'),
                ]),
            }),
            Type.Null(),
        ]),
    });

    const workspaceResolvedTargetSchema = Type.Object({
        id: Type.Number(),
        name: Type.String(),
        slug: Type.String(),
        itemCount: Type.Number(),
        pendingReviewTaskCount: Type.Number(),
        activeWorkflowCount: Type.Number(),
        activeTypeOfferCount: Type.Number(),
        reason: Type.String(),
        rank: Type.Number(),
        recommendedCommands: Type.Object({
            contentGuide: Type.String(),
            listContent: Type.String(),
            workflowActive: Type.String(),
        }),
        contentType: Type.Union([workspaceResolvedContentTypeSchema, Type.Null()]),
        workTarget: Type.Union([workspaceResolvedWorkTargetSchema, Type.Null()]),
    });

    server.get('/workspace-target', {
        schema: {
            querystring: Type.Object({
                intent: Type.Union([
                    Type.Literal('authoring'),
                    Type.Literal('review'),
                    Type.Literal('workflow'),
                    Type.Literal('paid'),
                ]),
                search: Type.Optional(Type.String()),
            }),
            response: {
                200: createAIResponse(Type.Object({
                    generatedAt: Type.String(),
                    currentActor: Type.Object({
                        actorId: Type.String(),
                        actorType: Type.String(),
                        actorSource: Type.String(),
                        actorProfileId: Type.String(),
                        domainId: Type.Number(),
                        scopes: Type.Array(Type.String()),
                        assignmentRefs: Type.Array(Type.String()),
                    }),
                    currentDomain: Type.Object({
                        id: Type.Number(),
                        name: Type.String(),
                        hostname: Type.String(),
                        current: Type.Boolean(),
                    }),
                    intent: Type.String(),
                    search: Type.Union([Type.String(), Type.Null()]),
                    availableTargetCount: Type.Number(),
                    target: Type.Union([workspaceResolvedTargetSchema, Type.Null()]),
                    alternatives: Type.Array(workspaceResolvedTargetSchema),
                    warnings: Type.Array(Type.String()),
                })),
                401: AIErrorResponse,
                403: AIErrorResponse,
            }
        }
    }, async (request) => {
        const principal = (request as { authPrincipal?: ActorPrincipal }).authPrincipal;
        if (!principal) {
            throw new Error('AUTH_PRINCIPAL_UNAVAILABLE');
        }

        const query = request.query as {
            intent: 'authoring' | 'review' | 'workflow' | 'paid';
            search?: string;
        };
        const resolution = await resolveWorkspaceTarget(buildCurrentActorSnapshot(principal), {
            intent: query.intent,
            search: query.search,
        });

        return {
            data: resolution,
            meta: buildMeta(
                'Resolve the strongest schema-plus-work-target candidate for the requested workspace task without scanning the full model inventory.',
                ['GET /api/workspace-context', 'GET /api/identity'],
                'low',
                1,
            ),
        };
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
        const actorId = toAuditActorFromRequest(request as RequestActorCarrier);
        const legacyActorUserId = toLegacyActorUserId(request as RequestActorCarrier);

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
            createdBy: legacyActorUserId ?? null,
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
        const actorId = toAuditActorFromRequest(request as RequestActorCarrier);
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
        const actorId = toAuditActorFromRequest(request as RequestActorCarrier);
        const legacyActorUserId = toLegacyActorUserId(request as RequestActorCarrier);
        const { id } = request.params as IdParams;

        const rotated = await rotateApiKey(id, getDomainId(request), legacyActorUserId ?? null);
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
        const actorId = toAuditActorFromRequest(request as RequestActorCarrier);
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
        const actorId = toAuditActorFromRequest(request as RequestActorCarrier);
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
        const actorId = toAuditActorFromRequest(request as RequestActorCarrier);
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
            toAuditActorFromRequest(request as RequestActorCarrier),
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
                offset: Type.Optional(Type.Number({ minimum: 0 })),
                includeStats: Type.Optional(Type.Boolean())
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
                    updatedAt: Type.String(),
                    stats: Type.Optional(Type.Object({
                        itemCount: Type.Number(),
                        lastItemUpdatedAt: Type.Union([Type.String(), Type.Null()]),
                        statusCounts: Type.Record(Type.String(), Type.Number())
                    }))
                })))
            }
        }
    }, async (request, reply) => {
        const { limit: rawLimit, offset: rawOffset, includeStats } = request.query as ContentTypesQuery;
        const limit = clampLimit(rawLimit);
        const offset = clampOffset(rawOffset);
        const domainId = getDomainId(request);
        const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(contentTypes).where(eq(contentTypes.domainId, domainId));
        const types = await db.select()
            .from(contentTypes)
            .where(eq(contentTypes.domainId, domainId))
            .limit(limit)
            .offset(offset);
        const typeIds = types.map((type) => type.id);
        const stats = includeStats === true && typeIds.length > 0
            ? await db.select({
                contentTypeId: contentItems.contentTypeId,
                status: contentItems.status,
                itemCount: sql<number>`count(*)::int`,
                lastItemUpdatedAt: sql<string | null>`max(${contentItems.updatedAt})::text`
            })
                .from(contentItems)
                .where(and(
                    eq(contentItems.domainId, domainId),
                    inArray(contentItems.contentTypeId, typeIds)
                ))
                .groupBy(contentItems.contentTypeId, contentItems.status)
            : [];
        const data = includeStats === true ? withContentTypeStats(types, stats) : types;

        const hasMore = offset + data.length < total;
        return {
            data,
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
            toAuditActorFromRequest(request as RequestActorCarrier),
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
            toAuditActorFromRequest(request as RequestActorCarrier),
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

    server.post('/assets', {
        schema: {
            body: Type.Object({
                filename: Type.String({ minLength: 1 }),
                originalFilename: Type.Optional(Type.String({ minLength: 1 })),
                mimeType: Type.String({ minLength: 1 }),
                contentBase64: Type.String({ minLength: 1 }),
                accessMode: Type.Optional(Type.Union([
                    Type.Literal('public'),
                    Type.Literal('signed'),
                    Type.Literal('entitled')
                ])),
                entitlementScope: Type.Optional(Type.Object({
                    type: Type.Union([
                        Type.Literal('item'),
                        Type.Literal('type'),
                        Type.Literal('subscription')
                    ]),
                    ref: Type.Optional(Type.Number({ minimum: 1 }))
                })),
                metadata: Type.Optional(Type.Object({}, { additionalProperties: true }))
            }),
            response: {
                201: createAIResponse(AssetResponseSchema),
                400: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const body = request.body as CreateAssetBody;

        let created;
        try {
            created = await createAsset({
                domainId: getDomainId(request),
                filename: body.filename,
                originalFilename: body.originalFilename,
                mimeType: body.mimeType,
                contentBase64: body.contentBase64,
                accessMode: body.accessMode,
                entitlementScope: body.entitlementScope,
                metadata: body.metadata,
                actor: toAuditActorFromRequest(request as RequestActorCarrier)
            });
        } catch (error) {
            if (error instanceof AssetListError) {
                return reply.status(400).send(toAssetErrorPayload(error));
            }
            throw error;
        }

        return reply.status(201).send({
            data: serializeAsset(created),
            meta: buildMeta(
                'Inspect the uploaded asset or attach it to content',
                ['GET /api/assets/:id', 'GET /api/assets/:id/content'],
                'low',
                1
            )
        });
    });

    server.get('/assets', {
        schema: {
            querystring: Type.Object({
                q: Type.Optional(Type.String()),
                accessMode: Type.Optional(Type.Union([
                    Type.Literal('public'),
                    Type.Literal('signed'),
                    Type.Literal('entitled')
                ])),
                status: Type.Optional(Type.Union([
                    Type.Literal('active'),
                    Type.Literal('deleted')
                ])),
                limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
                offset: Type.Optional(Type.Number({ minimum: 0 })),
                cursor: Type.Optional(Type.String())
            }),
            response: {
                200: createAIResponse(Type.Array(AssetResponseSchema)),
                400: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const query = request.query as AssetsQuery;
        const limit = clampLimit(query.limit);

        let result;
        try {
            result = await listAssets(getDomainId(request), {
                q: query.q,
                accessMode: query.accessMode,
                status: query.status,
                limit,
                offset: query.cursor ? query.offset : clampOffset(query.offset),
                cursor: query.cursor
            });
        } catch (error) {
            if (error instanceof AssetListError) {
                return reply.status(400).send(toAssetErrorPayload(error));
            }
            throw error;
        }

        return {
            data: result.items.map((asset) => serializeAsset(asset)),
            meta: buildMeta(
                'Inspect an asset or upload a new one',
                ['POST /api/assets', 'GET /api/assets/:id'],
                'low',
                1,
                false,
                {
                    total: result.total,
                    limit: result.limit,
                    hasMore: result.hasMore,
                    nextCursor: result.nextCursor,
                    ...(result.offset !== undefined ? { offset: result.offset } : {})
                }
            )
        };
    });

    server.get('/assets/:id', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                200: createAIResponse(AssetResponseSchema),
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        const asset = await getAsset(id, getDomainId(request));

        if (!asset) {
            return reply.status(404).send(notFoundAsset(id));
        }

        return {
            data: serializeAsset(asset),
            meta: buildMeta(
                'Fetch the asset bytes or remove the asset',
                ['GET /api/assets/:id/content', 'DELETE /api/assets/:id'],
                'low',
                1
            )
        };
    });

    server.get('/assets/:id/offers', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                200: createAIResponse(Type.Array(OfferResponseSchema)),
                404: AIErrorResponse,
                409: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        const domainId = getDomainId(request);
        const asset = await getAsset(id, domainId);

        if (!asset) {
            return reply.status(404).send(notFoundAsset(id));
        }

        if (asset.accessMode !== 'entitled') {
            return {
                data: [],
                meta: buildMeta(
                    'This asset does not require an entitlement',
                    ['GET /api/assets/:id/content'],
                    'low',
                    0
                )
            };
        }

        const entitlementScope = toOfferReadScope(getAssetEntitlementScope(asset));
        if (!entitlementScope) {
            return reply.status(409).send(toErrorPayload(
                'Asset entitlement scope unavailable',
                'ASSET_ENTITLEMENT_UNAVAILABLE',
                'Configure a valid entitlementScope on the asset before offering paid access.'
            ));
        }

        const availableOffers = await LicensingService.getActiveOffersForReadScope(domainId, entitlementScope);
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

    server.get('/assets/:id/content', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                400: AIErrorResponse,
                401: AIErrorResponse,
                402: AIErrorResponse,
                403: AIErrorResponse,
                404: AIErrorResponse,
                409: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        let asset = await getPublicAsset(id);

        if (!asset) {
            const auth = await authorizeApiRequest(request.method, request.url.split('?')[0], request.headers);
            if (!auth.ok) {
                const statusCode = auth.statusCode === 403 ? 403 : 401;
                return reply.status(statusCode).send(auth.payload);
            }

            (request as RequestActorCarrier).authPrincipal = auth.principal;
            asset = await getAsset(id, auth.principal.domainId);
            if (!asset) {
                return reply.status(404).send(notFoundAsset(id));
            }

            if (asset.accessMode === 'entitled') {
                const domainId = auth.principal.domainId;
                const entitlementScope = toOfferReadScope(getAssetEntitlementScope(asset));
                if (!entitlementScope) {
                    return reply.status(409).send(toErrorPayload(
                        'Asset entitlement scope unavailable',
                        'ASSET_ENTITLEMENT_UNAVAILABLE',
                        'Configure a valid entitlementScope on the asset before requesting entitlement-backed delivery.'
                    ));
                }

                const matchingOffers = await LicensingService.getActiveOffersForReadScope(domainId, entitlementScope);
                if (matchingOffers.length === 0) {
                    return reply.status(409).send(toErrorPayload(
                        'Asset entitlement offers unavailable',
                        'ASSET_ENTITLEMENT_UNAVAILABLE',
                        `No active offers are configured for this asset. Configure an offer or switch access mode before retrying GET /api/assets/${id}/content.`
                    ));
                }

                const principalApiKeyId = resolveApiKeyId(auth.principal);
                if (principalApiKeyId === undefined) {
                    return reply.status(402).send(toErrorPayload(
                        'Offer purchase required',
                        'OFFER_REQUIRED',
                        `This asset is licensed by offer. Discover offers with GET /api/assets/${id}/offers and complete POST /api/offers/:id/purchase with an API key principal.`
                    ));
                }

                const [profile] = await db.select().from(agentProfiles).where(and(
                    eq(agentProfiles.apiKeyId, principalApiKeyId),
                    eq(agentProfiles.domainId, domainId)
                ));

                if (!profile) {
                    return reply.status(402).send(toErrorPayload(
                        'Offer purchase required',
                        'OFFER_REQUIRED',
                        `You do not have an entitlement for this asset. Discover offers with GET /api/assets/${id}/offers and purchase one first.`
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

                const eligibleEntitlements = await LicensingService.getEligibleEntitlementsForReadScope(
                    domainId,
                    profile.id,
                    entitlementScope
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
                    `${request.method.toUpperCase()} /api/assets/:id/content`,
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
        }

        try {
            const content = await readAssetContent(asset.storageKey);
            reply.header('content-type', asset.mimeType);
            reply.header('content-length', String(content.byteLength));
            reply.header('content-disposition', `inline; filename="${asset.originalFilename}"`);
            reply.header('x-wordclaw-access-mode', asset.accessMode);
            if (asset.accessMode === 'public') {
                reply.header('cache-control', 'public, max-age=3600');
            } else {
                reply.header('cache-control', 'private, no-store');
            }

            return reply.send(content);
        } catch (error) {
            request.log.warn({ err: error, assetId: id }, 'Failed to read asset content');
            return reply.status(404).send(toErrorPayload(
                'Asset content not found',
                'ASSET_CONTENT_NOT_FOUND',
                'The asset metadata exists, but the underlying file is missing from storage.'
            ));
        }
    });

    server.delete('/assets/:id', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                200: createAIResponse(AssetResponseSchema),
                404: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;
        const deleted = await softDeleteAsset(
            id,
            getDomainId(request),
            toAuditActorFromRequest(request as RequestActorCarrier)
        );

        if (!deleted) {
            return reply.status(404).send(notFoundAsset(id));
        }

        return {
            data: serializeAsset(deleted),
            meta: buildMeta(
                'The asset is now soft-deleted and cannot be newly referenced',
                ['GET /api/assets', 'GET /api/assets/:id'],
                'low',
                1
            )
        };
    });

    server.post('/assets/:id/restore', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                200: createAIResponse(AssetRestoreResponseSchema),
                404: AIErrorResponse,
                409: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;

        try {
            const restored = await restoreAsset(
                id,
                getDomainId(request),
                toAuditActorFromRequest(request as RequestActorCarrier)
            );

            if (!restored) {
                return reply.status(404).send(notFoundAsset(id));
            }

            return {
                data: serializeAsset(restored),
                meta: buildMeta(
                    'Inspect the restored asset or resume attaching it to content',
                    ['GET /api/assets/:id', 'GET /api/assets/:id/content'],
                    'low',
                    1
                )
            };
        } catch (error) {
            if (error instanceof AssetListError) {
                return reply.status(409).send(toAssetErrorPayload(error));
            }

            throw error;
        }
    });

    server.post('/assets/:id/purge', {
        schema: {
            params: Type.Object({
                id: Type.Number()
            }),
            response: {
                200: createAIResponse(AssetPurgeResponseSchema),
                403: AIErrorResponse,
                404: AIErrorResponse,
                409: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as IdParams;

        if (!hasAdminScope(request as RequestActorCarrier)) {
            return reply.status(403).send(toErrorPayload(
                'Admin scope required',
                'ADMIN_REQUIRED',
                'Use an API key with the admin scope before purging an asset.'
            ));
        }

        try {
            const purged = await purgeAsset(
                id,
                getDomainId(request),
                toAuditActorFromRequest(request as RequestActorCarrier)
            );

            if (!purged) {
                return reply.status(404).send(notFoundAsset(id));
            }

            return {
                data: {
                    purged: true,
                    asset: serializeAsset(purged.asset),
                    referenceSummary: {
                        activeReferenceCount: purged.usage.activeReferences.length,
                        historicalReferenceCount: purged.usage.historicalReferences.length
                    }
                },
                meta: buildMeta(
                    'The asset bytes and metadata were permanently removed',
                    ['GET /api/assets', 'POST /api/assets'],
                    'medium',
                    1
                )
            };
        } catch (error) {
            if (error instanceof AssetListError) {
                return reply.status(409).send(toAssetErrorPayload(error));
            }

            throw error;
        }
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

        const contentValidation = await validateContentDataAgainstSchema(contentType.schema, data.data, getDomainId(request));
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
            toAuditActorFromRequest(request as RequestActorCarrier),
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

        const contentValidation = await validateContentDataAgainstSchema(contentType.schema, data.data, getDomainId(request));
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
            toAuditActorFromRequest(request as RequestActorCarrier),
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
                q: Type.Optional(Type.String()),
                createdAfter: Type.Optional(Type.String()),
                createdBefore: Type.Optional(Type.String()),
                sortBy: Type.Optional(Type.Union([
                    Type.Literal('updatedAt'),
                    Type.Literal('createdAt'),
                    Type.Literal('version')
                ])),
                sortDir: Type.Optional(Type.Union([
                    Type.Literal('asc'),
                    Type.Literal('desc')
                ])),
                limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
                offset: Type.Optional(Type.Number({ minimum: 0 })),
                cursor: Type.Optional(Type.String())
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
            q,
            createdAfter,
            createdBefore,
            sortBy,
            sortDir,
            limit: rawLimit,
            offset: rawOffset,
            cursor
        } = request.query as ContentItemsQuery;

        const limit = clampLimit(rawLimit);

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

        let result;
        try {
            result = await listContentItems(getDomainId(request), {
                contentTypeId,
                status,
                q,
                createdAfter: afterDate,
                createdBefore: beforeDate,
                sortBy,
                sortDir,
                limit,
                offset: cursor ? rawOffset : clampOffset(rawOffset),
                cursor
            });
        } catch (error) {
            if (error instanceof ContentItemListError) {
                return reply.status(400).send(toErrorPayload(error.message, error.code, error.remediation));
            }
            throw error;
        }

        return {
            data: result.items,
            meta: buildMeta(
                'Filter or select a content item',
                ['POST /api/content-items'],
                'low',
                1,
                false,
                {
                    total: result.total,
                    limit: result.limit,
                    hasMore: result.hasMore,
                    nextCursor: result.nextCursor,
                    ...(result.offset !== undefined ? { offset: result.offset } : {})
                }
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
            const principalApiKeyId = toApiKeyIdFromRequest(request as RequestActorCarrier);
            if (principalApiKeyId === undefined) {
                return reply.status(402).send(toErrorPayload(
                    'Offer purchase required',
                    'OFFER_REQUIRED',
                    `This content item is licensed by offer. List offers with GET /api/content-items/${id}/offers and complete POST /api/offers/:id/purchase.`
                ));
            }

            const [profile] = await db.select().from(agentProfiles).where(and(
                eq(agentProfiles.apiKeyId, principalApiKeyId),
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
        const principalApiKeyId = toApiKeyIdFromRequest(request as RequestActorCarrier);
        const paymentMethod: PaymentMethod = body.paymentMethod ?? 'lightning';

        if (paymentMethod !== 'lightning') {
            return reply.status(400).send(toErrorPayload(
                'Unsupported payment method',
                'PAYMENT_METHOD_UNSUPPORTED',
                'Only paymentMethod=lightning is currently enabled. AP2 settlement is tracked separately.'
            ));
        }

        if (principalApiKeyId === undefined) {
            return reply.status(403).send(toErrorPayload('API Key required', 'API_KEY_REQUIRED', 'Only API-key clients can hold entitlements and purchase offers.'));
        }

        let [profile] = await db.select().from(agentProfiles).where(and(
            eq(agentProfiles.apiKeyId, principalApiKeyId),
            eq(agentProfiles.domainId, domainId)
        ));
        if (!profile) {
            [profile] = await db.insert(agentProfiles).values({ domainId, apiKeyId: principalApiKeyId }).returning();
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
        const principalApiKeyId = toApiKeyIdFromRequest(request as RequestActorCarrier);

        if (principalApiKeyId === undefined) {
            return reply.status(403).send(toErrorPayload(
                'API Key required',
                'API_KEY_REQUIRED',
                'Only API-key clients can confirm offer purchases.'
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
            eq(agentProfiles.apiKeyId, principalApiKeyId),
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
        const principalApiKeyId = toApiKeyIdFromRequest(request as RequestActorCarrier);
        if (principalApiKeyId === undefined) {
            return reply.status(403).send(toErrorPayload(
                'API Key required',
                'API_KEY_REQUIRED',
                'Use an API key principal to list entitlement ownership.'
            ));
        }

        const [profile] = await db.select().from(agentProfiles).where(and(
            eq(agentProfiles.apiKeyId, principalApiKeyId),
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
        const principalApiKeyId = toApiKeyIdFromRequest(request as RequestActorCarrier);
        if (principalApiKeyId === undefined) {
            return reply.status(403).send(toErrorPayload(
                'API Key required',
                'API_KEY_REQUIRED',
                'Use an API key principal to inspect entitlement ownership.'
            ));
        }

        const [profile] = await db.select().from(agentProfiles).where(and(
            eq(agentProfiles.apiKeyId, principalApiKeyId),
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

    if (isExperimentalDelegationEnabled()) {
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

            const principalApiKeyId = toApiKeyIdFromRequest(request as RequestActorCarrier);
            if (principalApiKeyId === undefined) {
                return reply.status(403).send(toErrorPayload('API Key required', 'API_KEY_REQUIRED', 'Supervisors cannot delegate entitlements.'));
            }

            const [sourceProfile] = await db.select().from(agentProfiles).where(and(
                eq(agentProfiles.apiKeyId, principalApiKeyId),
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
                    meta: buildMeta('Experimental: share entitlement grant', [], 'low', 0)
                };
            } catch (e: any) {
                return reply.status(400).send(toErrorPayload(e.message, 'DELEGATION_FAILED', 'Check delegation rules. Entitlement delegation is experimental.'));
            }
        });
    }

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
        const contentValidation = await validateContentDataAgainstSchema(targetContentType.schema, targetData, getDomainId(request));
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
            toAuditActorFromRequest(request as RequestActorCarrier),
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

        const contentValidation = await validateContentDataAgainstSchema(contentType.schema, targetVersion.data, getDomainId(request));
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
                toAuditActorFromRequest(request as RequestActorCarrier),
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
            toAuditActorFromRequest(request as RequestActorCarrier),
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
        const actorId = toAuditActorFromRequest(request as RequestActorCarrier);
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

                const contentValidation = await validateContentDataAgainstSchema(contentType.schema, item.data, getDomainId(request));
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

                        const contentValidation = await validateContentDataAgainstSchema(contentType.schema, item.data, getDomainId(request));
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

                const contentValidation = await validateContentDataAgainstSchema(contentType.schema, item.data, getDomainId(request));
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
        const actorId = toAuditActorFromRequest(request as RequestActorCarrier);
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
            const validation = await validateContentDataAgainstSchema(targetContentType.schema, targetData, getDomainId(request));
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
                        const validation = await validateContentDataAgainstSchema(targetContentType.schema, targetData, getDomainId(request));
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
        const actorId = toAuditActorFromRequest(request as RequestActorCarrier);
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
                actorId: Type.Optional(Type.String()),
                actorType: Type.Optional(Type.String()),
                limit: Type.Optional(Type.Number({ default: 50, minimum: 1, maximum: 500 })),
                cursor: Type.Optional(Type.String())
            }),
            response: {
                200: createAIResponse(Type.Array(Type.Object({
                    id: Type.Number(),
                    action: Type.String(),
                    entityType: Type.String(),
                    entityId: Type.Number(),
                    actorId: Type.Union([Type.String(), Type.Null()]),
                    actorType: Type.Union([Type.String(), Type.Null()]),
                    actorSource: Type.Union([Type.String(), Type.Null()]),
                    details: Type.Optional(Type.String()),
                    createdAt: Type.String()
                })))
                ,
                400: AIErrorResponse
            }
        }
    }, async (request, reply) => {
        const { entityType, entityId, action, actorId, actorType, limit: rawLimit, cursor } = request.query as AuditLogQuery;
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
            actorId ? eq(auditLogs.actorId, actorId) : undefined,
            actorType ? eq(auditLogs.actorType, actorType) : undefined,
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
            actorId: auditLogs.actorId,
            actorType: auditLogs.actorType,
            actorSource: auditLogs.actorSource,
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
                    actorType: Type.Union([Type.String(), Type.Null()]),
                    actorSource: Type.Union([Type.String(), Type.Null()]),
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
            actorType: payments.actorType,
            actorSource: payments.actorSource,
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
                    actorType: Type.Union([Type.String(), Type.Null()]),
                    actorSource: Type.Union([Type.String(), Type.Null()]),
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
    if (isExperimentalAgentRunsEnabled()) {
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
            const authPrincipal = (request as any).authPrincipal as PrincipalLike | undefined;
            const run = await AgentRunService.createRun(getDomainId(request), {
                goal: payload.goal,
                runType: payload.runType,
                definitionId: payload.definitionId,
                requireApproval: payload.requireApproval,
                metadata: payload.metadata,
                requestedBy: authPrincipal?.actorRef?.toString()
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

    server.get('/agent-runs/metrics', {
        schema: {
            querystring: Type.Object({
                windowHours: Type.Optional(Type.Number({ minimum: 1, maximum: 720 })),
                runType: Type.Optional(Type.String())
            }),
            response: {
                200: createAIResponse(Type.Object({
                    window: Type.Object({
                        hours: Type.Number(),
                        from: Type.String(),
                        to: Type.String(),
                        runType: Type.Union([Type.String(), Type.Null()])
                    }),
                    queue: Type.Object({
                        backlog: Type.Number(),
                        queued: Type.Number(),
                        planning: Type.Number(),
                        waitingApproval: Type.Number(),
                        running: Type.Number()
                    }),
                    outcomes: Type.Object({
                        succeeded: Type.Number(),
                        failed: Type.Number(),
                        cancelled: Type.Number(),
                        completionRate: Type.Union([Type.Number(), Type.Null()])
                    }),
                    latencyMs: Type.Object({
                        queueToStartAvg: Type.Union([Type.Number(), Type.Null()]),
                        queueToStartSamples: Type.Number(),
                        completionAvg: Type.Union([Type.Number(), Type.Null()]),
                        completionSamples: Type.Number()
                    }),
                    throughput: Type.Object({
                        createdRuns: Type.Number(),
                        startedRuns: Type.Number(),
                        completedRuns: Type.Number(),
                        reviewActionsPlanned: Type.Number(),
                        reviewActionsSucceeded: Type.Number(),
                        qualityChecksPlanned: Type.Number(),
                        qualityChecksSucceeded: Type.Number()
                    }),
                    failureClasses: Type.Object({
                        policyDenied: Type.Number(),
                        reviewExecutionFailed: Type.Number(),
                        qualityValidationFailed: Type.Number(),
                        settledFailed: Type.Number()
                    })
                }))
            }
        }
    }, async (request) => {
        const { windowHours, runType } = request.query as AgentRunMetricsQuery;
        const metrics = await AgentRunMetricsService.getMetrics(getDomainId(request), {
            windowHours,
            runType
        });

        return {
            data: metrics,
            meta: buildMeta(
                'Inspect autonomous runtime queue health and throughput',
                ['GET /api/agent-runs', 'POST /api/agent-runs'],
                'low',
                1
            )
        };
    });

    server.get('/agent-runs/worker-status', {
        schema: {
            response: {
                200: createAIResponse(Type.Object({
                    started: Type.Boolean(),
                    sweepInProgress: Type.Boolean(),
                    intervalMs: Type.Number(),
                    maxRunsPerSweep: Type.Number(),
                    lastSweepStartedAt: Type.Union([Type.String(), Type.Null()]),
                    lastSweepCompletedAt: Type.Union([Type.String(), Type.Null()]),
                    lastSweepProcessedRuns: Type.Number(),
                    totalSweeps: Type.Number(),
                    totalProcessedRuns: Type.Number(),
                    lastError: Type.Union([
                        Type.Object({
                            message: Type.String(),
                            at: Type.String()
                        }),
                        Type.Null()
                    ])
                }))
            }
        }
    }, async () => {
        return {
            data: agentRunWorker.getStatus(),
            meta: buildMeta(
                'Inspect autonomous worker sweep status and last error',
                ['GET /api/agent-runs/metrics', 'POST /api/agent-runs'],
                'low',
                1
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
    }

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
                    contentItemId: Type.Number(),
                    workflowTransitionId: Type.Number(),
                    status: Type.String(),
                    assignee: Type.Union([Type.String(), Type.Null()]),
                    assigneeActorId: Type.Union([Type.String(), Type.Null()]),
                    assigneeActorType: Type.Union([Type.String(), Type.Null()]),
                    assigneeActorSource: Type.Union([Type.String(), Type.Null()]),
                    createdAt: Type.String(),
                    updatedAt: Type.String()
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
            data: {
                ...task,
                createdAt: task.createdAt.toISOString(),
                updatedAt: task.updatedAt.toISOString()
            },
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
                    contentItemId: Type.Number(),
                    workflowTransitionId: Type.Number(),
                    status: Type.String(),
                    assignee: Type.Union([Type.String(), Type.Null()]),
                    assigneeActorId: Type.Union([Type.String(), Type.Null()]),
                    assigneeActorType: Type.Union([Type.String(), Type.Null()]),
                    assigneeActorSource: Type.Union([Type.String(), Type.Null()]),
                    createdAt: Type.String(),
                    updatedAt: Type.String()
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
            data: {
                ...task,
                createdAt: task.createdAt.toISOString(),
                updatedAt: task.updatedAt.toISOString()
            },
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
                    authorActorId: Type.Union([Type.String(), Type.Null()]),
                    authorActorType: Type.Union([Type.String(), Type.Null()]),
                    authorActorSource: Type.Union([Type.String(), Type.Null()]),
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
                    authorActorId: Type.Union([Type.String(), Type.Null()]),
                    authorActorType: Type.Union([Type.String(), Type.Null()]),
                    authorActorSource: Type.Union([Type.String(), Type.Null()]),
                    comment: Type.String()
                }))
            }
        }
    }, async (request, reply) => {
        const { id } = request.params as { id: number };
        const payload = request.body as any;
        const authPrincipal = (request as any).authPrincipal;
        const comment = await WorkflowService.addComment(getDomainId(request), id, authPrincipal ?? 'system', payload.comment);

        return reply.status(201).send({
            data: comment,
            meta: buildMeta('Comment posted successfully', [], 'low', 1)
        });
    });

    if (isExperimentalRevenueEnabled()) {
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
            const authPrincipal = (request as any).authPrincipal as PrincipalLike | undefined;
            const principalApiKeyId = resolveApiKeyId(authPrincipal);

            if (principalApiKeyId === undefined) {
                return reply.status(401).send(toErrorPayload('API Key required', 'API_KEY_REQUIRED', 'Only API-key clients can view the experimental earnings ledger.'));
            }

            const domainId = getDomainId(request);
            const [profile] = await db.select().from(agentProfiles).where(and(eq(agentProfiles.apiKeyId, principalApiKeyId), eq(agentProfiles.domainId, domainId)));

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
                meta: buildMeta('Experimental: inspect your agent revenue ledger', [], 'low', 1)
            });
        });
    }
}
