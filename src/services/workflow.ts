import { db } from '../db/index.js';
import {
    workflows,
    workflowTransitions,
    reviewTasks,
    reviewComments,
    contentItems,
    contentTypes,
    jobs,
    formDefinitions,
} from '../db/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
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
    authPrincipal?: PrincipalLike & { scopes: Set<string>, domainId: number };
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

type DraftGenerationReviewWebhookContext = {
    form: {
        id: number;
        slug: string;
        name: string;
        webhookUrl: string;
        webhookSecret: string | null;
    };
    job: {
        id: number;
        intakeContentItemId: number;
        targetContentTypeId: number;
        workforceAgentId: number | null;
        workforceAgentSlug: string | null;
        workforceAgentName: string | null;
        agentSoul: string;
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
        data: Record<string, unknown>;
    };
};

async function loadDraftGenerationReviewWebhookContext(
    domainId: number,
    generatedContentItemId: number,
): Promise<DraftGenerationReviewWebhookContext | null> {
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

    const webhookUrl = normalizeOptionalString(form?.webhookUrl);
    if (!form || !webhookUrl) {
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
            webhookUrl,
            webhookSecret: normalizeOptionalString(form.webhookSecret),
        },
        job: {
            id: jobRow.id,
            intakeContentItemId,
            targetContentTypeId,
            workforceAgentId: readPositiveInteger(payload.workforceAgentId),
            workforceAgentSlug: normalizeOptionalString(payload.workforceAgentSlug),
            workforceAgentName: normalizeOptionalString(payload.workforceAgentName),
            agentSoul,
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
            data: parseObjectData(generatedItem.data) ?? {},
        },
    };
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
        const { domainId, contentItemId, workflowTransitionId, assignee, authPrincipal } = context;

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

        // Verify content item belongs to the domain
        const [contentItemRow] = await db.select().from(contentItems).where(and(eq(contentItems.id, contentItemId), eq(contentItems.domainId, domainId)));
        if (!contentItemRow) {
            throw new Error('CONTENT_ITEM_NOT_FOUND_OR_UNMATCHED_DOMAIN');
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
            assignee,
            assigneeActorId: assigneeIdentity?.actorId ?? null,
            assigneeActorType: assigneeIdentity?.actorType ?? null,
            assigneeActorSource: assigneeIdentity?.actorSource ?? null,
        }).returning();

        // 5. Update the content item native status to the transitional "fromState" (e.g. 'pending_review') 
        // to indicate it is locked in workflow
        await db.update(contentItems)
            .set({ status: transition.toState })
            .where(and(eq(contentItems.id, contentItemId), eq(contentItems.domainId, domainId)));

        return newTask;
    }

    static async decideReviewTask(
        domainId: number,
        taskId: number,
        decision: 'approved' | 'rejected',
        authPrincipal: PrincipalLike & {
            scopes: Set<string>;
            domainId: number;
        },
    ) {
        const results = await db.select()
            .from(reviewTasks)
            .where(and(eq(reviewTasks.id, taskId), eq(reviewTasks.domainId, domainId)));

        // Ensure the task matches the required domain context
        const task = results[0];

        if (!task || task.status !== 'pending') {
            throw new Error('INVALID_REVIEW_TASK_STATE_OR_NOT_FOUND');
        }

        const isAdmin = authPrincipal.scopes.has('admin');
        const assignmentRefs = buildActorAssignmentRefs(authPrincipal);
        const isAssignee = task.assignee ? assignmentRefs.includes(task.assignee) : false;

        if (!isAdmin && !isAssignee) {
            throw new Error('UNAUTHORIZED_REVIEW_DECISION: Must be an assignee or admin to decide.');
        }

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
                await db.update(contentItems)
                    .set({ status: transition.toState })
                    .where(and(eq(contentItems.id, task.contentItemId), eq(contentItems.domainId, domainId)));

                // If the target state is published, dynamically generate vector embeddings
                if (transition.toState === 'published') {
                    // Fire and forget to avoid stalling the HTTP response
                    EmbeddingService.syncItemEmbeddings(domainId, task.contentItemId).catch(console.error);
                } else {
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

    static async listComments(domainId: number, contentItemId: number) {
        return await db.select()
            .from(reviewComments)
            .where(and(eq(reviewComments.domainId, domainId), eq(reviewComments.contentItemId, contentItemId)))
            .orderBy(desc(reviewComments.createdAt), desc(reviewComments.id));
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
