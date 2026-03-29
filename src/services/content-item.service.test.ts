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

import {
    ContentItemProjectionError,
    listContentItems,
    projectContentItems,
    resolveContentItemReadView
} from './content-item.service.js';

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

describe('listContentItems', () => {
    beforeEach(() => {
        mocks.dbMock.select.mockReset();
        mocks.dbMock.insert.mockReset();
        mocks.dbMock.update.mockReset();
        mocks.dbMock.delete.mockReset();
        mocks.dbMock.transaction.mockReset();
        mocks.logAuditMock.mockReset();
    });

    it('resolves localized fields when locale-aware reads are requested', async () => {
        const offsetMock = vi.fn().mockResolvedValue([
            {
                item: {
                    id: 9,
                    domainId: 1,
                    contentTypeId: 7,
                    data: JSON.stringify({
                        title: {
                            en: 'Hello',
                            nl: 'Hallo'
                        }
                    }),
                    status: 'published',
                    version: 3,
                    createdAt: new Date('2026-03-28T10:00:00.000Z'),
                    updatedAt: new Date('2026-03-29T10:00:00.000Z')
                },
                schema: JSON.stringify({
                    type: 'object',
                    properties: {
                        title: {
                            type: 'string',
                            'x-wordclaw-localized': true
                        }
                    },
                    required: ['title'],
                    'x-wordclaw-localization': {
                        supportedLocales: ['en', 'nl'],
                        defaultLocale: 'en'
                    }
                }),
                basePrice: 0
            }
        ]);
        const limitMock = vi.fn(() => ({ offset: offsetMock }));
        const orderByMock = vi.fn(() => ({ limit: limitMock }));
        const whereMock = vi.fn(() => ({ orderBy: orderByMock }));

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ total: 1 }])
                })
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    innerJoin: vi.fn(() => ({
                        where: whereMock
                    }))
                })
            }));

        const result = await listContentItems(1, {
            locale: 'nl'
        });

        expect(result.items).toHaveLength(1);
        expect(JSON.parse(result.items[0].data)).toEqual({
            title: 'Hallo'
        });
        expect(result.items[0].localeResolution).toEqual({
            requestedLocale: 'nl',
            fallbackLocale: 'en',
            defaultLocale: 'en',
            localizedFieldCount: 1,
            resolvedFieldCount: 1,
            fallbackFieldCount: 0,
            unresolvedFields: []
        });
    });
});

describe('resolveContentItemReadView', () => {
    it('returns the published snapshot when draft reads are disabled and a published version exists', () => {
        const readView = resolveContentItemReadView(
            {
                id: 12,
                domainId: 1,
                contentTypeId: 7,
                data: JSON.stringify({ title: 'Draft copy' }),
                status: 'draft',
                version: 4,
                createdAt: new Date('2026-03-28T10:00:00.000Z'),
                updatedAt: new Date('2026-03-29T10:00:00.000Z')
            },
            JSON.stringify({
                type: 'object',
                properties: {
                    title: { type: 'string' }
                }
            }),
            {
                draft: false,
                unpublishedFallback: 'null'
            },
            {
                id: 99,
                contentItemId: 12,
                version: 2,
                data: JSON.stringify({ title: 'Published copy' }),
                status: 'published',
                createdAt: new Date('2026-03-27T08:00:00.000Z')
            }
        );

        expect(readView).not.toBeNull();
        expect(readView).toMatchObject({
            status: 'published',
            version: 2,
            publicationState: 'changed',
            workingCopyVersion: 4,
            publishedVersion: 2
        });
        expect(JSON.parse(readView!.data)).toEqual({
            title: 'Published copy'
        });
    });

    it('returns null for published-only reads when an item has never been published', () => {
        const readView = resolveContentItemReadView(
            {
                id: 14,
                domainId: 1,
                contentTypeId: 7,
                data: JSON.stringify({ title: 'Draft only' }),
                status: 'draft',
                version: 1,
                createdAt: new Date('2026-03-28T10:00:00.000Z'),
                updatedAt: new Date('2026-03-29T10:00:00.000Z')
            },
            JSON.stringify({
                type: 'object',
                properties: {
                    title: { type: 'string' }
                }
            }),
            {
                draft: false,
                unpublishedFallback: 'null'
            }
        );

        expect(readView).toBeNull();
    });
});
