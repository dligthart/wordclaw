import { describe, expect, it } from 'vitest';

import {
    canSubscribeToReactiveTopic,
    deriveReactiveTopics,
    getReactiveSubscriptionRecipe,
} from './reactive-events.js';
import type { ActorPrincipal } from '../services/actor-identity.js';

function buildPrincipal(scopes: string[]): ActorPrincipal {
    return {
        actorRef: 'test',
        domainId: 1,
        scopes: new Set(scopes),
        source: 'test',
        actorId: 'test',
        actorType: 'system',
        actorSource: 'test',
    };
}

describe('reactive integration discovery', () => {
    it('derives tenant AI provider and workforce topics from audit events', () => {
        expect(deriveReactiveTopics({
            id: 1,
            domainId: 1,
            action: 'update',
            entityType: 'ai_provider_config',
            entityId: 7,
            userId: null,
            actorId: 'supervisor:1',
            actorType: 'supervisor',
            actorSource: 'cookie',
            details: '{}',
            createdAt: new Date('2026-04-02T07:00:00.000Z'),
        })).toEqual(expect.arrayContaining([
            'audit.*',
            'ai_provider_config.update',
            'ai_provider_config.*',
        ]));

        expect(deriveReactiveTopics({
            id: 2,
            domainId: 1,
            action: 'create',
            entityType: 'workforce_agent',
            entityId: 9,
            userId: null,
            actorId: 'supervisor:1',
            actorType: 'supervisor',
            actorSource: 'cookie',
            details: '{}',
            createdAt: new Date('2026-04-02T07:00:00.000Z'),
        })).toEqual(expect.arrayContaining([
            'audit.*',
            'workforce_agent.create',
            'workforce_agent.*',
        ]));
    });

    it('allows tenant admins to subscribe to tenant-scoped integration topics', () => {
        const tenantAdmin = buildPrincipal(['tenant:admin']);

        expect(canSubscribeToReactiveTopic(tenantAdmin, 'api_key.create')).toBe(true);
        expect(canSubscribeToReactiveTopic(tenantAdmin, 'webhook.update')).toBe(true);
        expect(canSubscribeToReactiveTopic(tenantAdmin, 'ai_provider_config.create')).toBe(true);
        expect(canSubscribeToReactiveTopic(tenantAdmin, 'workforce_agent.delete')).toBe(true);
    });

    it('expands the integration-admin recipe to provider and workforce mutations', () => {
        expect(getReactiveSubscriptionRecipe('integration-admin')).toEqual(expect.objectContaining({
            requiredScopes: ['admin', 'tenant:admin'],
            topics: expect.arrayContaining([
                'api_key.create',
                'webhook.update',
                'ai_provider_config.create',
                'workforce_agent.delete',
            ]),
        }));
    });
});
