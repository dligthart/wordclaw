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
    };
});

vi.mock('../db/index.js', () => ({
    db: mocks.dbMock,
}));

vi.mock('./audit.js', () => ({
    logAudit: mocks.logAuditMock,
}));

import { processPendingJobs } from './jobs.js';

describe('jobs service', () => {
    beforeEach(() => {
        mocks.dbMock.select.mockReset();
        mocks.dbMock.insert.mockReset();
        mocks.dbMock.update.mockReset();
        mocks.logAuditMock.mockReset();
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
                defaultData: {
                    statusNote: 'Generated from intake',
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
                                summary: { type: 'string' },
                                statusNote: { type: 'string' },
                            },
                            required: ['title', 'summary'],
                        }),
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

        mocks.dbMock.insert.mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{
                    id: 144,
                    domainId: 1,
                    contentTypeId: 13,
                    data: JSON.stringify({
                        statusNote: 'Generated from intake',
                        title: 'Proposal for Acme',
                        summary: 'Need a proposal',
                    }),
                    status: 'draft',
                    version: 1,
                    createdAt: new Date('2026-03-31T10:00:02.000Z'),
                    updatedAt: new Date('2026-03-31T10:00:02.000Z'),
                }]),
            }),
        });

        const processed = await processPendingJobs(10);

        expect(processed).toBe(1);
        expect(mocks.dbMock.insert).toHaveBeenCalled();
        expect(mocks.logAuditMock).toHaveBeenCalledWith(
            1,
            'create',
            'content_item',
            144,
            expect.objectContaining({
                source: 'draft_generation_job',
                intakeContentItemId: 88,
                agentSoul: 'software-proposal-writer',
            }),
        );
        expect(updateCalls[1]).toEqual(expect.objectContaining({
            status: 'succeeded',
            result: expect.objectContaining({
                generatedContentItemId: 144,
                intakeContentItemId: 88,
            }),
            lastError: null,
        }));
    });
});
