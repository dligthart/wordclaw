import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    dbMock: {
        select: vi.fn(),
        update: vi.fn(),
        insert: vi.fn(),
        transaction: vi.fn(),
    },
    logAuditMock: vi.fn(),
    enqueueWebhookJobMock: vi.fn(),
    syncItemEmbeddingsMock: vi.fn(),
    deleteItemEmbeddingsMock: vi.fn(),
    getAiProviderSecretConfigMock: vi.fn(),
    getAssetMock: vi.fn(),
    readAssetContentMock: vi.fn(),
    validateContentDataAgainstSchemaMock: vi.fn(),
    updateContentItemMock: vi.fn(),
    generateDraftDataMock: vi.fn(),
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

vi.mock('./ai-provider-config.js', () => ({
    getAiProviderSecretConfig: mocks.getAiProviderSecretConfigMock,
}));

vi.mock('./assets.js', () => ({
    getAsset: mocks.getAssetMock,
    readAssetContent: mocks.readAssetContentMock,
}));

vi.mock('./content-schema.js', () => ({
    validateContentDataAgainstSchema: mocks.validateContentDataAgainstSchemaMock,
}));

vi.mock('./content-item.service.js', () => ({
    updateContentItem: mocks.updateContentItemMock,
}));

vi.mock('./draft-generation.js', () => ({
    DraftGenerationError: class extends Error {
        code: string;
        statusCode: number;

        constructor(code: string, message: string, statusCode = 500) {
            super(message);
            this.name = 'DraftGenerationError';
            this.code = code;
            this.statusCode = statusCode;
        }
    },
    generateDraftData: mocks.generateDraftDataMock,
}));

import { WorkflowService } from './workflow.js';

