import { describe, expect, it } from 'vitest';

import { buildWorkflowGuide } from './workflow-guide.js';

const sampleTask = {
    task: {
        id: 41,
        contentItemId: 99,
        workflowTransitionId: 7,
        status: 'pending',
        assignee: 'api_key:12',
        createdAt: '2026-03-11T10:00:00.000Z',
    },
    transition: {
        id: 7,
        fromState: 'draft',
        toState: 'in_review',
        requiredRoles: ['author', 'admin'],
    },
    workflow: {
        id: 5,
        name: 'Editorial Review',
    },
    contentItem: {
        id: 99,
        status: 'in_review',
        version: 3,
    },
    contentType: {
        id: 11,
        name: 'Article',
        slug: 'article',
    },
};

describe('buildWorkflowGuide', () => {
    it('marks admin actors as able to decide any task', () => {
        const guide = buildWorkflowGuide({
            tasks: [sampleTask],
            currentActor: {
                actorId: 'env_key:remote-admin',
                actorType: 'env_key',
                actorSource: 'env',
                actorProfileId: 'env-key',
                domainId: 1,
                scopes: ['admin'],
                assignmentRefs: ['env_key:remote-admin', 'remote-admin'],
            },
        });

        expect(guide.actorReadiness.status).toBe('ready');
        expect(guide.tasks[0].decisionReadiness).toEqual(expect.objectContaining({
            status: 'ready',
            reason: 'admin',
            canDecide: true,
        }));
        expect(guide.tasks[0].recommendedCommands.approve).toBe('node dist/cli/index.js workflow decide --id 41 --decision approved');
    });

    it('marks canonical assignee matches as actionable', () => {
        const guide = buildWorkflowGuide({
            tasks: [sampleTask],
            currentActor: {
                actorId: 'api_key:12',
                actorType: 'api_key',
                actorSource: 'db',
                actorProfileId: 'api-key',
                domainId: 1,
                scopes: ['content:write'],
                assignmentRefs: ['api_key:12', '12'],
            },
        });

        expect(guide.tasks[0].decisionReadiness).toEqual(expect.objectContaining({
            status: 'ready',
            reason: 'assignee',
            canDecide: true,
        }));
    });

    it('blocks actors when the task belongs to a different assignee', () => {
        const guide = buildWorkflowGuide({
            tasks: [sampleTask],
            currentActor: {
                actorId: 'api_key:14',
                actorType: 'api_key',
                actorSource: 'db',
                actorProfileId: 'api-key',
                domainId: 1,
                scopes: ['content:write'],
                assignmentRefs: ['api_key:14', '14'],
            },
        });

        expect(guide.tasks[0].decisionReadiness).toEqual(expect.objectContaining({
            status: 'blocked',
            reason: 'different-assignee',
            canDecide: false,
        }));
    });

    it('blocks when no actor snapshot is available', () => {
        const guide = buildWorkflowGuide({
            tasks: [sampleTask],
        });

        expect(guide.actorReadiness.status).toBe('blocked');
        expect(guide.tasks[0].decisionReadiness).toEqual(expect.objectContaining({
            status: 'blocked',
            reason: 'no-actor',
        }));
    });

    it('filters to a specific task when requested', () => {
        const guide = buildWorkflowGuide({
            tasks: [
                sampleTask,
                {
                    ...sampleTask,
                    task: {
                        ...sampleTask.task,
                        id: 42,
                    },
                },
            ],
            preferredTaskId: 42,
        });

        expect(guide.summary.pendingTasks).toBe(1);
        expect(guide.tasks[0].taskId).toBe(42);
    });
});
