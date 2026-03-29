import { describe, expect, it } from 'vitest';

import { generateSchemaArtifacts } from './schema-artifacts.js';

describe('generateSchemaArtifacts', () => {
    it('generates runtime metadata, TypeScript types, validators, and client helpers', () => {
        const artifacts = generateSchemaArtifacts({
            packageName: 'wordclaw-generated',
            capabilitySnapshot: {
                contentRuntime: {
                    globals: { supported: true },
                    workingCopyPreview: { supported: true },
                    localization: { supported: true },
                    reverseReferences: { supported: true }
                }
            },
            contentTypes: [
                {
                    id: 7,
                    name: 'Article',
                    slug: 'article',
                    kind: 'collection',
                    description: 'Primary article model',
                    schema: JSON.stringify({
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            title: { type: 'string' },
                            body: {
                                type: 'string',
                                'x-wordclaw-localized': true
                            },
                            hero: {
                                type: 'object',
                                additionalProperties: false,
                                'x-wordclaw-field-kind': 'asset',
                                properties: {
                                    assetId: { type: 'integer' }
                                },
                                required: ['assetId']
                            }
                        },
                        required: ['title']
                    })
                },
                {
                    id: 8,
                    name: 'Site Settings',
                    slug: 'site-settings',
                    kind: 'singleton',
                    description: 'Global site config',
                    schema: JSON.stringify({
                        type: 'object',
                        additionalProperties: false,
                        'x-wordclaw-localization': {
                            supportedLocales: ['en', 'nl'],
                            defaultLocale: 'en'
                        },
                        properties: {
                            siteName: { type: 'string' }
                        },
                        required: ['siteName']
                    })
                }
            ]
        });

        const runtime = artifacts.find((artifact) => artifact.filename === 'runtime.ts')?.content ?? '';
        const types = artifacts.find((artifact) => artifact.filename === 'types.ts')?.content ?? '';
        const validators = artifacts.find((artifact) => artifact.filename === 'validators.ts')?.content ?? '';
        const client = artifacts.find((artifact) => artifact.filename === 'client.ts')?.content ?? '';

        expect(artifacts.map((artifact) => artifact.filename)).toEqual([
            'runtime.ts',
            'types.ts',
            'validators.ts',
            'client.ts',
            'index.ts'
        ]);
        expect(runtime).toContain("export const contentModels =");
        expect(runtime).toContain('"site-settings"');
        expect(types).toContain('export interface ArticleData');
        expect(types).toContain('body?: LocalizedField<string>;');
        expect(types).toContain("export type GlobalModelsBySlug =");
        expect(validators).toContain('export const ArticleDataSchema = z.object(');
        expect(validators).toContain('localizedField(z.string())');
        expect(validators).toContain('export const SiteSettingsDataSchema = z.object(');
        expect(client).toContain('class WordClawRestClient');
        expect(client).toContain('async getContentItemUsage(id: number)');
        expect(client).toContain('async getSiteSettingsGlobal(');
        expect(client).toContain("callTool<{ asset: unknown; usage: ReferenceUsageSummary }>('get_asset_usage'");
    });
});
