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
            currentActor: {
                actorId: 'api_key:11',
                actorType: 'api_key',
                actorSource: 'db',
                actorProfileId: 'api-key',
                domainId: 2,
                scopes: ['content:read'],
                assignmentRefs: ['api_key:11', '11'],
            },
        });

        expect(guide.selectedOfferId).toBe(11);
        expect(guide.actorReadiness).toEqual(expect.objectContaining({
            status: 'ready',
            supportedActorProfile: true,
            requiredScopesSatisfied: true,
        }));
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

        expect(guide.actorReadiness.status).toBe('blocked');
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

    it('blocks purchase when the current actor does not satisfy the paid-content profile requirements', () => {
        const guide = buildL402Guide({
            itemId: 99,
            offers: [
                { id: 11, slug: 'blog-post', name: 'Blog Post Unlock', scopeType: 'item', scopeRef: 99, priceSats: 300, active: true },
            ],
            apiKeyConfigured: true,
            currentActor: {
                actorId: 'supervisor:1',
                actorType: 'supervisor',
                actorSource: 'cookie',
                actorProfileId: 'supervisor-session',
                domainId: 1,
                scopes: ['admin'],
                assignmentRefs: ['supervisor:1'],
            },
        });

        expect(guide.actorReadiness).toEqual(expect.objectContaining({
            status: 'blocked',
            supportedActorProfile: false,
            requiredScopesSatisfied: true,
        }));
        expect(guide.steps.find((step) => step.id === 'start-purchase')).toEqual(
            expect.objectContaining({
                status: 'blocked',
            }),
        );
    });

    it('warns when the current actor uses an env-backed API key profile', () => {
        const guide = buildL402Guide({
            itemId: 99,
            offers: [
                { id: 11, slug: 'blog-post', name: 'Blog Post Unlock', scopeType: 'item', scopeRef: 99, priceSats: 300, active: true },
            ],
            apiKeyConfigured: true,
            currentActor: {
                actorId: 'env_key:remote-admin',
                actorType: 'env_key',
                actorSource: 'env',
                actorProfileId: 'env-key',
                domainId: 1,
                scopes: ['admin'],
                assignmentRefs: ['env_key:remote-admin', 'remote-admin'],
            },
        });

        expect(guide.actorReadiness).toEqual(expect.objectContaining({
            status: 'warning',
            supportedActorProfile: true,
            requiredScopesSatisfied: true,
        }));
    });
});
