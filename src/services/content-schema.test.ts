import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assets, contentItems, contentTypes } from '../db/schema.js';

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

import {
    compileSchemaManifest,
    getContentLocalizationSchemaConfig,
    getContentLifecycleSchemaConfig,
    getPublicWriteSchemaConfig,
    getPublicWriteSubjectValue,
    localizeContentData,
    listQueryableContentFields,
    resolveContentTypeSchemaSource,
    validateContentDataAgainstSchema,
    validateContentTypeSchema
} from './content-schema.js';

type LookupState = {
    assets?: Array<{ id: number }>;
    contentItems?: Array<{ id: number; contentTypeId: number }>;
    contentTypes?: Array<{ id: number; slug: string }>;
};

function mockLookupState(state: LookupState) {
    mocks.dbMock.select.mockImplementation(() => ({
        from: (table: unknown) => ({
            where: vi.fn().mockResolvedValue(
                table === assets
                    ? (state.assets ?? [])
                    : table === contentItems
                        ? (state.contentItems ?? [])
                        : table === contentTypes
                            ? (state.contentTypes ?? [])
                            : []
            )
        })
    }));
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

    it('rejects malformed content-ref schema extensions', () => {
        const failure = validateContentTypeSchema(JSON.stringify({
            type: 'object',
            properties: {
                linkedStory: {
                    type: 'string',
                    'x-wordclaw-field-kind': 'content-ref'
                }
            }
        }));

        expect(failure).toMatchObject({
            code: 'INVALID_CONTENT_SCHEMA_CONTENT_REFERENCE_EXTENSION'
        });
    });

    it('accepts valid content-ref-list schema extensions with type constraints', () => {
        const failure = validateContentTypeSchema(JSON.stringify({
            type: 'object',
            properties: {
                relatedStories: {
                    type: 'array',
                    'x-wordclaw-field-kind': 'content-ref-list',
                    items: {
                        type: 'object',
                        'x-wordclaw-field-kind': 'content-ref',
                        allowedContentTypeSlugs: ['story', 'quest'],
                        properties: {
                            contentItemId: { type: 'integer' },
                            label: { type: 'string' }
                        },
                        required: ['contentItemId']
                    }
                }
            }
        }));

        expect(failure).toBeNull();
    });

    it('lists top-level scalar fields as queryable content fields', () => {
        const fields = listQueryableContentFields(JSON.stringify({
            type: 'object',
            properties: {
                title: { type: 'string' },
                score: { type: 'integer' },
                enabled: { type: 'boolean' },
                heroImage: {
                    type: 'object',
                    'x-wordclaw-field-kind': 'asset',
                    properties: {
                        assetId: { type: 'integer' }
                    },
                    required: ['assetId']
                },
                metadata: {
                    type: 'object',
                    properties: {
                        difficulty: { type: 'string' }
                    }
                }
            }
        }));

        expect(fields).toEqual([
            { name: 'title', type: 'string' },
            { name: 'score', type: 'number' },
            { name: 'enabled', type: 'boolean' }
        ]);
    });

    it('accepts a valid top-level public-write extension', () => {
        const schemaText = JSON.stringify({
            type: 'object',
            properties: {
                sessionId: { type: 'string' },
                body: { type: 'string' }
            },
            required: ['sessionId', 'body'],
            'x-wordclaw-public-write': {
                enabled: true,
                subjectField: 'sessionId',
                allowedOperations: ['create', 'update'],
                requiredStatus: 'draft'
            }
        });

        expect(validateContentTypeSchema(schemaText)).toBeNull();
        expect(getPublicWriteSchemaConfig(schemaText)).toEqual({
            enabled: true,
            subjectField: 'sessionId',
            allowedOperations: ['create', 'update'],
            requiredStatus: 'draft'
        });
    });

    it('accepts a valid top-level lifecycle extension', () => {
        const schemaText = JSON.stringify({
            type: 'object',
            properties: {
                sessionId: { type: 'string' },
                body: { type: 'string' }
            },
            'x-wordclaw-lifecycle': {
                ttlSeconds: 600,
                archiveStatus: 'expired',
                clock: 'updatedAt'
            }
        });

        expect(validateContentTypeSchema(schemaText)).toBeNull();
        expect(getContentLifecycleSchemaConfig(schemaText)).toEqual({
            enabled: true,
            ttlSeconds: 600,
            archiveStatus: 'expired',
            clock: 'updatedAt'
        });
    });

    it('accepts a valid localization extension and localized field markers', () => {
        const schemaText = JSON.stringify({
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    'x-wordclaw-localized': true
                },
                summary: { type: 'string' }
            },
            required: ['title'],
            'x-wordclaw-localization': {
                supportedLocales: ['en', 'nl'],
                defaultLocale: 'en'
            }
        });

        expect(validateContentTypeSchema(schemaText)).toBeNull();
        expect(getContentLocalizationSchemaConfig(schemaText)).toEqual({
            enabled: true,
            supportedLocales: ['en', 'nl'],
            defaultLocale: 'en'
        });
    });

    it('rejects malformed public-write schema extensions', () => {
        const failure = validateContentTypeSchema(JSON.stringify({
            type: 'object',
            properties: {
                sessionId: { type: 'integer' },
                body: { type: 'string' }
            },
            required: ['body'],
            'x-wordclaw-public-write': {
                enabled: true,
                subjectField: 'sessionId',
                allowedOperations: ['create', 'delete']
            }
        }));

        expect(failure).toMatchObject({
            code: 'INVALID_CONTENT_SCHEMA_PUBLIC_WRITE_EXTENSION'
        });
    });

    it('rejects malformed lifecycle schema extensions', () => {
        const failure = validateContentTypeSchema(JSON.stringify({
            type: 'object',
            properties: {
                sessionId: { type: 'string' }
            },
            'x-wordclaw-lifecycle': {
                ttlSeconds: 30,
                clock: 'lastSeenAt'
            }
        }));

        expect(failure).toMatchObject({
            code: 'INVALID_CONTENT_SCHEMA_LIFECYCLE_EXTENSION'
        });
    });

    it('rejects localized fields without a top-level localization config', () => {
        const failure = validateContentTypeSchema(JSON.stringify({
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    'x-wordclaw-localized': true
                }
            }
        }));

        expect(failure).toMatchObject({
            code: 'INVALID_CONTENT_SCHEMA_LOCALIZATION_EXTENSION'
        });
    });

    it('compiles schema manifests into canonical JSON schema with groups and block sets', () => {
        const compiled = compileSchemaManifest(JSON.stringify({
            title: 'Landing Page',
            localization: {
                supportedLocales: ['en', 'nl'],
                defaultLocale: 'en'
            },
            fields: [
                {
                    name: 'title',
                    type: 'text',
                    required: true,
                    localized: true
                },
                {
                    name: 'hero',
                    type: 'group',
                    fields: [
                        {
                            name: 'eyebrow',
                            type: 'text'
                        },
                        {
                            name: 'cta',
                            type: 'content-ref',
                            allowedContentTypeSlugs: ['cta']
                        }
                    ]
                },
                {
                    name: 'sections',
                    type: 'block-set',
                    blocks: [
                        {
                            type: 'callout',
                            fields: [
                                {
                                    name: 'body',
                                    type: 'textarea',
                                    required: true
                                }
                            ]
                        }
                    ]
                }
            ]
        }));

        expect(compiled.ok).toBe(true);
        if (!compiled.ok) {
            return;
        }

        expect(validateContentTypeSchema(compiled.schemaText)).toBeNull();
        expect(compiled.schema).toMatchObject({
            type: 'object',
            properties: {
                title: {
                    'x-wordclaw-localized': true
                },
                hero: {
                    type: 'object',
                    properties: {
                        cta: {
                            'x-wordclaw-field-kind': 'content-ref'
                        }
                    }
                },
                sections: {
                    type: 'array',
                    items: {
                        oneOf: [
                            expect.objectContaining({
                                properties: expect.objectContaining({
                                    blockType: expect.objectContaining({
                                        const: 'callout'
                                    })
                                })
                            })
                        ]
                    }
                }
            }
        });
    });

    it('rejects schema source payloads that provide both schema and schemaManifest', () => {
        const resolved = resolveContentTypeSchemaSource({
            schema: { type: 'object' },
            schemaManifest: { fields: [] }
        });

        expect(resolved).toMatchObject({
            ok: false,
            failure: {
                code: 'CONTENT_TYPE_SCHEMA_SOURCE_CONFLICT'
            }
        });
    });

    it('resolves manifest schema sources into compiled schema text', () => {
        const resolved = resolveContentTypeSchemaSource({
            schemaManifest: {
                fields: [
                    {
                        name: 'title',
                        type: 'text',
                        required: true
                    }
                ]
            }
        }, { requireSource: true });

        expect(resolved.ok).toBe(true);
        if (!resolved.ok || !resolved.value) {
            return;
        }

        expect(resolved.value.source).toBe('manifest');
        expect(resolved.value.schemaManifest).toContain('"fields"');
        expect(JSON.parse(resolved.value.schema)).toMatchObject({
            type: 'object',
            required: ['title']
        });
    });
});

