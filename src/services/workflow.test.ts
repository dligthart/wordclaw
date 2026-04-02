import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    dbMock: {
        select: vi.fn(),
        update: vi.fn(),
        insert: vi.fn(),
    },
    logAuditMock: vi.fn(),
    enqueueWebhookJobMock: vi.fn(),
    syncItemEmbeddingsMock: vi.fn(),
    deleteItemEmbeddingsMock: vi.fn(),
}));

vi.mock('../db/index.js', () => ({
    db: mocks.dbMock,
}));

vi.mock('./audit.js', () => ({
    logAudit: mocks.logAuditMock,
}));

vi.mock('./jobs.js', () => ({
    enqueueWebhookJob: mocks.enqueueWebhookJobMock,
}));

vi.mock('./embedding.js', () => ({
    EmbeddingService: {
        syncItemEmbeddings: mocks.syncItemEmbeddingsMock,
        deleteItemEmbeddings: mocks.deleteItemEmbeddingsMock,
    },
}));

import { WorkflowService } from './workflow.js';

describe('workflow service', () => {
    beforeEach(() => {
        mocks.dbMock.select.mockReset();
        mocks.dbMock.update.mockReset();
        mocks.dbMock.insert.mockReset();
        mocks.logAuditMock.mockReset();
        mocks.enqueueWebhookJobMock.mockReset();
        mocks.syncItemEmbeddingsMock.mockReset();
        mocks.deleteItemEmbeddingsMock.mockReset();
        mocks.syncItemEmbeddingsMock.mockResolvedValue(undefined);
        mocks.deleteItemEmbeddingsMock.mockResolvedValue(undefined);
    });

    it('enqueues a form webhook when an approved review task belongs to a generated draft', async () => {
        const pendingTask = {
            id: 44,
            domainId: 7,
            contentItemId: 11,
            workflowTransitionId: 90,
            status: 'pending',
            assignee: null,
            assigneeActorId: null,
            assigneeActorType: null,
            assigneeActorSource: null,
            createdAt: new Date('2026-04-02T09:00:00.000Z'),
            updatedAt: new Date('2026-04-02T09:00:00.000Z'),
        };
        const updatedTask = {
            ...pendingTask,
            status: 'approved',
            updatedAt: new Date('2026-04-02T09:05:00.000Z'),
        };
        const transition = {
            id: 90,
            workflowId: 12,
            fromState: 'pending_review',
            toState: 'approved',
            requiredRoles: ['admin'],
        };
        const draftGenerationJob = {
            id: 5,
            domainId: 7,
            kind: 'draft_generation',
            queue: 'drafts',
            status: 'succeeded',
            payload: {
                formId: 6,
                intakeContentItemId: 10,
                targetContentTypeId: 10,
                workforceAgentId: 2,
                workforceAgentSlug: 'proposal-writer',
                workforceAgentName: 'Proposal Writer',
                agentSoul: 'software-development-proposal-writer',
                provider: {
                    type: 'openai',
                    model: 'gpt-4.1-mini',
                },
            },
            result: {
                generatedContentItemId: 11,
                provider: {
                    type: 'openai',
                    model: 'gpt-4.1-mini',
                    responseId: 'resp_123',
                },
                strategy: 'openai_structured_outputs_v1',
            },
            runAt: new Date('2026-04-02T09:00:00.000Z'),
            attempts: 1,
            maxAttempts: 3,
            lastError: null,
            claimedAt: new Date('2026-04-02T09:01:00.000Z'),
            startedAt: new Date('2026-04-02T09:01:00.000Z'),
            completedAt: new Date('2026-04-02T09:02:00.000Z'),
            createdAt: new Date('2026-04-02T09:00:00.000Z'),
            updatedAt: new Date('2026-04-02T09:02:00.000Z'),
        };

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([pendingTask]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([transition]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: () => ({
                        orderBy: () => ({
                            limit: vi.fn().mockResolvedValue([draftGenerationJob]),
                        }),
                    }),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 6,
                        slug: 'proposal-intake',
                        name: 'Proposal Intake',
                        webhookUrl: 'https://example.com/forms',
                        webhookSecret: 'form-secret',
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 10,
                        status: 'draft',
                        data: JSON.stringify({
                            email: 'requester@example.com',
                            requirements: 'Need a proposal',
                        }),
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 11,
                        status: 'approved',
                        data: JSON.stringify({
                            title: 'Generated Proposal',
                            summary: 'Approved draft',
                        }),
                    }]),
                }),
            }));

        mocks.dbMock.update
            .mockImplementationOnce(() => ({
                set: () => ({
                    where: () => ({
                        returning: vi.fn().mockResolvedValue([updatedTask]),
                    }),
                }),
            }))
            .mockImplementationOnce(() => ({
                set: () => ({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            }));

        const authPrincipal = {
            actorId: 'api_key:1',
            actorType: 'api_key' as const,
            actorSource: 'db' as const,
            source: 'db' as const,
            domainId: 7,
            scopes: new Set(['admin']),
        };

        const result = await WorkflowService.decideReviewTask(7, 44, 'approved', authPrincipal);

        expect(result).toEqual(updatedTask);
        expect(mocks.logAuditMock).toHaveBeenCalledWith(
            7,
            'update',
            'content_item',
            11,
            expect.objectContaining({
                source: 'workflow_review_decision',
                reviewTaskId: 44,
                workflowTransitionId: 90,
                decision: 'approved',
                status: 'approved',
            }),
            expect.any(Object),
        );
        expect(mocks.enqueueWebhookJobMock).toHaveBeenCalledWith(expect.objectContaining({
            domainId: 7,
            url: 'https://example.com/forms',
            secret: 'form-secret',
            source: 'form',
            body: {
                event: 'form.draft_generation.review.approved',
                form: {
                    id: 6,
                    slug: 'proposal-intake',
                    name: 'Proposal Intake',
                },
                submission: {
                    contentItemId: 10,
                    status: 'draft',
                    data: {
                        email: 'requester@example.com',
                        requirements: 'Need a proposal',
                    },
                },
                draftGeneration: expect.objectContaining({
                    jobId: 5,
                    intakeContentItemId: 10,
                    generatedContentItemId: 11,
                    targetContentTypeId: 10,
                    providerType: 'openai',
                    providerModel: 'gpt-4.1-mini',
                    strategy: 'openai_structured_outputs_v1',
                }),
                review: {
                    taskId: 44,
                    decision: 'approved',
                    workflowTransitionId: 90,
                    decidedAt: '2026-04-02T09:05:00.000Z',
                },
                generated: {
                    contentItemId: 11,
                    status: 'approved',
                    data: {
                        title: 'Generated Proposal',
                        summary: 'Approved draft',
                    },
                },
            },
        }));
    });
});
