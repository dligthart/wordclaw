export type ActorType = 'supervisor' | 'api_key' | 'env_key' | 'mcp' | 'anonymous' | 'system';
export type ActorSource = 'cookie' | 'db' | 'env' | 'local' | 'anonymous' | 'system' | 'test';
export type ActorProfileId = 'public-discovery' | 'api-key' | 'env-key' | 'supervisor-session' | 'mcp-local' | 'anonymous-local-dev';

export type ActorIdentity = {
    actorId: string;
    actorType: ActorType;
    actorSource: ActorSource;
};

export type ActorPrincipal = ActorIdentity & {
    keyId: number | string;
    domainId: number;
    scopes: Set<string>;
    source: ActorSource;
};

export type PrincipalLike = Partial<ActorIdentity> & {
    keyId?: number | string;
    source?: string;
};

export type AuditActor = ActorIdentity & {
    userId?: number | null;
};

export type CurrentActorSnapshot = ActorIdentity & {
    actorProfileId: ActorProfileId;
    domainId: number;
    scopes: string[];
    assignmentRefs: string[];
};

export function buildApiKeyPrincipal(keyId: number, domainId: number, scopes: Set<string>): ActorPrincipal {
    return {
        keyId,
        domainId,
        scopes,
        source: 'db',
        actorId: `api_key:${keyId}`,
        actorType: 'api_key',
        actorSource: 'db'
    };
}

export function buildEnvKeyPrincipal(keyFragment: string, domainId: number, scopes: Set<string>): ActorPrincipal {
    const normalizedKey = keyFragment.trim() || 'env';

    return {
        keyId: normalizedKey,
        domainId,
        scopes,
        source: 'env',
        actorId: `env_key:${normalizedKey}`,
        actorType: 'env_key',
        actorSource: 'env'
    };
}

export function buildAnonymousLocalPrincipal(): ActorPrincipal {
    return {
        keyId: 'anonymous',
        domainId: 1,
        scopes: new Set(['admin']),
        source: 'anonymous',
        actorId: 'anonymous',
        actorType: 'anonymous',
        actorSource: 'anonymous'
    };
}

export function buildSupervisorPrincipal(supervisorId: number, domainId: number): ActorPrincipal {
    return {
        keyId: `supervisor:${supervisorId}`,
        domainId,
        scopes: new Set(['admin']),
        source: 'cookie',
        actorId: `supervisor:${supervisorId}`,
        actorType: 'supervisor',
        actorSource: 'cookie'
    };
}

export function buildMcpLocalPrincipal(domainId: number): ActorPrincipal {
    return {
        keyId: 'mcp-local',
        domainId,
        scopes: new Set(['admin']),
        source: 'local',
        actorId: 'mcp-local',
        actorType: 'mcp',
        actorSource: 'local'
    };
}

export function resolveActorIdentity(principal: PrincipalLike | null | undefined): ActorIdentity | undefined {
    if (!principal) {
        return undefined;
    }

    if (principal.actorId && principal.actorType && principal.actorSource) {
        return {
            actorId: principal.actorId,
            actorType: principal.actorType,
            actorSource: principal.actorSource
        };
    }

    if (principal.keyId === 'anonymous') {
        return {
            actorId: 'anonymous',
            actorType: 'anonymous',
            actorSource: 'anonymous'
        };
    }

    if (principal.keyId === 'mcp-local') {
        return {
            actorId: 'mcp-local',
            actorType: 'mcp',
            actorSource: 'local'
        };
    }

    if (typeof principal.keyId === 'string' && principal.keyId.startsWith('supervisor:')) {
        return {
            actorId: principal.keyId,
            actorType: 'supervisor',
            actorSource: 'cookie'
        };
    }

    if (typeof principal.keyId === 'number') {
        return {
            actorId: `api_key:${principal.keyId}`,
            actorType: 'api_key',
            actorSource: principal.source === 'test' ? 'test' : 'db'
        };
    }

    if (typeof principal.keyId === 'string' && principal.source === 'env') {
        return {
            actorId: `env_key:${principal.keyId}`,
            actorType: 'env_key',
            actorSource: 'env'
        };
    }

    if (typeof principal.keyId === 'string') {
        return {
            actorId: principal.keyId,
            actorType: 'system',
            actorSource: principal.source === 'test' ? 'test' : 'system'
        };
    }

    return undefined;
}

export function toAuditActor(actor: number | PrincipalLike | AuditActor | null | undefined): AuditActor | undefined {
    if (typeof actor === 'number') {
        return {
            actorId: `api_key:${actor}`,
            actorType: 'api_key',
            actorSource: 'db',
            userId: actor
        };
    }

    const identity = resolveActorIdentity(actor);
    if (!identity) {
        return undefined;
    }

    return {
        ...identity,
        userId: identity.actorType === 'api_key'
            && actor
            && typeof actor === 'object'
            && 'keyId' in actor
            && typeof actor.keyId === 'number'
            ? actor.keyId
            : null
    };
}

export function resolveActorProfileId(principal: PrincipalLike | null | undefined): ActorProfileId {
    const identity = resolveActorIdentity(principal);

    if (!identity) {
        return 'public-discovery';
    }

    switch (identity.actorType) {
        case 'api_key':
            return 'api-key';
        case 'env_key':
            return 'env-key';
        case 'supervisor':
            return 'supervisor-session';
        case 'mcp':
            return 'mcp-local';
        case 'anonymous':
            return 'anonymous-local-dev';
        default:
            return 'public-discovery';
    }
}

export function buildActorAssignmentRefs(principal: {
    keyId?: number | string;
    actorId?: string;
    assignmentRefs?: string[];
} | null | undefined): string[] {
    const refs = new Set<string>();

    if (!principal) {
        return [];
    }

    if (Array.isArray(principal.assignmentRefs)) {
        for (const ref of principal.assignmentRefs) {
            if (typeof ref === 'string' && ref.trim().length > 0) {
                refs.add(ref.trim());
            }
        }
    }

    if (typeof principal.actorId === 'string' && principal.actorId.trim().length > 0) {
        refs.add(principal.actorId.trim());
    }

    if (principal.keyId !== undefined && principal.keyId !== null) {
        const keyRef = String(principal.keyId).trim();
        if (keyRef.length > 0) {
            refs.add(keyRef);
        }
    }

    return Array.from(refs);
}

export function buildCurrentActorSnapshot(principal: ActorPrincipal): CurrentActorSnapshot {
    return {
        actorId: principal.actorId,
        actorType: principal.actorType,
        actorSource: principal.actorSource,
        actorProfileId: resolveActorProfileId(principal),
        domainId: principal.domainId,
        scopes: Array.from(principal.scopes).sort(),
        assignmentRefs: buildActorAssignmentRefs(principal),
    };
}