describe('validateContentDataAgainstSchema', () => {
    beforeEach(() => {
        mocks.dbMock.select.mockReset();
    });

    it('accepts valid asset references in the current domain', async () => {
        mockLookupState({
            assets: [{ id: 7 }]
        });

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

    it('extracts the configured public-write subject from content data', async () => {
        const schemaText = JSON.stringify({
            type: 'object',
            properties: {
                sessionId: { type: 'string' },
                body: { type: 'string' }
            },
            required: ['sessionId', 'body'],
            'x-wordclaw-public-write': {
                enabled: true,
                subjectField: 'sessionId',
                allowedOperations: ['create', 'update']
            }
        });

        expect(getPublicWriteSubjectValue(schemaText, JSON.stringify({
            sessionId: 'session-123',
            body: 'savepoint'
        }))).toBe('session-123');
    });

    it('validates localized fields as locale maps and requires the default locale for required fields', async () => {
        const schemaText = JSON.stringify({
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
        });

        await expect(validateContentDataAgainstSchema(
            schemaText,
            JSON.stringify({
                title: {
                    en: 'Hello',
                    nl: 'Hallo'
                }
            }),
            1
        )).resolves.toBeNull();

        await expect(validateContentDataAgainstSchema(
            schemaText,
            JSON.stringify({
                title: {
                    nl: 'Hallo'
                }
            }),
            1
        )).resolves.toMatchObject({
            code: 'CONTENT_SCHEMA_VALIDATION_FAILED'
        });
    });

    it('rejects missing or cross-domain asset references', async () => {
        mockLookupState({});

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
        mockLookupState({
            assets: [{ id: 3 }]
        });

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

    it('accepts valid content references in the current domain', async () => {
        mockLookupState({
            contentItems: [{ id: 42, contentTypeId: 9 }]
        });

        const failure = await validateContentDataAgainstSchema(
            JSON.stringify({
                type: 'object',
                properties: {
                    nextStory: {
                        type: 'object',
                        'x-wordclaw-field-kind': 'content-ref',
                        properties: {
                            contentItemId: { type: 'integer' },
                            label: { type: 'string' }
                        },
                        required: ['contentItemId']
                    }
                }
            }),
            JSON.stringify({
                nextStory: {
                    contentItemId: 42,
                    label: 'Continue'
                }
            }),
            1
        );

        expect(failure).toBeNull();
        expect(mocks.dbMock.select).toHaveBeenCalledTimes(1);
    });

    it('rejects missing or cross-domain content references', async () => {
        mockLookupState({});

        const failure = await validateContentDataAgainstSchema(
            JSON.stringify({
                type: 'object',
                properties: {
                    nextStory: {
                        type: 'object',
                        'x-wordclaw-field-kind': 'content-ref',
                        properties: {
                            contentItemId: { type: 'integer' }
                        },
                        required: ['contentItemId']
                    }
                }
            }),
            JSON.stringify({
                nextStory: {
                    contentItemId: 84
                }
            }),
            1
        );

        expect(failure).toMatchObject({
            code: 'CONTENT_REFERENCE_INVALID'
        });
        expect(failure?.context?.details).toContain('/nextStory');
        expect(failure?.context?.details).toContain('84');
    });

    it('rejects content references that violate allowed content type ids', async () => {
        mockLookupState({
            contentItems: [{ id: 42, contentTypeId: 9 }]
        });

        const failure = await validateContentDataAgainstSchema(
            JSON.stringify({
                type: 'object',
                properties: {
                    nextStory: {
                        type: 'object',
                        'x-wordclaw-field-kind': 'content-ref',
                        allowedContentTypeIds: [7],
                        properties: {
                            contentItemId: { type: 'integer' }
                        },
                        required: ['contentItemId']
                    }
                }
            }),
            JSON.stringify({
                nextStory: {
                    contentItemId: 42
                }
            }),
            1
        );

        expect(failure).toMatchObject({
            code: 'CONTENT_REFERENCE_TYPE_MISMATCH'
        });
        expect(failure?.context?.details).toContain('/nextStory');
        expect(failure?.context?.details).toContain('id:7');
    });

    it('rejects content references that violate allowed content type slugs', async () => {
        mockLookupState({
            contentItems: [{ id: 42, contentTypeId: 9 }],
            contentTypes: [{ id: 7, slug: 'story' }]
        });

        const failure = await validateContentDataAgainstSchema(
            JSON.stringify({
                type: 'object',
                properties: {
                    relatedStories: {
                        type: 'array',
                        'x-wordclaw-field-kind': 'content-ref-list',
                        items: {
                            type: 'object',
                            'x-wordclaw-field-kind': 'content-ref',
                            allowedContentTypeSlugs: ['story'],
                            properties: {
                                contentItemId: { type: 'integer' }
                            },
                            required: ['contentItemId']
                        }
                    }
                }
            }),
            JSON.stringify({
                relatedStories: [
                    { contentItemId: 42 }
                ]
            }),
            1
        );

        expect(failure).toMatchObject({
            code: 'CONTENT_REFERENCE_TYPE_MISMATCH'
        });
        expect(failure?.context?.details).toContain('/relatedStories/0');
        expect(failure?.context?.details).toContain('slug:story');
    });
});

describe('localizeContentData', () => {
    it('resolves localized fields using the requested locale and configured fallback', () => {
        const result = localizeContentData(JSON.stringify({
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    'x-wordclaw-localized': true
                },
                hero: {
                    type: 'object',
                    properties: {
                        eyebrow: {
                            type: 'string',
                            'x-wordclaw-localized': true
                        }
                    }
                }
            },
            required: ['title'],
            'x-wordclaw-localization': {
                supportedLocales: ['en', 'nl'],
                defaultLocale: 'en'
            }
        }), JSON.stringify({
            title: {
                en: 'Hello world',
                nl: 'Hallo wereld'
            },
            hero: {
                eyebrow: {
                    en: 'Launch'
                }
            }
        }), {
            locale: 'nl'
        });

        expect(JSON.parse(result.data)).toEqual({
            title: 'Hallo wereld',
            hero: {
                eyebrow: 'Launch'
            }
        });
        expect(result.localeResolution).toEqual({
            requestedLocale: 'nl',
            fallbackLocale: 'en',
            defaultLocale: 'en',
            localizedFieldCount: 2,
            resolvedFieldCount: 2,
            fallbackFieldCount: 1,
            unresolvedFields: []
        });
    });
});
