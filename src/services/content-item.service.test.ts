import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    dbMock: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
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

import { ContentItemProjectionError, projectContentItems } from './content-item.service.js';

describe('projectContentItems', () => {
    beforeEach(() => {
        mocks.dbMock.select.mockReset();
        mocks.dbMock.insert.mockReset();
        mocks.dbMock.update.mockReset();
        mocks.dbMock.delete.mockReset();
        mocks.dbMock.transaction.mockReset();
        mocks.logAuditMock.mockReset();
    });

    it('returns grouped buckets for numeric projection metrics', async () => {
        const limitMock = vi.fn().mockResolvedValue([
            { group: 'chronomancer', value: 18.5, count: 2 },
            { group: 'ranger', value: 11.25, count: 4 }
        ]);
        const orderByMock = vi.fn(() => ({ limit: limitMock }));
        const groupByMock = vi.fn(() => ({ orderBy: orderByMock }));
        const whereMock = vi.fn(() => ({ groupBy: groupByMock }));

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        schema: JSON.stringify({
                            type: 'object',
                            properties: {
                                characterClass: { type: 'string' },
                                score: { type: 'integer' },
                                published: { type: 'boolean' }
                            }
                        })
                    }])
                })
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: whereMock
                })
            }));

        const result = await projectContentItems(1, {
            contentTypeId: 7,
            groupBy: 'characterClass',
            metric: 'avg',
            metricField: 'score',
            orderBy: 'value',
            orderDir: 'desc',
            limit: 10
        });

        expect(result).toMatchObject({
            contentTypeId: 7,
            groupBy: 'characterClass',
            metric: 'avg',
            metricField: 'score',
            orderBy: 'value',
            orderDir: 'desc',
            limit: 10,
            buckets: [
                { group: 'chronomancer', value: 18.5, count: 2 },
                { group: 'ranger', value: 11.25, count: 4 }
            ]
        });
        expect(whereMock).toHaveBeenCalledTimes(1);
        expect(groupByMock).toHaveBeenCalledTimes(1);
        expect(orderByMock).toHaveBeenCalledTimes(1);
        expect(limitMock).toHaveBeenCalledWith(10);
    });

    it('rejects unknown projection group fields', async () => {
        mocks.dbMock.select.mockImplementationOnce(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    schema: JSON.stringify({
                        type: 'object',
                        properties: {
                            score: { type: 'integer' }
                        }
                    })
                }])
            })
        }));

        await expect(
            projectContentItems(1, {
                contentTypeId: 7,
                groupBy: 'characterClass'
            })
        ).rejects.toMatchObject({
            code: 'CONTENT_ITEMS_PROJECTION_GROUP_FIELD_UNKNOWN'
        } satisfies Partial<ContentItemProjectionError>);
    });

    it('rejects non-numeric metric fields for numeric aggregates', async () => {
        mocks.dbMock.select.mockImplementationOnce(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    schema: JSON.stringify({
                        type: 'object',
                        properties: {
                            characterClass: { type: 'string' },
                            title: { type: 'string' }
                        }
                    })
                }])
            })
        }));

        await expect(
            projectContentItems(1, {
                contentTypeId: 7,
                groupBy: 'characterClass',
                metric: 'avg',
                metricField: 'title'
            })
        ).rejects.toMatchObject({
            code: 'CONTENT_ITEMS_PROJECTION_METRIC_FIELD_NOT_NUMERIC'
        } satisfies Partial<ContentItemProjectionError>);
    });
});
