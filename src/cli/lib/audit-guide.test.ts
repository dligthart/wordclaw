import { describe, expect, it } from 'vitest';

import { buildAuditGuide } from './audit-guide.js';

describe('buildAuditGuide', () => {
    it('builds a ready provenance plan for an API key actor', () => {
        const guide = buildAuditGuide({
            currentActor: {
                actorId: 'api_key:12',
                actorType: 'api_key',
                actorSource: 'db',
                actorProfileId: 'api-key',
                domainId: 2,
                scopes: ['audit:read'],
                assignmentRefs: ['api_key:12', '12'],
            },
            entries: [
                {
                    id: 51,
                    action: 'update',
                    entityType: 'content_item',
                    entityId: 88,
                    actorId: 'api_key:12',
                    actorType: 'api_key',
                    actorSource: 'db',
                    details: '{"requestId":"req-1"}',
                    createdAt: '2026-03-11T10:00:00.000Z',
                },
                {
                    id: 50,
                    action: 'create',
                    entityType: 'content_item',
                    entityId: 77,
                    actorId: 'api_key:12',
                    actorType: 'api_key',
                    actorSource: 'db',
                    details: null,
                    createdAt: '2026-03-11T09:00:00.000Z',
                },
            ],
            limit: 10,
        });

        expect(guide.actorReadiness).toEqual(expect.objectContaining({
            status: 'ready',
            supportedActorProfile: true,
            requiredScopesSatisfied: true,
        }));
        expect(guide.summary).toEqual({
            returnedEvents: 2,
            actorMatches: 2,
            uniqueEntities: 2,
            latestEventAt: '2026-03-11T10:00:00.000Z',
        });
        expect(guide.steps).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'inspect-current-actor-trail',
                    status: 'completed',
                    command: 'node dist/cli/index.js audit list --actor-id "api_key:12" --actor-type "api_key" --limit 10',
                }),
            ]),
        );
    });

    it('builds a blocked provenance plan when actor and audit access are unavailable', () => {
        const guide = buildAuditGuide({
            currentActor: null,
            entries: [],
            limit: 5,
        });

        expect(guide.actorReadiness).toEqual(expect.objectContaining({
            status: 'blocked',
            supportedActorProfile: false,
            requiredScopesSatisfied: false,
        }));
        expect(guide.steps.find((step) => step.id === 'inspect-current-actor-trail')).toEqual(
            expect.objectContaining({
                status: 'blocked',
                command: null,
            }),
        );
    });

    it('warns for env-backed actors and preserves explicit filters', () => {
        const guide = buildAuditGuide({
            currentActor: {
                actorId: 'env_key:remote-admin',
                actorType: 'env_key',
                actorSource: 'env',
                actorProfileId: 'env-key',
                domainId: 1,
                scopes: ['admin'],
                assignmentRefs: ['env_key:remote-admin', 'remote-admin'],
            },
            actorId: 'env_key:remote-admin',
            entityType: 'api_key',
            entityId: 42,
            action: 'create',
            entries: [],
        });

        expect(guide.actorReadiness.status).toBe('warning');
        expect(guide.filters).toEqual(expect.objectContaining({
            actorId: 'env_key:remote-admin',
            entityType: 'api_key',
            entityId: 42,
            action: 'create',
        }));
    });
});
