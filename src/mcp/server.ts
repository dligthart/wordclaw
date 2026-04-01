import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { and, desc, eq, gte, lt, lte, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { getAssetSignedTtlSeconds } from '../config/assets.js';
import { isExperimentalAgentRunsEnabled, isExperimentalRevenueEnabled } from '../config/runtime-features.js';
import { db } from '../db/index.js';
import { agentProfiles, auditLogs, contentItemVersions, contentItems, contentTypes, domains, payments, workflows, workflowTransitions } from '../db/schema.js';
import { logAudit } from '../services/audit.js';
import {
    ValidationFailure,
    redactPremiumFields,
    resolveContentTypeSchemaSource,
    validateContentDataAgainstSchema
} from '../services/content-schema.js';
import { createApiKey, listApiKeys, normalizeScopes, revokeApiKey } from '../services/api-key.js';
import { createWebhook, deleteWebhook, getWebhookById, listWebhooks, normalizeWebhookEvents, parseWebhookEvents, updateWebhook, isSafeWebhookUrl } from '../services/webhook.js';
import { WorkflowService } from '../services/workflow.js';
import { EmbeddingService } from '../services/embedding.js';
import { AgentRunService, AgentRunServiceError, isAgentRunControlAction, isAgentRunStatus } from '../services/agent-runs.js';
import { LicensingService, type OfferReadScope } from '../services/licensing.js';
import {
    AssetListError,
    completeDirectAssetUpload,
    createAsset,
    getAsset,
    getAssetEntitlementScope,
    issueDirectAssetUpload,
    listAssetDerivatives,
    listAssets,
    purgeAsset,
    restoreAsset,
    softDeleteAsset
} from '../services/assets.js';
import { AssetStorageError } from '../services/asset-storage.js';

import { PolicyEngine } from '../services/policy.js';
import { buildOperationContext } from '../services/policy-adapters.js';
import { buildCurrentActorSnapshot, buildMcpLocalPrincipal, hasAdministrativeScope, isPlatformAdminPrincipal, type ActorPrincipal } from '../services/actor-identity.js';
import { buildCapabilityManifest } from '../services/capability-manifest.js';
import { getDeploymentStatusSnapshot } from '../services/deployment-status.js';
import { buildContentGuide } from '../cli/lib/content-guide.js';
import { buildWorkflowGuide } from '../cli/lib/workflow-guide.js';
import { buildIntegrationGuide } from '../cli/lib/integration-guide.js';
import { buildL402Guide } from '../cli/lib/l402-guide.js';
import { buildAuditGuide } from '../cli/lib/audit-guide.js';
import { buildBootstrapWorkspaceGuide } from '../cli/lib/bootstrap-workspace-guide.js';
import { buildDeploymentGuide } from '../cli/lib/deployment-guide.js';
import { buildWorkspaceGuide } from '../cli/lib/workspace-guide.js';
import { issueSignedAssetAccess } from '../services/asset-access.js';
import {
    attachContentItemEmbeddingReadiness,
    ContentItemListError,
    ContentItemProjectionError,
    getLatestPublishedVersionsForItems,
    listContentItems,
    projectContentItems,
    resolveContentItemReadView
} from '../services/content-item.service.js';
import { ensureContentItemLifecycleState } from '../services/content-lifecycle.js';
import { getWorkspaceContextSnapshot, resolveWorkspaceTarget } from '../services/workspace-context.js';
import {
    countContentItemsForContentType,
    findSingletonContentConflict,
    getGlobalContentTypeBySlug,
    getSingletonContentItem,
    isSingletonContentType,
    listGlobalContentTypes,
    normalizeContentTypeKind
} from '../services/content-type.service.js';
import {
    buildRuntimeEndpoints,
    normalizePublicBaseUrl,
    onboardTenant
} from '../services/tenant-onboarding.js';
import { findAssetUsage, findContentItemUsage, type ReferenceUsageSummary } from '../services/reference-usage.js';
import {
    FormServiceError,
    createFormDefinition,
    deleteFormDefinition,
    getFormDefinitionById,
    getFormDefinitionBySlug,
    listFormDefinitions,
    submitFormDefinition,
    updateFormDefinition,
} from '../services/forms.js';
import {
    cancelJob,
    createJob,
    getJob,
    listJobs,
    scheduleContentStatusTransition,
    serializeJob,
} from '../services/jobs.js';
import {
    canSubscribeToReactiveTopic,
    getReactiveSubscriptionRecipe,
    REACTIVE_SUBSCRIPTION_RECIPE_IDS,
    ReactiveEventFiltersSchema,
    SUPPORTED_REACTIVE_FILTER_FIELDS,
    SUPPORTED_REACTIVE_EVENT_TOPICS,
    SUPPORTED_REACTIVE_SUBSCRIPTION_RECIPES,
    type ReactiveEventBindings,
} from './reactive-events.js';

type McpRequestExtra = {
    authInfo?: {
        extra?: Record<string, unknown>;
    };
};

type CreateMcpServerOptions = {
    reactiveEvents?: ReactiveEventBindings;
};

function readResourceTemplateValue(value: string | string[] | undefined) {
    if (Array.isArray(value)) {
        return value[0];
    }

    return value;
}

const GUIDE_TASK_IDS = [
    'bootstrap-workspace',
    'discover-deployment',
    'discover-workspace',
    'author-content',
    'review-workflow',
    'manage-integrations',
    'consume-paid-content',
    'verify-provenance',
] as const;

type GuideTaskId = typeof GUIDE_TASK_IDS[number];

type ReactiveTaskRecommendation = {
    available: boolean;
    reason: string;
    recipeId: string | null;
    resolvedTopics: string[];
    blockedTopics: string[];
    filters: Record<string, unknown>;
    subscribe: {
        tool: 'subscribe_events';
        arguments: Record<string, unknown>;
    } | null;
};

function normalizeReactiveGuideFilters(filters: Record<string, unknown>) {
    return Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value !== undefined),
    );
}

function buildReactiveTaskRecommendation(
    principal: ActorPrincipal,
    options: {
        taskId: GuideTaskId;
        contentTypeId?: number;
        reviewTaskId?: number;
        actorId?: string;
        actorType?: string;
        entityType?: string;
        entityId?: number;
        action?: string;
    },
): ReactiveTaskRecommendation | null {
    let recipeId: string | null = null;
    let explicitTopics: string[] = [];
    let reason = '';
    let filters: Record<string, unknown> = {};

    if (options.taskId === 'author-content') {
        if (options.contentTypeId === undefined) {
            return null;
        }

        recipeId = 'content-lifecycle';
        reason = 'Watch lifecycle changes for the schema you are actively authoring into.';
        filters = {
            contentTypeId: options.contentTypeId,
        };
    } else if (options.taskId === 'review-workflow') {
        recipeId = 'review-decisions';
        reason = 'Watch approval and rejection events while supervising the review queue.';
        filters = {
            reviewTaskId: options.reviewTaskId,
        };
    } else if (options.taskId === 'manage-integrations') {
        recipeId = 'integration-admin';
        reason = 'Watch API key and webhook mutations while managing external integration surfaces.';
    } else if (options.taskId === 'verify-provenance') {
        if (options.entityType === 'content_item') {
            recipeId = 'content-lifecycle';
            reason = 'Watch subsequent lifecycle changes for the target content item or its schema.';
            filters = {
                entityId: options.entityId,
                action: options.action,
            };
        } else if (options.entityType === 'content_type') {
            recipeId = 'schema-governance';
            reason = 'Watch future schema mutations for the targeted content model.';
            filters = {
                entityId: options.entityId,
                action: options.action,
            };
        } else if (options.entityType === 'api_key' || options.entityType === 'webhook') {
            recipeId = 'integration-admin';
            reason = 'Watch future integration changes for the targeted admin entity.';
            filters = {
                entityType: options.entityType,
                entityId: options.entityId,
                action: options.action,
            };
        } else {
            explicitTopics = ['audit.*'];
            reason = 'Use the filtered audit stream when provenance depends on actor filters or mixed entity types.';
            filters = {
                actorId: options.actorId,
                actorType: options.actorType,
                entityType: options.entityType,
                entityId: options.entityId,
                action: options.action,
            };
        }
    } else {
        return null;
    }

    const recipe = recipeId ? getReactiveSubscriptionRecipe(recipeId) : null;
    const normalizedFilters = normalizeReactiveGuideFilters(filters);
    const resolvedTopics = recipe ? [...recipe.topics] : explicitTopics;
    const allowedTopics = resolvedTopics.filter((topic) => canSubscribeToReactiveTopic(principal, topic));
    const blockedTopics = resolvedTopics.filter((topic) => !canSubscribeToReactiveTopic(principal, topic));
    const available = allowedTopics.length > 0;

    return {
        available,
        reason: available
            ? reason
            : 'Current actor is missing the scopes required for the recommended reactive subscription.',
        recipeId,
        resolvedTopics,
        blockedTopics,
        filters: normalizedFilters,
        subscribe: available
            ? {
                tool: 'subscribe_events',
                arguments: {
                    ...(recipeId ? { recipeId } : { topics: allowedTopics }),
                    ...(Object.keys(normalizedFilters).length > 0 ? { filters: normalizedFilters } : {}),
                },
            }
            : null,
    };
}

function resolveMcpPrincipal(extra?: McpRequestExtra): ActorPrincipal {
    const principal = extra?.authInfo?.extra?.wordclawPrincipal;

    if (
        principal
        && typeof principal === 'object'
        && 'domainId' in principal
        && 'scopes' in principal
        && 'actorRef' in principal
    ) {
        return principal as ActorPrincipal;
    }

    const domainId = Number(process.env.WORDCLAW_DOMAIN_ID) || 1;
    return buildMcpLocalPrincipal(domainId);
}

