import { describe, expect, it } from 'vitest';

import { buildL402Guide, selectOfferForGuide } from './l402-guide.js';

describe('selectOfferForGuide', () => {
    const offers = [
        { id: 4, slug: 'premium', name: 'Premium', scopeType: 'item', scopeRef: 12, priceSats: 500, active: true },
        { id: 7, slug: 'basic', name: 'Basic', scopeType: 'item', scopeRef: 12, priceSats: 200, active: true },
    ];

    it('prefers an explicitly requested offer', () => {
        expect(selectOfferForGuide(offers, 4)?.id).toBe(4);
    });

    it('falls back to the cheapest active offer', () => {
        expect(selectOfferForGuide(offers)?.id).toBe(7);
    });

    it('returns null when no offers exist', () => {
        expect(selectOfferForGuide([])).toBeNull();
    });
});

describe('buildL402Guide', () => {
    it('builds a ready purchase flow when an API key and offer are available', () => {
        const guide = buildL402Guide({
            itemId: 99,
            offers: [
                { id: 11, slug: 'blog-post', name: 'Blog Post Unlock', scopeType: 'item', scopeRef: 99, priceSats: 300, active: true },
            ],
            apiKeyConfigured: true,
        });

        expect(guide.selectedOfferId).toBe(11);
        expect(guide.steps).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'start-purchase',
                    status: 'ready',
                    command: 'node dist/cli/index.js l402 purchase --offer 11',
                }),
                expect.objectContaining({
                    id: 'read-content',
                    status: 'ready',
                }),
            ]),
        );
    });

    it('blocks purchase when no API key is configured', () => {
        const guide = buildL402Guide({
            itemId: 99,
            offers: [
                { id: 11, slug: 'blog-post', name: 'Blog Post Unlock', scopeType: 'item', scopeRef: 99, priceSats: 300, active: true },
            ],
            apiKeyConfigured: false,
        });

        expect(guide.steps.find((step) => step.id === 'start-purchase')).toEqual(
            expect.objectContaining({
                status: 'blocked',
            }),
        );
    });

    it('reports blocked purchase when no active offers exist', () => {
        const guide = buildL402Guide({
            itemId: 99,
            offers: [],
            apiKeyConfigured: true,
        });

        expect(guide.selectedOfferId).toBeNull();
        expect(guide.steps.find((step) => step.id === 'start-purchase')).toEqual(
            expect.objectContaining({
                status: 'blocked',
                command: null,
            }),
        );
    });
});
