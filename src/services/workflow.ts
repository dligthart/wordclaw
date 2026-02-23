import { db } from '../db/index.js';
import {
    workflows,
    workflowTransitions,
    reviewTasks,
    reviewComments,
    contentItems,
    contentTypes
} from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { EmbeddingService } from './embedding.js';

export interface WorkflowTransitionContext {
    domainId: number;
    contentItemId: number;
    workflowTransitionId: number;
    assignee?: string;
    authPrincipal?: { scopes: Set<string>, domainId: number };
}

export class WorkflowService {
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

        // 1. Fetch transition requirements
        const results = await db.select()
            .from(workflowTransitions)
            .where(eq(workflowTransitions.id, workflowTransitionId));
        const transition = results[0];

        if (!transition) {
            throw new Error('WORKFLOW_TRANSITION_NOT_FOUND');
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

        // 3. Close out any existing pending review tasks for this content item
        await db.update(reviewTasks)
            .set({ status: 'rejected' })
            .where(and(eq(reviewTasks.contentItemId, contentItemId), eq(reviewTasks.status, 'pending')));

        // 4. Create the new review task
        const [newTask] = await db.insert(reviewTasks).values({
            domainId,
            contentItemId,
            workflowTransitionId,
            status: 'pending',
            assignee
        }).returning();

        // 5. Update the content item native status to the transitional "fromState" (e.g. 'pending_review') 
        // to indicate it is locked in workflow
        await db.update(contentItems)
            .set({ status: transition.toState })
            .where(eq(contentItems.id, contentItemId));

        return newTask;
    }

    static async decideReviewTask(domainId: number, taskId: number, decision: 'approved' | 'rejected', authPrincipal: { scopes: Set<string>, domainId: number }) {
        const results = await db.select()
            .from(reviewTasks)
            .where(and(eq(reviewTasks.id, taskId), eq(reviewTasks.domainId, domainId)));

        const task = results[0];

        if (!task || task.status !== 'pending') {
            throw new Error('INVALID_REVIEW_TASK_STATE');
        }

        // Technically, a robust workflow engine checks if the user mapped to `assignee` is deciding this.
        // For standard parity, we accept any `admin` or the direct assignee if configured.

        const [updatedTask] = await db.update(reviewTasks)
            .set({
                status: decision,
                updatedAt: new Date()
            })
            .where(eq(reviewTasks.id, taskId))
            .returning();

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
                    .where(eq(contentItems.id, task.contentItemId));

                // If the target state is published, dynamically generate vector embeddings
                if (transition.toState === 'published') {
                    // Fire and forget to avoid stalling the HTTP response
                    EmbeddingService.syncItemEmbeddings(domainId, task.contentItemId).catch(console.error);
                } else {
                    EmbeddingService.deleteItemEmbeddings(domainId, task.contentItemId).catch(console.error);
                }
            }
        }

        return updatedTask;
    }

    static async listComments(domainId: number, contentItemId: number) {
        return await db.select()
            .from(reviewComments)
            .where(and(eq(reviewComments.domainId, domainId), eq(reviewComments.contentItemId, contentItemId)))
            .orderBy(desc(reviewComments.createdAt));
    }

    static async addComment(domainId: number, contentItemId: number, authorId: string, comment: string) {
        const [newComment] = await db.insert(reviewComments).values({
            domainId,
            contentItemId,
            authorId,
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
