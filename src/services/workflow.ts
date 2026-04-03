import { db } from '../db/index.js';
import {
    workflows,
    workflowTransitions,
    reviewTasks,
    reviewComments,
    contentItems,
    contentItemVersions,
    contentTypes,
    jobs,
    formDefinitions,
    externalFeedbackEvents,
} from '../db/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getAiProviderSecretConfig } from './ai-provider-config.js';
import { getAsset, readAssetContent } from './assets.js';
import { validateContentDataAgainstSchema } from './content-schema.js';
import { updateContentItem } from './content-item.service.js';
import {
    DraftGenerationError,
    generateDraftData,
    type DraftGenerationAssetReference,
    type DraftGenerationAttachment,
    type DraftGenerationProviderConfig,
    type DraftGenerationProviderProvisioning,
    type DraftGenerationWorkforceAgentReference,
} from './draft-generation.js';
import { EmbeddingService } from './embedding.js';
import { logAudit } from './audit.js';
import { enqueueWebhookJob } from './jobs.js';
import {
    buildActorAssignmentRefs,
    resolveActorIdentity,
    resolveActorIdentityRef,
    toAuditActor,
    type PrincipalLike,
} from './actor-identity.js';

export interface WorkflowTransitionContext {
    domainId: number;
    contentItemId: number;
    workflowTransitionId: number;
    assignee?: string;
    source?: 'author_submit' | 'external_feedback';
    sourceEventId?: number | null;
    authPrincipal?: PrincipalLike & { scopes: Set<string>, domainId: number };
}

type AuthenticatedWorkflowPrincipal = PrincipalLike & {
    scopes: Set<string>;
    domainId: number;
};

type ReviewTaskRow = typeof reviewTasks.$inferSelect;

type DraftGenerationReviewContext = {
    form: {
        id: number;
        slug: string;
        name: string;
        webhookUrl: string | null;
        webhookSecret: string | null;
    };
    job: {
        id: number;
        intakeContentItemId: number;
        intakeAssetReferences: DraftGenerationAssetReference[];
        targetContentTypeId: number;
        workforceAgentId: number | null;
        workforceAgentSlug: string | null;
        workforceAgentName: string | null;
        workforceAgentPurpose: string | null;
        agentSoul: string;
        fieldMap: Record<string, string>;
        defaultData: Record<string, unknown>;
        provider: DraftGenerationProviderConfig;
        providerType: string;
        providerModel: string | null;
        strategy: string | null;
    };
    submission: {
        contentItemId: number;
        status: string;
        data: Record<string, unknown>;
    };
    generated: {
        contentItemId: number;
        status: string;
        version: number;
        data: Record<string, unknown>;
    };
};

type DraftGenerationReviewWebhookContext = DraftGenerationReviewContext & {
    form: {
        id: number;
        slug: string;
        name: string;
        webhookUrl: string;
        webhookSecret: string | null;
    };
};

export type ReviewTaskRevisionResult = {
    taskId: number;
    contentItemId: number;
    contentStatus: string;
    contentVersion: number;
    revisedAt: Date;
    strategy: string;
    provider: {
        type: DraftGenerationProviderConfig['type'];
        model: string | null;
        responseId: string | null;
    };
};

export type ExternalFeedbackDecision = 'accepted' | 'changes_requested';
export type ExternalFeedbackRefinementMode = 'human_supervised' | 'agent_direct';

export type ExternalFeedbackSubmissionInput = {
    domainId: number;
    contentItemId: number;
    workflowTransitionId?: number;
    decision?: unknown;
    comment?: unknown;
    prompt?: unknown;
    refinementMode?: unknown;
    submitter?: unknown;
    authPrincipal?: AuthenticatedWorkflowPrincipal;
};

export type ExternalFeedbackSubmissionResult = {
    event: typeof externalFeedbackEvents.$inferSelect;
    reviewTask: typeof reviewTasks.$inferSelect | null;
    revision: ReviewTaskRevisionResult | null;
};

const INLINE_IMAGE_ATTACHMENT_LIMIT = 4;
const INLINE_IMAGE_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

export class WorkflowServiceError extends Error {
    code: string;
    remediation: string;
    statusCode: number;

