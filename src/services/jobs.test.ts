import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const dbMock = {
        select: vi.fn(),
        update: vi.fn(),
    };

    return {
        dbMock,
    };
});

vi.mock('../db/index.js', () => ({
    db: mocks.dbMock,
}));

import { processPendingJobs } from './jobs.js';

describe('jobs service', () => {
    beforeEach(() => {
        mocks.dbMock.select.mockReset();
        mocks.dbMock.update.mockReset();
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
});
