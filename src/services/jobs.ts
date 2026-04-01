import crypto from 'node:crypto';

import { and, asc, eq, lte, sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import { contentItems, contentItemVersions, contentTypes, jobs, webhooks, workflows } from '../db/schema.js';
import { logAudit } from './audit.js';
import { getAiProviderSecretConfig } from './ai-provider-config.js';
import { validateContentDataAgainstSchema } from './content-schema.js';
import {
    generateDraftData,
    type DraftGenerationProviderConfig,
    type DraftGenerationProviderProvisioning,
    type DraftGenerationWorkforceAgentReference,
} from './draft-generation.js';
import { EmbeddingService } from './embedding.js';
import { WorkflowService } from './workflow.js';

export type JobKind = 'content_status_transition' | 'outbound_webhook' | 'draft_generation';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type OutboundWebhookJobPayload = {
    url: string;
    body: Record<string, unknown>;
    secret?: string | null;
    method?: 'POST';
    headers?: Record<string, string>;
    timeoutMs?: number;
    source?: 'audit' | 'form';
};

export type ContentStatusTransitionJobPayload = {
    contentItemId: number;
    targetStatus: string;
};

export type DraftGenerationJobPayload = {
    formId: number;
    formSlug: string;
    intakeContentItemId: number;
    intakeData: Record<string, unknown>;
    targetContentTypeId: number;
    workforceAgentId?: number | null;
    workforceAgentSlug?: string | null;
    workforceAgentName?: string | null;
    workforceAgentPurpose?: string | null;
    agentSoul: string;
    fieldMap?: Record<string, string>;
    defaultData?: Record<string, unknown>;
    provider?: DraftGenerationProviderConfig;
    postGenerationWorkflowTransitionId?: number | null;
};

export type JobPayloadMap = {
    outbound_webhook: OutboundWebhookJobPayload;
    content_status_transition: ContentStatusTransitionJobPayload;
    draft_generation: DraftGenerationJobPayload;
};

export type CreateJobInput<K extends JobKind = JobKind> = {
    domainId: number;
    kind: K;
    payload: JobPayloadMap[K];
    queue?: string;
    runAt?: Date;
    maxAttempts?: number;
};

export type ListJobsOptions = {
    status?: JobStatus;
    kind?: JobKind;
    limit?: number;
    offset?: number;
};

export type JobRecord = typeof jobs.$inferSelect;

const JOB_STATUS_VALUES: JobStatus[] = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];
const JOB_KIND_VALUES: JobKind[] = ['content_status_transition', 'outbound_webhook', 'draft_generation'];

function isObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function signWebhookBody(secret: string, body: string): string {
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function computeRetryRunAt(attempts: number): Date {
    const backoffMs = Math.min(5 * 60 * 1000, 15 * 1000 * (2 ** Math.max(0, attempts - 1)));
    return new Date(Date.now() + backoffMs);
}

function normalizeJobQueue(queue: string | undefined, kind: JobKind): string {
    if (typeof queue === 'string' && queue.trim().length > 0) {
        return queue.trim();
    }

    if (kind === 'outbound_webhook') {
        return 'webhooks';
    }

    if (kind === 'draft_generation') {
        return 'drafts';
    }

    return 'content';
}

function parseJobStatus(value: unknown): JobStatus {
    return JOB_STATUS_VALUES.includes(value as JobStatus)
        ? value as JobStatus
        : 'queued';
}

function parseJobKind(value: unknown): JobKind {
    if (!JOB_KIND_VALUES.includes(value as JobKind)) {
        throw new Error(`Unsupported job kind '${String(value)}'.`);
    }

    return value as JobKind;
}

function parseOutboundWebhookPayload(payload: unknown): OutboundWebhookJobPayload {
    if (!isObject(payload) || typeof payload.url !== 'string' || !isObject(payload.body)) {
        throw new Error('Outbound webhook jobs require url and object body payload.');
    }

    return {
        url: payload.url,
        body: payload.body as Record<string, unknown>,
        secret: typeof payload.secret === 'string' ? payload.secret : null,
        method: 'POST',
        headers: isObject(payload.headers)
            ? Object.fromEntries(
                Object.entries(payload.headers).flatMap(([key, value]) => (
                    typeof value === 'string' && key.trim().length > 0
                        ? [[key.trim(), value]]
                        : []
                )),
            )
            : undefined,
        timeoutMs: typeof payload.timeoutMs === 'number' && Number.isFinite(payload.timeoutMs)
            ? Math.max(1000, Math.min(Math.trunc(payload.timeoutMs), 15000))
            : undefined,
        source: payload.source === 'form' ? 'form' : 'audit',
    };
}

function parseContentStatusTransitionPayload(payload: unknown): ContentStatusTransitionJobPayload {
    if (
        !isObject(payload)
        || typeof payload.contentItemId !== 'number'
        || !Number.isInteger(payload.contentItemId)
        || payload.contentItemId <= 0
        || typeof payload.targetStatus !== 'string'
        || payload.targetStatus.trim().length === 0
    ) {
        throw new Error('Content status transition jobs require contentItemId and targetStatus.');
    }

    return {
        contentItemId: payload.contentItemId,
        targetStatus: payload.targetStatus.trim(),
    };
}

function parseDraftGenerationPayload(payload: unknown): DraftGenerationJobPayload {
    if (
        !isObject(payload)
        || typeof payload.formId !== 'number'
        || !Number.isInteger(payload.formId)
        || payload.formId <= 0
        || typeof payload.formSlug !== 'string'
        || payload.formSlug.trim().length === 0
        || typeof payload.intakeContentItemId !== 'number'
        || !Number.isInteger(payload.intakeContentItemId)
        || payload.intakeContentItemId <= 0
        || !isObject(payload.intakeData)
        || typeof payload.targetContentTypeId !== 'number'
        || !Number.isInteger(payload.targetContentTypeId)
        || payload.targetContentTypeId <= 0
        || typeof payload.agentSoul !== 'string'
        || payload.agentSoul.trim().length === 0
    ) {
        throw new Error('Draft generation jobs require formId, formSlug, intakeContentItemId, intakeData, targetContentTypeId, and agentSoul.');
    }

    const workforceAgentId = payload.workforceAgentId === undefined
        ? null
        : payload.workforceAgentId === null
            ? null
            : typeof payload.workforceAgentId === 'number'
                && Number.isInteger(payload.workforceAgentId)
                && payload.workforceAgentId > 0
                ? payload.workforceAgentId
                : null;
    if (
        payload.workforceAgentId !== undefined
        && payload.workforceAgentId !== null
        && workforceAgentId === null
    ) {
        throw new Error('Draft generation jobs require workforceAgentId to be a positive integer or null.');
    }

    const defaultData = payload.defaultData === undefined
        ? {}
        : isObject(payload.defaultData)
            ? payload.defaultData as Record<string, unknown>
            : null;
    if (defaultData === null) {
        throw new Error('Draft generation jobs require defaultData to be an object when provided.');
    }

    const fieldMap = payload.fieldMap === undefined
        ? {}
        : isObject(payload.fieldMap)
            ? Object.fromEntries(
                Object.entries(payload.fieldMap).map(([sourceFieldName, targetFieldName]) => {
                    const normalizedSourceFieldName = sourceFieldName.trim();
                    if (!normalizedSourceFieldName || typeof targetFieldName !== 'string' || targetFieldName.trim().length === 0) {
                        throw new Error('Draft generation jobs require fieldMap entries to use non-empty string source and target field names.');
                    }

                    return [normalizedSourceFieldName, targetFieldName.trim()];
                }),
            )
            : null;
    if (fieldMap === null) {
        throw new Error('Draft generation jobs require fieldMap to be an object when provided.');
    }

    const mappedTargetFieldNames = Object.values(fieldMap);
    if (new Set(mappedTargetFieldNames).size !== mappedTargetFieldNames.length) {
        throw new Error('Draft generation jobs require unique target field names in fieldMap.');
    }

    const providerValue = payload.provider;
    let provider: DraftGenerationProviderConfig = {
        type: 'deterministic',
    };
    if (providerValue !== undefined) {
        if (!isObject(providerValue)) {
            throw new Error('Draft generation jobs require provider to be an object when provided.');
        }

        const providerType = typeof providerValue.type === 'string' && providerValue.type.trim().length > 0
            ? providerValue.type.trim()
            : 'deterministic';

        if (providerType === 'deterministic') {
            provider = {
                type: 'deterministic',
            };
        } else if (providerType === 'openai') {
            provider = {
                type: 'openai',
                ...(typeof providerValue.model === 'string' && providerValue.model.trim().length > 0
                    ? { model: providerValue.model.trim() }
                    : {}),
                ...(typeof providerValue.instructions === 'string' && providerValue.instructions.trim().length > 0
                    ? { instructions: providerValue.instructions.trim() }
                    : {}),
            };
        } else if (providerType === 'anthropic') {
            provider = {
                type: 'anthropic',
                ...(typeof providerValue.model === 'string' && providerValue.model.trim().length > 0
                    ? { model: providerValue.model.trim() }
                    : {}),
                ...(typeof providerValue.instructions === 'string' && providerValue.instructions.trim().length > 0
                    ? { instructions: providerValue.instructions.trim() }
                    : {}),
            };
        } else if (providerType === 'gemini') {
            provider = {
                type: 'gemini',
                ...(typeof providerValue.model === 'string' && providerValue.model.trim().length > 0
                    ? { model: providerValue.model.trim() }
                    : {}),
                ...(typeof providerValue.instructions === 'string' && providerValue.instructions.trim().length > 0
                    ? { instructions: providerValue.instructions.trim() }
                    : {}),
            };
        } else {
            throw new Error(`Unsupported draft generation provider '${providerType}'.`);
        }
    }

    const postGenerationWorkflowTransitionId = payload.postGenerationWorkflowTransitionId === undefined
        ? null
        : payload.postGenerationWorkflowTransitionId === null
            ? null
            : typeof payload.postGenerationWorkflowTransitionId === 'number'
                && Number.isInteger(payload.postGenerationWorkflowTransitionId)
                && payload.postGenerationWorkflowTransitionId > 0
                ? payload.postGenerationWorkflowTransitionId
                : null;

    if (
        payload.postGenerationWorkflowTransitionId !== undefined
        && payload.postGenerationWorkflowTransitionId !== null
        && postGenerationWorkflowTransitionId === null
    ) {
        throw new Error('Draft generation jobs require postGenerationWorkflowTransitionId to be a positive integer or null.');
    }

    return {
        formId: payload.formId,
        formSlug: payload.formSlug.trim(),
        intakeContentItemId: payload.intakeContentItemId,
        intakeData: payload.intakeData as Record<string, unknown>,
        targetContentTypeId: payload.targetContentTypeId,
        workforceAgentId,
        workforceAgentSlug: typeof payload.workforceAgentSlug === 'string' && payload.workforceAgentSlug.trim().length > 0
            ? payload.workforceAgentSlug.trim()
            : null,
        workforceAgentName: typeof payload.workforceAgentName === 'string' && payload.workforceAgentName.trim().length > 0
            ? payload.workforceAgentName.trim()
            : null,
        workforceAgentPurpose: typeof payload.workforceAgentPurpose === 'string' && payload.workforceAgentPurpose.trim().length > 0
            ? payload.workforceAgentPurpose.trim()
            : null,
        agentSoul: payload.agentSoul.trim(),
        fieldMap,
        defaultData,
        provider,
        postGenerationWorkflowTransitionId,
    };
}

function parsePayload(kind: JobKind, payload: unknown): JobPayloadMap[JobKind] {
    if (kind === 'outbound_webhook') {
        return parseOutboundWebhookPayload(payload);
    }

    if (kind === 'draft_generation') {
        return parseDraftGenerationPayload(payload);
    }

    return parseContentStatusTransitionPayload(payload);
}

async function runOutboundWebhookJob(payload: OutboundWebhookJobPayload) {
    const body = JSON.stringify(payload.body);
    const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...(payload.headers ?? {}),
    };

    if (payload.secret) {
        headers['x-wordclaw-signature'] = signWebhookBody(payload.secret, body);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), payload.timeoutMs ?? 5000);

    try {
        const response = await fetch(payload.url, {
            method: payload.method ?? 'POST',
            headers,
            body,
            signal: controller.signal,
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Webhook delivery failed with ${response.status}${text ? `: ${text.slice(0, 240)}` : ''}`);
        }

        return {
            delivered: true,
            status: response.status,
            source: payload.source ?? null,
            url: payload.url,
        };
    } finally {
        clearTimeout(timeoutId);
    }
}

async function runContentStatusTransitionJob(domainId: number, payload: ContentStatusTransitionJobPayload) {
    const [item] = await db.select()
        .from(contentItems)
        .where(and(
            eq(contentItems.id, payload.contentItemId),
            eq(contentItems.domainId, domainId),
        ));

    if (!item) {
        throw new Error(`Content item ${payload.contentItemId} not found in domain ${domainId}.`);
    }

    const [contentType] = await db.select()
        .from(contentTypes)
        .where(and(
            eq(contentTypes.id, item.contentTypeId),
            eq(contentTypes.domainId, domainId),
        ));

    if (!contentType) {
        throw new Error(`Content type ${item.contentTypeId} not found in domain ${domainId}.`);
    }

    const [activeWorkflow] = await db.select({ id: workflows.id })
        .from(workflows)
        .where(and(
            eq(workflows.domainId, domainId),
            eq(workflows.contentTypeId, item.contentTypeId),
            eq(workflows.active, true),
        ));

    if (activeWorkflow) {
        throw new Error(`Active workflow ${activeWorkflow.id} governs content type ${item.contentTypeId}; scheduled status changes are disabled for workflow-managed content.`);
    }

    if (item.status === payload.targetStatus) {
        return {
            skipped: true,
            contentItemId: item.id,
            status: item.status,
        };
    }

    const updated = await db.transaction(async (tx) => {
        await tx.insert(contentItemVersions).values({
            contentItemId: item.id,
            version: item.version,
            data: item.data,
            status: item.status,
            createdAt: item.updatedAt,
        });

        const [next] = await tx.update(contentItems)
            .set({
                status: payload.targetStatus,
                version: item.version + 1,
                updatedAt: new Date(),
            })
            .where(and(
                eq(contentItems.id, item.id),
                eq(contentItems.domainId, domainId),
            ))
            .returning();

        if (!next) {
            throw new Error(`Content item ${item.id} could not be updated.`);
        }

        return next;
    });

    if (updated.status === 'published') {
        EmbeddingService.syncItemEmbeddings(domainId, updated.id).catch(console.error);
    } else {
        EmbeddingService.deleteItemEmbeddings(domainId, updated.id).catch(console.error);
    }

    return {
        skipped: false,
        contentItemId: updated.id,
        previousStatus: item.status,
        status: updated.status,
        version: updated.version,
    };
}

async function runDraftGenerationJob(domainId: number, payload: DraftGenerationJobPayload) {
    const [targetContentType] = await db.select()
        .from(contentTypes)
        .where(and(
            eq(contentTypes.domainId, domainId),
            eq(contentTypes.id, payload.targetContentTypeId),
        ));

    if (!targetContentType) {
        throw new Error(`Target content type ${payload.targetContentTypeId} not found in domain ${domainId}.`);
    }

    const explicitFieldMap = payload.fieldMap ?? {};
    const provider = payload.provider ?? { type: 'deterministic' };
    const workforceAgent: DraftGenerationWorkforceAgentReference | null = payload.workforceAgentId
        ? {
            id: payload.workforceAgentId,
            slug: payload.workforceAgentSlug ?? `agent-${payload.workforceAgentId}`,
            name: payload.workforceAgentName ?? `Agent ${payload.workforceAgentId}`,
            purpose: payload.workforceAgentPurpose ?? 'Tenant-defined drafting agent',
        }
        : null;
    let providerProvisioning: DraftGenerationProviderProvisioning | null = {
        type: 'deterministic',
    };
    if (provider.type === 'openai') {
        const configuredProvider = await getAiProviderSecretConfig(domainId, provider.type);
        providerProvisioning = configuredProvider
            ? {
                type: 'openai',
                apiKey: configuredProvider.apiKey,
                defaultModel: configuredProvider.defaultModel,
            }
            : null;
    } else if (provider.type === 'anthropic') {
        const configuredProvider = await getAiProviderSecretConfig(domainId, provider.type);
        providerProvisioning = configuredProvider
            ? {
                type: 'anthropic',
                apiKey: configuredProvider.apiKey,
                defaultModel: configuredProvider.defaultModel,
            }
            : null;
    } else if (provider.type === 'gemini') {
        const configuredProvider = await getAiProviderSecretConfig(domainId, provider.type);
        providerProvisioning = configuredProvider
            ? {
                type: 'gemini',
                apiKey: configuredProvider.apiKey,
                defaultModel: configuredProvider.defaultModel,
            }
            : null;
    }

    const generation = await generateDraftData({
        domainId,
        formId: payload.formId,
        formSlug: payload.formSlug,
        intakeContentItemId: payload.intakeContentItemId,
        intakeData: payload.intakeData,
        targetContentType: {
            id: targetContentType.id,
            name: targetContentType.name,
            slug: targetContentType.slug,
            schema: targetContentType.schema,
        },
        agentSoul: payload.agentSoul,
        fieldMap: explicitFieldMap,
        defaultData: payload.defaultData ?? {},
        provider,
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
        throw new Error(`${validationFailure.code}: ${validationFailure.remediation}`);
    }

    const [created] = await db.insert(contentItems).values({
        domainId,
        contentTypeId: payload.targetContentTypeId,
        data: serializedData,
        status: 'draft',
    }).returning();

    await logAudit(domainId, 'create', 'content_item', created.id, {
        source: 'draft_generation_job',
        formId: payload.formId,
        formSlug: payload.formSlug,
        intakeContentItemId: payload.intakeContentItemId,
        targetContentTypeId: payload.targetContentTypeId,
        workforceAgentId: workforceAgent?.id ?? null,
        workforceAgentSlug: workforceAgent?.slug ?? null,
        workforceAgentName: workforceAgent?.name ?? null,
        agentSoul: payload.agentSoul,
        fieldMap: explicitFieldMap,
        provider: generation.provider,
        strategy: generation.strategy,
    });

    let reviewTaskId: number | null = null;
    if (payload.postGenerationWorkflowTransitionId) {
        const task = await WorkflowService.submitForReview({
            domainId,
            contentItemId: created.id,
            workflowTransitionId: payload.postGenerationWorkflowTransitionId,
        });
        reviewTaskId = task.id;
    }

    return {
        generatedContentItemId: created.id,
        generatedStatus: created.status,
        reviewTaskId,
        intakeContentItemId: payload.intakeContentItemId,
        targetContentTypeId: payload.targetContentTypeId,
        workforceAgentId: workforceAgent?.id ?? null,
        workforceAgentSlug: workforceAgent?.slug ?? null,
        workforceAgentName: workforceAgent?.name ?? null,
        agentSoul: payload.agentSoul,
        fieldMap: explicitFieldMap,
        provider: generation.provider,
        strategy: generation.strategy,
    };
}

async function executeJob(row: JobRecord) {
    const kind = parseJobKind(row.kind);
    const payload = parsePayload(kind, row.payload);

    if (kind === 'outbound_webhook') {
        return runOutboundWebhookJob(payload as OutboundWebhookJobPayload);
    }

    if (kind === 'draft_generation') {
        return runDraftGenerationJob(row.domainId, payload as DraftGenerationJobPayload);
    }

    return runContentStatusTransitionJob(row.domainId, payload as ContentStatusTransitionJobPayload);
}

export async function createJob<K extends JobKind>(input: CreateJobInput<K>) {
    const [created] = await db.insert(jobs).values({
        domainId: input.domainId,
        kind: input.kind,
        queue: normalizeJobQueue(input.queue, input.kind),
        status: 'queued',
        payload: input.payload,
        runAt: input.runAt ?? new Date(),
        maxAttempts: Math.max(1, Math.min(Math.trunc(input.maxAttempts ?? 3), 10)),
    }).returning();

    return created;
}

export async function scheduleContentStatusTransition(input: {
    domainId: number;
    contentItemId: number;
    targetStatus: string;
    runAt: Date;
    maxAttempts?: number;
}) {
    return createJob({
        domainId: input.domainId,
        kind: 'content_status_transition',
        payload: {
            contentItemId: input.contentItemId,
            targetStatus: input.targetStatus,
        },
        queue: 'content',
        runAt: input.runAt,
        maxAttempts: input.maxAttempts,
    });
}

export async function enqueueWebhookJob(input: {
    domainId: number;
    url: string;
    body: Record<string, unknown>;
    secret?: string | null;
    headers?: Record<string, string>;
    source?: 'audit' | 'form';
    runAt?: Date;
    maxAttempts?: number;
}) {
    return createJob({
        domainId: input.domainId,
        kind: 'outbound_webhook',
        payload: {
            url: input.url,
            body: input.body,
            secret: input.secret ?? null,
            headers: input.headers,
            source: input.source ?? 'audit',
        },
        queue: 'webhooks',
        runAt: input.runAt,
        maxAttempts: input.maxAttempts ?? 4,
    });
}

export async function enqueueDraftGenerationJob(input: {
    domainId: number;
    formId: number;
    formSlug: string;
    intakeContentItemId: number;
    intakeData: Record<string, unknown>;
    targetContentTypeId: number;
    workforceAgentId?: number | null;
    workforceAgentSlug?: string | null;
    workforceAgentName?: string | null;
    workforceAgentPurpose?: string | null;
    agentSoul: string;
    fieldMap?: Record<string, string>;
    defaultData?: Record<string, unknown>;
    provider?: DraftGenerationProviderConfig;
    postGenerationWorkflowTransitionId?: number | null;
    runAt?: Date;
    maxAttempts?: number;
}) {
    return createJob({
        domainId: input.domainId,
        kind: 'draft_generation',
        payload: {
            formId: input.formId,
            formSlug: input.formSlug,
            intakeContentItemId: input.intakeContentItemId,
            intakeData: input.intakeData,
            targetContentTypeId: input.targetContentTypeId,
            workforceAgentId: input.workforceAgentId ?? null,
            workforceAgentSlug: input.workforceAgentSlug ?? null,
            workforceAgentName: input.workforceAgentName ?? null,
            workforceAgentPurpose: input.workforceAgentPurpose ?? null,
            agentSoul: input.agentSoul,
            fieldMap: input.fieldMap ?? {},
            defaultData: input.defaultData ?? {},
            provider: input.provider ?? { type: 'deterministic' },
            postGenerationWorkflowTransitionId: input.postGenerationWorkflowTransitionId ?? null,
        },
        queue: 'drafts',
        runAt: input.runAt,
        maxAttempts: input.maxAttempts ?? 3,
    });
}

export async function enqueueAuditWebhookJobs(domainId: number, payload: Record<string, unknown>) {
    const targets = await db.select()
        .from(webhooks)
        .where(and(
            eq(webhooks.active, true),
            eq(webhooks.domainId, domainId),
        ));

    if (targets.length === 0) {
        return [];
    }

    const action = typeof payload.action === 'string' ? payload.action : '';
    const entityType = typeof payload.entityType === 'string' ? payload.entityType : '';
    const eventCandidates = new Set<string>([
        `${entityType}.${action}`,
        `audit.${action}`,
    ]);

    const matchingTargets = targets.filter((target) => {
        const events = target.events
            .split('|')
            .map((entry) => entry.trim())
            .filter(Boolean);

        return events.includes('*') || events.some((event) => eventCandidates.has(event));
    });

    if (matchingTargets.length === 0) {
        return [];
    }

    return Promise.all(
        matchingTargets.map((target) => enqueueWebhookJob({
            domainId,
            url: target.url,
            secret: target.secret,
            body: payload,
            source: 'audit',
        })),
    );
}

export async function listJobs(domainId: number, options: ListJobsOptions = {}) {
    const filters = [eq(jobs.domainId, domainId)];
    if (options.status) {
        filters.push(eq(jobs.status, options.status));
    }
    if (options.kind) {
        filters.push(eq(jobs.kind, options.kind));
    }

    return db.select()
        .from(jobs)
        .where(and(...filters))
        .orderBy(asc(jobs.runAt), asc(jobs.id))
        .limit(Math.max(1, Math.min(options.limit ?? 50, 200)))
        .offset(Math.max(0, options.offset ?? 0));
}

export async function getJob(domainId: number, id: number) {
    const [job] = await db.select()
        .from(jobs)
        .where(and(
            eq(jobs.domainId, domainId),
            eq(jobs.id, id),
        ));

    return job ?? null;
}

export async function cancelJob(domainId: number, id: number) {
    const [updated] = await db.update(jobs)
        .set({
            status: 'cancelled',
            completedAt: new Date(),
            updatedAt: new Date(),
        })
        .where(and(
            eq(jobs.domainId, domainId),
            eq(jobs.id, id),
            eq(jobs.status, 'queued'),
        ))
        .returning();

    return updated ?? null;
}

export async function processPendingJobs(maxJobsPerSweep = 25): Promise<number> {
    const now = new Date();
    const candidates = await db.select()
        .from(jobs)
        .where(and(
            eq(jobs.status, 'queued'),
            lte(jobs.runAt, now),
        ))
        .orderBy(asc(jobs.runAt), asc(jobs.id))
        .limit(Math.max(1, Math.min(maxJobsPerSweep, 100)));

    let processed = 0;
    for (const candidate of candidates) {
        const [claimed] = await db.update(jobs)
            .set({
                status: 'running',
                attempts: sql`${jobs.attempts} + 1`,
                claimedAt: new Date(),
                startedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(and(
                eq(jobs.id, candidate.id),
                eq(jobs.status, 'queued'),
            ))
            .returning();

        if (!claimed) {
            continue;
        }

        processed += 1;

        try {
            const result = await executeJob(claimed);
            await db.update(jobs)
                .set({
                    status: 'succeeded',
                    result,
                    lastError: null,
                    completedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(jobs.id, claimed.id));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const shouldRetry = claimed.attempts < claimed.maxAttempts;

            await db.update(jobs)
                .set({
                    status: shouldRetry ? 'queued' : 'failed',
                    runAt: shouldRetry ? computeRetryRunAt(claimed.attempts) : claimed.runAt,
                    lastError: message,
                    completedAt: shouldRetry ? null : new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(jobs.id, claimed.id));
        }
    }

    return processed;
}

export function serializeJob(row: JobRecord) {
    return {
        ...row,
        kind: parseJobKind(row.kind),
        status: parseJobStatus(row.status),
    };
}
