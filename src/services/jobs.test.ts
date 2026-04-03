import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const dbMock = {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
    };

    return {
        dbMock,
        logAuditMock: vi.fn(),
        submitForReviewMock: vi.fn(),
    };
});

vi.mock('../db/index.js', () => ({
    db: mocks.dbMock,
}));

vi.mock('./audit.js', () => ({
    logAudit: mocks.logAuditMock,
}));

vi.mock('./workflow.js', () => ({
    WorkflowService: {
        submitForReview: mocks.submitForReviewMock,
    },
}));

import { processPendingJobs } from './jobs.js';

describe('jobs service', () => {
    beforeEach(() => {
        mocks.dbMock.select.mockReset();
        mocks.dbMock.insert.mockReset();
        mocks.dbMock.update.mockReset();
        mocks.logAuditMock.mockReset();
        mocks.submitForReviewMock.mockReset();
        vi.restoreAllMocks();
    });

    it('processes queued outbound webhook jobs', async () => {
        const queuedJob = {
            id: 7,
            domainId: 1,
            kind: 'outbound_webhook',
            queue: 'webhooks',
            status: 'queued',
            payload: {
                url: 'https://example.com/hook',
                body: { event: 'audit.create' },
                source: 'audit',
            },
            result: null,
            runAt: new Date('2026-03-29T10:00:00.000Z'),
            attempts: 0,
            maxAttempts: 3,
            lastError: null,
            claimedAt: null,
            startedAt: null,
            completedAt: null,
            createdAt: new Date('2026-03-29T09:59:00.000Z'),
            updatedAt: new Date('2026-03-29T09:59:00.000Z'),
        };
        const claimedJob = {
            ...queuedJob,
            status: 'running',
            attempts: 1,
            claimedAt: new Date('2026-03-29T10:00:01.000Z'),
            startedAt: new Date('2026-03-29T10:00:01.000Z'),
        };

        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: () => ({
                    orderBy: () => ({
                        limit: vi.fn().mockResolvedValue([queuedJob]),
                    }),
                }),
            }),
        }));

        const updateCalls: Array<Record<string, unknown>> = [];
        mocks.dbMock.update
            .mockImplementationOnce(() => ({
                set: (values: Record<string, unknown>) => {
                    updateCalls.push(values);
                    return {
                        where: () => ({
                            returning: vi.fn().mockResolvedValue([claimedJob]),
                        }),
                    };
                },
            }))
            .mockImplementationOnce(() => ({
                set: (values: Record<string, unknown>) => {
                    updateCalls.push(values);
                    return {
                        where: vi.fn().mockResolvedValue(undefined),
                    };
                },
            }));

        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', {
            status: 202,
        }));

        const processed = await processPendingJobs(10);

        expect(processed).toBe(1);
        expect(fetchSpy).toHaveBeenCalledWith(
            'https://example.com/hook',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ event: 'audit.create' }),
            }),
        );
        expect(updateCalls[1]).toEqual(expect.objectContaining({
            status: 'succeeded',
            lastError: null,
        }));
    });

    it('processes queued draft generation jobs', async () => {
        const queuedJob = {
            id: 8,
            domainId: 1,
            kind: 'draft_generation',
            queue: 'drafts',
            status: 'queued',
            payload: {
                formId: 5,
                formSlug: 'proposal-request',
                intakeContentItemId: 88,
                intakeData: {
                    title: 'Proposal for Acme',
                    summary: 'Need a proposal',
                    ignored: 'drop me',
                },
                targetContentTypeId: 13,
                agentSoul: 'software-proposal-writer',
                fieldMap: {
                    title: 'headline',
                },
                defaultData: {
                    title: 'Draft proposal',
                    statusNote: 'Generated from intake',
                },
                provider: {
                    type: 'deterministic',
                },
                postGenerationWorkflowTransitionId: null,
            },
            result: null,
            runAt: new Date('2026-03-31T10:00:00.000Z'),
            attempts: 0,
            maxAttempts: 3,
            lastError: null,
            claimedAt: null,
            startedAt: null,
            completedAt: null,
            createdAt: new Date('2026-03-31T09:59:00.000Z'),
            updatedAt: new Date('2026-03-31T09:59:00.000Z'),
        };
        const claimedJob = {
            ...queuedJob,
            status: 'running',
            attempts: 1,
            claimedAt: new Date('2026-03-31T10:00:01.000Z'),
            startedAt: new Date('2026-03-31T10:00:01.000Z'),
        };

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: () => ({
                        orderBy: () => ({
                            limit: vi.fn().mockResolvedValue([queuedJob]),
                        }),
                    }),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 13,
                        domainId: 1,
                        name: 'Proposal Draft',
                        slug: 'proposal-draft',
                        schema: JSON.stringify({
                            type: 'object',
                            properties: {
                                title: { type: 'string' },
                                headline: { type: 'string' },
                                summary: { type: 'string' },
                                statusNote: { type: 'string' },
                            },
                            required: ['headline', 'summary'],
                        }),
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 5,
                        slug: 'proposal-request',
                        name: 'Proposal Request',
                        webhookUrl: 'https://example.com/forms',
                        webhookSecret: 'form-secret',
                    }]),
                }),
            }));

        const updateCalls: Array<Record<string, unknown>> = [];
        mocks.dbMock.update
            .mockImplementationOnce(() => ({
                set: (values: Record<string, unknown>) => {
                    updateCalls.push(values);
                    return {
                        where: () => ({
                            returning: vi.fn().mockResolvedValue([claimedJob]),
                        }),
                    };
                },
            }))
            .mockImplementationOnce(() => ({
                set: (values: Record<string, unknown>) => {
                    updateCalls.push(values);
                    return {
                        where: vi.fn().mockResolvedValue(undefined),
                    };
                },
            }));

        const insertValues: Array<Record<string, unknown>> = [];
        mocks.dbMock.insert
            .mockImplementationOnce(() => ({
                values: vi.fn().mockImplementation((values: Record<string, unknown>) => {
                    insertValues.push(values);
                    return {
                        returning: vi.fn().mockResolvedValue([{
                            id: 144,
                            domainId: 1,
                            contentTypeId: 13,
                            data: JSON.stringify({
                                title: 'Draft proposal',
                                headline: 'Proposal for Acme',
                                summary: 'Need a proposal',
                                statusNote: 'Generated from intake',
                            }),
                            status: 'draft',
                            version: 1,
                            createdAt: new Date('2026-03-31T10:00:02.000Z'),
                            updatedAt: new Date('2026-03-31T10:00:02.000Z'),
                        }]),
                    };
                }),
            }))
            .mockImplementationOnce(() => ({
                values: vi.fn().mockImplementation((values: Record<string, unknown>) => {
                    insertValues.push(values);
                    return {
                        returning: vi.fn().mockResolvedValue([{
                            id: 21,
                            domainId: 1,
                            kind: 'outbound_webhook',
                            queue: 'webhooks',
                            status: 'queued',
                        }]),
                    };
                }),
            }));

        const processed = await processPendingJobs(10);

        expect(processed).toBe(1);
        expect(mocks.dbMock.insert).toHaveBeenCalledTimes(2);
        expect(mocks.logAuditMock).toHaveBeenCalledWith(
            1,
            'create',
            'content_item',
            144,
            expect.objectContaining({
                source: 'draft_generation_job',
                intakeContentItemId: 88,
                agentSoul: 'software-proposal-writer',
                fieldMap: {
                    title: 'headline',
                },
                provider: {
                    type: 'deterministic',
                    model: null,
                    responseId: null,
                },
            }),
        );
        expect(insertValues[1]).toEqual(expect.objectContaining({
            kind: 'outbound_webhook',
            queue: 'webhooks',
            payload: expect.objectContaining({
                url: 'https://example.com/forms',
                secret: 'form-secret',
                source: 'form',
                body: expect.objectContaining({
                    event: 'form.draft_generation.completed',
                    form: {
                        id: 5,
                        slug: 'proposal-request',
                        name: 'Proposal Request',
                    },
                    draftGeneration: expect.objectContaining({
                        jobId: 8,
                        status: 'completed',
                        generatedContentItemId: 144,
                        intakeContentItemId: 88,
                        providerType: 'deterministic',
                    }),
                }),
            }),
        }));
        expect(updateCalls[1]).toEqual(expect.objectContaining({
            status: 'succeeded',
            result: expect.objectContaining({
                generatedContentItemId: 144,
                intakeContentItemId: 88,
                fieldMap: {
                    title: 'headline',
                },
                provider: {
                    type: 'deterministic',
                    model: null,
                    responseId: null,
                },
            }),
            lastError: null,
        }));
    });

    it('enqueues a terminal failure webhook when draft generation exhausts retries', async () => {
        const queuedJob = {
            id: 9,
            domainId: 1,
            kind: 'draft_generation',
            queue: 'drafts',
            status: 'queued',
            payload: {
                formId: 5,
                formSlug: 'proposal-request',
                intakeContentItemId: 88,
                intakeData: {
                    requirements: 'Need a proposal',
                },
                targetContentTypeId: 13,
                agentSoul: 'software-proposal-writer',
                provider: {
                    type: 'deterministic',
                },
            },
            result: null,
            runAt: new Date('2026-03-31T10:00:00.000Z'),
            attempts: 0,
            maxAttempts: 1,
            lastError: null,
            claimedAt: null,
            startedAt: null,
            completedAt: null,
            createdAt: new Date('2026-03-31T09:59:00.000Z'),
            updatedAt: new Date('2026-03-31T09:59:00.000Z'),
        };
        const claimedJob = {
            ...queuedJob,
            status: 'running',
            attempts: 1,
            claimedAt: new Date('2026-03-31T10:00:01.000Z'),
            startedAt: new Date('2026-03-31T10:00:01.000Z'),
        };

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: () => ({
                        orderBy: () => ({
                            limit: vi.fn().mockResolvedValue([queuedJob]),
                        }),
                    }),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 5,
                        slug: 'proposal-request',
                        name: 'Proposal Request',
                        webhookUrl: 'https://example.com/forms',
                        webhookSecret: 'form-secret',
                    }]),
                }),
            }));

        const updateCalls: Array<Record<string, unknown>> = [];
        mocks.dbMock.update
            .mockImplementationOnce(() => ({
                set: (values: Record<string, unknown>) => {
                    updateCalls.push(values);
                    return {
                        where: () => ({
                            returning: vi.fn().mockResolvedValue([claimedJob]),
                        }),
                    };
                },
            }))
            .mockImplementationOnce(() => ({
                set: (values: Record<string, unknown>) => {
                    updateCalls.push(values);
                    return {
                        where: vi.fn().mockResolvedValue(undefined),
                    };
                },
            }));

        const insertValues: Array<Record<string, unknown>> = [];
        mocks.dbMock.insert.mockImplementationOnce(() => ({
            values: vi.fn().mockImplementation((values: Record<string, unknown>) => {
                insertValues.push(values);
                return {
                    returning: vi.fn().mockResolvedValue([{
                        id: 22,
                        domainId: 1,
                        kind: 'outbound_webhook',
                        queue: 'webhooks',
                        status: 'queued',
                    }]),
                };
            }),
        }));

        const processed = await processPendingJobs(10);

        expect(processed).toBe(1);
        expect(mocks.dbMock.insert).toHaveBeenCalledTimes(1);
        expect(insertValues[0]).toEqual(expect.objectContaining({
            kind: 'outbound_webhook',
            queue: 'webhooks',
            payload: expect.objectContaining({
                url: 'https://example.com/forms',
                secret: 'form-secret',
                source: 'form',
                body: expect.objectContaining({
                    event: 'form.draft_generation.failed',
                    draftGeneration: expect.objectContaining({
                        jobId: 9,
                        status: 'failed',
                        intakeContentItemId: 88,
                        targetContentTypeId: 13,
                        providerType: 'deterministic',
                        error: 'Target content type 13 not found in domain 1.',
                    }),
                }),
            }),
        }));
        expect(updateCalls[1]).toEqual(expect.objectContaining({
            status: 'failed',
            lastError: 'Target content type 13 not found in domain 1.',
        }));
    });

    it('records in-review generated status when draft generation submits into review', async () => {
        const queuedJob = {
            id: 10,
            domainId: 1,
            kind: 'draft_generation',
            queue: 'drafts',
            status: 'queued',
            payload: {
                formId: 5,
                formSlug: 'proposal-request',
                intakeContentItemId: 91,
                intakeData: {
                    title: 'Proposal for Beta',
                    summary: 'Need approval',
                },
                targetContentTypeId: 13,
                agentSoul: 'software-proposal-writer',
                provider: {
                    type: 'deterministic',
                },
                postGenerationWorkflowTransitionId: 77,
            },
            result: null,
            runAt: new Date('2026-03-31T10:00:00.000Z'),
            attempts: 0,
            maxAttempts: 3,
            lastError: null,
            claimedAt: null,
            startedAt: null,
            completedAt: null,
            createdAt: new Date('2026-03-31T09:59:00.000Z'),
            updatedAt: new Date('2026-03-31T09:59:00.000Z'),
        };
        const claimedJob = {
            ...queuedJob,
            status: 'running',
            attempts: 1,
            claimedAt: new Date('2026-03-31T10:00:01.000Z'),
            startedAt: new Date('2026-03-31T10:00:01.000Z'),
        };

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: () => ({
                        orderBy: () => ({
                            limit: vi.fn().mockResolvedValue([queuedJob]),
                        }),
                    }),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 13,
                        domainId: 1,
                        name: 'Proposal Draft',
                        slug: 'proposal-draft',
                        schema: JSON.stringify({
                            type: 'object',
                            properties: {
                                title: { type: 'string' },
                                summary: { type: 'string' },
                            },
                            required: ['title', 'summary'],
                        }),
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 5,
                        slug: 'proposal-request',
                        name: 'Proposal Request',
                        webhookUrl: null,
                        webhookSecret: null,
                    }]),
                }),
            }));

        const updateCalls: Array<Record<string, unknown>> = [];
        mocks.dbMock.update
            .mockImplementationOnce(() => ({
                set: (values: Record<string, unknown>) => {
                    updateCalls.push(values);
                    return {
                        where: () => ({
                            returning: vi.fn().mockResolvedValue([claimedJob]),
                        }),
                    };
                },
            }))
            .mockImplementationOnce(() => ({
                set: (values: Record<string, unknown>) => {
                    updateCalls.push(values);
                    return {
                        where: vi.fn().mockResolvedValue(undefined),
                    };
                },
            }));

        mocks.dbMock.insert.mockImplementationOnce(() => ({
            values: vi.fn().mockImplementation(() => ({
                returning: vi.fn().mockResolvedValue([{
                    id: 145,
                    domainId: 1,
                    contentTypeId: 13,
                    data: JSON.stringify({
                        title: 'Proposal for Beta',
                        summary: 'Need approval',
                    }),
                    status: 'draft',
                    version: 1,
                    createdAt: new Date('2026-03-31T10:00:02.000Z'),
                    updatedAt: new Date('2026-03-31T10:00:02.000Z'),
                }]),
            })),
        }));

        mocks.submitForReviewMock.mockResolvedValue({
            id: 55,
            contentItemId: 145,
            workflowTransitionId: 77,
            status: 'pending',
        });

        const processed = await processPendingJobs(10);

        expect(processed).toBe(1);
        expect(mocks.submitForReviewMock).toHaveBeenCalledWith({
            domainId: 1,
            contentItemId: 145,
            workflowTransitionId: 77,
        });
        expect(updateCalls[1]).toEqual(expect.objectContaining({
            status: 'succeeded',
            result: expect.objectContaining({
                generatedContentItemId: 145,
                generatedStatus: 'in_review',
                reviewTaskId: 55,
            }),
            lastError: null,
        }));
    });
});