export function createServer(options: CreateMcpServerOptions = {}) {
    const server = new McpServer({
        name: 'WordClaw CMS',
        version: '1.0.0'
    });

    const TARGET_VERSION_NOT_FOUND = 'Target version not found';
    const CONTENT_TYPE_SLUG_CONSTRAINTS = new Set([
        'content_types_slug_unique',
        'content_types_domain_slug_unique'
    ]);
    const DOMAIN_HOSTNAME_CONSTRAINTS = new Set([
        'domains_hostname_unique',
        'domains_hostname_key',
    ]);

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

    function formatAssetError(error: AssetListError): string {
        return `${error.code}: ${error.message}. ${error.remediation}${error.context ? ` Context: ${JSON.stringify(error.context)}` : ''}`;
    }

    function formatFormError(error: FormServiceError): string {
        return `${error.code}: ${error.message}. ${error.remediation}${error.context ? ` Context: ${JSON.stringify(error.context)}` : ''}`;
    }

    function withMCPPolicy<T>(
        operation: string,
        extractResource: (args: T) => any,
        handler: (args: T, extra: any, domainId: number) => Promise<ToolResult>
    ) {
        return async (args: T, extra: any) => {
            const principal = resolveMcpPrincipal(extra);
            const domainId = principal.domainId;
            const resource = extractResource(args) || { type: 'system' };
            const operationContext = buildOperationContext('mcp', principal, operation, resource);
            const decision = await PolicyEngine.evaluate(operationContext);
            if (decision.outcome !== 'allow') {
                return err(`${decision.code}: Access Denied by Policy. ${decision.remediation || ''}`);
            }
            return handler(args, extra, domainId);
        };
    }

    function validationFailureToText(failure: ValidationFailure): string {
        const context = failure.context ? ` Context: ${JSON.stringify(failure.context)}` : '';
        return `${failure.code}: ${failure.error}. ${failure.remediation}${context}`;
    }

    function invalidContentTypeKindText(rawKind: unknown) {
        return `INVALID_CONTENT_TYPE_KIND: Use kind of "collection" or "singleton" instead of '${String(rawKind)}'.`;
    }

    function singletonContentItemConflictText(contentType: { slug: string }, existingItemId: number) {
        return `SINGLETON_CONTENT_ITEM_EXISTS: Content type '${contentType.slug}' is a singleton and already uses content item ${existingItemId}. Use update_global or update_content_item instead.`;
    }

    function singletonContentTypeRequiresSingleItemText(contentType: { slug: string }, itemCount: number) {
        return `SINGLETON_CONTENT_TYPE_REQUIRES_ONE_ITEM: Content type '${contentType.slug}' currently has ${itemCount} items. Archive, delete, or consolidate to a single item before changing kind to 'singleton'.`;
    }

    async function findSingletonConflictText(
        domainId: number,
        contentType: { id: number; kind: string; slug: string },
        excludeContentItemId?: number
    ) {
        if (!isSingletonContentType(contentType.kind)) {
            return null;
        }

        const conflict = await findSingletonContentConflict(domainId, contentType.id, excludeContentItemId);
        if (!conflict) {
            return null;
        }

        return singletonContentItemConflictText(contentType, conflict.id);
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

    function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
        return Object.fromEntries(
            Object.entries(value).filter(([, entry]) => entry !== undefined)
        ) as Partial<T>;
    }

    function hasDefinedValues<T extends Record<string, unknown>>(value: T): boolean {
        return Object.keys(stripUndefined(value)).length > 0;
    }

    function resolveLocalizedReadOptions(
        draft?: boolean,
        locale?: string,
        fallbackLocale?: string
    ): {
        draft: boolean;
        locale?: string;
        fallbackLocale?: string;
    } | {
        error: string;
    } {
        const normalizedDraft = draft === false ? false : true;
        const normalizedLocale = typeof locale === 'string' && locale.trim().length > 0
            ? locale.trim()
            : undefined;
        const normalizedFallbackLocale = typeof fallbackLocale === 'string' && fallbackLocale.trim().length > 0
            ? fallbackLocale.trim()
            : undefined;

        if (!normalizedLocale && normalizedFallbackLocale) {
            return {
                error: 'CONTENT_LOCALE_REQUIRED: Provide locale when requesting fallbackLocale on localized content reads.'
            };
        }

        return {
            draft: normalizedDraft,
            locale: normalizedLocale,
            fallbackLocale: normalizedFallbackLocale
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

    function toIsoString(value: Date | null): string | null {
        if (!value) {
            return null;
        }
        return value.toISOString();
    }

    function toOptionalIsoString(value: Date | null | undefined): string | undefined {
        if (!value) {
            return undefined;
        }

        return value.toISOString();
    }

    function extractNumericCell(result: unknown, keys: string[]) {
        const firstRow = Array.isArray(result)
            ? result[0]
            : Array.isArray((result as { rows?: unknown[] } | null | undefined)?.rows)
                ? (result as { rows: unknown[] }).rows[0]
                : null;

        if (!firstRow || typeof firstRow !== 'object') {
            return 0;
        }

        for (const key of keys) {
            const candidate = (firstRow as Record<string, unknown>)[key];
            const numeric = Number(candidate);
            if (Number.isFinite(numeric)) {
                return numeric;
            }
        }

        return 0;
    }

    function isAdminPrincipal(principal: ActorPrincipal) {
        return hasAdministrativeScope(principal);
    }

    function isPlatformAdminActor(principal: ActorPrincipal) {
        return isPlatformAdminPrincipal(principal);
    }

    function hasActorScope(actor: ReturnType<typeof buildCurrentActorSnapshot>, scope: string): boolean {
        return actor.scopes.includes('admin') || actor.scopes.includes(scope);
    }

    function canInspectContent(actor: ReturnType<typeof buildCurrentActorSnapshot>): boolean {
        return hasActorScope(actor, 'content:read') || hasActorScope(actor, 'content:write');
    }

    function canWriteContent(actor: ReturnType<typeof buildCurrentActorSnapshot>): boolean {
        return hasActorScope(actor, 'content:write');
    }

    function canManageIntegrations(actor: ReturnType<typeof buildCurrentActorSnapshot>): boolean {
        return actor.scopes.includes('admin') || actor.scopes.includes('tenant:admin');
    }

    function serializeApiKeyForGuide(key: Awaited<ReturnType<typeof listApiKeys>>[number]) {
        return {
            id: key.id,
            name: key.name,
            keyPrefix: key.keyPrefix,
            scopes: key.scopes.split('|').filter(Boolean),
            createdBy: key.createdBy,
            createdAt: toIsoString(key.createdAt) ?? new Date(0).toISOString(),
            expiresAt: toIsoString(key.expiresAt),
            revokedAt: toIsoString(key.revokedAt),
            lastUsedAt: toIsoString(key.lastUsedAt),
        };
    }

    function serializeWebhookForGuide(hook: Awaited<ReturnType<typeof listWebhooks>>[number]) {
        return {
            id: hook.id,
            url: hook.url,
            events: parseWebhookEvents(hook.events),
            active: hook.active,
            createdAt: toIsoString(hook.createdAt) ?? new Date(0).toISOString(),
        };
    }

    function offerScopeRank(scopeType: string): number {
        if (scopeType === 'item') return 0;
        if (scopeType === 'type') return 1;
        if (scopeType === 'subscription') return 2;
        return 99;
    }

    function toOfferReadScope(assetEntitlementScope: ReturnType<typeof getAssetEntitlementScope>): OfferReadScope | null {
        if (!assetEntitlementScope) {
            return null;
        }

        if (assetEntitlementScope.type === 'subscription') {
            return {
                scopeType: 'subscription',
                scopeRef: null
            };
        }

        if (typeof assetEntitlementScope.ref !== 'number') {
            return null;
        }

        return {
            scopeType: assetEntitlementScope.type,
            scopeRef: assetEntitlementScope.ref
        };
    }

    function serializeAssetForMcp(asset: {
        id: number;
        sourceAssetId: number | null;
        variantKey: string | null;
        transformSpec: unknown;
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
            sourceAssetId: asset.sourceAssetId ?? null,
            variantKey: asset.variantKey ?? null,
            transformSpec: asset.transformSpec && typeof asset.transformSpec === 'object'
                ? asset.transformSpec as Record<string, unknown>
                : null,
            filename: asset.filename,
            originalFilename: asset.originalFilename,
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
            byteHash: asset.byteHash ?? null,
            storageProvider: asset.storageProvider,
            accessMode: asset.accessMode,
            entitlementScope: getAssetEntitlementScope(asset),
            status: asset.status,
            metadata: asset.metadata && typeof asset.metadata === 'object'
                ? asset.metadata as Record<string, unknown>
                : {},
            uploaderActorId: asset.uploaderActorId ?? null,
            uploaderActorType: asset.uploaderActorType ?? null,
            uploaderActorSource: asset.uploaderActorSource ?? null,
            createdAt: asset.createdAt.toISOString(),
            updatedAt: asset.updatedAt.toISOString(),
            deletedAt: asset.deletedAt ? asset.deletedAt.toISOString() : null,
            relationships: {
                sourcePath: asset.sourceAssetId ? `/api/assets/${asset.sourceAssetId}` : null,
                derivativesPath: `/api/assets/${asset.id}/derivatives`,
            },
            delivery: {
                readSurface: 'rest',
                contentPath: `/api/assets/${asset.id}/content`,
                accessPath: asset.accessMode === 'signed' ? `/api/assets/${asset.id}/access` : null,
                requiresAuth: asset.accessMode !== 'public',
                requiresEntitlement: asset.accessMode === 'entitled',
                offersPath: asset.accessMode === 'entitled' ? `/api/assets/${asset.id}/offers` : null,
                signedTokenTtlSeconds: asset.accessMode === 'signed' ? getAssetSignedTtlSeconds() : null
            }
        };
    }

    function serializeReferenceUsageSummary(summary: ReferenceUsageSummary) {
        return {
            activeReferenceCount: summary.activeReferences.length,
            historicalReferenceCount: summary.historicalReferences.length,
            activeReferences: summary.activeReferences,
            historicalReferences: summary.historicalReferences
        };
    }

    function buildAssetRestReadGuide(asset: ReturnType<typeof serializeAssetForMcp>) {
        if (asset.accessMode === 'public') {
            return {
                method: 'GET',
                path: asset.delivery.contentPath,
                auth: 'none',
                note: 'This asset is publicly readable over the REST content endpoint.'
            };
        }

        if (asset.accessMode === 'signed') {
            return {
                method: 'POST',
                path: asset.delivery.accessPath,
                auth: 'api-key-or-session',
                issueTool: 'issue_asset_access',
                note: 'Issue a short-lived signed URL over REST or MCP before reading the asset bytes without a long-lived credential.'
            };
        }

        return {
            method: 'GET',
            path: asset.delivery.contentPath,
            auth: 'api-key-or-session',
            entitlementHeader: 'x-entitlement-id',
            offersPath: asset.delivery.offersPath,
            note: 'Entitlement-backed asset delivery remains REST-first. Discover offers, purchase one, and then read the content endpoint with an eligible entitlement.'
        };
    }

    function serializePendingReviewTaskForGuide(taskRow: Awaited<ReturnType<typeof WorkflowService.listPendingReviewTasks>>[number]) {
        return {
            task: {
                ...taskRow.task,
                createdAt: toOptionalIsoString(taskRow.task.createdAt),
                updatedAt: toOptionalIsoString(taskRow.task.updatedAt),
            },
            transition: {
                ...taskRow.transition,
                requiredRoles: Array.isArray(taskRow.transition.requiredRoles) ? taskRow.transition.requiredRoles : [],
            },
            workflow: taskRow.workflow,
            contentItem: taskRow.contentItem,
            contentType: taskRow.contentType,
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

server.tool(
    'create_domain',
    'Create a domain for first-contact bootstrap or multi-domain administration',
    {
        name: z.string().min(1).describe('Display name for the new domain'),
        hostname: z.string().min(1).describe('Unique hostname for the domain, e.g. docs.example.com'),
    },
    withMCPPolicy('tenant.create', () => ({ type: 'system' }), async ({ name, hostname }, extra) => {
        const principal = resolveMcpPrincipal(extra as McpRequestExtra | undefined);

        try {
            const domainCountResult = await db.execute(sql`SELECT COUNT(*)::int AS total FROM domains`);
            const domainCount = extractNumericCell(domainCountResult, ['total', 'count', '?column?']);

            if (domainCount > 0 && !isPlatformAdminActor(principal)) {
                return err('DOMAIN_CREATE_FORBIDDEN: Use a platform-admin actor such as a supervisor session, env-backed admin key, or local bootstrap admin to create additional domains.');
            }

            const [created] = await db.insert(domains).values({
                name,
                hostname,
            }).returning();

            await logAudit(created.id, 'create', 'domain', created.id, created);

            return okJson({
                id: created.id,
                name: created.name,
                hostname: created.hostname,
                createdAt: created.createdAt.toISOString(),
                bootstrap: domainCount === 0,
            });
        } catch (error) {
            if (isUniqueViolation(error, DOMAIN_HOSTNAME_CONSTRAINTS) || (error as { code?: string }).code === '23505') {
                return err(`DOMAIN_HOSTNAME_CONFLICT: Choose a different hostname than '${hostname}'.`);
            }

            return err(`Error creating domain: ${(error as Error).message}`);
        }
    }),
);

server.tool(
    'onboard_tenant',
    'Create a tenant domain and issue its first admin-capable API key in one step',
    {
        tenantName: z.string().min(1).describe('Display name for the tenant domain'),
        hostname: z.string().min(1).describe('Unique hostname for the tenant domain, e.g. epilomedia.example'),
        adminEmail: z.string().email().optional().describe('Optional operator contact email for audit context'),
        apiKeyName: z.string().min(1).optional().describe('Optional label for the initial API key'),
        scopes: z.array(z.string()).optional().describe('Optional initial scopes; defaults to admin'),
        expiresAt: z.string().optional().describe('Optional ISO expiry timestamp for the initial API key'),
        publicBaseUrl: z.string().optional().describe('Optional absolute public base URL used to populate API and MCP endpoints'),
    },
    withMCPPolicy('tenant.onboard', () => ({ type: 'system' }), async ({ tenantName, hostname, adminEmail, apiKeyName, scopes, expiresAt, publicBaseUrl }) => {
        let parsedExpiry: Date | null = null;
        if (expiresAt) {
            parsedExpiry = new Date(expiresAt);
            if (Number.isNaN(parsedExpiry.getTime())) {
                return err('INVALID_EXPIRES_AT: Provide expiresAt as an ISO-8601 date-time string.');
            }
        }

        let publicOrigin: string | null;
        try {
            publicOrigin = normalizePublicBaseUrl(publicBaseUrl);
        } catch {
            return err('INVALID_PUBLIC_BASE_URL: Provide publicBaseUrl as an absolute http(s) URL such as https://kb.lightheart.tech.');
        }

        try {
            const created = await onboardTenant({
                tenantName,
                hostname,
                apiKeyName,
                scopes,
                expiresAt: parsedExpiry
            });

            await logAudit(created.domain.id, 'create', 'domain', created.domain.id, {
                hostname: created.domain.hostname,
                onboardTenant: true,
                adminEmail: adminEmail ?? null,
                mcpTool: 'onboard_tenant'
            });
            await logAudit(created.domain.id, 'create', 'api_key', created.apiKey.id, {
                onboardTenant: true,
                authKeyCreated: true,
                scopes: created.scopes,
                name: created.apiKey.name,
                mcpTool: 'onboard_tenant'
            });

            return okJson({
                bootstrap: created.bootstrap,
                domain: {
                    id: created.domain.id,
                    name: created.domain.name,
                    hostname: created.domain.hostname,
                    createdAt: created.domain.createdAt.toISOString()
                },
                apiKey: {
                    id: created.apiKey.id,
                    name: created.apiKey.name,
                    keyPrefix: created.apiKey.keyPrefix,
                    scopes: created.scopes,
                    expiresAt: created.apiKey.expiresAt,
                    apiKey: created.plaintext
                },
                endpoints: buildRuntimeEndpoints(publicOrigin)
            });
        } catch (error) {
            if ((error as Error).message === 'EMPTY_ONBOARDING_SCOPES') {
                return err('INVALID_KEY_SCOPES: Provide at least one scope for the initial tenant API key.');
            }
            if ((error as Error).message.startsWith('Invalid scopes:')) {
                return err(`INVALID_KEY_SCOPES: ${(error as Error).message}`);
            }
            if (isUniqueViolation(error, DOMAIN_HOSTNAME_CONSTRAINTS) || (error as { code?: string }).code === '23505') {
                return err(`DOMAIN_HOSTNAME_CONFLICT: Choose a different hostname than '${hostname}'.`);
            }

            return err(`Error onboarding tenant: ${(error as Error).message}`);
        }
    }),
);

server.tool(
    'create_content_type',
    'Create a new content type schema',
    {
        name: z.string().describe('Name of the content type'),
        slug: z.string().describe('Unique slug for the content type'),
        kind: z.enum(['collection', 'singleton']).optional().describe('Collection or singleton/global content type'),
        description: z.string().optional().describe('Description of the content type'),
        schema: z.union([z.string(), z.record(z.string(), z.any())]).optional().describe('Canonical JSON schema definition as a string or object'),
        schemaManifest: z.union([z.string(), z.record(z.string(), z.any())]).optional().describe('Optional editor-oriented manifest that compiles into the canonical schema'),
        dryRun: z.boolean().optional().describe('If true, simulates the action without making changes')
    },
    withMCPPolicy('content.write', () => ({ type: 'system' }), async ({ name, slug, kind, description, schema, schemaManifest, dryRun }, extra, domainId) => {
        try {
            const normalizedKind = normalizeContentTypeKind(kind ?? 'collection');
            if (!normalizedKind) {
                return err(invalidContentTypeKindText(kind));
            }
            const schemaSource = resolveContentTypeSchemaSource({
                schema,
                schemaManifest
            }, { requireSource: true });
            if (!schemaSource.ok) {
                return err(validationFailureToText(schemaSource.failure));
            }

            if (dryRun) {
                return ok(`[Dry Run] Would create ${normalizedKind} content type '${name}' with slug '${slug}'`);
            }

            const [newItem] = await db.insert(contentTypes).values({
                domainId,
                name,
                slug,
                kind: normalizedKind,
                description,
                schemaManifest: schemaSource.value!.schemaManifest,
                schema: schemaSource.value!.schema
            }).returning();

            await logAudit(domainId, 'create', 'content_type', newItem.id, newItem);

            return ok(`Created content type '${newItem.name}' (ID: ${newItem.id})`);
        } catch (error) {
            if (isUniqueViolation(error, CONTENT_TYPE_SLUG_CONSTRAINTS)) {
                return err(`CONTENT_TYPE_SLUG_CONFLICT: Choose a different slug than '${slug}' or update the existing content type in this domain.`);
            }
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
    withMCPPolicy('content.read', () => ({ type: 'system' }), async ({ limit: rawLimit, offset: rawOffset }, extra, domainId) => {
        const limit = clampLimit(rawLimit);
        const offset = clampOffset(rawOffset);
        const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
            .from(contentTypes)
            .where(eq(contentTypes.domainId, domainId));
        const types = await db.select()
            .from(contentTypes)
            .where(eq(contentTypes.domainId, domainId))
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
    withMCPPolicy('content.read', (args) => ({ type: 'content_type', id: args.id }), async ({ id, slug }, extra, domainId) => {
        if (id === undefined && !slug) {
            return err("Must provide either 'id' or 'slug'");
        }

        const [type] = id !== undefined
            ? await db.select().from(contentTypes).where(and(eq(contentTypes.id, id), eq(contentTypes.domainId, domainId)))
            : await db.select().from(contentTypes).where(and(eq(contentTypes.slug, slug!), eq(contentTypes.domainId, domainId)));

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
        kind: z.enum(['collection', 'singleton']).optional(),
        description: z.string().optional(),
        schema: z.union([z.string(), z.record(z.string(), z.any())]).optional(),
        schemaManifest: z.union([z.string(), z.record(z.string(), z.any())]).optional(),
        dryRun: z.boolean().optional()
    },
    withMCPPolicy('content.write', (args) => ({ type: 'content_type', id: args.id }), async ({ id, name, slug, kind, description, schema, schemaManifest, dryRun }, extra, domainId) => {
        try {
            const normalizedKind = kind !== undefined ? (normalizeContentTypeKind(kind) ?? undefined) : undefined;
            if (kind !== undefined && !normalizedKind) {
                return err(invalidContentTypeKindText(kind));
            }
            const schemaSource = resolveContentTypeSchemaSource({
                schema,
                schemaManifest
            });
            if (!schemaSource.ok) {
                return err(validationFailureToText(schemaSource.failure));
            }
            const updateData = stripUndefined({
                name,
                slug,
                kind: normalizedKind,
                description,
                ...(schemaSource.value
                    ? {
                        schema: schemaSource.value.schema,
                        schemaManifest: schemaSource.value.schemaManifest
                    }
                    : {})
            });
            if (!hasDefinedValues({ name, slug, kind, description, schema, schemaManifest })) {
                return err('At least one update field is required (name, slug, kind, description, schema, schemaManifest).');
            }

            const [existing] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, id), eq(contentTypes.domainId, domainId)));
            if (!existing) {
                return err(`Content type ${id} not found`);
            }

            const targetKind = updateData.kind ?? existing.kind;
            if (isSingletonContentType(targetKind) && !isSingletonContentType(existing.kind)) {
                const itemCount = await countContentItemsForContentType(domainId, existing.id);
                if (itemCount > 1) {
                    return err(singletonContentTypeRequiresSingleItemText(existing, itemCount));
                }
            }

            if (dryRun) {
                return ok(`[Dry Run] Would update content type ${id}`);
            }

            const [updated] = await db.update(contentTypes)
                .set(updateData)
                .where(and(eq(contentTypes.id, id), eq(contentTypes.domainId, domainId)))
                .returning();

            if (!updated) {
                return err(`Content type ${id} not found`);
            }

            await logAudit(domainId, 'update', 'content_type', updated.id, updateData);

            return ok(`Updated content type '${updated.name}' (ID: ${updated.id})`);
        } catch (error) {
            if (isUniqueViolation(error, CONTENT_TYPE_SLUG_CONSTRAINTS)) {
                return err(`CONTENT_TYPE_SLUG_CONFLICT: Choose a different slug than '${slug ?? ''}' or update the existing content type in this domain.`);
            }
            return err(`Error updating content type: ${(error as Error).message}`);
        }
    }
    ));

server.tool(
    'list_globals',
    'List singleton/global content types and their current item',
    {
        draft: z.boolean().optional().describe('Return the working copy when true, otherwise prefer the latest published snapshot'),
        locale: z.string().optional().describe('Optional locale for locale-aware reads'),
        fallbackLocale: z.string().optional().describe('Optional fallback locale when localized fields do not contain locale')
    },
    withMCPPolicy('content.read', () => ({ type: 'system' }), async ({ draft, locale, fallbackLocale }, _extra, domainId) => {
        const localizedReadOptions = resolveLocalizedReadOptions(draft, locale, fallbackLocale);
        if ('error' in localizedReadOptions) {
            return err(localizedReadOptions.error);
        }

        const globalTypes = await listGlobalContentTypes(domainId);
        const rows = await Promise.all(globalTypes.map(async (contentType) => {
            const item = await getSingletonContentItem(domainId, contentType.id);
            return {
                contentType,
                item
            };
        }));
        const latestPublishedVersions = await getLatestPublishedVersionsForItems(
            rows.flatMap((row) => row.item && row.item.status !== 'published' ? [row.item.id] : [])
        );
        const entries = rows.map(({ contentType, item }) => ({
            contentType,
            item,
            publishedVersion: item ? latestPublishedVersions.get(item.id) ?? null : null,
            readView: item
                ? resolveContentItemReadView(
                    item,
                    contentType.schema,
                    localizedReadOptions,
                    latestPublishedVersions.get(item.id)
                )
                : null
        }));
        const enrichedReadViews = await attachContentItemEmbeddingReadiness(
            domainId,
            entries
                .filter((entry) => entry.item)
                .map((entry) => ({
                    item: entry.item!,
                    readView: entry.readView,
                    publishedVersion: entry.publishedVersion
                }))
        );
        let enrichedIndex = 0;
        const items = entries.map((entry) => ({
            contentType: entry.contentType,
            item: entry.item ? enrichedReadViews[enrichedIndex++] ?? null : null
        }));

        return okJson({ items, total: items.length });
    })
);

server.tool(
    'get_global',
    'Get a singleton/global content type by slug',
    {
        slug: z.string().describe('Slug of the singleton/global content type'),
        draft: z.boolean().optional().describe('Return the working copy when true, otherwise prefer the latest published snapshot'),
        locale: z.string().optional().describe('Optional locale for locale-aware reads'),
        fallbackLocale: z.string().optional().describe('Optional fallback locale when localized fields do not contain locale')
    },
    withMCPPolicy('content.read', (args) => ({ type: 'content_type', id: args.slug }), async ({ slug, draft, locale, fallbackLocale }, _extra, domainId) => {
        const localizedReadOptions = resolveLocalizedReadOptions(draft, locale, fallbackLocale);
        if ('error' in localizedReadOptions) {
            return err(localizedReadOptions.error);
        }

        const contentType = await getGlobalContentTypeBySlug(slug, domainId);
        if (!contentType) {
            return err(`GLOBAL_CONTENT_TYPE_NOT_FOUND: No singleton/global content type exists with slug '${slug}'.`);
        }

        const item = await getSingletonContentItem(domainId, contentType.id);
        const latestPublishedVersions = await getLatestPublishedVersionsForItems(
            item && item.status !== 'published' ? [item.id] : []
        );
        const readView = item
            ? resolveContentItemReadView(
                item,
                contentType.schema,
                localizedReadOptions,
                latestPublishedVersions.get(item.id)
            )
            : null;
        const [enrichedReadView] = item
            ? await attachContentItemEmbeddingReadiness(domainId, [{
                item,
                readView,
                publishedVersion: latestPublishedVersions.get(item.id) ?? null
            }])
            : [null];
        return okJson({
            contentType,
            item: enrichedReadView
        });
    })
);

server.tool(
    'update_global',
    'Create or update the singleton item for a global content type',
    {
        slug: z.string().describe('Slug of the singleton/global content type'),
        data: z.union([z.string(), z.record(z.string(), z.any())]).describe('JSON string or object conforming to the global schema'),
        status: z.enum(['draft', 'published', 'archived']).optional().describe('Optional lifecycle status'),
        dryRun: z.boolean().optional().describe('If true, simulates the action without making changes')
    },
    withMCPPolicy('content.write', (args) => ({ type: 'content_type', id: args.slug }), async ({ slug, data, status, dryRun }, _extra, domainId) => {
        const contentType = await getGlobalContentTypeBySlug(slug, domainId);
        if (!contentType) {
            return err(`GLOBAL_CONTENT_TYPE_NOT_FOUND: No singleton/global content type exists with slug '${slug}'.`);
        }

        const existing = await getSingletonContentItem(domainId, contentType.id);
        const singletonConflict = await findSingletonConflictText(domainId, contentType, existing?.id);
        if (singletonConflict) {
            return err(singletonConflict);
        }

        const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
        const validation = await validateContentDataAgainstSchema(contentType.schema, dataStr, domainId);
        if (validation) {
            return err(validationFailureToText(validation));
        }

        const activeWorkflow = await WorkflowService.getActiveWorkflow(domainId, contentType.id);
        if (!existing && activeWorkflow && status && status !== 'draft') {
            return err(`WORKFLOW_TRANSITION_FORBIDDEN: This global is governed by an active workflow. Create it as 'draft' and use workflow submission to request a transition.`);
        }

        if (existing && activeWorkflow && status && status !== existing.status) {
            return err(`WORKFLOW_TRANSITION_FORBIDDEN: This global is governed by an active workflow. You cannot manually change the status to '${status}'. Use workflow submission to request a transition.`);
        }

        const targetStatus = existing
            ? (status ?? existing.status)
            : (status ?? 'draft');

        if (dryRun) {
            return okJson({
                contentType,
                item: existing
                    ? {
                        ...existing,
                        data: dataStr,
                        status: targetStatus,
                        version: existing.version + 1
                    }
                    : {
                        id: 0,
                        contentTypeId: contentType.id,
                        data: dataStr,
                        status: targetStatus,
                        version: 1
                    }
            });
        }

        if (!existing) {
            const [created] = await db.insert(contentItems).values({
                domainId,
                contentTypeId: contentType.id,
                data: dataStr,
                status: targetStatus
            }).returning();

            await logAudit(domainId, 'create', 'content_item', created.id, created);
            return okJson({
                contentType,
                item: created
            });
        }

        const updated = await db.transaction(async (tx) => {
            await tx.insert(contentItemVersions).values({
                contentItemId: existing.id,
                version: existing.version,
                data: existing.data,
                status: existing.status,
                createdAt: existing.updatedAt
            });

            const [result] = await tx.update(contentItems)
                .set({
                    data: dataStr,
                    status: targetStatus,
                    version: existing.version + 1,
                    updatedAt: new Date()
                })
                .where(and(
                    eq(contentItems.id, existing.id),
                    eq(contentItems.domainId, domainId)
                ))
                .returning();

            return result;
        });

        await logAudit(domainId, 'update', 'content_item', updated.id, {
            data: dataStr,
            status: targetStatus
        });

        return okJson({
            contentType,
            item: updated
        });
    })
);

server.tool(
    'list_forms',
    'List form definitions in the current domain',
    {},
    withMCPPolicy('content.read', () => ({ type: 'system' }), async (_args, _extra, domainId) => {
        const forms = await listFormDefinitions(domainId);
        return okJson({ items: forms, total: forms.length });
    })
);

server.tool(
    'get_form',
    'Get a form definition by numeric id or public slug',
    {
        id: z.number().optional().describe('Numeric form definition id'),
        slug: z.string().optional().describe('Public form slug'),
        domainId: z.number().optional().describe('Optional domain id for public slug reads when bypassing the active MCP domain')
    },
    withMCPPolicy('content.read', () => ({ type: 'system' }), async ({ id, slug, domainId }, _extra, activeDomainId) => {
        if (id === undefined && !slug) {
            return err('FORM_IDENTIFIER_REQUIRED: Provide id or slug.');
        }

        const resolvedDomainId = domainId ?? activeDomainId;
        const form = id !== undefined
            ? await getFormDefinitionById(activeDomainId, id)
            : await getFormDefinitionBySlug(resolvedDomainId, slug as string);

        if (!form) {
            return err('FORM_DEFINITION_NOT_FOUND: No matching form definition exists in the current domain.');
        }

        return okJson(form);
    })
);

server.tool(
    'create_form',
    'Create a reusable form definition',
    {
        name: z.string().describe('Human-readable form name'),
        slug: z.string().describe('Unique public slug'),
        description: z.string().optional().describe('Optional description'),
        contentTypeId: z.number().describe('Target content type id'),
        fields: z.array(z.record(z.string(), z.any())).describe('Array of form field descriptors'),
        defaultData: z.record(z.string(), z.any()).optional().describe('Optional default payload merged into every submission'),
        active: z.boolean().optional().describe('Whether the form accepts submissions immediately'),
        publicRead: z.boolean().optional().describe('Whether the public form definition is readable without authentication'),
        submissionStatus: z.string().optional().describe('Initial content item status for form submissions'),
        workflowTransitionId: z.number().nullable().optional().describe('Optional workflow transition to auto-submit after creation'),
        requirePayment: z.boolean().optional().describe('Whether submissions require L402 payment using the target content type base price'),
        webhookUrl: z.string().optional().describe('Optional follow-up webhook URL'),
        webhookSecret: z.string().optional().describe('Optional webhook signing secret'),
        successMessage: z.string().optional().describe('Optional public-facing success message'),
        draftGeneration: z.object({
            targetContentTypeId: z.number().describe('Target content type for generated drafts'),
            agentSoul: z.string().describe('Lightweight SOUL/agent key for the draft pipeline'),
            defaultData: z.record(z.string(), z.any()).optional().describe('Default output fields merged before copied intake fields'),
            postGenerationWorkflowTransitionId: z.number().nullable().optional().describe('Optional workflow transition to submit the generated draft after creation'),
        }).nullable().optional().describe('Optional draft-generation pipeline config'),
    },
    withMCPPolicy('content.write', () => ({ type: 'system' }), async (args, _extra, domainId) => {
        try {
            const created = await createFormDefinition({
                domainId,
                ...args,
            });
            await logAudit(domainId, 'create', 'form_definition', created.id, {
                slug: created.slug,
                contentTypeId: created.contentTypeId,
            });
            return okJson(created);
        } catch (error) {
            if (error instanceof FormServiceError) {
                return err(formatFormError(error));
            }
            return err(`Error creating form: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'update_form',
    'Update a reusable form definition',
    {
        id: z.number().describe('Form definition id'),
        name: z.string().optional().describe('Optional updated form name'),
        slug: z.string().optional().describe('Optional updated slug'),
        description: z.string().optional().describe('Optional description'),
        contentTypeId: z.number().optional().describe('Optional target content type id'),
        fields: z.array(z.record(z.string(), z.any())).optional().describe('Optional replacement field array'),
        defaultData: z.record(z.string(), z.any()).optional().describe('Optional default payload merged into every submission'),
        active: z.boolean().optional().describe('Whether the form accepts submissions immediately'),
        publicRead: z.boolean().optional().describe('Whether the public form definition is readable without authentication'),
        submissionStatus: z.string().optional().describe('Initial content item status for form submissions'),
        workflowTransitionId: z.number().nullable().optional().describe('Optional workflow transition to auto-submit after creation'),
        requirePayment: z.boolean().optional().describe('Whether submissions require L402 payment using the target content type base price'),
        webhookUrl: z.string().nullable().optional().describe('Optional follow-up webhook URL'),
        webhookSecret: z.string().nullable().optional().describe('Optional webhook signing secret'),
        successMessage: z.string().nullable().optional().describe('Optional public-facing success message'),
        draftGeneration: z.object({
            targetContentTypeId: z.number().describe('Target content type for generated drafts'),
            agentSoul: z.string().describe('Lightweight SOUL/agent key for the draft pipeline'),
            defaultData: z.record(z.string(), z.any()).optional().describe('Default output fields merged before copied intake fields'),
            postGenerationWorkflowTransitionId: z.number().nullable().optional().describe('Optional workflow transition to submit the generated draft after creation'),
        }).nullable().optional().describe('Optional draft-generation pipeline config'),
    },
    withMCPPolicy('content.write', (args) => ({ type: 'system', id: args.id }), async ({ id, ...args }, _extra, domainId) => {
        try {
            const updated = await updateFormDefinition(id, {
                domainId,
                ...args,
            });
            await logAudit(domainId, 'update', 'form_definition', updated.id, {
                slug: updated.slug,
                contentTypeId: updated.contentTypeId,
            });
            return okJson(updated);
        } catch (error) {
            if (error instanceof FormServiceError) {
                return err(formatFormError(error));
            }
            return err(`Error updating form: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'delete_form',
    'Delete a reusable form definition',
    {
        id: z.number().describe('Form definition id')
    },
    withMCPPolicy('content.write', (args) => ({ type: 'system', id: args.id }), async ({ id }, _extra, domainId) => {
        const deleted = await deleteFormDefinition(domainId, id);
        if (!deleted) {
            return err(`FORM_DEFINITION_NOT_FOUND: No form definition exists with id ${id} in the current domain.`);
        }

        await logAudit(domainId, 'delete', 'form_definition', deleted.id, {
            slug: deleted.slug,
            contentTypeId: deleted.contentTypeId,
        });
        return okJson(deleted);
    })
);

server.tool(
    'submit_form',
    'Submit a form payload into its target content type',
    {
        slug: z.string().describe('Public form slug'),
        data: z.record(z.string(), z.any()).describe('Submission payload'),
        domainId: z.number().optional().describe('Optional domain id override for public-style submissions')
    },
    withMCPPolicy('content.write', () => ({ type: 'system' }), async ({ slug, data, domainId }, extra, activeDomainId) => {
        try {
            const resolvedDomainId = domainId ?? activeDomainId;
            const principal = resolveMcpPrincipal(extra);
            const submitted = await submitFormDefinition(resolvedDomainId, slug, {
                data,
                request: {
                    requestId: undefined,
                    userAgent: 'mcp',
                    ip: undefined,
                    headers: undefined,
                }
            });
            await logAudit(resolvedDomainId, 'create', 'content_item', submitted.item.id, {
                source: 'submit_form',
                formId: submitted.form.id,
                formSlug: submitted.form.slug,
                reviewTaskId: submitted.reviewTaskId,
                actorId: principal.actorId,
            });
            return okJson({
                form: submitted.form,
                item: submitted.item,
                reviewTaskId: submitted.reviewTaskId,
                draftGenerationJobId: submitted.draftGenerationJob?.id ?? null,
            });
        } catch (error) {
            if (error instanceof FormServiceError) {
                return err(formatFormError(error));
            }
            return err(`Error submitting form: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'list_jobs',
    'List background jobs in the current domain',
    {
        status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']).optional().describe('Optional job status filter'),
        kind: z.enum(['content_status_transition', 'outbound_webhook', 'draft_generation']).optional().describe('Optional job kind filter'),
        limit: z.number().optional().describe('Maximum rows to return'),
        offset: z.number().optional().describe('Offset into the job list')
    },
    withMCPPolicy('content.read', () => ({ type: 'system' }), async ({ status, kind, limit, offset }, _extra, domainId) => {
        const rows = await listJobs(domainId, { status, kind, limit, offset });
        return okJson({ items: rows.map((row) => serializeJob(row)), total: rows.length });
    })
);

server.tool(
    'get_job',
    'Get one background job by id',
    {
        id: z.number().describe('Job id')
    },
    withMCPPolicy('content.read', (args) => ({ type: 'system', id: args.id }), async ({ id }, _extra, domainId) => {
        const job = await getJob(domainId, id);
        if (!job) {
            return err(`JOB_NOT_FOUND: No background job exists with id ${id} in the current domain.`);
        }

        return okJson(serializeJob(job));
    })
);

server.tool(
    'create_job',
    'Create a generic background job',
    {
        kind: z.enum(['content_status_transition', 'outbound_webhook', 'draft_generation']).describe('Job kind'),
        payload: z.record(z.string(), z.any()).describe('Job payload'),
        queue: z.string().optional().describe('Optional queue name'),
        runAt: z.string().optional().describe('Optional ISO-8601 scheduled time'),
        maxAttempts: z.number().optional().describe('Optional retry limit')
    },
    withMCPPolicy('content.write', () => ({ type: 'system' }), async ({ kind, payload, queue, runAt, maxAttempts }, _extra, domainId) => {
        try {
            const created = await createJob({
                domainId,
                kind,
                payload: payload as never,
                queue,
                runAt: runAt ? new Date(runAt) : undefined,
                maxAttempts,
            });
            await logAudit(domainId, 'create', 'job', created.id, {
                kind: created.kind,
                queue: created.queue,
                runAt: created.runAt.toISOString(),
            });
            return okJson(serializeJob(created));
        } catch (error) {
            return err(`Error creating job: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'cancel_job',
    'Cancel a queued background job',
    {
        id: z.number().describe('Job id')
    },
    withMCPPolicy('content.write', (args) => ({ type: 'system', id: args.id }), async ({ id }, _extra, domainId) => {
        const cancelled = await cancelJob(domainId, id);
        if (!cancelled) {
            return err(`JOB_CANCEL_FORBIDDEN: Only queued jobs can be cancelled, or job ${id} does not exist.`);
        }

        return okJson(serializeJob(cancelled));
    })
);

server.tool(
    'schedule_content_status_change',
    'Schedule a future content item status transition through the jobs lane',
    {
        id: z.number().describe('Content item id'),
        status: z.string().describe('Target status such as published or archived'),
        runAt: z.string().describe('ISO-8601 time when the status change should execute'),
        maxAttempts: z.number().optional().describe('Optional retry limit')
    },
    withMCPPolicy('content.write', (args) => ({ type: 'content_item', id: args.id }), async ({ id, status, runAt, maxAttempts }, _extra, domainId) => {
        const scheduled = await scheduleContentStatusTransition({
            domainId,
            contentItemId: id,
            targetStatus: status,
            runAt: new Date(runAt),
            maxAttempts,
        });
        await logAudit(domainId, 'create', 'job', scheduled.id, {
            source: 'schedule_content_status',
            contentItemId: id,
            targetStatus: status,
            runAt,
        });
        return okJson(serializeJob(scheduled));
    })
);

server.tool(
    'delete_content_type',
    'Delete a content type',
    {
        id: z.number().describe('ID of the content type to delete'),
        dryRun: z.boolean().optional()
    },
    withMCPPolicy('content.write', (args) => ({ type: 'content_type', id: args.id }), async ({ id, dryRun }, extra, domainId) => {
        try {
            if (dryRun) {
                return ok(`[Dry Run] Would delete content type ${id}`);
            }

            const [deleted] = await db.delete(contentTypes)
                .where(and(eq(contentTypes.id, id), eq(contentTypes.domainId, domainId)))
                .returning();

            if (!deleted) {
                return err(`Content type ${id} not found`);
            }

            await logAudit(domainId, 'delete', 'content_type', deleted.id, deleted);

            return ok(`Deleted content type '${deleted.name}' (ID: ${deleted.id})`);
        } catch (error) {
            return err(`Error deleting content type: ${(error as Error).message}`);
        }
    }
    ));

server.tool(
    'create_asset',
    'Upload a new media asset',
    {
        filename: z.string().describe('Storage filename for the asset'),
        originalFilename: z.string().optional().describe('Original source filename'),
        mimeType: z.string().describe('MIME type such as image/png'),
        contentBase64: z.string().describe('Asset bytes encoded as base64'),
        accessMode: z.enum(['public', 'signed', 'entitled']).optional().describe('Access mode for the asset'),
        sourceAssetId: z.number().optional().describe('Optional source asset ID when creating a derivative variant'),
        variantKey: z.string().optional().describe('Required derivative variant key when sourceAssetId is set'),
        transformSpec: z.record(z.string(), z.any()).optional().describe('Optional derivative transform metadata such as width, height, format, or fit'),
        entitlementScope: z.object({
            type: z.enum(['item', 'type', 'subscription']),
            ref: z.number().optional()
        }).optional().describe('Required when accessMode is entitled'),
        metadata: z.record(z.string(), z.any()).optional().describe('Optional metadata object')
    },
    withMCPPolicy('content.write', () => ({ type: 'system' }), async (args, extra, domainId) => {
        try {
            const principal = resolveMcpPrincipal(extra);
            const created = await createAsset({
                domainId,
                filename: args.filename,
                originalFilename: args.originalFilename,
                mimeType: args.mimeType,
                contentBase64: args.contentBase64,
                accessMode: args.accessMode,
                sourceAssetId: args.sourceAssetId,
                variantKey: args.variantKey,
                transformSpec: args.transformSpec,
                entitlementScope: args.entitlementScope,
                metadata: args.metadata,
                actor: {
                    actorId: principal.actorId,
                    actorType: principal.actorType,
                    actorSource: principal.actorSource
                }
            });

            return okJson({
                asset: serializeAssetForMcp(created),
                recommendedNextAction: 'Use get_asset or get_asset_access to inspect delivery and attachment guidance.'
            });
        } catch (error) {
            if (error instanceof AssetListError) {
                return err(formatAssetError(error));
            }
            if (error instanceof AssetStorageError) {
                return err(`${error.code}: ${error.message}. ${error.remediation}`);
            }

            return err(`Error creating asset: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'issue_direct_asset_upload',
    'Issue a direct provider upload URL for S3-compatible asset storage and return a completion token',
    {
        filename: z.string().describe('Storage filename for the asset'),
        originalFilename: z.string().optional().describe('Original source filename'),
        mimeType: z.string().describe('MIME type such as image/png'),
        accessMode: z.enum(['public', 'signed', 'entitled']).optional().describe('Access mode for the asset'),
        sourceAssetId: z.number().optional().describe('Optional source asset ID when creating a derivative variant'),
        variantKey: z.string().optional().describe('Required derivative variant key when sourceAssetId is set'),
        transformSpec: z.record(z.string(), z.any()).optional().describe('Optional derivative transform metadata such as width, height, format, or fit'),
        entitlementScope: z.object({
            type: z.enum(['item', 'type', 'subscription']),
            ref: z.number().optional()
        }).optional().describe('Required when accessMode is entitled'),
        metadata: z.record(z.string(), z.any()).optional().describe('Optional metadata object'),
        ttlSeconds: z.number().optional().describe('Optional direct upload lifetime in seconds (60-3600)')
    },
    withMCPPolicy('content.write', () => ({ type: 'system' }), async (args, _extra, domainId) => {
        try {
            const issued = await issueDirectAssetUpload({
                domainId,
                filename: args.filename,
                originalFilename: args.originalFilename,
                mimeType: args.mimeType,
                accessMode: args.accessMode,
                sourceAssetId: args.sourceAssetId,
                variantKey: args.variantKey,
                transformSpec: args.transformSpec,
                entitlementScope: args.entitlementScope,
                metadata: args.metadata,
                ttlSeconds: args.ttlSeconds,
            });

            return okJson({
                provider: issued.provider,
                upload: {
                    method: issued.upload.method,
                    uploadUrl: issued.upload.uploadUrl,
                    uploadHeaders: issued.upload.uploadHeaders,
                    expiresAt: issued.upload.expiresAt.toISOString(),
                    ttlSeconds: issued.upload.ttlSeconds,
                },
                finalize: {
                    path: issued.finalize.path,
                    token: issued.finalize.token,
                    expiresAt: issued.finalize.expiresAt.toISOString(),
                },
                recommendedNextAction: 'Upload the bytes to the provider URL, then call complete_direct_asset_upload with the returned token.'
            });
        } catch (error) {
            if (error instanceof AssetListError) {
                return err(formatAssetError(error));
            }
            if (error instanceof AssetStorageError) {
                return err(`${error.code}: ${error.message}. ${error.remediation}`);
            }

            return err(`Error issuing direct asset upload: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'complete_direct_asset_upload',
    'Finalize a previously issued direct provider upload and materialize the asset record',
    {
        token: z.string().describe('Completion token returned by issue_direct_asset_upload')
    },
    withMCPPolicy('content.write', () => ({ type: 'system' }), async ({ token }, extra, domainId) => {
        try {
            const principal = resolveMcpPrincipal(extra);
            const completed = await completeDirectAssetUpload(token, domainId, {
                actorId: principal.actorId,
                actorType: principal.actorType,
                actorSource: principal.actorSource
            });

            return okJson({
                asset: serializeAssetForMcp(completed),
                recommendedNextAction: 'Use get_asset or get_asset_access to inspect delivery and attachment guidance.'
            });
        } catch (error) {
            if (error instanceof AssetListError) {
                return err(formatAssetError(error));
            }
            if (error instanceof AssetStorageError) {
                return err(`${error.code}: ${error.message}. ${error.remediation}`);
            }

            return err(`Error completing direct asset upload: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'list_assets',
    'List assets with optional filters and cursor pagination',
    {
        q: z.string().optional().describe('Search by filename, original filename, mime type, or asset ID'),
        accessMode: z.enum(['public', 'signed', 'entitled']).optional().describe('Filter by asset access mode'),
        status: z.enum(['active', 'deleted']).optional().describe('Filter by asset status'),
        sourceAssetId: z.number().optional().describe('Filter derivatives by source asset ID'),
        limit: z.number().optional().describe('Page size (default 50, max 500)'),
        offset: z.number().optional().describe('Row offset (default 0)'),
        cursor: z.string().optional().describe('Cursor returned by a previous list_assets page')
    },
    withMCPPolicy('content.read', () => ({ type: 'system' }), async ({ q, accessMode, status, sourceAssetId, limit: rawLimit, offset: rawOffset, cursor }, extra, domainId) => {
        try {
            const result = await listAssets(domainId, {
                q,
                accessMode,
                status,
                sourceAssetId,
                limit: clampLimit(rawLimit),
                offset: cursor ? rawOffset : clampOffset(rawOffset),
                cursor
            });

            return okJson({
                items: result.items.map((asset) => serializeAssetForMcp(asset)),
                total: result.total,
                limit: result.limit,
                ...(result.offset !== undefined ? { offset: result.offset } : {}),
                hasMore: result.hasMore,
                nextCursor: result.nextCursor
            });
        } catch (error) {
            if (error instanceof AssetListError) {
                return err(formatAssetError(error));
            }

            return err(`Error listing assets: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'list_asset_derivatives',
    'List derivative variants for a source asset',
    {
        id: z.number().describe('Source asset ID'),
        status: z.enum(['active', 'deleted']).optional().describe('Optional derivative status filter'),
    },
    withMCPPolicy('content.read', (args) => ({ type: 'asset', id: args.id }), async ({ id, status }, _extra, domainId) => {
        const asset = await getAsset(id, domainId, { includeDeleted: status === 'deleted' });
        if (!asset) {
            return err(`ASSET_NOT_FOUND: Asset ${id} not found in the current domain.`);
        }

        const derivatives = await listAssetDerivatives(id, domainId, {
            includeDeleted: status === 'deleted',
        });

        return okJson({
            sourceAsset: serializeAssetForMcp(asset),
            items: derivatives.map((candidate) => serializeAssetForMcp(candidate)),
            total: derivatives.length,
            status: status ?? 'active',
        });
    })
);

server.tool(
    'get_asset',
    'Get a single asset by ID',
    {
        id: z.number().describe('Asset ID')
    },
    withMCPPolicy('content.read', (args) => ({ type: 'asset', id: args.id }), async ({ id }, extra, domainId) => {
        const asset = await getAsset(id, domainId);
        if (!asset) {
            return err(`ASSET_NOT_FOUND: Asset ${id} not found in the current domain.`);
        }

        return okJson(serializeAssetForMcp(asset));
    })
);

server.tool(
    'get_asset_usage',
    'Inspect which content currently or historically references an asset',
    {
        id: z.number().describe('Asset ID')
    },
    withMCPPolicy('content.read', (args) => ({ type: 'asset', id: args.id }), async ({ id }, _extra, domainId) => {
        const asset = await getAsset(id, domainId, { includeDeleted: true });
        if (!asset) {
            return err(`ASSET_NOT_FOUND: Asset ${id} not found in the current domain.`);
        }

        const usage = await findAssetUsage(domainId, id);
        return okJson({
            asset: serializeAssetForMcp(asset),
            usage: serializeReferenceUsageSummary(usage),
            recommendedNextAction: 'Inspect the referencing content items before deleting or purging this asset.'
        });
    })
);

server.tool(
    'get_asset_access',
    'Describe how the current asset should be read or licensed',
    {
        id: z.number().describe('Asset ID')
    },
    withMCPPolicy('content.read', (args) => ({ type: 'asset', id: args.id }), async ({ id }, extra, domainId) => {
        const asset = await getAsset(id, domainId);
        if (!asset) {
            return err(`ASSET_NOT_FOUND: Asset ${id} not found in the current domain.`);
        }

        const serializedAsset = serializeAssetForMcp(asset);
        const access = buildAssetRestReadGuide(serializedAsset);
        const entitlementScope = toOfferReadScope(getAssetEntitlementScope(asset));

        if (serializedAsset.accessMode !== 'entitled') {
            return okJson({
                asset: serializedAsset,
                readSurface: 'rest',
                access,
                offers: [],
                note: serializedAsset.accessMode === 'public'
                    ? 'The asset is readable directly from REST.'
                    : 'The asset remains metadata-first over MCP; use the authenticated REST endpoint to fetch bytes.'
            });
        }

        if (!entitlementScope) {
            return err('ASSET_ENTITLEMENT_UNAVAILABLE: Configure a valid entitlement scope before using entitlement-backed asset delivery.');
        }

        const offers = await LicensingService.getActiveOffersForReadScope(domainId, entitlementScope);
        offers.sort((left, right) => offerScopeRank(left.scopeType) - offerScopeRank(right.scopeType));

        return okJson({
            asset: serializedAsset,
            readSurface: 'rest',
            access,
            offers,
            note: offers.length > 0
                ? 'Purchase an offer over REST and read the asset bytes through GET /api/assets/:id/content.'
                : 'This asset is entitled, but no active offer currently matches its entitlement scope.'
        });
    })
);

server.tool(
    'issue_asset_access',
    'Issue a short-lived signed access URL for signed assets, or return direct guidance for public assets',
    {
        id: z.number().describe('Asset ID'),
        ttlSeconds: z.number().optional().describe('Optional token lifetime in seconds (30-3600)')
    },
    withMCPPolicy('content.read', (args) => ({ type: 'asset', id: args.id }), async ({ id, ttlSeconds }, _extra, domainId) => {
        const asset = await getAsset(id, domainId);
        if (!asset) {
            return err(`ASSET_NOT_FOUND: Asset ${id} not found in the current domain.`);
        }

        const serializedAsset = serializeAssetForMcp(asset);
        if (asset.accessMode === 'public') {
            return okJson({
                asset: serializedAsset,
                access: {
                    mode: 'public',
                    method: 'GET',
                    contentPath: serializedAsset.delivery.contentPath,
                    signedUrl: null,
                    token: null,
                    expiresAt: null,
                    ttlSeconds: null,
                    note: 'This asset is already publicly readable over REST.'
                }
            });
        }

        if (asset.accessMode !== 'signed') {
            return err(`ASSET_ACCESS_ISSUE_UNSUPPORTED: Asset ${id} uses ${asset.accessMode} delivery. Use get_asset_access for entitlement guidance instead.`);
        }

        const issued = issueSignedAssetAccess({
            assetId: asset.id,
            domainId: asset.domainId,
            ttlSeconds
        });

        return okJson({
            asset: serializedAsset,
            access: {
                mode: 'signed',
                method: 'GET',
                contentPath: serializedAsset.delivery.contentPath,
                signedUrl: `${serializedAsset.delivery.contentPath}?token=${encodeURIComponent(issued.token)}`,
                token: issued.token,
                expiresAt: issued.expiresAt.toISOString(),
                ttlSeconds: issued.ttlSeconds,
                note: 'Use the signed URL before it expires. The token is scoped to this asset and domain.'
            }
        });
    })
);

server.tool(
    'delete_asset',
    'Soft-delete an asset so it can no longer be newly referenced',
    {
        id: z.number().describe('Asset ID')
    },
    withMCPPolicy('content.write', (args) => ({ type: 'asset', id: args.id }), async ({ id }, extra, domainId) => {
        const principal = resolveMcpPrincipal(extra);
        const deleted = await softDeleteAsset(id, domainId, {
            actorId: principal.actorId,
            actorType: principal.actorType,
            actorSource: principal.actorSource
        });

        if (!deleted) {
            return err(`ASSET_NOT_FOUND: Asset ${id} not found in the current domain.`);
        }

        return okJson({
            asset: serializeAssetForMcp(deleted),
            recommendedNextAction: 'Historical content can still reference this asset, but new references should stop using it.'
        });
    })
);

server.tool(
    'restore_asset',
    'Restore a soft-deleted asset back to active status',
    {
        id: z.number().describe('Asset ID')
    },
    withMCPPolicy('content.write', (args) => ({ type: 'asset', id: args.id }), async ({ id }, extra, domainId) => {
        try {
            const principal = resolveMcpPrincipal(extra);
            const restored = await restoreAsset(id, domainId, {
                actorId: principal.actorId,
                actorType: principal.actorType,
                actorSource: principal.actorSource
            });

            if (!restored) {
                return err(`ASSET_NOT_FOUND: Asset ${id} not found in the current domain.`);
            }

            return okJson({
                asset: serializeAssetForMcp(restored),
                recommendedNextAction: 'Inspect the restored asset or resume attaching it to content.'
            });
        } catch (error) {
            if (error instanceof AssetListError) {
                return err(formatAssetError(error));
            }

            return err(`Error restoring asset: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'purge_asset',
    'Permanently remove a soft-deleted asset after confirming it is no longer referenced',
    {
        id: z.number().describe('Asset ID')
    },
    withMCPPolicy('content.write', (args) => ({ type: 'asset', id: args.id }), async ({ id }, extra, domainId) => {
        const principal = resolveMcpPrincipal(extra);
        if (!principal.scopes.has('admin') && !principal.scopes.has('tenant:admin')) {
            return err('ADMIN_REQUIRED: Use an actor with the admin scope before purging an asset.');
        }

        try {
            const purged = await purgeAsset(id, domainId, {
                actorId: principal.actorId,
                actorType: principal.actorType,
                actorSource: principal.actorSource
            });

            if (!purged) {
                return err(`ASSET_NOT_FOUND: Asset ${id} not found in the current domain.`);
            }

            return okJson({
                purged: true,
                asset: serializeAssetForMcp(purged.asset),
                referenceSummary: {
                    activeReferenceCount: purged.usage.activeReferences.length,
                    historicalReferenceCount: purged.usage.historicalReferences.length
                },
                recommendedNextAction: 'The asset bytes and metadata are permanently removed.'
            });
        } catch (error) {
            if (error instanceof AssetListError) {
                return err(formatAssetError(error));
            }

            return err(`Error purging asset: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'create_api_key',
    'Create a new API key for agent authentication',
    {
        name: z.string().describe('Human-readable name'),
        scopes: z.array(z.string()).describe('Scopes such as content:read|content:write|audit:read|admin'),
        expiresAt: z.string().optional().describe('Optional ISO expiry timestamp')
    },
    withMCPPolicy('apikey.write', () => ({ type: 'system' }), async ({ name, scopes, expiresAt }, extra, domainId) => {
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
                domainId, name,
                scopes: normalizedScopes,
                expiresAt: parsedExpiry
            });

            await logAudit(domainId, 'create', 'api_key', key.id, {
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
    withMCPPolicy('apikey.list', () => ({ type: 'system' }), async (_args, _extra, domainId) => {
        const keys = await listApiKeys(domainId);
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
    withMCPPolicy('apikey.write', (args) => ({ type: 'apikey', id: args.id }), async ({ id }, extra, domainId) => {
        const revoked = await revokeApiKey(id, domainId);
        if (!revoked) {
            return err(`API key ${id} not found or already revoked`);
        }

        await logAudit(domainId, 'delete', 'api_key', revoked.id, {
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
    withMCPPolicy('webhook.write', () => ({ type: 'system' }), async ({ url, events, secret, active }, extra, domainId) => {
        try {
            if (!await isSafeWebhookUrl(url)) {
                return err('INVALID_WEBHOOK_URL: Provide a valid absolute URL.');
            }

            let normalizedEvents: string[];
            try {
                normalizedEvents = normalizeWebhookEvents(events);
            } catch (error) {
                return err(`INVALID_WEBHOOK_EVENTS: ${(error as Error).message}`);
            }

            const created = await createWebhook({
                domainId, url,
                events: normalizedEvents,
                secret,
                active
            });

            await logAudit(domainId, 'create', 'webhook', created.id, {
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
    withMCPPolicy('webhook.list', () => ({ type: 'system' }), async (_args, _extra, domainId) => {
        try {
            const hooks = await listWebhooks(domainId);
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
    withMCPPolicy('webhook.list', (args) => ({ type: 'webhook', id: args.id }), async ({ id }, extra, domainId) => {
        try {
            const hook = await getWebhookById(id, domainId);
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
    withMCPPolicy('webhook.write', (args) => ({ type: 'webhook', id: args.id }), async ({ id, url, events, secret, active }, extra, domainId) => {
        try {
            if (url !== undefined && !await isSafeWebhookUrl(url)) {
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

            const updated = await updateWebhook(id, domainId, {
                url,
                events: normalizedEvents,
                secret,
                active
            });

            if (!updated) {
                return err(`WEBHOOK_NOT_FOUND: Webhook ${id} not found`);
            }

            await logAudit(domainId, 'update', 'webhook', updated.id, {
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
    withMCPPolicy('webhook.write', (args) => ({ type: 'webhook', id: args.id }), async ({ id }, extra, domainId) => {
        try {
            const existing = await getWebhookById(id, domainId);
            if (!existing) {
                return err(`WEBHOOK_NOT_FOUND: Webhook ${id} not found`);
            }

            await deleteWebhook(id, domainId);
            await logAudit(domainId, 'delete', 'webhook', existing.id, {
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
    withMCPPolicy('content.write', (args) => ({ type: 'content_type', id: args.contentTypeId }), async ({ contentTypeId, data, status, dryRun }, extra, domainId) => {
        try {
            const [contentType] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, contentTypeId), eq(contentTypes.domainId, domainId)));
            if (!contentType) {
                return err(`Content type ${contentTypeId} not found`);
            }

            const singletonConflict = await findSingletonConflictText(domainId, contentType);
            if (singletonConflict) {
                return err(singletonConflict);
            }

            const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
            const contentFailure = await validateContentDataAgainstSchema(contentType.schema, dataStr, domainId);
            if (contentFailure) {
                return err(validationFailureToText(contentFailure));
            }

            if (dryRun) {
                return ok(`[Dry Run] Would create content item for type ${contentTypeId} with status '${status || 'draft'}'`);
            }

            const [newItem] = await db.insert(contentItems).values({
                domainId,
                contentTypeId,
                data: dataStr,
                status: status || 'draft'
            }).returning();

            await logAudit(domainId, 'create', 'content_item', newItem.id, newItem);

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
    withMCPPolicy('content.write', () => ({ type: 'batch' }), async ({ items, atomic, dryRun }, extra, domainId) => {
        if (items.length === 0) {
            return err('EMPTY_BATCH: Provide at least one item.');
        }

        const buildItemError = (index: number, code: string, errorText: string) => ({ index, ok: false, code, error: errorText });
        const isAtomic = atomic === true;
        const plannedSingletonAssignments = new Map<number, number>();

        if (dryRun) {
            const results: Array<Record<string, unknown>> = [];
            for (const [index, item] of items.entries()) {
                const [contentType] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, item.contentTypeId), eq(contentTypes.domainId, domainId)));
                if (!contentType) {
                    results.push(buildItemError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${item.contentTypeId} not found`));
                    continue;
                }

                const itemDataStr = typeof item.data === 'string' ? item.data : JSON.stringify(item.data);
                const validation = await validateContentDataAgainstSchema(contentType.schema, itemDataStr, domainId);
                if (validation) {
                    results.push(buildItemError(index, validation.code, validation.error));
                    continue;
                }

                if (isSingletonContentType(contentType.kind)) {
                    const conflict = await findSingletonContentConflict(domainId, item.contentTypeId);
                    if (conflict) {
                        results.push(buildItemError(index, 'SINGLETON_CONTENT_ITEM_EXISTS', `Singleton content type '${contentType.slug}' already uses content item ${conflict.id}`));
                        continue;
                    }

                    const reservedBy = plannedSingletonAssignments.get(item.contentTypeId);
                    if (reservedBy !== undefined) {
                        results.push(buildItemError(index, 'SINGLETON_CONTENT_ITEM_EXISTS', `Singleton content type '${contentType.slug}' is already targeted by batch item ${reservedBy}.`));
                        continue;
                    }
                    plannedSingletonAssignments.set(item.contentTypeId, index);
                }

                results.push({
                    index,
                    ok: true,
                    id: 0,
                    version: 1
                });
            }

            return okJson({ atomic: isAtomic, results });
        }

        if (isAtomic) {
            try {
                const results = await db.transaction(async (tx) => {
                    const output: Array<Record<string, unknown>> = [];
                    const singletonAssignments = new Map<number, number>();

                    for (const [index, item] of items.entries()) {
                        const [contentType] = await tx.select().from(contentTypes).where(and(eq(contentTypes.id, item.contentTypeId), eq(contentTypes.domainId, domainId)));
                        if (!contentType) {
                            throw new Error(JSON.stringify(buildItemError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${item.contentTypeId} not found`)));
                        }

                        const itemDataStr = typeof item.data === 'string' ? item.data : JSON.stringify(item.data);
                        const validation = await validateContentDataAgainstSchema(contentType.schema, itemDataStr, domainId);
                        if (validation) {
                            throw new Error(JSON.stringify(buildItemError(index, validation.code, validation.error)));
                        }

                        if (isSingletonContentType(contentType.kind)) {
                            const [conflict] = await tx.select({ id: contentItems.id })
                                .from(contentItems)
                                .where(and(
                                    eq(contentItems.domainId, domainId),
                                    eq(contentItems.contentTypeId, item.contentTypeId)
                                ));
                            if (conflict) {
                                throw new Error(JSON.stringify(buildItemError(index, 'SINGLETON_CONTENT_ITEM_EXISTS', `Singleton content type '${contentType.slug}' already uses content item ${conflict.id}`)));
                            }

                            const reservedBy = singletonAssignments.get(item.contentTypeId);
                            if (reservedBy !== undefined) {
                                throw new Error(JSON.stringify(buildItemError(index, 'SINGLETON_CONTENT_ITEM_EXISTS', `Singleton content type '${contentType.slug}' is already targeted by batch item ${reservedBy}.`)));
                            }
                            singletonAssignments.set(item.contentTypeId, index);
                        }

                        const [created] = await tx.insert(contentItems).values({
                            domainId,
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
                        await logAudit(domainId, 'create', 'content_item', id, { batch: true, mode: 'atomic' });
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
        const singletonAssignments = new Map<number, number>();
        for (const [index, item] of items.entries()) {
            try {
                const [contentType] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, item.contentTypeId), eq(contentTypes.domainId, domainId)));
                if (!contentType) {
                    results.push(buildItemError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${item.contentTypeId} not found`));
                    continue;
                }

                const itemDataStr = typeof item.data === 'string' ? item.data : JSON.stringify(item.data);
                const validation = await validateContentDataAgainstSchema(contentType.schema, itemDataStr, domainId);
                if (validation) {
                    results.push(buildItemError(index, validation.code, validation.error));
                    continue;
                }

                if (isSingletonContentType(contentType.kind)) {
                    const conflict = await findSingletonContentConflict(domainId, item.contentTypeId);
                    if (conflict) {
                        results.push(buildItemError(index, 'SINGLETON_CONTENT_ITEM_EXISTS', `Singleton content type '${contentType.slug}' already uses content item ${conflict.id}`));
                        continue;
                    }

                    const reservedBy = singletonAssignments.get(item.contentTypeId);
                    if (reservedBy !== undefined) {
                        results.push(buildItemError(index, 'SINGLETON_CONTENT_ITEM_EXISTS', `Singleton content type '${contentType.slug}' is already targeted by batch item ${reservedBy}.`));
                        continue;
                    }
                    singletonAssignments.set(item.contentTypeId, index);
                }

                const [created] = await db.insert(contentItems).values({
                    domainId,
                    contentTypeId: item.contentTypeId,
                    data: itemDataStr,
                    status: item.status || 'draft'
                }).returning();

                await logAudit(domainId, 'create', 'content_item', created.id, { batch: true, mode: 'partial' });

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
    'search_semantic_knowledge',
    'Search the WordClaw knowledge base using semantic vector similarity',
    {
        query: z.string().describe('The search query or concept to find'),
        limit: z.number().optional().describe('Maximum number of results to return (default 5)')
    },
    withMCPPolicy('content.read', () => ({ type: 'system' }), async ({ query, limit }, extra, domainId) => {
        try {
            const results = await EmbeddingService.searchSemanticKnowledge(domainId, query, limit);
            return okJson(results);
        } catch (error) {
            return err(`Semantic search failed: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'get_content_items',
    'Get content items with optional filters and pagination',
    {
        contentTypeId: z.number().optional().describe('Filter by content type ID'),
        status: z.string().optional().describe('Filter by status'),
        draft: z.boolean().optional().describe('Return the working copy when true, otherwise prefer the latest published snapshot'),
        locale: z.string().optional().describe('Optional locale for locale-aware reads'),
        fallbackLocale: z.string().optional().describe('Optional fallback locale when localized fields do not contain locale'),
        createdAfter: z.string().optional().describe('ISO-8601 created-at lower bound'),
        createdBefore: z.string().optional().describe('ISO-8601 created-at upper bound'),
        fieldName: z.string().optional().describe('Top-level scalar field from the selected content type schema'),
        fieldOp: z.enum(['eq', 'contains', 'gte', 'lte']).optional().describe('Comparison operator for fieldName (default eq)'),
        fieldValue: z.string().optional().describe('Filter value for fieldName'),
        sortField: z.string().optional().describe('Top-level scalar field from the selected content type schema to sort by'),
        includeArchived: z.boolean().optional().describe('Include lifecycle-archived items when the content type defines x-wordclaw-lifecycle'),
        limit: z.number().optional().describe('Page size (default 50, max 500)'),
        offset: z.number().optional().describe('Row offset (default 0)'),
        cursor: z.string().optional().describe('Cursor returned by a previous get_content_items page')
    },
    withMCPPolicy('content.read', () => ({ type: 'system' }), async ({ contentTypeId, status, draft, locale, fallbackLocale, createdAfter, createdBefore, fieldName, fieldOp, fieldValue, sortField, includeArchived, limit: rawLimit, offset: rawOffset, cursor }, extra, domainId) => {
        const localizedReadOptions = resolveLocalizedReadOptions(draft, locale, fallbackLocale);
        if ('error' in localizedReadOptions) {
            return err(localizedReadOptions.error);
        }

        try {
            const result = await listContentItems(domainId, {
                contentTypeId,
                status,
                draft: localizedReadOptions.draft,
                locale: localizedReadOptions.locale,
                fallbackLocale: localizedReadOptions.fallbackLocale,
                createdAfter: parseDateArg(createdAfter, 'createdAfter'),
                createdBefore: parseDateArg(createdBefore, 'createdBefore'),
                fieldName,
                fieldOp,
                fieldValue,
                sortField,
                includeArchived,
                limit: clampLimit(rawLimit),
                offset: cursor ? rawOffset : clampOffset(rawOffset),
                cursor,
                sortBy: cursor ? 'createdAt' : undefined,
                sortDir: cursor ? 'desc' : undefined
            });

            return okJson({
                items: result.items,
                total: result.total,
                limit: result.limit,
                ...(result.offset !== undefined ? { offset: result.offset } : {}),
                hasMore: result.hasMore,
                nextCursor: result.nextCursor
            });
        } catch (error) {
            if (error instanceof ContentItemListError) {
                return err(`${error.code}: ${error.message}. ${error.remediation}`);
            }
            return err(`Error listing content items: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'project_content_items',
    'Build grouped content projections for leaderboard and analytics-style views',
    {
        contentTypeId: z.number().describe('Target content type ID'),
        status: z.string().optional().describe('Filter by status'),
        createdAfter: z.string().optional().describe('ISO-8601 created-at lower bound'),
        createdBefore: z.string().optional().describe('ISO-8601 created-at upper bound'),
        fieldName: z.string().optional().describe('Top-level scalar field from the selected content type schema'),
        fieldOp: z.enum(['eq', 'contains', 'gte', 'lte']).optional().describe('Comparison operator for fieldName (default eq)'),
        fieldValue: z.string().optional().describe('Filter value for fieldName'),
        groupBy: z.string().describe('Top-level scalar field from the selected content type schema to group by'),
        metric: z.enum(['count', 'sum', 'avg', 'min', 'max']).optional().describe('Projection metric (default count)'),
        metricField: z.string().optional().describe('Numeric top-level scalar field used by sum, avg, min, or max'),
        orderBy: z.enum(['value', 'group']).optional().describe('Sort grouped buckets by metric value or group label'),
        orderDir: z.enum(['asc', 'desc']).optional().describe('Projection sort direction (default desc)'),
        includeArchived: z.boolean().optional().describe('Include lifecycle-archived items when the content type defines x-wordclaw-lifecycle'),
        limit: z.number().optional().describe('Bucket limit (default 50, max 500)')
    },
    withMCPPolicy('content.read', () => ({ type: 'system' }), async ({
        contentTypeId,
        status,
        createdAfter,
        createdBefore,
        fieldName,
        fieldOp,
        fieldValue,
        groupBy,
        metric,
        metricField,
        orderBy,
        orderDir,
        includeArchived,
        limit: rawLimit
    }, extra, domainId) => {
        try {
            const result = await projectContentItems(domainId, {
                contentTypeId,
                status,
                createdAfter: parseDateArg(createdAfter, 'createdAfter'),
                createdBefore: parseDateArg(createdBefore, 'createdBefore'),
                fieldName,
                fieldOp,
                fieldValue,
                groupBy,
                metric,
                metricField,
                orderBy,
                orderDir,
                includeArchived,
                limit: clampLimit(rawLimit)
            });

            return okJson({
                buckets: result.buckets,
                contentTypeId: result.contentTypeId,
                groupBy: result.groupBy,
                metric: result.metric,
                metricField: result.metricField,
                orderBy: result.orderBy,
                orderDir: result.orderDir,
                limit: result.limit
            });
        } catch (error) {
            if (error instanceof ContentItemProjectionError) {
                return err(`${error.code}: ${error.message}. ${error.remediation}`);
            }
            return err(`Error projecting content items: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'get_content_item',
    'Get a single content item by ID',
    {
        id: z.number().describe('ID of the content item'),
        draft: z.boolean().optional().describe('Return the working copy when true, otherwise prefer the latest published snapshot'),
        locale: z.string().optional().describe('Optional locale for locale-aware reads'),
        fallbackLocale: z.string().optional().describe('Optional fallback locale when localized fields do not contain locale')
    },
    withMCPPolicy('content.read', (args) => ({ type: 'content_item', id: args.id }), async ({ id, draft, locale, fallbackLocale }, extra, domainId) => {
        const localizedReadOptions = resolveLocalizedReadOptions(draft, locale, fallbackLocale);
        if ('error' in localizedReadOptions) {
            return err(localizedReadOptions.error);
        }

        const [row] = await db.select({
            item: contentItems,
            basePrice: contentTypes.basePrice,
            schema: contentTypes.schema
        })
            .from(contentItems)
            .innerJoin(contentTypes, eq(contentItems.contentTypeId, contentTypes.id))
            .where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId)));

        if (!row) {
            return err('Content item not found');
        }

        if ((row.basePrice || 0) > 0) {
            return err('PAYMENT_REQUIRED: This content item is paywalled. You must use the REST API /api/content-items/:id to fulfill the L402 payment challenge.');
        }

        const item = await ensureContentItemLifecycleState(row.item, row.schema);
        const latestPublishedVersions = await getLatestPublishedVersionsForItems(
            item.status === 'published' ? [] : [item.id]
        );
        const readView = resolveContentItemReadView(
            item,
            row.schema,
            localizedReadOptions,
            latestPublishedVersions.get(item.id)
        );
        const [enrichedReadView] = await attachContentItemEmbeddingReadiness(domainId, [{
            item,
            readView,
            publishedVersion: latestPublishedVersions.get(item.id) ?? null
        }]);
        return okJson(enrichedReadView);
    }
    ));

server.tool(
    'get_content_item_usage',
    'Inspect which content currently or historically references a content item',
    {
        id: z.number().describe('ID of the content item')
    },
    withMCPPolicy('content.read', (args) => ({ type: 'content_item', id: args.id }), async ({ id }, _extra, domainId) => {
        const [item] = await db.select({ id: contentItems.id })
            .from(contentItems)
            .where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId)));

        if (!item) {
            return err(`CONTENT_ITEM_NOT_FOUND: Content item ${id} not found in the current domain.`);
        }

        const usage = await findContentItemUsage(domainId, id);
        return okJson({
            item,
            usage: serializeReferenceUsageSummary(usage),
            recommendedNextAction: 'Inspect the referencing content items before deleting or heavily revising this record.'
        });
    })
);

server.tool(
    'update_content_item',
    'Update a content item with versioning',
    {
        id: z.number().describe('ID of the content item'),
        data: z.union([z.string(), z.record(z.string(), z.any())]).optional().describe('New JSON data or object'),
        status: z.enum(['draft', 'published', 'archived']).optional(),
        dryRun: z.boolean().optional()
    },
    withMCPPolicy('content.write', (args) => ({ type: 'content_item', id: args.id }), async ({ id, data, status, dryRun }, extra, domainId) => {
        try {
            const dataStr = data ? (typeof data === 'string' ? data : JSON.stringify(data)) : undefined;
            const updateData = stripUndefined({ data: dataStr, status });
            if (!hasDefinedValues({ data, status })) {
                return err('At least one update field is required (data, status).');
            }

            const [existing] = await db.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId)));
            if (!existing) {
                return err('Content item not found');
            }

            const [contentType] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, existing.contentTypeId), eq(contentTypes.domainId, domainId)));
            if (!contentType) {
                return err(`Content type ${existing.contentTypeId} not found`);
            }

            const singletonConflict = await findSingletonConflictText(domainId, contentType, existing.id);
            if (singletonConflict) {
                return err(singletonConflict);
            }

            const targetData = typeof updateData.data === 'string' ? updateData.data : existing.data;
            const contentFailure = await validateContentDataAgainstSchema(contentType.schema, targetData, domainId);
            if (contentFailure) {
                return err(validationFailureToText(contentFailure));
            }

            if (dryRun) {
                return ok(`[Dry Run] Would update content item ${id} (creating new version)`);
            }

            const result = await db.transaction(async (tx) => {
                const [existing] = await tx.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId)));
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
                    .where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId)))
                    .returning();

                return updated;
            });

            if (!result) {
                return err('Content item not found');
            }

            await logAudit(domainId, 'update', 'content_item', result.id, updateData);

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
    withMCPPolicy('content.write', () => ({ type: 'batch' }), async ({ items, atomic, dryRun }, extra, domainId) => {
        if (items.length === 0) {
            return err('EMPTY_BATCH: Provide at least one item.');
        }

        const buildItemError = (index: number, code: string, errorText: string) => ({ index, ok: false, code, error: errorText });
        const isAtomic = atomic === true;
        const plannedSingletonAssignments = new Map<number, number>();

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

            const [existing] = await db.select().from(contentItems).where(and(eq(contentItems.id, item.id), eq(contentItems.domainId, domainId)));
            if (!existing) {
                return {
                    ok: false,
                    error: buildItemError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${item.id} not found`)
                } as const;
            }

            const targetContentTypeId = item.contentTypeId ?? existing.contentTypeId;
            const [contentType] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, targetContentTypeId), eq(contentTypes.domainId, domainId)));
            if (!contentType) {
                return {
                    ok: false,
                    error: buildItemError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${targetContentTypeId} not found`)
                } as const;
            }

            const targetData = item.data ?? existing.data;
            const validation = await validateContentDataAgainstSchema(contentType.schema, targetData, domainId);
            if (validation) {
                return {
                    ok: false,
                    error: buildItemError(index, validation.code, validation.error)
                } as const;
            }

            if (isSingletonContentType(contentType.kind)) {
                const conflict = await findSingletonContentConflict(domainId, targetContentTypeId, existing.id);
                if (conflict) {
                    return {
                        ok: false,
                        error: buildItemError(index, 'SINGLETON_CONTENT_ITEM_EXISTS', `Singleton content type '${contentType.slug}' already uses content item ${conflict.id}`)
                    } as const;
                }

                const reservedBy = plannedSingletonAssignments.get(targetContentTypeId);
                if (reservedBy !== undefined && reservedBy !== existing.id) {
                    return {
                        ok: false,
                        error: buildItemError(index, 'SINGLETON_CONTENT_ITEM_EXISTS', `Singleton content type '${contentType.slug}' is already targeted by content item ${reservedBy}.`)
                    } as const;
                }
                plannedSingletonAssignments.set(targetContentTypeId, existing.id);
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
                    const singletonAssignments = new Map<number, number>();

                    for (const [index, item] of items.entries()) {
                        const updateData = stripUndefined({
                            contentTypeId: item.contentTypeId,
                            data: item.data,
                            status: item.status
                        });

                        if (!hasDefinedValues(updateData)) {
                            throw new Error(JSON.stringify(buildItemError(index, 'EMPTY_UPDATE_BODY', `No update fields provided for item ${item.id}`)));
                        }

                        const [existing] = await tx.select().from(contentItems).where(and(eq(contentItems.id, item.id), eq(contentItems.domainId, domainId)));
                        if (!existing) {
                            throw new Error(JSON.stringify(buildItemError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${item.id} not found`)));
                        }

                        const targetContentTypeId = item.contentTypeId ?? existing.contentTypeId;
                        const [contentType] = await tx.select().from(contentTypes).where(and(eq(contentTypes.id, targetContentTypeId), eq(contentTypes.domainId, domainId)));
                        if (!contentType) {
                            throw new Error(JSON.stringify(buildItemError(index, 'CONTENT_TYPE_NOT_FOUND', `Content type ${targetContentTypeId} not found`)));
                        }

                        const targetData = item.data ?? existing.data;
                        const validation = await validateContentDataAgainstSchema(contentType.schema, targetData, domainId);
                        if (validation) {
                            throw new Error(JSON.stringify(buildItemError(index, validation.code, validation.error)));
                        }

                        if (isSingletonContentType(contentType.kind)) {
                            const [conflict] = await tx.select({ id: contentItems.id })
                                .from(contentItems)
                                .where(and(
                                    eq(contentItems.domainId, domainId),
                                    eq(contentItems.contentTypeId, targetContentTypeId),
                                    ne(contentItems.id, existing.id)
                                ));
                            if (conflict) {
                                throw new Error(JSON.stringify(buildItemError(index, 'SINGLETON_CONTENT_ITEM_EXISTS', `Singleton content type '${contentType.slug}' already uses content item ${conflict.id}`)));
                            }

                            const reservedBy = singletonAssignments.get(targetContentTypeId);
                            if (reservedBy !== undefined && reservedBy !== existing.id) {
                                throw new Error(JSON.stringify(buildItemError(index, 'SINGLETON_CONTENT_ITEM_EXISTS', `Singleton content type '${contentType.slug}' is already targeted by content item ${reservedBy}.`)));
                            }
                            singletonAssignments.set(targetContentTypeId, existing.id);
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
                            .where(and(eq(contentItems.id, item.id), eq(contentItems.domainId, domainId)))
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
                        await logAudit(domainId, 'update', 'content_item', id, { batch: true, mode: 'atomic' });
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
                    .where(and(eq(contentItems.id, validated.existing.id), eq(contentItems.domainId, domainId)))
                    .returning();

                return updated;
            });

            await logAudit(domainId, 'update', 'content_item', result.id, { batch: true, mode: 'partial' });

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
    withMCPPolicy('content.write', (args) => ({ type: 'content_item', id: args.id }), async ({ id, dryRun }, extra, domainId) => {
        try {
            if (dryRun) {
                return ok(`[Dry Run] Would delete content item ${id}`);
            }

            const [deleted] = await db.delete(contentItems)
                .where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId)))
                .returning();

            if (!deleted) {
                return err('Content item not found');
            }

            await logAudit(domainId, 'delete', 'content_item', deleted.id, deleted);

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
    withMCPPolicy('content.write', () => ({ type: 'batch' }), async ({ ids, atomic, dryRun }, extra, domainId) => {
        if (ids.length === 0) {
            return err('EMPTY_BATCH: Provide at least one id.');
        }

        const buildItemError = (index: number, code: string, errorText: string) => ({ index, ok: false, code, error: errorText });
        const isAtomic = atomic === true;

        if (dryRun) {
            const results = await Promise.all(ids.map(async (id, index) => {
                const [existing] = await db.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId)));
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
                        const [deleted] = await tx.delete(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId))).returning();
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
                        await logAudit(domainId, 'delete', 'content_item', id, { batch: true, mode: 'atomic' });
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
            const [deleted] = await db.delete(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId))).returning();
            if (!deleted) {
                results.push(buildItemError(index, 'CONTENT_ITEM_NOT_FOUND', `Content item ${id} not found`));
                continue;
            }

            await logAudit(domainId, 'delete', 'content_item', deleted.id, { batch: true, mode: 'partial' });
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
    withMCPPolicy('content.read', (args) => ({ type: 'content_item', id: args.id }), async ({ id }, extra, domainId) => {
        const versions = await db.select()
            .from(contentItemVersions)
            .innerJoin(contentItems, eq(contentItemVersions.contentItemId, contentItems.id))
            .where(and(eq(contentItemVersions.contentItemId, id), eq(contentItems.domainId, domainId)))
            .orderBy(desc(contentItemVersions.version));

        return okJson(versions.map((v) => v.content_item_versions));
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
    withMCPPolicy('content.write', (args) => ({ type: 'content_item', id: args.id }), async ({ id, version, dryRun }, extra, domainId) => {
        try {
            const [currentItem] = await db.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId)));
            if (!currentItem) {
                return err('Content item not found');
            }

            const [targetVersion] = await db.select()
                .from(contentItemVersions)
                .where(and(eq(contentItemVersions.contentItemId, id), eq(contentItemVersions.version, version)));

            if (!targetVersion) {
                return err(TARGET_VERSION_NOT_FOUND);
            }

            const [contentType] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, currentItem.contentTypeId), eq(contentTypes.domainId, domainId)));
            if (!contentType) {
                return err(`Content type ${currentItem.contentTypeId} not found`);
            }

            const contentFailure = await validateContentDataAgainstSchema(contentType.schema, targetVersion.data, domainId);
            if (contentFailure) {
                return err(validationFailureToText(contentFailure));
            }

            if (dryRun) {
                return ok(`[Dry Run] Would rollback item ${id} to version ${version}`);
            }

            const result = await db.transaction(async (tx) => {
                const [currentItem] = await tx.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId)));
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
                    .where(and(eq(contentItems.id, id), eq(contentItems.domainId, domainId)))
                    .returning();

                return restored;
            });

            if (!result) {
                return err('Content item not found');
            }

            await logAudit(domainId, 'rollback', 'content_item', result.id, { from: result.version - 1, to: version });

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
        actorId: z.string().optional(),
        actorType: z.string().optional(),
        cursor: z.string().optional().describe('Opaque cursor from previous call')
    },
    withMCPPolicy('audit.read', () => ({ type: 'system' }), async ({ limit: rawLimit, entityType, entityId, action, actorId, actorType, cursor }, extra, domainId) => {
        try {
            const limit = clampLimit(rawLimit);
            const decodedCursor = cursor ? decodeCursor(cursor) : null;
            if (cursor && !decodedCursor) {
                return err('INVALID_AUDIT_CURSOR: Provide cursor returned by previous get_audit_logs call.');
            }

            const baseConditions = [
                eq(auditLogs.domainId, domainId),
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
    ));

server.tool(
    'list_payments',
    'List all payments with optional pagination',
    {
        limit: z.number().min(1).max(500).default(50).describe('Maximum number of items to return'),
        offset: z.number().min(0).default(0).describe('Number of items to skip for pagination')
    },
    withMCPPolicy('payment.read', () => ({ type: 'system' }), async ({ limit, offset }, extra, domainId) => {
        try {
            const results = await db.select().from(payments)
                .where(eq(payments.domainId, domainId))
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
    ));

server.tool(
    'get_payment',
    'Get a single payment by its numeric ID',
    {
        id: z.number().describe('The numeric ID of the payment to retrieve')
    },
    withMCPPolicy('payment.read', (args) => ({ type: 'payment', id: args.id }), async ({ id }, extra, domainId) => {
        try {
            const [payment] = await db.select().from(payments).where(and(eq(payments.id, id), eq(payments.domainId, domainId)));

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
    ));

if (isExperimentalAgentRunsEnabled()) {
server.tool(
    'create_agent_run_definition',
    'Create a reusable autonomous run definition',
    {
        name: z.string().min(1).describe('Unique definition name in current domain'),
        runType: z.string().min(1).describe('Run type key used by the runtime'),
        strategyConfig: z.record(z.string(), z.any()).optional().describe('Optional strategy configuration object'),
        active: z.boolean().optional().default(true).describe('Whether this definition can be selected for new runs')
    },
    withMCPPolicy('content.write', () => ({ type: 'agent_run_definition' }), async ({ name, runType, strategyConfig, active }, _extra, domainId) => {
        try {
            const definition = await AgentRunService.createDefinition(domainId, {
                name,
                runType,
                strategyConfig,
                active
            });
            return okJson(serializeAgentRunDefinition(definition));
        } catch (error) {
            if (error instanceof AgentRunServiceError) {
                if (error.code === 'AGENT_RUN_DEFINITION_NAME_CONFLICT') {
                    return err('AGENT_RUN_DEFINITION_NAME_CONFLICT: Choose a unique definition name in this domain.');
                }
                if (error.code === 'AGENT_RUN_DEFINITION_INVALID_NAME' || error.code === 'AGENT_RUN_DEFINITION_INVALID_RUN_TYPE') {
                    return err(`AGENT_RUN_DEFINITION_INVALID_PAYLOAD: ${error.message}`);
                }
            }
            return err(`Error creating agent run definition: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'list_agent_run_definitions',
    'List autonomous run definitions with optional active/runType filters and pagination',
    {
        active: z.boolean().optional().describe('Filter by active definitions'),
        runType: z.string().optional().describe('Filter by run type'),
        limit: z.number().min(1).max(500).optional().default(50).describe('Page size'),
        offset: z.number().min(0).optional().default(0).describe('Row offset')
    },
    withMCPPolicy('content.read', () => ({ type: 'agent_run_definition' }), async ({ active, runType, limit, offset }, _extra, domainId) => {
        try {
            const definitions = await AgentRunService.listDefinitions(domainId, {
                active,
                runType,
                limit,
                offset
            });

            return okJson({
                items: definitions.items.map(serializeAgentRunDefinition),
                total: definitions.total,
                limit: definitions.limit,
                offset: definitions.offset,
                hasMore: definitions.hasMore
            });
        } catch (error) {
            return err(`Error listing agent run definitions: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'get_agent_run_definition',
    'Get one autonomous run definition by ID',
    {
        id: z.number().describe('Definition ID')
    },
    withMCPPolicy('content.read', (args) => ({ type: 'agent_run_definition', id: args.id.toString() }), async ({ id }, _extra, domainId) => {
        try {
            const definition = await AgentRunService.getDefinition(domainId, id);
            if (!definition) {
                return err(`AGENT_RUN_DEFINITION_NOT_FOUND: Definition ${id} was not found in this domain.`);
            }
            return okJson(serializeAgentRunDefinition(definition));
        } catch (error) {
            return err(`Error fetching agent run definition: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'update_agent_run_definition',
    'Update a reusable autonomous run definition',
    {
        id: z.number().describe('Definition ID'),
        name: z.string().optional().describe('Updated name'),
        runType: z.string().optional().describe('Updated run type'),
        strategyConfig: z.record(z.string(), z.any()).optional().describe('Updated strategy configuration object'),
        active: z.boolean().optional().describe('Updated active flag')
    },
    withMCPPolicy('content.write', (args) => ({ type: 'agent_run_definition', id: args.id.toString() }), async ({ id, name, runType, strategyConfig, active }, _extra, domainId) => {
        try {
            const definition = await AgentRunService.updateDefinition(domainId, id, {
                name,
                runType,
                strategyConfig,
                active
            });
            return okJson(serializeAgentRunDefinition(definition));
        } catch (error) {
            if (error instanceof AgentRunServiceError) {
                if (error.code === 'AGENT_RUN_DEFINITION_NOT_FOUND') {
                    return err(`AGENT_RUN_DEFINITION_NOT_FOUND: Definition ${id} was not found in this domain.`);
                }
                if (error.code === 'AGENT_RUN_DEFINITION_NAME_CONFLICT') {
                    return err('AGENT_RUN_DEFINITION_NAME_CONFLICT: Choose a unique definition name in this domain.');
                }
                if (
                    error.code === 'AGENT_RUN_DEFINITION_INVALID_NAME'
                    || error.code === 'AGENT_RUN_DEFINITION_INVALID_RUN_TYPE'
                    || error.code === 'AGENT_RUN_DEFINITION_EMPTY_UPDATE'
                ) {
                    return err(`AGENT_RUN_DEFINITION_INVALID_UPDATE: ${error.message}`);
                }
            }
            return err(`Error updating agent run definition: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'create_agent_run',
    'Create a new autonomous content-operations run',
    {
        goal: z.string().min(1).describe('Goal statement for the run'),
        runType: z.string().optional().describe('Optional run type identifier'),
        definitionId: z.number().optional().describe('Optional run definition ID'),
        requireApproval: z.boolean().optional().default(true).describe('Whether run should start in waiting_approval'),
        metadata: z.record(z.string(), z.any()).optional().describe('Optional arbitrary JSON metadata')
    },
    withMCPPolicy('content.write', () => ({ type: 'agent_run' }), async ({ goal, runType, definitionId, requireApproval, metadata }, _extra, domainId) => {
        try {
            const run = await AgentRunService.createRun(domainId, {
                goal,
                runType,
                definitionId,
                requireApproval,
                metadata,
                requestedBy: resolveMcpPrincipal(_extra).actorId
            });

            return okJson(serializeAgentRun(run));
        } catch (error) {
            if (error instanceof AgentRunServiceError) {
                if (error.code === 'AGENT_RUN_DEFINITION_NOT_FOUND') {
                    return err('AGENT_RUN_DEFINITION_NOT_FOUND: Provide a definitionId that belongs to this domain.');
                }
                if (error.code === 'AGENT_RUN_DEFINITION_INACTIVE') {
                    return err('AGENT_RUN_DEFINITION_INACTIVE: Activate the run definition before creating new runs from it.');
                }
                if (error.code === 'AGENT_RUN_INVALID_GOAL') {
                    return err('AGENT_RUN_INVALID_GOAL: Goal must be a non-empty string.');
                }
            }

            return err(`Error creating agent run: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'list_agent_runs',
    'List autonomous runs with optional status and pagination',
    {
        status: z.string().optional().describe('Optional status filter'),
        runType: z.string().optional().describe('Optional runType filter'),
        definitionId: z.number().optional().describe('Optional run definition ID filter'),
        limit: z.number().min(1).max(500).optional().default(50).describe('Page size'),
        offset: z.number().min(0).optional().default(0).describe('Row offset')
    },
    withMCPPolicy('content.read', () => ({ type: 'agent_run' }), async ({ status, runType, definitionId, limit, offset }, _extra, domainId) => {
        try {
            if (status && !isAgentRunStatus(status)) {
                return err('AGENT_RUN_INVALID_STATUS: Use queued|planning|waiting_approval|running|succeeded|failed|cancelled.');
            }

            const runs = await AgentRunService.listRuns(domainId, {
                status: status as any,
                runType,
                definitionId,
                limit,
                offset
            });

            return okJson({
                items: runs.items.map(serializeAgentRun),
                total: runs.total,
                limit: runs.limit,
                offset: runs.offset,
                hasMore: runs.hasMore
            });
        } catch (error) {
            return err(`Error listing agent runs: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'get_agent_run',
    'Get one autonomous run by ID including steps and checkpoints',
    {
        id: z.number().describe('Run ID')
    },
    withMCPPolicy('content.read', (args) => ({ type: 'agent_run', id: args.id.toString() }), async ({ id }, _extra, domainId) => {
        try {
            const details = await AgentRunService.getRun(domainId, id);
            if (!details) {
                return err(`AGENT_RUN_NOT_FOUND: Run ${id} was not found in this domain.`);
            }

            return okJson({
                run: serializeAgentRun(details.run),
                steps: details.steps.map(serializeAgentRunStep),
                checkpoints: details.checkpoints.map(serializeAgentRunCheckpoint)
            });
        } catch (error) {
            return err(`Error fetching agent run: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'control_agent_run',
    'Apply a control action to an autonomous run',
    {
        id: z.number().describe('Run ID'),
        action: z.enum(['approve', 'pause', 'resume', 'cancel']).describe('Control action')
    },
    withMCPPolicy('content.write', (args) => ({ type: 'agent_run', id: args.id.toString() }), async ({ id, action }, _extra, domainId) => {
        try {
            if (!isAgentRunControlAction(action)) {
                return err('AGENT_RUN_INVALID_ACTION: Use approve|pause|resume|cancel.');
            }

            const run = await AgentRunService.controlRun(domainId, id, action);
            return okJson(serializeAgentRun(run));
        } catch (error) {
            if (error instanceof AgentRunServiceError) {
                if (error.code === 'AGENT_RUN_NOT_FOUND') {
                    return err(`AGENT_RUN_NOT_FOUND: Run ${id} was not found in this domain.`);
                }
                if (error.code === 'AGENT_RUN_INVALID_TRANSITION') {
                    return err(`AGENT_RUN_INVALID_TRANSITION: ${error.message}`);
                }
            }

            return err(`Error controlling agent run: ${(error as Error).message}`);
        }
    })
);
}

server.tool(
    'evaluate_policy',
    'Evaluate a policy decision without side effects (Simulation/Dry-Run)',
    {
        operation: z.string().describe('The operation string (e.g. content.read, content.write)'),
        resourceType: z.string().describe('The type of resource (e.g. content_item, system)'),
        resourceId: z.string().optional().describe('The ID of the resource'),
        contentTypeId: z.string().optional().describe('The content type ID of the resource')
    },
    withMCPPolicy('policy.read', () => ({ type: 'system' }), async ({ operation, resourceType, resourceId, contentTypeId }, extra, domainId) => {
        const operationContext = buildOperationContext(
            'mcp',
            resolveMcpPrincipal(extra),
            operation,
            { type: resourceType, id: resourceId, contentTypeId }
        );
        const decision = await PolicyEngine.evaluate(operationContext);
        return okJson(decision);
    })
);

server.tool(
    'subscribe_events',
    'Subscribe the active MCP session to WordClaw reactive runtime events such as content publication or workflow approval.',
    {
        topics: z.array(z.string()).min(1).optional().describe('Optional explicit event topics to subscribe to, e.g. content_item.published'),
        recipeId: z.enum(REACTIVE_SUBSCRIPTION_RECIPE_IDS).optional().describe('Optional recipe that expands into a curated set of reactive topics'),
        replaceExisting: z.boolean().optional().default(false).describe('If true, replace the current topic set instead of appending to it'),
        filters: ReactiveEventFiltersSchema.optional().describe(
            `Optional event filters. Supported fields: ${SUPPORTED_REACTIVE_FILTER_FIELDS.join(', ')}.`,
        ),
    },
    async ({ topics, recipeId, replaceExisting, filters }, extra) => {
        const principal = resolveMcpPrincipal(extra as McpRequestExtra | undefined);

        if (!options.reactiveEvents) {
            return err(
                'REACTIVE_STREAMS_UNAVAILABLE: This MCP transport does not expose session-backed reactive events. Use the remote HTTP /mcp endpoint with a long-lived session.'
            );
        }

        const recipe = recipeId ? getReactiveSubscriptionRecipe(recipeId) : null;
        const resolvedTopics = Array.from(new Set([
            ...(recipe?.topics ?? []),
            ...((topics ?? []).map((topic) => topic.trim()).filter(Boolean)),
        ]));

        if (resolvedTopics.length === 0) {
            return err(
                'MISSING_REACTIVE_SELECTION: Provide topics, recipeId, or both when subscribing to reactive events.'
            );
        }

        const subscription = options.reactiveEvents.subscribe(resolvedTopics, replaceExisting, filters);

        return okJson({
            ...subscription,
            requestedTopics: topics ?? [],
            recipe: recipe
                ? {
                    id: recipe.id,
                    title: recipe.title,
                    description: recipe.description,
                    topics: [...recipe.topics],
                    requiredScopes: [...recipe.requiredScopes],
                }
                : null,
            resolvedTopics,
            supportedTopics: SUPPORTED_REACTIVE_EVENT_TOPICS,
            supportedRecipes: SUPPORTED_REACTIVE_SUBSCRIPTION_RECIPES.map((entry) => ({
                id: entry.id,
                title: entry.title,
                description: entry.description,
                topics: [...entry.topics],
                requiredScopes: [...entry.requiredScopes],
            })),
            supportedFilterFields: SUPPORTED_REACTIVE_FILTER_FIELDS,
            currentActor: buildCurrentActorSnapshot(principal),
        });
    }
);

server.tool(
    'create_workflow',
    'Create an active workflow for a content type',
    {
        name: z.string().describe('Human-readable workflow name'),
        contentTypeId: z.number().describe('ID of the content type to govern'),
        active: z.boolean().optional().default(true).describe('Whether the workflow is currently active')
    },
    withMCPPolicy('system.config', () => ({ type: 'system' }), async ({ name, contentTypeId, active }, _extra, domainId) => {
        try {
            const workflow = await WorkflowService.createWorkflow(
                domainId,
                name,
                contentTypeId,
                active
            );
            return okJson(workflow);
        } catch (error) {
            if (error instanceof Error && error.message === 'CONTENT_TYPE_NOT_FOUND') {
                return err(`CONTENT_TYPE_NOT_FOUND: Content type ${contentTypeId} not found in current domain`);
            }
            return err(`Error creating workflow: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'create_workflow_transition',
    'Create a state transition path for a workflow',
    {
        workflowId: z.number().describe('ID of the workflow'),
        fromState: z.string().describe('Initial state (e.g. "draft")'),
        toState: z.string().describe('Target state (e.g. "in_review")'),
        requiredRoles: z.array(z.string()).describe('Roles authorized to execute this transition (e.g. ["reviewer"])')
    },
    withMCPPolicy('system.config', () => ({ type: 'system' }), async ({ workflowId, fromState, toState, requiredRoles }, _extra, domainId) => {
        try {
            const transition = await WorkflowService.createWorkflowTransition(
                domainId,
                workflowId,
                fromState,
                toState,
                requiredRoles
            );
            return okJson(transition);
        } catch (error) {
            if (error instanceof Error && error.message === 'WORKFLOW_NOT_FOUND') {
                return err(`WORKFLOW_NOT_FOUND: Workflow ${workflowId} not found in current domain`);
            }
            return err(`Error creating transition: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'submit_review_task',
    'Submit a content item for review via a workflow transition',
    {
        contentItemId: z.number().describe('ID of the content item to submit'),
        workflowTransitionId: z.number().describe('ID of the relevant workflow transition path'),
        assignee: z.string().optional().describe('Username/ID of the designated reviewer')
    },
    withMCPPolicy('content.write', (args) => ({ type: 'content_item', id: args.contentItemId.toString() }), async ({ contentItemId, workflowTransitionId, assignee }, _extra, domainId) => {
        try {
            const result = await WorkflowService.submitForReview({
                domainId,
                contentItemId,
                workflowTransitionId,
                assignee,
                authPrincipal: { scopes: new Set(['admin']), domainId }
            });
            return okJson(result);
        } catch (error) {
            return err(`Error submitting for review: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'decide_review_task',
    'Approve or Reject an active review task',
    {
        taskId: z.number().describe('ID of the review task to decide upon'),
        decision: z.enum(['approved', 'rejected']).describe('Decision outcome for the task')
    },
    withMCPPolicy('content.write', () => ({ type: 'system' }), async ({ taskId, decision }, _extra, domainId) => {
        try {
            const result = await WorkflowService.decideReviewTask(
                domainId,
                taskId,
                decision,
                { scopes: new Set(['admin']), domainId }
            );
            return okJson(result);
        } catch (error) {
            return err(`Error deciding task: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'add_review_comment',
    'Add a threaded comment to a content item currently under review',
    {
        contentItemId: z.number().describe('ID of the relevant content item'),
        comment: z.string().describe('The review feedback or comment text')
    },
    withMCPPolicy('content.write', (args) => ({ type: 'content_item', id: args.contentItemId.toString() }), async ({ contentItemId, comment }, _extra, domainId) => {
        try {
            const commentObj = await WorkflowService.addComment(domainId, contentItemId, 'mcp-agent', comment);
            return okJson(commentObj);
        } catch (error) {
            return err(`Error adding comment: ${(error as Error).message}`);
        }
    })
);

server.tool(
    'resolve_workspace_target',
    'Resolve the strongest schema-plus-work-target candidate for a workspace intent such as authoring, review, workflow, or paid content',
    {
        intent: z.enum(['authoring', 'review', 'workflow', 'paid']).describe('Task intent to resolve against the active workspace'),
        search: z.string().optional().describe('Optional search string to narrow candidate schemas before resolving'),
    },
    async ({ intent, search }, extra) => {
        const principal = resolveMcpPrincipal(extra as McpRequestExtra | undefined);
        const currentActor = buildCurrentActorSnapshot(principal);
        const resolution = await resolveWorkspaceTarget(currentActor, {
            intent,
            search,
        });

        return okJson(resolution);
    }
);

server.tool(
    'guide_task',
    'Build live, actor-aware guidance for a supported WordClaw agent task',
    {
        taskId: z.enum(GUIDE_TASK_IDS).describe('Supported task id, e.g. author-content or consume-paid-content'),
        intent: z.enum(['all', 'authoring', 'review', 'workflow', 'paid']).optional().describe('Optional workspace intent for discover-workspace guidance'),
        search: z.string().optional().describe('Optional workspace search string for discover-workspace guidance'),
        workspaceLimit: z.number().optional().describe('Optional workspace result limit for discover-workspace guidance'),
        contentTypeId: z.number().optional().describe('Optional for author-content guidance; omit it to get schema-design guidance before a target content type exists'),
        reviewTaskId: z.number().optional().describe('Optional review task to prioritize for review-workflow guidance'),
        contentItemId: z.number().optional().describe('Required for consume-paid-content guidance'),
        offerId: z.number().optional().describe('Optional offer id to prioritize for consume-paid-content guidance'),
        actorId: z.string().optional().describe('Optional actor id filter for verify-provenance guidance'),
        actorType: z.string().optional().describe('Optional actor type filter for verify-provenance guidance'),
        entityType: z.string().optional().describe('Optional entity type filter for verify-provenance guidance'),
        entityId: z.number().optional().describe('Optional entity id filter for verify-provenance guidance'),
        action: z.string().optional().describe('Optional action filter for verify-provenance guidance'),
        limit: z.number().optional().describe('Optional audit page size for verify-provenance guidance'),
    },
    async ({ taskId, intent, search, workspaceLimit, contentTypeId, reviewTaskId, contentItemId, offerId, actorId, actorType, entityType, entityId, action, limit }, extra) => {
        const principal = resolveMcpPrincipal(extra as McpRequestExtra | undefined);
        const currentActor = buildCurrentActorSnapshot(principal);
        const manifest = buildCapabilityManifest();
        const recipe = manifest.agentGuidance.taskRecipes.find((task) => task.id === taskId);

        if (!recipe) {
            return err(`UNKNOWN_TASK: Unsupported task "${taskId}"`);
        }

        const domainId = principal.domainId;
        const basePayload = {
            taskId: recipe.id,
            goal: recipe.goal,
            preferredSurface: recipe.preferredSurface,
            fallbackSurface: recipe.fallbackSurface,
            recommendedAuth: recipe.recommendedAuth,
            preferredActorProfile: recipe.preferredActorProfile,
            supportedActorProfiles: recipe.supportedActorProfiles,
            recommendedApiKeyScopes: recipe.recommendedApiKeyScopes,
            requiredModules: recipe.requiredModules,
            dryRunRecommended: recipe.dryRunRecommended,
            currentActor,
        };

        if (taskId === 'bootstrap-workspace') {
            const deploymentStatus = await getDeploymentStatusSnapshot();
            const guide = buildBootstrapWorkspaceGuide({
                currentActor,
                deploymentStatus,
            });

            return okJson({
                ...basePayload,
                deploymentStatus,
                guide,
            });
        }

        if (taskId === 'discover-deployment') {
            const deploymentStatus = await getDeploymentStatusSnapshot();
            const guide = buildDeploymentGuide({
                currentActor,
                deploymentStatus,
            });

            return okJson({
                ...basePayload,
                deploymentStatus,
                guide,
            });
        }

        if (taskId === 'discover-workspace') {
            const workspaceContext = await getWorkspaceContextSnapshot(currentActor, {
                intent,
                search,
                limit: workspaceLimit,
            });
            const resolvedTarget = intent && intent !== 'all'
                ? await resolveWorkspaceTarget(currentActor, {
                    intent,
                    search,
                })
                : null;
            const guide = buildWorkspaceGuide({
                currentActor,
                workspace: workspaceContext,
            });

            return okJson({
                ...basePayload,
                workspaceContext,
                resolvedTarget,
                guide,
            });
        }

        if (taskId === 'author-content') {
            let contentType: {
                id: number;
                name: string;
                slug: string;
                description: string | null;
                schema: string;
                basePrice: number | null;
                createdAt?: string;
                updatedAt?: string;
            } | null = null;
            let workflow: {
                id: number;
                name: string;
                contentTypeId: number;
                active: boolean;
                transitions: Array<{
                    id: number;
                    workflowId: number;
                    fromState: string;
                    toState: string;
                    requiredRoles?: string[];
                }>;
            } | null = null;
            const warnings: string[] = [];

            if (contentTypeId !== undefined && canInspectContent(currentActor)) {
                const [type] = await db.select().from(contentTypes).where(and(
                    eq(contentTypes.id, contentTypeId),
                    eq(contentTypes.domainId, domainId),
                ));

                if (!type) {
                    return err(`CONTENT_TYPE_NOT_FOUND: Content type ${contentTypeId} was not found in the active domain.`);
                }

                contentType = {
                    id: type.id,
                    name: type.name,
                    slug: type.slug,
                    description: type.description,
                    schema: type.schema,
                    basePrice: type.basePrice,
                    createdAt: toOptionalIsoString(type.createdAt),
                    updatedAt: toOptionalIsoString(type.updatedAt),
                };

                const activeWorkflow = await WorkflowService.getActiveWorkflowWithTransitions(domainId, contentTypeId);
                if (activeWorkflow) {
                    workflow = {
                        id: activeWorkflow.id,
                        name: activeWorkflow.name,
                        contentTypeId: activeWorkflow.contentTypeId,
                        active: activeWorkflow.active,
                        transitions: activeWorkflow.transitions.map((transition) => ({
                            id: transition.id,
                            workflowId: transition.workflowId,
                            fromState: transition.fromState,
                            toState: transition.toState,
                            requiredRoles: Array.isArray(transition.requiredRoles) ? transition.requiredRoles : [],
                        })),
                    };
                }
            } else if (contentTypeId !== undefined) {
                warnings.push('Schema inspection is unavailable until the current actor has content read access.');
            }

            const guide = buildContentGuide({
                contentTypeId,
                contentType,
                workflow,
                currentActor,
            });
            if (warnings.length > 0) {
                guide.warnings = [...(guide.warnings ?? []), ...warnings];
            }

            return okJson({
                ...basePayload,
                reactiveRecommendation: buildReactiveTaskRecommendation(principal, {
                    taskId,
                    contentTypeId,
                }),
                guide,
            });
        }

        if (taskId === 'review-workflow') {
            let tasks: ReturnType<typeof serializePendingReviewTaskForGuide>[] = [];
            const warnings: string[] = [];

            if (canWriteContent(currentActor)) {
                const pendingTasks = await WorkflowService.listPendingReviewTasks(domainId);
                tasks = pendingTasks.map(serializePendingReviewTaskForGuide);
            } else {
                warnings.push('Pending review tasks are unavailable until the current actor has content write access.');
            }

            const guide = buildWorkflowGuide({
                tasks,
                currentActor,
                preferredTaskId: reviewTaskId,
            });
            if (warnings.length > 0) {
                guide.warnings = [...(guide.warnings ?? []), ...warnings];
            }

            return okJson({
                ...basePayload,
                reactiveRecommendation: buildReactiveTaskRecommendation(principal, {
                    taskId,
                    reviewTaskId,
                }),
                guide,
            });
        }

        if (taskId === 'manage-integrations') {
            let apiKeys: ReturnType<typeof serializeApiKeyForGuide>[] | null = null;
            let webhooks: ReturnType<typeof serializeWebhookForGuide>[] | null = null;
            const warnings: string[] = [];

            if (canManageIntegrations(currentActor)) {
                apiKeys = (await listApiKeys(domainId)).map(serializeApiKeyForGuide);
                webhooks = (await listWebhooks(domainId)).map(serializeWebhookForGuide);
            } else {
                warnings.push('Integration inventory is unavailable until the current actor has admin or tenant:admin scope.');
            }

            const guide = buildIntegrationGuide({
                currentActor,
                apiKeys,
                webhooks,
            });
            if (warnings.length > 0) {
                guide.warnings = [...(guide.warnings ?? []), ...warnings];
            }

            return okJson({
                ...basePayload,
                reactiveRecommendation: buildReactiveTaskRecommendation(principal, {
                    taskId,
                }),
                guide,
            });
        }

        if (taskId === 'verify-provenance') {
            let entries: Array<{
                id: number;
                action: string;
                entityType: string;
                entityId: number;
                actorId: string | null;
                actorType: string | null;
                actorSource: string | null;
                details: string | null;
                createdAt: string;
            }> = [];
            const warnings: string[] = [];
            const auditLimit = clampLimit(limit, 20, 100);

            if (hasActorScope(currentActor, 'audit:read')) {
                const filters = [
                    eq(auditLogs.domainId, domainId),
                    actorId ? eq(auditLogs.actorId, actorId) : undefined,
                    actorType ? eq(auditLogs.actorType, actorType) : undefined,
                    entityType ? eq(auditLogs.entityType, entityType) : undefined,
                    entityId !== undefined ? eq(auditLogs.entityId, entityId) : undefined,
                    action ? eq(auditLogs.action, action) : undefined,
                ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

                entries = (await db.select({
                    id: auditLogs.id,
                    action: auditLogs.action,
                    entityType: auditLogs.entityType,
                    entityId: auditLogs.entityId,
                    actorId: auditLogs.actorId,
                    actorType: auditLogs.actorType,
                    actorSource: auditLogs.actorSource,
                    details: auditLogs.details,
                    createdAt: auditLogs.createdAt,
                })
                    .from(auditLogs)
                    .where(and(...filters))
                    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
                    .limit(auditLimit))
                    .map((entry) => ({
                        ...entry,
                        createdAt: entry.createdAt.toISOString(),
                    }));
            } else {
                warnings.push('Audit events are unavailable until the current actor has audit read access.');
            }

            const guide = buildAuditGuide({
                currentActor,
                entries,
                actorId,
                actorType,
                entityType,
                entityId,
                action,
                limit: auditLimit,
            });
            if (warnings.length > 0) {
                guide.warnings = [...(guide.warnings ?? []), ...warnings];
            }

            return okJson({
                ...basePayload,
                reactiveRecommendation: buildReactiveTaskRecommendation(principal, {
                    taskId,
                    actorId,
                    actorType,
                    entityType,
                    entityId,
                    action,
                }),
                guide,
            });
        }

        if (contentItemId === undefined) {
            return err('MISSING_CONTENT_ITEM_ID: guide_task consume-paid-content requires contentItemId.');
        }

        let offers: Array<{
            id: number;
            slug: string;
            name: string;
            scopeType: string;
            scopeRef: number | null;
            priceSats: number;
            active: boolean;
        }> = [];
        let apiKeyConfigured = false;
        const warnings: string[] = [];

        if (hasActorScope(currentActor, 'content:read')) {
            const [item] = await db.select().from(contentItems).where(and(
                eq(contentItems.id, contentItemId),
                eq(contentItems.domainId, domainId),
            ));

            if (!item) {
                return err(`CONTENT_ITEM_NOT_FOUND: Content item ${contentItemId} was not found in the active domain.`);
            }

            offers = await LicensingService.getActiveOffersForItemRead(domainId, contentItemId, item.contentTypeId);
            apiKeyConfigured = currentActor.actorProfileId === 'api-key' || currentActor.actorProfileId === 'env-key';
        } else {
            warnings.push('Live paid-content offer discovery is unavailable until the current actor has content read access.');
        }

        const guide = buildL402Guide({
            itemId: contentItemId,
            offers,
            apiKeyConfigured,
            currentActor,
            preferredOfferId: offerId,
        });
        if (warnings.length > 0) {
            guide.warnings = [...(guide.warnings ?? []), ...warnings];
        }

        return okJson({
            ...basePayload,
            guide,
        });
    }
);

server.resource(
    'capabilities',
    'system://capabilities',
    async (uri) => {
        return {
            contents: [{
                uri: uri.href,
                text: JSON.stringify(buildCapabilityManifest(), null, 2)
            }]
        };
    }
);

server.resource(
    'agent-guidance',
    'system://agent-guidance',
    async (uri) => {
        return {
            contents: [{
                uri: uri.href,
                text: JSON.stringify(buildCapabilityManifest().agentGuidance, null, 2)
            }]
        };
    }
);

server.resource(
    'current-actor',
    'system://current-actor',
    async (uri, extra) => {
        return {
            contents: [{
                uri: uri.href,
                text: JSON.stringify(buildCurrentActorSnapshot(resolveMcpPrincipal(extra as McpRequestExtra | undefined)), null, 2)
            }]
        };
    }
);

server.resource(
    'workspace-context',
    'system://workspace-context',
    async (uri, extra) => {
        const currentActor = buildCurrentActorSnapshot(resolveMcpPrincipal(extra as McpRequestExtra | undefined));
        return {
            contents: [{
                uri: uri.href,
                text: JSON.stringify(await getWorkspaceContextSnapshot(currentActor), null, 2)
            }]
        };
    }
);

server.resource(
    'workspace-context-by-intent',
    new ResourceTemplate('system://workspace-context/{intent}', { list: undefined }),
    async (uri, variables, extra) => {
        const currentActor = buildCurrentActorSnapshot(resolveMcpPrincipal(extra as McpRequestExtra | undefined));
        const intent = readResourceTemplateValue(variables.intent);
        return {
            contents: [{
                uri: uri.href,
                text: JSON.stringify(await getWorkspaceContextSnapshot(currentActor, {
                    intent: intent === 'all' || intent === 'authoring' || intent === 'review' || intent === 'workflow' || intent === 'paid'
                        ? intent
                        : undefined,
                }), null, 2)
            }]
        };
    }
);

server.resource(
    'workspace-target-by-intent',
    new ResourceTemplate('system://workspace-target/{intent}', { list: undefined }),
    async (uri, variables, extra) => {
        const currentActor = buildCurrentActorSnapshot(resolveMcpPrincipal(extra as McpRequestExtra | undefined));
        const intent = readResourceTemplateValue(variables.intent);
        return {
            contents: [{
                uri: uri.href,
                text: JSON.stringify(await resolveWorkspaceTarget(currentActor, {
                    intent: intent === 'authoring' || intent === 'review' || intent === 'workflow' || intent === 'paid'
                        ? intent
                        : 'authoring',
                }), null, 2)
            }]
        };
    }
);

server.resource(
    'workspace-context-by-intent-and-limit',
    new ResourceTemplate('system://workspace-context/{intent}/{limit}', { list: undefined }),
    async (uri, variables, extra) => {
        const currentActor = buildCurrentActorSnapshot(resolveMcpPrincipal(extra as McpRequestExtra | undefined));
        const intent = readResourceTemplateValue(variables.intent);
        const limitValue = readResourceTemplateValue(variables.limit);
        const limit = limitValue ? Number.parseInt(limitValue, 10) : undefined;
        return {
            contents: [{
                uri: uri.href,
                text: JSON.stringify(await getWorkspaceContextSnapshot(currentActor, {
                    intent: intent === 'all' || intent === 'authoring' || intent === 'review' || intent === 'workflow' || intent === 'paid'
                        ? intent
                        : undefined,
                    limit: Number.isFinite(limit) ? limit : undefined,
                }), null, 2)
            }]
        };
    }
);

server.resource(
    'deployment-status',
    'system://deployment-status',
    async (uri) => {
        return {
            contents: [{
                uri: uri.href,
                text: JSON.stringify(await getDeploymentStatusSnapshot(), null, 2)
            }]
        };
    }
);

server.resource(
    'assets',
    'content://assets',
    async (uri, extra) => {
        const domainId = resolveMcpPrincipal(extra as McpRequestExtra | undefined).domainId;
        const result = await listAssets(domainId, {
            status: 'active',
            limit: 100
        });

        return {
            contents: [{
                uri: uri.href,
                text: JSON.stringify({
                    items: result.items.map((asset) => serializeAssetForMcp(asset)),
                    total: result.total,
                    limit: result.limit,
                    hasMore: result.hasMore,
                    nextCursor: result.nextCursor
                }, null, 2)
            }]
        };
    }
);

server.resource(
    'asset',
    new ResourceTemplate('content://assets/{id}', { list: undefined }),
    async (uri, variables, extra) => {
        const domainId = resolveMcpPrincipal(extra as McpRequestExtra | undefined).domainId;
        const idValue = readResourceTemplateValue(variables.id);
        const id = Number(idValue);

        if (!Number.isInteger(id) || id <= 0) {
            return {
                contents: [{
                    uri: uri.href,
                    text: JSON.stringify({
                        error: 'INVALID_ASSET_ID',
                        remediation: 'Use content://assets/<positive integer id>.'
                    }, null, 2)
                }]
            };
        }

        const asset = await getAsset(id, domainId);
        return {
            contents: [{
                uri: uri.href,
                text: JSON.stringify(
                    asset
                        ? serializeAssetForMcp(asset)
                        : {
                            error: 'ASSET_NOT_FOUND',
                            remediation: 'List content://assets to discover valid asset IDs in the current domain.'
                        },
                    null,
                    2
                )
            }]
        };
    }
);

server.resource(
    'asset-derivatives',
    new ResourceTemplate('content://assets/{id}/derivatives', { list: undefined }),
    async (uri, variables, extra) => {
        const domainId = resolveMcpPrincipal(extra as McpRequestExtra | undefined).domainId;
        const idValue = readResourceTemplateValue(variables.id);
        const id = Number(idValue);

        if (!Number.isInteger(id) || id <= 0) {
            return {
                contents: [{
                    uri: uri.href,
                    text: JSON.stringify({
                        error: 'INVALID_ASSET_ID',
                        remediation: 'Use content://assets/<positive integer id>/derivatives.'
                    }, null, 2)
                }]
            };
        }

        const asset = await getAsset(id, domainId);
        if (!asset) {
            return {
                contents: [{
                    uri: uri.href,
                    text: JSON.stringify({
                        error: 'ASSET_NOT_FOUND',
                        remediation: 'List content://assets to discover valid asset IDs in the current domain.'
                    }, null, 2)
                }]
            };
        }

        const derivatives = await listAssetDerivatives(id, domainId);
        return {
            contents: [{
                uri: uri.href,
                text: JSON.stringify({
                    sourceAsset: serializeAssetForMcp(asset),
                    items: derivatives.map((candidate) => serializeAssetForMcp(candidate)),
                    total: derivatives.length,
                }, null, 2)
            }]
        };
    }
);

server.resource(
    'content-types',
    'content://types',
    async (uri, extra) => {
        const domainId = resolveMcpPrincipal(extra as McpRequestExtra | undefined).domainId;
        const types = await db.select().from(contentTypes).where(eq(contentTypes.domainId, domainId));
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
    async ({ contentTypeId, topic }, extra) => {
        const id = Number.parseInt(contentTypeId, 10);
        const domainId = resolveMcpPrincipal(extra).domainId;
        const [type] = await db.select().from(contentTypes).where(and(eq(contentTypes.id, id), eq(contentTypes.domainId, domainId)));

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

if (isExperimentalRevenueEnabled()) {
    server.tool(
        'get_my_earnings',
        'Experimental: get agent earnings including pending, cleared, and disputed balances',
        {
            apiKeyId: z.number().describe('Your API Key ID')
        },
        withMCPPolicy('content.read', () => ({ type: 'system' }), async ({ apiKeyId }, extra, domainId) => {
            try {
                const [profile] = await db.select().from(agentProfiles).where(and(eq(agentProfiles.apiKeyId, apiKeyId), eq(agentProfiles.domainId, domainId)));

                if (!profile) {
                    return err('Agent profile not found for this API key');
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

                return okJson(earnings);
            } catch (error) {
                return err(`Error fetching earnings: ${(error as Error).message}`);
            }
        })
    );
}

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

server.prompt(
    'task-guidance',
    'Explain the preferred WordClaw workflow for a specific agent task',
    {
        taskId: z.string().describe('Task recipe id, e.g. author-content or consume-paid-content')
    },
    async ({ taskId }) => {
        const manifest = buildCapabilityManifest();
        const recipe = manifest.agentGuidance.taskRecipes.find((task) => task.id === taskId);

        if (!recipe) {
            const available = manifest.agentGuidance.taskRecipes.map((task) => task.id).join(', ');
            return {
                messages: [{
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `Unknown task "${taskId}". Available tasks: ${available}.`
                    }
                }]
            };
        }

        const actorProfiles = recipe.supportedActorProfiles
            .map((profileId) => manifest.agentGuidance.actorProfiles.find((profile) => profile.id === profileId))
            .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile));

        const steps = recipe.steps
            .map((step, index) => `${index + 1}. ${step.title} [${step.surface}] ${step.operation}\n   Purpose: ${step.purpose}${'optional' in step && step.optional ? ' (optional)' : ''}`)
            .join('\n');
        const actors = actorProfiles
            .map((profile) => {
                const actorExamples = profile.actorIdExamples.length > 0
                    ? profile.actorIdExamples.join(', ')
                    : 'none (public unauthenticated)';
                const domainContext = profile.domainContext.required
                    ? `${profile.domainContext.strategy}${profile.domainContext.header ? ` via ${profile.domainContext.header}` : ''}${profile.domainContext.environmentVariable ? ` via ${profile.domainContext.environmentVariable}` : ''}`
                    : 'not required';

                return `- ${profile.id} (${profile.label})\n   Actor type: ${profile.actorType}\n   Auth mode: ${profile.authMode}\n   Surfaces: ${profile.availableSurfaces.join(', ')}\n   Domain context: ${domainContext}\n   Actor IDs: ${actorExamples}\n   Notes: ${profile.notes.join(' ')}`;
            })
            .join('\n');
        const reactiveFollowUp = recipe.reactiveFollowUp
            ? `\n\nReactive follow-up:\nPurpose: ${recipe.reactiveFollowUp.purpose}\nRecipe: ${recipe.reactiveFollowUp.recipeId ?? 'none (explicit topics)'}\nTopics: ${recipe.reactiveFollowUp.topics.join(', ')}\nRecommended filters: ${recipe.reactiveFollowUp.recommendedFilters.join(', ') || 'none'}\nExample subscribe_events payload: ${JSON.stringify(recipe.reactiveFollowUp.example.arguments)}\nNote: ${recipe.reactiveFollowUp.note}`
            : '';

        return {
            messages: [{
                role: 'user',
                content: {
                    type: 'text',
                    text: `Task: ${recipe.id}\nGoal: ${recipe.goal}\nPreferred surface: ${recipe.preferredSurface}\nFallback surface: ${recipe.fallbackSurface ?? 'none'}\nRecommended auth: ${recipe.recommendedAuth}\nPreferred actor profile: ${recipe.preferredActorProfile}\nSupported actor profiles: ${recipe.supportedActorProfiles.join(', ')}\nRecommended API-key scopes: ${recipe.recommendedApiKeyScopes.join(', ') || 'none'}\nRequired modules: ${recipe.requiredModules.join(', ') || 'none'}\nDry-run recommended: ${recipe.dryRunRecommended ? 'yes' : 'no'}\n\nActor guidance:\n${actors}\n\nSteps:\n${steps}${reactiveFollowUp}`
                }
            }]
        };
    }
);

return server;
}

export async function startServer() {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('WordClaw MCP Server running on stdio');
}
