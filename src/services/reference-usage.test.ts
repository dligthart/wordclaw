import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const dbMock = {
        select: vi.fn()
    };

    return {
        dbMock
    };
});

vi.mock('../db/index.js', () => ({
    db: mocks.dbMock
}));

import { findAssetUsage, findContentItemUsage } from './reference-usage.js';

function mockSelectResults(...results: unknown[]) {
    const queue = [...results];
    mocks.dbMock.select.mockImplementation(() => {
        const next = queue.shift() ?? [];
        return {
            from: () => ({
                where: vi.fn().mockResolvedValue(next),
                innerJoin: () => ({
                    where: vi.fn().mockResolvedValue(next)
                })
            })
        };
    });
}

describe('reference usage service', () => {
    beforeEach(() => {
        mocks.dbMock.select.mockReset();
    });

    it('finds active and historical asset references', async () => {
        const schema = JSON.stringify({
            type: 'object',
            properties: {
                hero: {
                    type: 'object',
                    'x-wordclaw-field-kind': 'asset',
                    properties: {
                        assetId: { type: 'integer' }
                    },
                    required: ['assetId']
                }
            }
        });

        mockSelectResults(
            [{
                id: 7,
                name: 'Post',
                slug: 'post',
                schema
            }],
            [{
                contentItemId: 10,
                contentTypeId: 7,
                status: 'draft',
                version: 3,
                data: JSON.stringify({ hero: { assetId: 99 } })
            }],
            [{
                contentItemVersionId: 41,
                contentItemId: 10,
                contentTypeId: 7,
                version: 2,
                data: JSON.stringify({ hero: { assetId: 99 } })
            }]
        );

        const usage = await findAssetUsage(1, 99);

        expect(usage).toEqual({
            activeReferences: [{
                contentItemId: 10,
                contentTypeId: 7,
                contentTypeName: 'Post',
                contentTypeSlug: 'post',
                path: '/hero',
                version: 3,
                status: 'draft'
            }],
            historicalReferences: [{
                contentItemId: 10,
                contentItemVersionId: 41,
                contentTypeId: 7,
                contentTypeName: 'Post',
                contentTypeSlug: 'post',
                path: '/hero',
                version: 2
            }]
        });
    });

    it('finds active and historical content references', async () => {
        const schema = JSON.stringify({
            type: 'object',
            properties: {
                related: {
                    type: 'object',
                    'x-wordclaw-field-kind': 'content-ref',
                    allowedContentTypeSlugs: ['post'],
                    properties: {
                        contentItemId: { type: 'integer' }
                    },
                    required: ['contentItemId']
                }
            }
        });

        mockSelectResults(
            [{
                id: 8,
                name: 'Landing Page',
                slug: 'landing-page',
                schema
            }],
            [{
                contentItemId: 15,
                contentTypeId: 8,
                status: 'published',
                version: 6,
                data: JSON.stringify({ related: { contentItemId: 77 } })
            }],
            [{
                contentItemVersionId: 90,
                contentItemId: 15,
                contentTypeId: 8,
                version: 4,
                data: JSON.stringify({ related: { contentItemId: 77 } })
            }]
        );

        const usage = await findContentItemUsage(1, 77);

        expect(usage).toEqual({
            activeReferences: [{
                contentItemId: 15,
                contentTypeId: 8,
                contentTypeName: 'Landing Page',
                contentTypeSlug: 'landing-page',
                path: '/related',
                version: 6,
                status: 'published'
            }],
            historicalReferences: [{
                contentItemId: 15,
                contentItemVersionId: 90,
                contentTypeId: 8,
                contentTypeName: 'Landing Page',
                contentTypeSlug: 'landing-page',
                path: '/related',
                version: 4
            }]
        });
    });
});