    constructor(message: string, code: string, remediation: string, statusCode = 400) {
        super(message);
        this.name = 'WorkflowServiceError';
        this.code = code;
        this.remediation = remediation;
        this.statusCode = statusCode;
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readPositiveInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value > 0
        ? value
        : null;
}

function normalizeOptionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeExternalFeedbackDecision(value: unknown): ExternalFeedbackDecision | null {
    if (value === 'accepted' || value === 'changes_requested') {
        return value;
    }

    if (value === undefined || value === null) {
        return null;
    }

    throw new WorkflowServiceError(
        'External feedback decision is invalid.',
        'EXTERNAL_FEEDBACK_DECISION_INVALID',
        "Use decision = 'accepted' or 'changes_requested', or omit it.",
        400,
    );
}

function normalizeExternalFeedbackRefinementMode(value: unknown): ExternalFeedbackRefinementMode {
    if (value === undefined || value === null) {
        return 'human_supervised';
    }

    if (value === 'human_supervised' || value === 'agent_direct') {
        return value;
    }

    throw new WorkflowServiceError(
        'External feedback refinement mode is invalid.',
        'EXTERNAL_FEEDBACK_REFINEMENT_MODE_INVALID',
        "Use refinementMode = 'human_supervised' or 'agent_direct'.",
        400,
    );
}

type ExternalFeedbackSubmitter = {
    actorId: string;
    actorType: 'external_requester';
    actorSource: string;
    displayName: string | null;
    email: string | null;
};

function normalizeExternalFeedbackSubmitter(value: unknown): ExternalFeedbackSubmitter {
    if (!isObject(value)) {
        throw new WorkflowServiceError(
            'External feedback submitter is required.',
            'EXTERNAL_FEEDBACK_SUBMITTER_REQUIRED',
            'Provide submitter.actorId and submitter.actorSource so the client feedback can be attributed correctly.',
            400,
        );
    }

    const actorId = normalizeOptionalString(value.actorId);
    const actorSource = normalizeOptionalString(value.actorSource);
    const actorType = normalizeOptionalString(value.actorType) ?? 'external_requester';
    if (!actorId || !actorSource) {
        throw new WorkflowServiceError(
            'External feedback submitter is incomplete.',
            'EXTERNAL_FEEDBACK_SUBMITTER_INVALID',
            'Provide submitter.actorId and submitter.actorSource as non-empty strings.',
            400,
        );
    }

    if (actorType !== 'external_requester') {
        throw new WorkflowServiceError(
            'External feedback submitter type is invalid.',
            'EXTERNAL_FEEDBACK_SUBMITTER_TYPE_INVALID',
            "Use submitter.actorType = 'external_requester' or omit it.",
            400,
        );
    }

    return {
        actorId,
        actorType: 'external_requester',
        actorSource,
        displayName: normalizeOptionalString(value.displayName),
        email: normalizeOptionalString(value.email),
    };
}

function buildExternalFeedbackComment(input: {
    submitter: ExternalFeedbackSubmitter;
    decision: ExternalFeedbackDecision | null;
    comment: string | null;
    prompt: string | null;
}): string {
    const label = input.submitter.displayName ?? input.submitter.actorId;
    const header = input.decision
        ? `External feedback from ${label} (${input.decision})`
        : `External feedback from ${label}`;
    const parts = [header];

    if (input.comment) {
        parts.push(input.comment);
    }

    if (input.prompt) {
        parts.push(`Prompt: ${input.prompt}`);
    }

    return parts.join('\n\n');
}

function requiresExternalFeedbackRevision(input: {
    decision: ExternalFeedbackDecision | null;
    prompt: string | null;
    refinementMode: ExternalFeedbackRefinementMode;
}): boolean {
    if (input.refinementMode === 'agent_direct') {
        return true;
    }

    if (input.prompt) {
        return true;
    }

    return input.decision === 'changes_requested';
}

function parseObjectData(value: unknown): Record<string, unknown> | null {
    if (isObject(value)) {
        return value;
    }

    if (typeof value !== 'string' || value.trim().length === 0) {
        return null;
    }

    try {
        const parsed = JSON.parse(value);
        return isObject(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function parseDraftGenerationFieldMap(value: unknown): Record<string, string> {
    if (!isObject(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value).flatMap(([sourceFieldName, targetFieldName]) => {
            const normalizedSourceFieldName = sourceFieldName.trim();
            const normalizedTargetFieldName = normalizeOptionalString(targetFieldName);
            if (!normalizedSourceFieldName || !normalizedTargetFieldName) {
                return [];
            }

            return [[normalizedSourceFieldName, normalizedTargetFieldName]];
        }),
    );
}

function parseDraftGenerationDefaultData(value: unknown): Record<string, unknown> {
    return isObject(value) ? value : {};
}

function parseDraftGenerationAssetReferences(value: unknown): DraftGenerationAssetReference[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.flatMap((entry) => {
        if (!isObject(entry)) {
            return [];
        }

        const assetId = readPositiveInteger(entry.assetId);
        const path = normalizeOptionalString(entry.path);
        if (!assetId || !path) {
            return [];
        }

        return [{ assetId, path }];
    });
}

function normalizeDraftGenerationProviderConfig(value: unknown): DraftGenerationProviderConfig {
    if (!isObject(value)) {
        return { type: 'deterministic' };
    }

    const providerType = normalizeOptionalString(value.type) ?? 'deterministic';
    const model = normalizeOptionalString(value.model);
    const instructions = normalizeOptionalString(value.instructions);

    if (providerType === 'openai' || providerType === 'anthropic' || providerType === 'gemini') {
        return {
            type: providerType,
            ...(model ? { model } : {}),
            ...(instructions ? { instructions } : {}),
        };
    }

    return { type: 'deterministic' };
}

function isImageMimeType(mimeType: string): boolean {
    return mimeType.startsWith('image/');
}

function supportsInlineImageProvider(providerType: DraftGenerationProviderConfig['type']): boolean {
    return providerType === 'openai' || providerType === 'anthropic' || providerType === 'gemini';
}

async function resolveDraftGenerationProviderProvisioning(
    domainId: number,
    provider: DraftGenerationProviderConfig,
): Promise<DraftGenerationProviderProvisioning | null> {
    if (provider.type === 'deterministic') {
        return {
            type: 'deterministic',
        };
    }

    const configuredProvider = await getAiProviderSecretConfig(domainId, provider.type);
    if (!configuredProvider) {
        return null;
    }

    if (provider.type === 'openai') {
        return {
            type: 'openai',
            apiKey: configuredProvider.apiKey,
            defaultModel: configuredProvider.defaultModel,
        };
    }

    if (provider.type === 'anthropic') {
        return {
            type: 'anthropic',
            apiKey: configuredProvider.apiKey,
            defaultModel: configuredProvider.defaultModel,
        };
    }

    return {
        type: 'gemini',
        apiKey: configuredProvider.apiKey,
        defaultModel: configuredProvider.defaultModel,
    };
}

async function resolveDraftGenerationAttachments(
    domainId: number,
    provider: DraftGenerationProviderConfig,
    references: DraftGenerationAssetReference[],
): Promise<DraftGenerationAttachment[]> {
    if (references.length === 0) {
        return [];
    }

    let remainingInlineImages = supportsInlineImageProvider(provider.type)
        ? INLINE_IMAGE_ATTACHMENT_LIMIT
        : 0;
    const attachments: DraftGenerationAttachment[] = [];

    for (const reference of references) {
        const asset = await getAsset(reference.assetId, domainId);
        if (!asset) {
            throw new WorkflowServiceError(
                `Referenced intake asset ${reference.assetId} is no longer available in domain ${domainId}.`,
                'REVIEW_TASK_AI_REVISION_ASSET_NOT_FOUND',
                'Remove the stale asset reference from the intake submission or restore the asset before retrying.',
                409,
            );
        }

        if (!isImageMimeType(asset.mimeType)) {
            continue;
        }

        let inlineImageDataUrl: string | null = null;
        if (
            supportsInlineImageProvider(provider.type)
            && remainingInlineImages > 0
            && asset.sizeBytes <= INLINE_IMAGE_ATTACHMENT_MAX_BYTES
        ) {
            try {
                const bytes = await readAssetContent(asset);
                const base64Data = bytes.toString('base64');
                inlineImageDataUrl = `data:${asset.mimeType};base64,${base64Data}`;
                remainingInlineImages -= 1;
                attachments.push({
                    assetId: asset.id,
                    path: reference.path,
                    filename: asset.filename,
                    originalFilename: asset.originalFilename,
                    mimeType: asset.mimeType,
                    sizeBytes: asset.sizeBytes,
                    accessMode: asset.accessMode as DraftGenerationAttachment['accessMode'],
                    inlineImageDataUrl,
                    inlineImageBase64: base64Data,
                });
                continue;
            } catch {
                inlineImageDataUrl = null;
            }
        }

        attachments.push({
            assetId: asset.id,
            path: reference.path,
            filename: asset.filename,
            originalFilename: asset.originalFilename,
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
            accessMode: asset.accessMode as DraftGenerationAttachment['accessMode'],
            inlineImageDataUrl,
            inlineImageBase64: null,
        });
    }

    return attachments;
}

async function loadDraftGenerationReviewContext(
    domainId: number,
    generatedContentItemId: number,
): Promise<DraftGenerationReviewContext | null> {
    const [jobRow] = await db.select()
        .from(jobs)
        .where(and(
            eq(jobs.domainId, domainId),
            eq(jobs.kind, 'draft_generation'),
            sql<boolean>`(((${jobs.result})::jsonb ->> 'generatedContentItemId')::integer) = ${generatedContentItemId}`,
        ))
        .orderBy(desc(jobs.completedAt), desc(jobs.id))
        .limit(1);

    if (!jobRow || !isObject(jobRow.payload)) {
        return null;
    }

    const payload = jobRow.payload;
    const result = isObject(jobRow.result) ? jobRow.result : {};
    const formId = readPositiveInteger(payload.formId);
    const intakeContentItemId = readPositiveInteger(payload.intakeContentItemId);
    const targetContentTypeId = readPositiveInteger(payload.targetContentTypeId);
    const agentSoul = normalizeOptionalString(payload.agentSoul);
    if (!formId || !intakeContentItemId || !targetContentTypeId || !agentSoul) {
        return null;
    }

    const [form] = await db.select({
        id: formDefinitions.id,
        slug: formDefinitions.slug,
        name: formDefinitions.name,
        webhookUrl: formDefinitions.webhookUrl,
        webhookSecret: formDefinitions.webhookSecret,
    })
        .from(formDefinitions)
        .where(and(
            eq(formDefinitions.domainId, domainId),
            eq(formDefinitions.id, formId),
        ));

    if (!form) {
        return null;
    }

    const [submissionItem] = await db.select({
        id: contentItems.id,
        status: contentItems.status,
        data: contentItems.data,
    })
        .from(contentItems)
        .where(and(
            eq(contentItems.domainId, domainId),
            eq(contentItems.id, intakeContentItemId),
        ));

    const [generatedItem] = await db.select({
        id: contentItems.id,
        status: contentItems.status,
        version: contentItems.version,
        data: contentItems.data,
    })
        .from(contentItems)
        .where(and(
            eq(contentItems.domainId, domainId),
            eq(contentItems.id, generatedContentItemId),
        ));

    if (!submissionItem || !generatedItem) {
        return null;
    }

    return {
        form: {
            id: form.id,
            slug: form.slug,
            name: form.name,
            webhookUrl: normalizeOptionalString(form.webhookUrl),
            webhookSecret: normalizeOptionalString(form.webhookSecret),
        },
        job: {
            id: jobRow.id,
            intakeContentItemId,
            intakeAssetReferences: parseDraftGenerationAssetReferences(payload.intakeAssetReferences),
            targetContentTypeId,
            workforceAgentId: readPositiveInteger(payload.workforceAgentId),
            workforceAgentSlug: normalizeOptionalString(payload.workforceAgentSlug),
            workforceAgentName: normalizeOptionalString(payload.workforceAgentName),
            workforceAgentPurpose: normalizeOptionalString(payload.workforceAgentPurpose),
            agentSoul,
            fieldMap: parseDraftGenerationFieldMap(payload.fieldMap),
            defaultData: parseDraftGenerationDefaultData(payload.defaultData),
            provider: normalizeDraftGenerationProviderConfig(payload.provider),
            providerType: normalizeOptionalString((isObject(result.provider) ? result.provider.type : null))
                ?? normalizeOptionalString((isObject(payload.provider) ? payload.provider.type : null))
                ?? 'deterministic',
            providerModel: normalizeOptionalString((isObject(result.provider) ? result.provider.model : null))
                ?? normalizeOptionalString((isObject(payload.provider) ? payload.provider.model : null)),
            strategy: normalizeOptionalString(result.strategy),
        },
        submission: {
            contentItemId: submissionItem.id,
            status: submissionItem.status,
            data: parseObjectData(submissionItem.data) ?? {},
        },
        generated: {
            contentItemId: generatedItem.id,
            status: generatedItem.status,
            version: generatedItem.version,
            data: parseObjectData(generatedItem.data) ?? {},
        },
    };
}

async function loadDraftGenerationReviewWebhookContext(
    domainId: number,
    generatedContentItemId: number,
): Promise<DraftGenerationReviewWebhookContext | null> {
    const context = await loadDraftGenerationReviewContext(domainId, generatedContentItemId);
    const webhookUrl = normalizeOptionalString(context?.form.webhookUrl);
    if (!context || !webhookUrl) {
        return null;
    }

    return {
        ...context,
        form: {
            ...context.form,
            webhookUrl,
        },
    };
}

async function authorizePendingReviewTask(
    domainId: number,
    taskId: number,
    authPrincipal: AuthenticatedWorkflowPrincipal,
): Promise<ReviewTaskRow> {
    const results = await db.select()
        .from(reviewTasks)
        .where(and(eq(reviewTasks.id, taskId), eq(reviewTasks.domainId, domainId)));
    const task = results[0];

    if (!task || task.status !== 'pending') {
        throw new WorkflowServiceError(
            'Review task is no longer pending or could not be found.',
            'INVALID_REVIEW_TASK_STATE_OR_NOT_FOUND',
            'Refresh the approval queue and choose a task that is still pending review.',
            409,
        );
    }

    const isAdmin = authPrincipal.scopes.has('admin');
    const assignmentRefs = buildActorAssignmentRefs(authPrincipal);
    const isAssignee = task.assignee ? assignmentRefs.includes(task.assignee) : false;

    if (!isAdmin && !isAssignee) {
        throw new WorkflowServiceError(
            'Must be an assignee or admin to operate on this review task.',
            'UNAUTHORIZED_REVIEW_DECISION',
            'Sign in as the assigned reviewer or an administrator before retrying.',
            403,
        );
    }

    return task;
}

async function transitionContentItemStatus(
    domainId: number,
    contentItemId: number,
    nextStatus: string,
) {
    return db.transaction(async (tx) => {
        const [item] = await tx.select()
            .from(contentItems)
            .where(and(
                eq(contentItems.id, contentItemId),
                eq(contentItems.domainId, domainId),
            ));

        if (!item) {
            throw new Error('CONTENT_ITEM_NOT_FOUND_OR_UNMATCHED_DOMAIN');
        }

        if (item.status === nextStatus) {
            return {
                previousItem: item,
                updatedItem: item,
                changed: false,
            };
        }

        await tx.insert(contentItemVersions).values({
            contentItemId: item.id,
            version: item.version,
            data: item.data,
            status: item.status,
            createdAt: item.updatedAt,
        });

        const [updatedItem] = await tx.update(contentItems)
            .set({
                status: nextStatus,
                version: item.version + 1,
                updatedAt: new Date(),
            })
            .where(and(
                eq(contentItems.id, contentItemId),
                eq(contentItems.domainId, domainId),
            ))
            .returning();

        if (!updatedItem) {
            throw new Error('CONTENT_ITEM_NOT_FOUND_OR_UNMATCHED_DOMAIN');
        }

        return {
            previousItem: item,
            updatedItem,
            changed: true,
        };
    });
}

async function resolveExternalFeedbackPublishedVersion(
    domainId: number,
    contentItemId: number,
): Promise<{ item: typeof contentItems.$inferSelect; publishedVersion: number }> {
    const [item] = await db.select()
        .from(contentItems)
        .where(and(
            eq(contentItems.domainId, domainId),
            eq(contentItems.id, contentItemId),
        ));

    if (!item) {
        throw new WorkflowServiceError(
            'Content item not found for external feedback.',
            'EXTERNAL_FEEDBACK_CONTENT_ITEM_NOT_FOUND',
            'Retry with a content item that exists in the current tenant.',
            404,
        );
    }

    if (item.status === 'published') {
        return {
            item,
            publishedVersion: item.version,
        };
    }

    const [publishedVersion] = await db.select({
        version: contentItemVersions.version,
    })
        .from(contentItemVersions)
        .where(and(
            eq(contentItemVersions.contentItemId, contentItemId),
            eq(contentItemVersions.status, 'published'),
        ))
        .orderBy(desc(contentItemVersions.version), desc(contentItemVersions.id))
        .limit(1);

    if (!publishedVersion) {
        throw new WorkflowServiceError(
            'External feedback requires a published snapshot.',
            'EXTERNAL_FEEDBACK_REQUIRES_PUBLISHED_SNAPSHOT',
            'Publish the content item once before accepting client feedback on it.',
            409,
        );
    }

    return {
        item,
        publishedVersion: publishedVersion.version,
    };
}

async function resolveExternalFeedbackTransitionId(
    domainId: number,
    contentItem: typeof contentItems.$inferSelect,
    workflowTransitionId?: number,
): Promise<number> {
    if (workflowTransitionId) {
        return workflowTransitionId;
    }

    const workflow = await WorkflowService.getActiveWorkflowWithTransitions(domainId, contentItem.contentTypeId);
    if (!workflow) {
        throw new WorkflowServiceError(
            'No active workflow is available for external feedback routing.',
            'EXTERNAL_FEEDBACK_WORKFLOW_NOT_FOUND',
            'Activate a workflow for this content type or provide a valid workflowTransitionId.',
            404,
        );
    }

    const publishTransitions = workflow.transitions.filter((transition) => transition.toState === 'published');
    if (publishTransitions.length === 1) {
        return publishTransitions[0].id;
    }

    if (publishTransitions.length === 0) {
        throw new WorkflowServiceError(
            'No publish transition is available for external feedback routing.',
            'EXTERNAL_FEEDBACK_PUBLISH_TRANSITION_NOT_FOUND',
            'Add a workflow transition that publishes the reviewed content, or provide workflowTransitionId explicitly.',
            409,
        );
    }

    throw new WorkflowServiceError(
        'External feedback transition is ambiguous.',
        'EXTERNAL_FEEDBACK_TRANSITION_AMBIGUOUS',
        'Provide workflowTransitionId explicitly when multiple transitions can publish the content.',
        409,
    );
}

export class WorkflowService {
    static async createWorkflow(domainId: number, name: string, contentTypeId: number, active = true) {
        const [contentType] = await db.select({ id: contentTypes.id })
            .from(contentTypes)
            .where(and(
                eq(contentTypes.id, contentTypeId),
                eq(contentTypes.domainId, domainId)
            ));
        if (!contentType) {
            throw new Error('CONTENT_TYPE_NOT_FOUND');
        }

        const [workflow] = await db.insert(workflows).values({
            domainId,
            name,
            contentTypeId,
            active
        }).returning();

        return workflow;
    }

    static async createWorkflowTransition(
        domainId: number,
        workflowId: number,
        fromState: string,
        toState: string,
        requiredRoles: string[]
    ) {
        const [workflow] = await db.select({ id: workflows.id })
            .from(workflows)
            .where(and(
                eq(workflows.id, workflowId),
                eq(workflows.domainId, domainId)
            ));
        if (!workflow) {
            throw new Error('WORKFLOW_NOT_FOUND');
        }

        const [transition] = await db.insert(workflowTransitions).values({
            workflowId,
            fromState,
            toState,
            requiredRoles
        }).returning();

        return transition;
    }

    static async getActiveWorkflow(domainId: number, contentTypeId: number) {
        const results = await db.select()
            .from(workflows)
            .where(and(eq(workflows.domainId, domainId), eq(workflows.contentTypeId, contentTypeId), eq(workflows.active, true)));
        return results[0] || null;
    }

    static async getActiveWorkflowWithTransitions(domainId: number, contentTypeId: number) {
        const workflow = await this.getActiveWorkflow(domainId, contentTypeId);
        if (!workflow) return null;

        const transitions = await db.select()
            .from(workflowTransitions)
            .where(eq(workflowTransitions.workflowId, workflow.id));

        return {
            ...workflow,
            transitions
        };
    }

    static async submitForReview(context: WorkflowTransitionContext) {
        const {
            domainId,
            contentItemId,
            workflowTransitionId,
            assignee,
            source = 'author_submit',
            sourceEventId = null,
            authPrincipal,
        } = context;

        // 1. Fetch transition requirements and ensure it belongs to the domain
        const results = await db.select({ transition: workflowTransitions })
            .from(workflowTransitions)
            .innerJoin(workflows, eq(workflowTransitions.workflowId, workflows.id))
            .where(and(
                eq(workflowTransitions.id, workflowTransitionId),
                eq(workflows.domainId, domainId)
            ));
        const transition = results[0]?.transition;

        if (!transition) {
            throw new Error('WORKFLOW_TRANSITION_NOT_FOUND_OR_CROSS_TENANT');
        }

        // 2. Enforce minimum roles against the transitioning user
        if (transition.requiredRoles && Array.isArray(transition.requiredRoles) && transition.requiredRoles.length > 0) {
            if (!authPrincipal) {
                throw new Error('UNAUTHORIZED_WORKFLOW_TRANSITION: Request lacks authentication context.');
            }

            const hasRequiredRole = transition.requiredRoles.some(role => authPrincipal.scopes.has(role as string));
            if (!hasRequiredRole) {
                throw new Error(`UNAUTHORIZED_WORKFLOW_TRANSITION: Principal lacks required roles: ${transition.requiredRoles.join(', ')}`);
            }
        }

        // 3. Close out any existing pending review tasks for this content item safely
        await db.update(reviewTasks)
            .set({ status: 'rejected' })
            .where(and(
                eq(reviewTasks.contentItemId, contentItemId),
                eq(reviewTasks.domainId, domainId),
                eq(reviewTasks.status, 'pending')
            ));

        const assigneeIdentity = resolveActorIdentityRef(assignee);

        // 4. Create the new review task
        const [newTask] = await db.insert(reviewTasks).values({
            domainId,
            contentItemId,
            workflowTransitionId,
            status: 'pending',
            source,
            sourceEventId,
            assignee,
            assigneeActorId: assigneeIdentity?.actorId ?? null,
            assigneeActorType: assigneeIdentity?.actorType ?? null,
            assigneeActorSource: assigneeIdentity?.actorSource ?? null,
        }).returning();

        // 5. Mark the live item as under review while the task is pending.
        // The target state is only applied after an approval decision.
        await transitionContentItemStatus(domainId, contentItemId, 'in_review');

        return newTask;
    }

    static async decideReviewTask(
        domainId: number,
        taskId: number,
        decision: 'approved' | 'rejected',
        authPrincipal: AuthenticatedWorkflowPrincipal,
    ) {
        const task = await authorizePendingReviewTask(domainId, taskId, authPrincipal);

        const [updatedTask] = await db.update(reviewTasks)
            .set({
                status: decision,
                updatedAt: new Date()
            })
            .where(and(eq(reviewTasks.id, taskId), eq(reviewTasks.domainId, domainId)))
            .returning();

        let notificationContext: DraftGenerationReviewWebhookContext | null = null;

        if (decision === 'approved') {
            // Find the ultimate target state
            const tResults = await db.select()
                .from(workflowTransitions)
                .where(eq(workflowTransitions.id, task.workflowTransitionId));
            const transition = tResults[0];

            // Advance the content item to the approved state
            if (transition) {
                const transitionResult = await transitionContentItemStatus(
                    domainId,
                    task.contentItemId,
                    transition.toState,
                );

                // If the target state is published, dynamically generate vector embeddings
                if (transition.toState === 'published') {
                    // Fire and forget to avoid stalling the HTTP response
                    EmbeddingService.syncItemEmbeddings(domainId, task.contentItemId).catch(console.error);
                } else if (transitionResult.changed) {
                    EmbeddingService.deleteItemEmbeddings(domainId, task.contentItemId).catch(console.error);
                }

                await logAudit(
                    domainId,
                    'update',
                    'content_item',
                    task.contentItemId,
                    {
                        source: 'workflow_review_decision',
                        reviewTaskId: task.id,
                        workflowTransitionId: transition.id,
                        decision,
                        previousStatus: transition.fromState,
                        status: transition.toState,
                    },
                    toAuditActor(authPrincipal),
                );
            }
        }

        notificationContext = await loadDraftGenerationReviewWebhookContext(domainId, task.contentItemId);
        if (notificationContext) {
            try {
                await enqueueWebhookJob({
                    domainId,
                    url: notificationContext.form.webhookUrl,
                    secret: notificationContext.form.webhookSecret,
                    source: 'form',
                    body: {
                        event: `form.draft_generation.review.${decision}`,
                        form: {
                            id: notificationContext.form.id,
                            slug: notificationContext.form.slug,
                            name: notificationContext.form.name,
                        },
                        submission: {
                            contentItemId: notificationContext.submission.contentItemId,
                            status: notificationContext.submission.status,
                            data: notificationContext.submission.data,
                        },
                        draftGeneration: {
                            jobId: notificationContext.job.id,
                            intakeContentItemId: notificationContext.job.intakeContentItemId,
                            targetContentTypeId: notificationContext.job.targetContentTypeId,
                            workforceAgentId: notificationContext.job.workforceAgentId,
                            workforceAgentSlug: notificationContext.job.workforceAgentSlug,
                            workforceAgentName: notificationContext.job.workforceAgentName,
                            agentSoul: notificationContext.job.agentSoul,
                            providerType: notificationContext.job.providerType,
                            providerModel: notificationContext.job.providerModel,
                            strategy: notificationContext.job.strategy,
                            generatedContentItemId: notificationContext.generated.contentItemId,
                            generatedStatus: notificationContext.generated.status,
                        },
                        review: {
                            taskId: updatedTask.id,
                            decision,
                            workflowTransitionId: updatedTask.workflowTransitionId,
                            decidedAt: updatedTask.updatedAt.toISOString(),
                        },
                        generated: {
                            contentItemId: notificationContext.generated.contentItemId,
                            status: notificationContext.generated.status,
                            data: notificationContext.generated.data,
                        },
                    },
                });
            } catch (error) {
                console.error('Failed to enqueue form draft review webhook', error);
            }
        }

        return updatedTask;
    }

    static async reviseReviewTask(
        domainId: number,
        taskId: number,
        prompt: string,
        authPrincipal: AuthenticatedWorkflowPrincipal,
    ): Promise<ReviewTaskRevisionResult> {
        const normalizedPrompt = normalizeOptionalString(prompt);
        if (!normalizedPrompt) {
            throw new WorkflowServiceError(
                'Agent revision prompt is required.',
                'REVIEW_TASK_REVISION_PROMPT_REQUIRED',
                'Describe what should change in the draft, then retry the revision request.',
                400,
            );
        }

        const task = await authorizePendingReviewTask(domainId, taskId, authPrincipal);
        const revisionContext = await loadDraftGenerationReviewContext(domainId, task.contentItemId);
        if (!revisionContext) {
            throw new WorkflowServiceError(
                'This review task is not backed by form draft generation.',
                'REVIEW_TASK_AI_REVISION_UNAVAILABLE',
                'Use manual editing for non-generated drafts, or resubmit the content through a draft-generation form.',
                409,
            );
        }

        if (revisionContext.job.provider.type === 'deterministic') {
            throw new WorkflowServiceError(
                'This draft uses deterministic generation and cannot accept revision prompts.',
                'REVIEW_TASK_AI_REVISION_PROVIDER_UNSUPPORTED',
                'Configure an AI provider for the workforce agent or form before requesting agent revisions.',
                409,
            );
        }

        const [targetContentType] = await db.select()
            .from(contentTypes)
            .where(and(
                eq(contentTypes.domainId, domainId),
                eq(contentTypes.id, revisionContext.job.targetContentTypeId),
            ));

        if (!targetContentType) {
            throw new WorkflowServiceError(
                `Target content type ${revisionContext.job.targetContentTypeId} not found in domain ${domainId}.`,
                'REVIEW_TASK_AI_REVISION_TARGET_CONTENT_TYPE_NOT_FOUND',
                'Restore the target content type or update the form draft-generation configuration before retrying.',
                409,
            );
        }

        const workforceAgent: DraftGenerationWorkforceAgentReference | null = revisionContext.job.workforceAgentId
            ? {
                id: revisionContext.job.workforceAgentId,
                slug: revisionContext.job.workforceAgentSlug ?? `agent-${revisionContext.job.workforceAgentId}`,
                name: revisionContext.job.workforceAgentName ?? `Agent ${revisionContext.job.workforceAgentId}`,
                purpose: revisionContext.job.workforceAgentPurpose ?? 'Tenant-defined drafting agent',
            }
            : null;
        const providerProvisioning = await resolveDraftGenerationProviderProvisioning(
            domainId,
            revisionContext.job.provider,
        );
        const attachments = await resolveDraftGenerationAttachments(
            domainId,
            revisionContext.job.provider,
            revisionContext.job.intakeAssetReferences,
        );

        const generation = await generateDraftData({
            domainId,
            formId: revisionContext.form.id,
            formSlug: revisionContext.form.slug,
            intakeContentItemId: revisionContext.job.intakeContentItemId,
            intakeData: revisionContext.submission.data,
            currentDraftData: revisionContext.generated.data,
            revisionPrompt: normalizedPrompt,
            attachments,
            targetContentType: {
                id: targetContentType.id,
                name: targetContentType.name,
                slug: targetContentType.slug,
                schema: targetContentType.schema,
            },
            agentSoul: revisionContext.job.agentSoul,
            fieldMap: revisionContext.job.fieldMap,
            defaultData: revisionContext.job.defaultData,
            provider: revisionContext.job.provider,
            providerProvisioning,
            workforceAgent,
        });

        const serializedData = JSON.stringify(generation.data);
        const validationFailure = await validateContentDataAgainstSchema(
            targetContentType.schema,
            serializedData,
            domainId,
        );
        if (validationFailure) {
            throw new DraftGenerationError(
                validationFailure.code,
                validationFailure.remediation,
                409,
            );
        }

        const updated = await updateContentItem(task.contentItemId, domainId, {
            data: serializedData,
            status: revisionContext.generated.status,
        });
        if (!updated) {
            throw new WorkflowServiceError(
                `Content item ${task.contentItemId} no longer exists in domain ${domainId}.`,
                'REVIEW_TASK_AI_REVISION_CONTENT_ITEM_NOT_FOUND',
                'Refresh the approval queue and reopen the draft before retrying.',
                404,
            );
        }

        await this.addComment(
            domainId,
            task.contentItemId,
            authPrincipal,
            `AI revision requested: ${normalizedPrompt}`,
        );

        await logAudit(
            domainId,
            'update',
            'content_item',
            updated.id,
            {
                source: 'workflow_review_ai_revision',
                reviewTaskId: task.id,
                contentItemId: updated.id,
                previousContentVersion: revisionContext.generated.version,
                contentVersion: updated.version,
                revisionPrompt: normalizedPrompt,
                provider: generation.provider,
                strategy: generation.strategy,
                workforceAgentId: revisionContext.job.workforceAgentId,
                workforceAgentSlug: revisionContext.job.workforceAgentSlug,
            },
            toAuditActor(authPrincipal),
        );

        return {
            taskId: task.id,
            contentItemId: updated.id,
            contentStatus: updated.status,
            contentVersion: updated.version,
            revisedAt: updated.updatedAt,
            strategy: generation.strategy,
            provider: generation.provider,
        };
    }

    static async submitExternalFeedback(input: ExternalFeedbackSubmissionInput): Promise<ExternalFeedbackSubmissionResult> {
        const decision = normalizeExternalFeedbackDecision(input.decision);
        const comment = normalizeOptionalString(input.comment);
        const prompt = normalizeOptionalString(input.prompt);
        const refinementMode = normalizeExternalFeedbackRefinementMode(input.refinementMode);
        const submitter = normalizeExternalFeedbackSubmitter(input.submitter);

        if (!decision && !comment && !prompt) {
            throw new WorkflowServiceError(
                'External feedback must include a decision, comment, or prompt.',
                'EXTERNAL_FEEDBACK_EMPTY',
                'Provide at least one of decision, comment, or prompt.',
                400,
            );
        }

        if (refinementMode === 'agent_direct' && !prompt) {
            throw new WorkflowServiceError(
                'Agent-direct external feedback requires a prompt.',
                'EXTERNAL_FEEDBACK_PROMPT_REQUIRED',
                'Provide a prompt describing what the agent should revise, or use refinementMode = human_supervised.',
                400,
            );
        }

        const { item, publishedVersion } = await resolveExternalFeedbackPublishedVersion(input.domainId, input.contentItemId);
        const shouldRequestRevision = requiresExternalFeedbackRevision({
            decision,
            prompt,
            refinementMode,
        });

        const [event] = await db.insert(externalFeedbackEvents).values({
            domainId: input.domainId,
            contentItemId: input.contentItemId,
            publishedVersion,
            decision,
            comment,
            prompt,
            refinementMode,
            actorId: submitter.actorId,
            actorType: submitter.actorType,
            actorSource: submitter.actorSource,
            actorDisplayName: submitter.displayName,
            actorEmail: submitter.email,
            reviewTaskId: null,
        }).returning();

        await this.addComment(
            input.domainId,
            input.contentItemId,
            {
                actorId: submitter.actorId,
                actorType: submitter.actorType,
                actorSource: submitter.actorSource,
            },
            buildExternalFeedbackComment({
                submitter,
                decision,
                comment,
                prompt,
            }),
        );

        if (!shouldRequestRevision) {
            await logAudit(
                input.domainId,
                'create',
                'external_feedback_event',
                event.id,
                {
                    contentItemId: input.contentItemId,
                    publishedVersion,
                    decision,
                    refinementMode,
                    reviewTaskId: null,
                },
                input.authPrincipal ? toAuditActor(input.authPrincipal) : {
                    actorId: submitter.actorId,
                    actorType: submitter.actorType,
                    actorSource: submitter.actorSource,
                },
            );

            return {
                event,
                reviewTask: null,
                revision: null,
            };
        }

        const transitionId = await resolveExternalFeedbackTransitionId(
            input.domainId,
            item,
            input.workflowTransitionId,
        );
        const reviewTask = await this.submitForReview({
            domainId: input.domainId,
            contentItemId: input.contentItemId,
            workflowTransitionId: transitionId,
            source: 'external_feedback',
            sourceEventId: event.id,
            authPrincipal: input.authPrincipal,
        });

        const [updatedEvent] = await db.update(externalFeedbackEvents)
            .set({
                reviewTaskId: reviewTask.id,
            })
            .where(and(
                eq(externalFeedbackEvents.id, event.id),
                eq(externalFeedbackEvents.domainId, input.domainId),
            ))
            .returning();

        let revision: ReviewTaskRevisionResult | null = null;
        if (refinementMode === 'agent_direct' && prompt) {
            if (!input.authPrincipal) {
                throw new WorkflowServiceError(
                    'Agent-direct external feedback requires an authenticated operator principal.',
                    'EXTERNAL_FEEDBACK_AUTH_REQUIRED',
                    'Retry through a trusted backend with an authenticated principal, or use refinementMode = human_supervised.',
                    403,
                );
            }

            revision = await this.reviseReviewTask(
                input.domainId,
                reviewTask.id,
                prompt,
                input.authPrincipal,
            );
        }

        await logAudit(
            input.domainId,
            'create',
            'external_feedback_event',
            event.id,
            {
                contentItemId: input.contentItemId,
                publishedVersion,
                decision,
                refinementMode,
                reviewTaskId: reviewTask.id,
                revisionTriggered: revision !== null,
            },
            input.authPrincipal ? toAuditActor(input.authPrincipal) : {
                actorId: submitter.actorId,
                actorType: submitter.actorType,
                actorSource: submitter.actorSource,
            },
        );

        return {
            event: updatedEvent ?? {
                ...event,
                reviewTaskId: reviewTask.id,
            },
            reviewTask,
            revision,
        };
    }

    static async listComments(domainId: number, contentItemId: number) {
        return await db.select()
            .from(reviewComments)
            .where(and(eq(reviewComments.domainId, domainId), eq(reviewComments.contentItemId, contentItemId)))
            .orderBy(desc(reviewComments.createdAt), desc(reviewComments.id));
    }

    static async listExternalFeedbackEvents(domainId: number, contentItemId: number) {
        return await db.select()
            .from(externalFeedbackEvents)
            .where(and(
                eq(externalFeedbackEvents.domainId, domainId),
                eq(externalFeedbackEvents.contentItemId, contentItemId),
            ))
            .orderBy(desc(externalFeedbackEvents.createdAt), desc(externalFeedbackEvents.id));
    }

    static async addComment(domainId: number, contentItemId: number, author: PrincipalLike | string, comment: string) {
        const authorIdentity = typeof author === 'string'
            ? resolveActorIdentityRef(author)
            : resolveActorIdentity(author);
        const authorId = authorIdentity?.actorId ?? (typeof author === 'string' ? author : 'system');

        const [newComment] = await db.insert(reviewComments).values({
            domainId,
            contentItemId,
            authorId,
            authorActorId: authorIdentity?.actorId ?? null,
            authorActorType: authorIdentity?.actorType ?? null,
            authorActorSource: authorIdentity?.actorSource ?? null,
            comment
        }).returning();
        return newComment;
    }

    static async listPendingReviewTasks(domainId: number) {
        return await db.select({
            task: reviewTasks,
            transition: workflowTransitions,
            workflow: workflows,
            contentItem: contentItems,
            contentType: {
                id: contentTypes.id,
                name: contentTypes.name,
                slug: contentTypes.slug
            }
        })
            .from(reviewTasks)
            .innerJoin(workflowTransitions, eq(reviewTasks.workflowTransitionId, workflowTransitions.id))
            .innerJoin(workflows, eq(workflowTransitions.workflowId, workflows.id))
            .innerJoin(contentItems, eq(reviewTasks.contentItemId, contentItems.id))
            .innerJoin(contentTypes, eq(contentItems.contentTypeId, contentTypes.id))
            .where(and(eq(reviewTasks.domainId, domainId), eq(reviewTasks.status, 'pending')))
            .orderBy(desc(reviewTasks.createdAt));
    }
}
