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

import { validateContentDataAgainstSchema, validateContentTypeSchema } from './content-schema.js';

function mockAssetLookup(rows: Array<{ id: number }>) {
    mocks.dbMock.select.mockReturnValue({
        from: () => ({
            where: vi.fn().mockResolvedValue(rows)
        })
    });
}

describe('validateContentTypeSchema', () => {
    beforeEach(() => {
        mocks.dbMock.select.mockReset();
    });

    it('rejects malformed asset schema extensions', () => {
        const failure = validateContentTypeSchema(JSON.stringify({
            type: 'object',
            properties: {
                heroImage: {
                    type: 'string',
                    'x-wordclaw-field-kind': 'asset'
                }
            }
        }));

        expect(failure).toMatchObject({
            code: 'INVALID_CONTENT_SCHEMA_ASSET_EXTENSION'
        });
    });

    it('accepts valid asset-list schema extensions', () => {
        const failure = validateContentTypeSchema(JSON.stringify({
            type: 'object',
            properties: {
                gallery: {
                    type: 'array',
                    'x-wordclaw-field-kind': 'asset-list',
                    items: {
                        type: 'object',
                        properties: {
                            assetId: { type: 'integer' },
                            alt: { type: 'string' }
                        },
                        required: ['assetId']
                    }
                }
            }
        }));

        expect(failure).toBeNull();
    });
});

describe('validateContentDataAgainstSchema', () => {
    beforeEach(() => {
        mocks.dbMock.select.mockReset();
    });

    it('accepts valid asset references in the current domain', async () => {
        mockAssetLookup([{ id: 7 }]);

        const failure = await validateContentDataAgainstSchema(
            JSON.stringify({
                type: 'object',
                properties: {
                    heroImage: {
                        type: 'object',
                        'x-wordclaw-field-kind': 'asset',
                        properties: {
                            assetId: { type: 'integer' },
                            alt: { type: 'string' }
                        },
                        required: ['assetId']
                    }
                }
            }),
            JSON.stringify({
                heroImage: {
                    assetId: 7,
                    alt: 'Cover'
                }
            }),
            1
        );

        expect(failure).toBeNull();
        expect(mocks.dbMock.select).toHaveBeenCalledTimes(1);
    });

    it('rejects missing or cross-domain asset references', async () => {
        mockAssetLookup([]);

        const failure = await validateContentDataAgainstSchema(
            JSON.stringify({
                type: 'object',
                properties: {
                    heroImage: {
                        type: 'object',
                        'x-wordclaw-field-kind': 'asset',
                        properties: {
                            assetId: { type: 'integer' }
                        },
                        required: ['assetId']
                    }
                }
            }),
            JSON.stringify({
                heroImage: {
                    assetId: 99
                }
            }),
            1
        );

        expect(failure).toMatchObject({
            code: 'CONTENT_ASSET_REFERENCE_INVALID'
        });
        expect(failure?.context?.details).toContain('/heroImage');
        expect(failure?.context?.details).toContain('99');
    });

    it('reports missing asset references inside asset lists', async () => {
        mockAssetLookup([{ id: 3 }]);

        const failure = await validateContentDataAgainstSchema(
            JSON.stringify({
                type: 'object',
                properties: {
                    gallery: {
                        type: 'array',
                        'x-wordclaw-field-kind': 'asset-list',
                        items: {
                            type: 'object',
                            properties: {
                                assetId: { type: 'integer' }
                            },
                            required: ['assetId']
                        }
                    }
                }
            }),
            JSON.stringify({
                gallery: [
                    { assetId: 3 },
                    { assetId: 4 }
                ]
            }),
            1
        );

        expect(failure).toMatchObject({
            code: 'CONTENT_ASSET_REFERENCE_INVALID'
        });
        expect(failure?.context?.details).toContain('/gallery/1');
        expect(failure?.context?.details).toContain('4');
    });
});
