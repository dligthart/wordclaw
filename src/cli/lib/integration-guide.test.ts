import { describe, expect, it } from 'vitest';

import { buildIntegrationGuide } from './integration-guide.js';

describe('buildIntegrationGuide', () => {
    it('builds a ready integration plan with API key and webhook inventory', () => {
        const guide = buildIntegrationGuide({
            currentActor: {
                actorId: 'api_key:12',
                actorType: 'api_key',
                actorSource: 'db',
                actorProfileId: 'api-key',
                domainId: 2,
                scopes: ['admin'],
                assignmentRefs: ['api_key:12', '12'],
            },
            apiKeys: [
                {
                    id: 21,
                    name: 'Writer Key',
                    keyPrefix: 'wcak_123',
                    scopes: ['content:read', 'content:write'],
                    createdBy: 1,
                    createdAt: '2026-03-11T10:00:00.000Z',
                    expiresAt: null,
                    revokedAt: null,
                    lastUsedAt: null,
                },
                {
                    id: 22,
                    name: 'Revoked Key',
                    keyPrefix: 'wcak_456',
                    scopes: ['content:read'],
                    createdBy: 1,
                    createdAt: '2026-03-10T10:00:00.000Z',
                    expiresAt: null,
                    revokedAt: '2026-03-11T10:00:00.000Z',
                    lastUsedAt: null,
                },
            ],
            webhooks: [
                {
                    id: 31,
                    url: 'https://example.com/hooks/wordclaw',
                    events: ['content_item.create'],
                    active: true,
                    createdAt: '2026-03-11T10:00:00.000Z',
                },
            ],
        });

        expect(guide.actorReadiness).toEqual(expect.objectContaining({
            status: 'ready',
            supportedActorProfile: true,
            requiredScopesSatisfied: true,
        }));
        expect(guide.apiKeys).toEqual(expect.objectContaining({
            accessible: true,
            total: 2,
            active: 1,
            revoked: 1,
        }));
        expect(guide.webhooks).toEqual(expect.objectContaining({
            accessible: true,
            total: 1,
            active: 1,
            inactive: 0,
        }));
        expect(guide.steps).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'create-api-key',
                    status: 'ready',
                }),
                expect.objectContaining({
                    id: 'rotate-stale-key',
                    status: 'ready',
                    command: 'node dist/cli/index.js rest request PUT /auth/keys/<apiKeyId>',
                }),
            ]),
        );
    });

    it('builds a blocked plan when actor and inventories are unavailable', () => {
        const guide = buildIntegrationGuide({
            currentActor: null,
            apiKeys: null,
            webhooks: null,
        });

        expect(guide.actorReadiness).toEqual(expect.objectContaining({
            status: 'blocked',
            supportedActorProfile: false,
            requiredScopesSatisfied: false,
        }));
        expect(guide.apiKeys.accessible).toBe(false);
        expect(guide.webhooks.accessible).toBe(false);
        expect(guide.steps.find((step) => step.id === 'create-webhook')).toEqual(
            expect.objectContaining({
                status: 'blocked',
            }),
        );
    });

    it('warns when the actor uses an env-backed API key profile', () => {
        const guide = buildIntegrationGuide({
            currentActor: {
                actorId: 'env_key:remote-admin',
                actorType: 'env_key',
                actorSource: 'env',
                actorProfileId: 'env-key',
                domainId: 1,
                scopes: ['admin'],
                assignmentRefs: ['env_key:remote-admin', 'remote-admin'],
            },
            apiKeys: [],
            webhooks: [],
        });

        expect(guide.actorReadiness).toEqual(expect.objectContaining({
            status: 'warning',
            supportedActorProfile: true,
            requiredScopesSatisfied: true,
        }));
    });
});
