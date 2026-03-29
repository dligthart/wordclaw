import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    dbMock: {
        select: vi.fn(),
        transaction: vi.fn(),
    },
    logAuditMock: vi.fn(),
}));

vi.mock('../db/index.js', () => ({
    db: mocks.dbMock
}));

vi.mock('./audit.js', () => ({
    logAudit: mocks.logAuditMock
}));

import {
    archiveExpiredContentItemsForSchema,
    ensureContentItemLifecycleState,
    isContentItemLifecycleExpired
} from './content-lifecycle.js';

describe('content lifecycle', () => {
    beforeEach(() => {
        mocks.dbMock.select.mockReset();
        mocks.dbMock.transaction.mockReset();
        mocks.logAuditMock.mockReset();
    });

    it('identifies expired lifecycle-managed items from updatedAt by default', () => {
        const expired = isContentItemLifecycleExpired({
            id: 91,
            domainId: 1,
            contentTypeId: 7,
            data: '{}',
            status: 'draft',
            embeddingStatus: 'disabled',
            embeddingChunks: 0,
            embeddingUpdatedAt: null,
            embeddingErrorCode: null,
            version: 3,
            createdAt: new Date('2026-03-16T09:00:00.000Z'),
            updatedAt: new Date('2026-03-16T09:05:00.000Z'),
        }, {
            enabled: true,
            ttlSeconds: 300,
            archiveStatus: 'archived',
            clock: 'updatedAt'
        }, new Date('2026-03-16T09:10:01.000Z'));

        expect(expired).toBe(true);
    });

    it('archives expired content items and records version history', async () => {
        const expiredItem = {
            id: 91,
            domainId: 1,
            contentTypeId: 7,
            data: '{"sessionId":"s-1"}',
            status: 'draft',
            embeddingStatus: 'disabled',
            embeddingChunks: 0,
            embeddingUpdatedAt: null,
            embeddingErrorCode: null,
            version: 3,
            createdAt: new Date('2026-03-16T09:00:00.000Z'),
            updatedAt: new Date('2026-03-16T09:04:00.000Z'),
        };
        const now = new Date('2026-03-16T09:10:00.000Z');

        mocks.dbMock.select.mockReturnValue({
            from: () => ({
                where: vi.fn().mockResolvedValue([expiredItem])
            })
        });

        mocks.dbMock.transaction.mockImplementation(async (callback: (tx: Record<string, unknown>) => Promise<unknown>) => {
            const tx = {
                insert: vi.fn().mockReturnValue({
                    values: vi.fn().mockResolvedValue(undefined)
                }),
                update: vi.fn().mockReturnValue({
                    set: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            returning: vi.fn().mockResolvedValue([{
                                ...expiredItem,
                                status: 'archived',
                                version: 4,
                                updatedAt: now,
                            }])
                        })
                    })
                })
            };

            return callback(tx);
        });

        const archived = await archiveExpiredContentItemsForSchema(1, 7, JSON.stringify({
            type: 'object',
            properties: {
                sessionId: { type: 'string' }
            },
            'x-wordclaw-lifecycle': {
                ttlSeconds: 300
            }
        }), now);

        expect(archived).toBe(1);
        expect(mocks.dbMock.transaction).toHaveBeenCalledTimes(1);
        expect(mocks.logAuditMock).toHaveBeenCalledWith(
            1,
            'update',
            'content_item',
            91,
            expect.objectContaining({
                lifecycleAutoArchived: true,
                archiveStatus: 'archived',
                ttlSeconds: 300,
                clock: 'updatedAt',
            })
        );
    });

    it('returns the original item when lifecycle policy is absent or still active', async () => {
        const item = {
            id: 91,
            domainId: 1,
            contentTypeId: 7,
            data: '{}',
            status: 'draft',
            embeddingStatus: 'disabled',
            embeddingChunks: 0,
            embeddingUpdatedAt: null,
            embeddingErrorCode: null,
            version: 3,
            createdAt: new Date('2026-03-16T09:00:00.000Z'),
            updatedAt: new Date('2026-03-16T09:09:30.000Z'),
        };

        const result = await ensureContentItemLifecycleState(item, JSON.stringify({
            type: 'object',
            properties: {
                sessionId: { type: 'string' }
            },
            'x-wordclaw-lifecycle': {
                ttlSeconds: 600
            }
        }), new Date('2026-03-16T09:10:00.000Z'));

        expect(result).toEqual(item);
        expect(mocks.dbMock.transaction).not.toHaveBeenCalled();
    });
});