describe('workflow service', () => {
    beforeEach(() => {
        mocks.dbMock.select.mockReset();
        mocks.dbMock.update.mockReset();
        mocks.dbMock.insert.mockReset();
        mocks.dbMock.transaction.mockReset();
        mocks.logAuditMock.mockReset();
        mocks.enqueueWebhookJobMock.mockReset();
        mocks.syncItemEmbeddingsMock.mockReset();
        mocks.deleteItemEmbeddingsMock.mockReset();
        mocks.getAiProviderSecretConfigMock.mockReset();
        mocks.getAssetMock.mockReset();
        mocks.readAssetContentMock.mockReset();
        mocks.validateContentDataAgainstSchemaMock.mockReset();
        mocks.updateContentItemMock.mockReset();
        mocks.generateDraftDataMock.mockReset();
        mocks.syncItemEmbeddingsMock.mockResolvedValue(undefined);
        mocks.deleteItemEmbeddingsMock.mockResolvedValue(undefined);
        mocks.validateContentDataAgainstSchemaMock.mockResolvedValue(null);
        mocks.dbMock.transaction.mockImplementation(async (callback: (tx: typeof mocks.dbMock) => unknown) => {
            return await callback({
                select: mocks.dbMock.select,
                update: mocks.dbMock.update,
                insert: mocks.dbMock.insert,
                transaction: mocks.dbMock.transaction,
            } as typeof mocks.dbMock);
        });
    });

    it('keeps content in review while a pending approval task exists', async () => {
        const transition = {
            id: 90,
            workflowId: 12,
            fromState: 'draft',
            toState: 'published',
            requiredRoles: [],
        };
        const contentItem = {
            id: 18,
            domainId: 7,
            contentTypeId: 10,
            status: 'draft',
            version: 1,
            data: JSON.stringify({ title: 'Draft proposal' }),
            createdAt: new Date('2026-04-02T09:00:00.000Z'),
            updatedAt: new Date('2026-04-02T09:00:00.000Z'),
        };
        const updatedContentItem = {
            ...contentItem,
            status: 'in_review',
            version: 2,
            updatedAt: new Date('2026-04-02T09:01:00.000Z'),
        };
        const createdTask = {
            id: 55,
            domainId: 7,
            contentItemId: 18,
            workflowTransitionId: 90,
            status: 'pending',
            assignee: null,
            assigneeActorId: null,
            assigneeActorType: null,
            assigneeActorSource: null,
        };

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    innerJoin: () => ({
                        where: vi.fn().mockResolvedValue([{ transition }]),
                    }),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([contentItem]),
                }),
            }));

        mocks.dbMock.update
            .mockImplementationOnce(() => ({
                set: () => ({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            }))
            .mockImplementationOnce(() => ({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([updatedContentItem]),
                    }),
                }),
            }));

        mocks.dbMock.insert
            .mockImplementationOnce(() => ({
                values: () => ({
                    returning: vi.fn().mockResolvedValue([createdTask]),
                }),
            }))
            .mockImplementationOnce(() => ({
                values: vi.fn().mockResolvedValue(undefined),
            }));

        const result = await WorkflowService.submitForReview({
            domainId: 7,
            contentItemId: 18,
            workflowTransitionId: 90,
            authPrincipal: {
                domainId: 7,
                scopes: new Set(['admin']),
            },
        });

        expect(mocks.dbMock.update).toHaveBeenNthCalledWith(
            2,
            expect.anything(),
        );
        const secondUpdate = mocks.dbMock.update.mock.results[1]?.value;
        expect(secondUpdate.set).toHaveBeenCalledWith(expect.objectContaining({
            status: 'in_review',
            version: 2,
            updatedAt: expect.any(Date),
        }));
        expect(result).toEqual(createdTask);
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
                    where: vi.fn().mockResolvedValue([{
                        id: 11,
                        domainId: 7,
                        contentTypeId: 10,
                        status: 'in_review',
                        version: 2,
                        data: JSON.stringify({
                            title: 'Generated Proposal',
                            summary: 'Approved draft',
                        }),
                        createdAt: new Date('2026-04-02T09:00:00.000Z'),
                        updatedAt: new Date('2026-04-02T09:03:00.000Z'),
                    }]),
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
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{
                            id: 11,
                            domainId: 7,
                            contentTypeId: 10,
                            status: 'approved',
                            version: 3,
                            data: JSON.stringify({
                                title: 'Generated Proposal',
                                summary: 'Approved draft',
                            }),
                            createdAt: new Date('2026-04-02T09:00:00.000Z'),
                            updatedAt: new Date('2026-04-02T09:04:00.000Z'),
                        }]),
                    }),
                }),
            }));
        mocks.dbMock.insert.mockImplementationOnce(() => ({
            values: vi.fn().mockResolvedValue(undefined),
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

    it('revises a generated draft in place and keeps the review task pending', async () => {
        const pendingTask = {
            id: 55,
            domainId: 7,
            contentItemId: 18,
            workflowTransitionId: 91,
            status: 'pending',
            assignee: null,
            assigneeActorId: null,
            assigneeActorType: null,
            assigneeActorSource: null,
            createdAt: new Date('2026-04-02T10:00:00.000Z'),
            updatedAt: new Date('2026-04-02T10:00:00.000Z'),
        };
        const draftGenerationJob = {
            id: 9,
            domainId: 7,
            kind: 'draft_generation',
            queue: 'drafts',
            status: 'succeeded',
            payload: {
                formId: 6,
                formSlug: 'proposal-intake',
                intakeContentItemId: 17,
                intakeData: {
                    company: 'Acme',
                },
                intakeAssetReferences: [],
                targetContentTypeId: 10,
                workforceAgentId: 2,
                workforceAgentSlug: 'proposal-writer',
                workforceAgentName: 'Proposal Writer',
                workforceAgentPurpose: 'Draft software implementation proposals.',
                agentSoul: 'software-development-proposal-writer',
                fieldMap: {
                    requirements: 'brief',
                },
                defaultData: {
                    title: 'Draft proposal',
                },
                provider: {
                    type: 'openai',
                    model: 'gpt-4.1-mini',
                    instructions: 'Keep the proposal concise.',
                },
            },
            result: {
                generatedContentItemId: 18,
                provider: {
                    type: 'openai',
                    model: 'gpt-4.1-mini',
                    responseId: 'resp_prev',
                },
                strategy: 'openai_structured_outputs_v1',
            },
            runAt: new Date('2026-04-02T10:00:00.000Z'),
            attempts: 1,
            maxAttempts: 3,
            lastError: null,
            claimedAt: new Date('2026-04-02T10:01:00.000Z'),
            startedAt: new Date('2026-04-02T10:01:00.000Z'),
            completedAt: new Date('2026-04-02T10:02:00.000Z'),
            createdAt: new Date('2026-04-02T10:00:00.000Z'),
            updatedAt: new Date('2026-04-02T10:02:00.000Z'),
        };
        const updatedContentItem = {
            id: 18,
            domainId: 7,
            contentTypeId: 10,
            data: JSON.stringify({
                title: 'Draft proposal',
                brief: 'Need clearer rollout detail',
                summary: 'Updated summary',
            }),
            status: 'in_review',
            version: 4,
            createdAt: new Date('2026-04-02T10:00:00.000Z'),
            updatedAt: new Date('2026-04-02T10:06:00.000Z'),
        };

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([pendingTask]),
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
                        webhookUrl: null,
                        webhookSecret: null,
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 17,
                        status: 'draft',
                        data: JSON.stringify({
                            requirements: 'Need clearer rollout detail',
                        }),
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 18,
                        status: 'in_review',
                        version: 3,
                        data: JSON.stringify({
                            title: 'Draft proposal',
                            summary: 'Original summary',
                        }),
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 10,
                        domainId: 7,
                        name: 'Proposal Draft',
                        slug: 'proposal-draft',
                        schema: JSON.stringify({
                            type: 'object',
                            properties: {
                                title: { type: 'string' },
                                brief: { type: 'string' },
                                summary: { type: 'string' },
                            },
                            required: ['title', 'brief', 'summary'],
                        }),
                    }]),
                }),
            }));

        mocks.dbMock.insert.mockImplementationOnce(() => ({
            values: () => ({
                returning: vi.fn().mockResolvedValue([{
                    id: 1,
                    contentItemId: 18,
                    comment: 'AI revision requested: Tighten the delivery plan and make assumptions explicit.',
                }]),
            }),
        }));

        mocks.getAiProviderSecretConfigMock.mockResolvedValue({
            provider: 'openai',
            apiKey: 'tenant-openai-key',
            defaultModel: 'gpt-4.1-mini',
            maskedApiKey: '***',
            createdAt: '2026-04-02T10:00:00.000Z',
            updatedAt: '2026-04-02T10:00:00.000Z',
        });
        mocks.generateDraftDataMock.mockResolvedValue({
            data: {
                title: 'Draft proposal',
                brief: 'Need clearer rollout detail',
                summary: 'Updated summary',
            },
            strategy: 'openai_structured_outputs_v1',
            provider: {
                type: 'openai',
                model: 'gpt-4.1-mini',
                responseId: 'resp_new',
            },
        });
        mocks.updateContentItemMock.mockResolvedValue(updatedContentItem);

        const authPrincipal = {
            actorId: 'supervisor:1',
            actorType: 'supervisor' as const,
            actorSource: 'db' as const,
            source: 'db' as const,
            domainId: 7,
            scopes: new Set(['admin']),
        };

        const result = await WorkflowService.reviseReviewTask(
            7,
            55,
            'Tighten the delivery plan and make assumptions explicit.',
            authPrincipal,
        );

        expect(mocks.generateDraftDataMock).toHaveBeenCalledWith(expect.objectContaining({
            revisionPrompt: 'Tighten the delivery plan and make assumptions explicit.',
            currentDraftData: {
                title: 'Draft proposal',
                summary: 'Original summary',
            },
            provider: {
                type: 'openai',
                model: 'gpt-4.1-mini',
                instructions: 'Keep the proposal concise.',
            },
        }));
        expect(mocks.updateContentItemMock).toHaveBeenCalledWith(18, 7, {
            data: JSON.stringify({
                title: 'Draft proposal',
                brief: 'Need clearer rollout detail',
                summary: 'Updated summary',
            }),
            status: 'in_review',
        });
        expect(mocks.logAuditMock).toHaveBeenCalledWith(
            7,
            'update',
            'content_item',
            18,
            expect.objectContaining({
                source: 'workflow_review_ai_revision',
                contentItemId: 18,
                previousContentVersion: 3,
                contentVersion: 4,
                revisionPrompt: 'Tighten the delivery plan and make assumptions explicit.',
            }),
            expect.any(Object),
        );
        expect(result).toEqual({
            taskId: 55,
            contentItemId: 18,
            contentStatus: 'in_review',
            contentVersion: 4,
            revisedAt: new Date('2026-04-02T10:06:00.000Z'),
            strategy: 'openai_structured_outputs_v1',
            provider: {
                type: 'openai',
                model: 'gpt-4.1-mini',
                responseId: 'resp_new',
            },
        });
    });

    it('rejects agent-direct external feedback without a prompt', async () => {
        await expect(WorkflowService.submitExternalFeedback({
            domainId: 7,
            contentItemId: 18,
            decision: 'changes_requested',
            refinementMode: 'agent_direct',
            submitter: {
                actorId: 'proposal-contact:123',
                actorSource: 'proposal_portal',
            },
        })).rejects.toMatchObject({
            code: 'EXTERNAL_FEEDBACK_PROMPT_REQUIRED',
            statusCode: 400,
        });

        expect(mocks.dbMock.select).not.toHaveBeenCalled();
    });

    it('records accepted external feedback without creating a review task', async () => {
        const contentItem = {
            id: 18,
            domainId: 7,
            contentTypeId: 10,
            status: 'published',
            version: 3,
            data: JSON.stringify({ title: 'Proposal' }),
        };
        const feedbackEvent = {
            id: 71,
            domainId: 7,
            contentItemId: 18,
            publishedVersion: 3,
            decision: 'accepted',
            comment: 'Looks good to proceed.',
            prompt: null,
            refinementMode: 'human_supervised',
            actorId: 'proposal-contact:123',
            actorType: 'external_requester',
            actorSource: 'proposal_portal',
            actorDisplayName: 'Jane Smith',
            actorEmail: 'jane@client.com',
            reviewTaskId: null,
            createdAt: new Date('2026-04-03T10:00:00.000Z'),
        };
        const reviewTaskSpy = vi.spyOn(WorkflowService, 'submitForReview');

        mocks.dbMock.select.mockImplementationOnce(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([contentItem]),
            }),
        }));

        mocks.dbMock.insert
            .mockImplementationOnce(() => ({
                values: () => ({
                    returning: vi.fn().mockResolvedValue([feedbackEvent]),
                }),
            }))
            .mockImplementationOnce(() => ({
                values: () => ({
                    returning: vi.fn().mockResolvedValue([{
                        id: 88,
                        domainId: 7,
                        contentItemId: 18,
                        authorId: 'proposal-contact:123',
                        authorActorId: 'proposal-contact:123',
                        authorActorType: 'external_requester',
                        authorActorSource: 'proposal_portal',
                        comment: 'External feedback from Jane Smith (accepted)\n\nLooks good to proceed.',
                        createdAt: new Date('2026-04-03T10:00:00.000Z'),
                    }]),
                }),
            }));

        try {
            const result = await WorkflowService.submitExternalFeedback({
                domainId: 7,
                contentItemId: 18,
                decision: 'accepted',
                comment: 'Looks good to proceed.',
                submitter: {
                    actorId: 'proposal-contact:123',
                    actorSource: 'proposal_portal',
                    displayName: 'Jane Smith',
                    email: 'jane@client.com',
                },
                authPrincipal: {
                    actorId: 'api_key:9',
                    actorType: 'api_key',
                    actorSource: 'db',
                    actorRef: 9,
                    source: 'db',
                    domainId: 7,
                    scopes: new Set(['admin']),
                },
            });

            expect(result).toEqual({
                event: feedbackEvent,
                reviewTask: null,
                revision: null,
            });
            expect(reviewTaskSpy).not.toHaveBeenCalled();
            expect(mocks.logAuditMock).toHaveBeenCalledWith(
                7,
                'create',
                'external_feedback_event',
                71,
                expect.objectContaining({
                    contentItemId: 18,
                    publishedVersion: 3,
                    decision: 'accepted',
                    reviewTaskId: null,
                }),
                expect.any(Object),
            );
        } finally {
            reviewTaskSpy.mockRestore();
        }
    });

    it('lists external feedback events for a content item newest first', async () => {
        const events = [
            {
                id: 72,
                domainId: 7,
                contentItemId: 18,
                publishedVersion: 4,
                decision: 'changes_requested',
                comment: 'Clarify the timeline.',
                prompt: 'Tighten the proposal timeline.',
                refinementMode: 'agent_direct',
                actorId: 'proposal-contact:124',
                actorType: 'external_requester',
                actorSource: 'proposal_portal',
                actorDisplayName: 'Jane Smith',
                actorEmail: 'jane@client.com',
                reviewTaskId: 45,
                createdAt: new Date('2026-04-03T10:05:00.000Z'),
            },
            {
                id: 71,
                domainId: 7,
                contentItemId: 18,
                publishedVersion: 3,
                decision: 'accepted',
                comment: 'Looks good to proceed.',
                prompt: null,
                refinementMode: 'human_supervised',
                actorId: 'proposal-contact:123',
                actorType: 'external_requester',
                actorSource: 'proposal_portal',
                actorDisplayName: 'Jane Smith',
                actorEmail: 'jane@client.com',
                reviewTaskId: null,
                createdAt: new Date('2026-04-03T10:00:00.000Z'),
            },
        ];
        const orderBy = vi.fn().mockResolvedValue(events);
        const where = vi.fn().mockReturnValue({ orderBy });

        mocks.dbMock.select.mockImplementationOnce(() => ({
            from: () => ({
                where,
            }),
        }));

        const result = await WorkflowService.listExternalFeedbackEvents(7, 18);

        expect(result).toEqual(events);
        expect(where).toHaveBeenCalledTimes(1);
        expect(orderBy).toHaveBeenCalledTimes(1);
    });
});
