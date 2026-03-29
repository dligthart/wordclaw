import crypto from 'node:crypto';

import { and, asc, eq, lte, sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import { contentItems, contentItemVersions, contentTypes, jobs, webhooks, workflows } from '../db/schema.js';
import { EmbeddingService } from './embedding.js';

export type JobKind = 'content_status_transition' | 'outbound_webhook';
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

export type JobPayloadMap = {
    outbound_webhook: OutboundWebhookJobPayload;
    content_status_transition: ContentStatusTransitionJobPayload;
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
const JOB_KIND_VALUES: JobKind[] = ['content_status_transition', 'outbound_webhook'];

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

    return kind === 'outbound_webhook' ? 'webhooks' : 'content';
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

function parsePayload(kind: JobKind, payload: unknown): JobPayloadMap[JobKind] {
    if (kind === 'outbound_webhook') {
        return parseOutboundWebhookPayload(payload);
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

async function executeJob(row: JobRecord) {
    const kind = parseJobKind(row.kind);
    const payload = parsePayload(kind, row.payload);

    if (kind === 'outbound_webhook') {
        return runOutboundWebhookJob(payload as OutboundWebhookJobPayload);
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
