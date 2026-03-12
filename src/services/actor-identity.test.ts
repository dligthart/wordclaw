import { describe, expect, it } from 'vitest';

import {
    buildActorAssignmentRefs,
    buildCurrentActorSnapshot,
    buildEnvKeyPrincipal,
    buildApiKeyPrincipal,
    buildMcpLocalPrincipal,
    buildSupervisorPrincipal,
    resolveActorIdentityRef,
    resolveActorProfileId,
    toAuditActor
} from './actor-identity.js';

describe('actor identity helpers', () => {
    it('builds canonical actor identity for API keys', () => {
        const principal = buildApiKeyPrincipal(42, 7, new Set(['content:read']));

        expect(principal).toMatchObject({
            keyId: 42,
            domainId: 7,
            actorId: 'api_key:42',
            actorType: 'api_key',
            actorSource: 'db',
            source: 'db'
        });
    });

    it('derives audit identity for supervisors', () => {
        const principal = buildSupervisorPrincipal(12, 3);

        expect(toAuditActor(principal)).toEqual({
            actorId: 'supervisor:12',
            actorType: 'supervisor',
            actorSource: 'cookie',
            userId: null
        });
    });

    it('derives audit identity for MCP local runs', () => {
        const principal = buildMcpLocalPrincipal(1);

        expect(toAuditActor(principal)).toEqual({
            actorId: 'mcp-local',
            actorType: 'mcp',
            actorSource: 'local',
            userId: null
        });
    });

    it('maps legacy numeric actor IDs to canonical api_key audit actors', () => {
        expect(toAuditActor(9)).toEqual({
            actorId: 'api_key:9',
            actorType: 'api_key',
            actorSource: 'db',
            userId: 9
        });
    });

    it('maps env-backed API keys to the env-key actor profile', () => {
        const principal = buildEnvKeyPrincipal('writer', 1, new Set(['content:write']));

        expect(resolveActorProfileId(principal)).toBe('env-key');
        expect(buildCurrentActorSnapshot(principal)).toEqual({
            actorId: 'env_key:writer',
            actorType: 'env_key',
            actorSource: 'env',
            actorProfileId: 'env-key',
            domainId: 1,
            scopes: ['content:write'],
            assignmentRefs: ['env_key:writer', 'writer'],
        });
    });

    it('builds assignment refs with both canonical actor ids and legacy key ids where needed', () => {
        expect(buildActorAssignmentRefs({
            actorId: 'api_key:12',
            keyId: 12,
        })).toEqual(['api_key:12', '12']);

        expect(buildActorAssignmentRefs({
            actorId: 'supervisor:4',
            keyId: 'supervisor:4',
        })).toEqual(['supervisor:4']);
    });

    it('resolves canonical actor refs and legacy numeric ids into structured actor identity', () => {
        expect(resolveActorIdentityRef('api_key:12')).toEqual({
            actorId: 'api_key:12',
            actorType: 'api_key',
            actorSource: 'db'
        });

        expect(resolveActorIdentityRef('42')).toEqual({
            actorId: 'api_key:42',
            actorType: 'api_key',
            actorSource: 'db'
        });

        expect(resolveActorIdentityRef('supervisor:7')).toEqual({
            actorId: 'supervisor:7',
            actorType: 'supervisor',
            actorSource: 'cookie'
        });

        expect(resolveActorIdentityRef('unstructured-user')).toBeUndefined();
    });
});
