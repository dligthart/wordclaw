import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../db/index.js';
import { workflows, workflowTransitions, contentTypes, contentItems, reviewTasks, reviewComments, domains } from '../db/schema.js';
import { WorkflowService } from '../services/workflow.js';
import { eq } from 'drizzle-orm';

describe('Workflow & Review System (Domain 1)', () => {
    const domainId = 1;
    let contentTypeId: number;
    let workflowId: number;
    let transition1Id: number;
    let transition2Id: number;

    beforeAll(async () => {
        // Build base tables directly to skip application logic where possible since we are testing
        const [ct] = await db.insert(contentTypes).values({
            domainId,
            name: 'Article Workflow Mode',
            slug: `article-workflow-mode-${Date.now()}`,
            schema: JSON.stringify({ type: 'object', properties: { title: { type: 'string' } }, additionalProperties: false })
        }).returning();
        contentTypeId = ct.id;

        const [wf] = await db.insert(workflows).values({
            domainId,
            name: 'Standard Editorial Review',
            contentTypeId,
            active: true
        }).returning();
        workflowId = wf.id;

        const [t1] = await db.insert(workflowTransitions).values({
            workflowId,
            fromState: 'draft',
            toState: 'in_review',
            requiredRoles: ['author', 'admin']
        }).returning();
        transition1Id = t1.id;

        const [t2] = await db.insert(workflowTransitions).values({
            workflowId,
            fromState: 'in_review',
            toState: 'published',
            requiredRoles: ['reviewer', 'admin']
        }).returning();
        transition2Id = t2.id;
    });

    it('should create an active workflow and retrieve it', async () => {
        const wf = await WorkflowService.getActiveWorkflow(domainId, contentTypeId);
        expect(wf).toBeDefined();
        expect(wf?.id).toBe(workflowId);
    });

    it('should allow submitting a drafted content item into a review task', async () => {
        const [item] = await db.insert(contentItems).values({
            domainId,
            contentTypeId,
            status: 'draft',
            data: JSON.stringify({ title: 'AI Generated Draft' })
        }).returning();

        const task = await WorkflowService.submitForReview({
            domainId,
            contentItemId: item.id,
            workflowTransitionId: transition1Id,
            authPrincipal: { scopes: new Set(['author']), domainId }
        });

        expect(task.status).toBe('pending');
        expect(task.contentItemId).toBe(item.id);

        const [updatedItem] = await db.select().from(contentItems).where(eq(contentItems.id, item.id));
        expect(updatedItem.status).toBe('in_review');
    });

    it('should allow reviewers to decide upon the task and update item status', async () => {
        const [item] = await db.insert(contentItems).values({
            domainId,
            contentTypeId,
            status: 'draft',
            data: JSON.stringify({ title: 'Final Review Item' })
        }).returning();

        // 1. Author submits for review -> status "in_review"
        await WorkflowService.submitForReview({
            domainId,
            contentItemId: item.id,
            workflowTransitionId: transition1Id,
            authPrincipal: { scopes: new Set(['author']), domainId }
        });

        // 2. Reviewer submits review-task decision (or transition) pointing towards "published"
        const task2 = await WorkflowService.submitForReview({
            domainId,
            contentItemId: item.id,
            workflowTransitionId: transition2Id,
            authPrincipal: { scopes: new Set(['reviewer']), domainId }
        });

        const decisionResult = await WorkflowService.decideReviewTask(
            domainId,
            task2.id,
            'approved',
            { scopes: new Set(['reviewer', 'admin']), domainId }
        );

        expect(decisionResult.status).toBe('approved');

        const [finalItem] = await db.select().from(contentItems).where(eq(contentItems.id, item.id));
        expect(finalItem.status).toBe('published'); // transition execution successful
    });

    it('should allow adding and listing comments on an item', async () => {
        const [item] = await db.insert(contentItems).values({
            domainId,
            contentTypeId,
            status: 'draft',
            data: JSON.stringify({ title: 'Discussion Item' })
        }).returning();

        const comment1 = await WorkflowService.addComment(domainId, item.id, 'AgentA', 'Looks good to me.');
        expect(comment1.comment).toBe('Looks good to me.');

        const comment2 = await WorkflowService.addComment(domainId, item.id, 'AgentB', 'Needs more citations.');
        expect(comment2.comment).toBe('Needs more citations.');

        const list = await WorkflowService.listComments(domainId, item.id);
        expect(list.length).toBe(2);
        expect(list[0].authorId).toBe('AgentB');
        expect(list[1].authorId).toBe('AgentA');
    });

    it('should reject workflow creation when content type belongs to another domain', async () => {
        const [domain2] = await db.select().from(domains).where(eq(domains.id, 2));
        if (!domain2) {
            await db.insert(domains).values({
                id: 2,
                name: 'Workflow Test Domain 2',
                hostname: `workflow-domain2-${Date.now()}.local`
            });
        }

        const [foreignType] = await db.insert(contentTypes).values({
            domainId: 2,
            name: 'Cross Domain Workflow Type',
            slug: `cross-domain-workflow-type-${Date.now()}`,
            schema: JSON.stringify({ type: 'object', properties: { title: { type: 'string' } } })
        }).returning();

        try {
            await expect(
                WorkflowService.createWorkflow(domainId, 'Invalid Cross Domain Workflow', foreignType.id, true)
            ).rejects.toThrow('CONTENT_TYPE_NOT_FOUND');
        } finally {
            await db.delete(contentTypes).where(eq(contentTypes.id, foreignType.id));
        }
    });

    it('should reject transition creation when workflow belongs to another domain', async () => {
        const [domain2] = await db.select().from(domains).where(eq(domains.id, 2));
        if (!domain2) {
            await db.insert(domains).values({
                id: 2,
                name: 'Workflow Test Domain 2',
                hostname: `workflow-domain2-${Date.now()}.local`
            });
        }

        const [foreignType] = await db.insert(contentTypes).values({
            domainId: 2,
            name: 'Foreign Workflow Transition Type',
            slug: `foreign-workflow-transition-type-${Date.now()}`,
            schema: JSON.stringify({ type: 'object', properties: { title: { type: 'string' } } })
        }).returning();

        const [foreignWorkflow] = await db.insert(workflows).values({
            domainId: 2,
            name: 'Foreign Domain Workflow',
            contentTypeId: foreignType.id,
            active: true
        }).returning();

        try {
            await expect(
                WorkflowService.createWorkflowTransition(
                    domainId,
                    foreignWorkflow.id,
                    'draft',
                    'in_review',
                    ['admin']
                )
            ).rejects.toThrow('WORKFLOW_NOT_FOUND');
        } finally {
            await db.delete(workflows).where(eq(workflows.id, foreignWorkflow.id));
            await db.delete(contentTypes).where(eq(contentTypes.id, foreignType.id));
        }
    });
});
