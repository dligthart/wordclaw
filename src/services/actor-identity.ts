export type ActorType = 'supervisor' | 'api_key' | 'env_key' | 'mcp' | 'anonymous' | 'system';
export type ActorSource = 'cookie' | 'db' | 'env' | 'local' | 'anonymous' | 'system' | 'test';
export type ActorProfileId = 'public-discovery' | 'api-key' | 'env-key' | 'supervisor-session' | 'mcp-local' | 'anonymous-local-dev';

export type ActorIdentity = {
    actorId: string;
    actorType: ActorType;
    actorSource: ActorSource;
};

export type ActorPrincipal = ActorIdentity & {
    actorRef: number | string;
    domainId: number;
    scopes: Set<string>;
    source: ActorSource;
};

export type PrincipalLike = Partial<ActorIdentity> & {
    actorRef?: number | string;
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

export function buildApiKeyPrincipal(apiKeyId: number, domainId: number, scopes: Set<string>): ActorPrincipal {
    return {
        actorRef: apiKeyId,
        domainId,
        scopes,
        source: 'db',
        actorId: `api_key:${apiKeyId}`,
        actorType: 'api_key',
        actorSource: 'db'
    };
}

export function buildEnvKeyPrincipal(keyFragment: string, domainId: number, scopes: Set<string>): ActorPrincipal {
    const normalizedKey = keyFragment.trim() || 'env';

    return {
        actorRef: normalizedKey,
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
        actorRef: 'anonymous',
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
        actorRef: `supervisor:${supervisorId}`,
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
        actorRef: 'mcp-local',
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

    if (typeof principal.actorId === 'string') {
        const identityFromActorId = resolveActorIdentityRef(principal.actorId);
        if (identityFromActorId) {
            return identityFromActorId;
        }
    }

    if (principal.actorRef === 'anonymous') {
        return {
            actorId: 'anonymous',
            actorType: 'anonymous',
            actorSource: 'anonymous'
        };
    }

    if (principal.actorRef === 'mcp-local') {
        return {
            actorId: 'mcp-local',
            actorType: 'mcp',
            actorSource: 'local'
        };
    }

    if (typeof principal.actorRef === 'string' && principal.actorRef.startsWith('supervisor:')) {
        return {
            actorId: principal.actorRef,
            actorType: 'supervisor',
            actorSource: 'cookie'
        };
    }

    if (typeof principal.actorRef === 'number') {
        return {
            actorId: `api_key:${principal.actorRef}`,
            actorType: 'api_key',
            actorSource: principal.source === 'test' ? 'test' : 'db'
        };
    }

    if (typeof principal.actorRef === 'string' && principal.source === 'env') {
        return {
            actorId: `env_key:${principal.actorRef}`,
            actorType: 'env_key',
            actorSource: 'env'
        };
    }

    if (typeof principal.actorRef === 'string') {
        return {
            actorId: principal.actorRef,
            actorType: 'system',
            actorSource: principal.source === 'test' ? 'test' : 'system'
        };
    }

    return undefined;
}

export function resolveActorIdentityRef(ref: string | null | undefined): ActorIdentity | undefined {
    if (typeof ref !== 'string') {
        return undefined;
    }

    const normalized = ref.trim();
    if (normalized.length === 0) {
        return undefined;
    }

    if (/^\d+$/.test(normalized)) {
        return {
            actorId: `api_key:${normalized}`,
            actorType: 'api_key',
            actorSource: 'db'
        };
    }

    if (normalized === 'anonymous') {
        return {
            actorId: 'anonymous',
            actorType: 'anonymous',
            actorSource: 'anonymous'
        };
    }

    if (normalized === 'mcp-local') {
        return {
            actorId: 'mcp-local',
            actorType: 'mcp',
            actorSource: 'local'
        };
    }

    if (normalized === 'system') {
        return {
            actorId: 'system',
            actorType: 'system',
            actorSource: 'system'
        };
    }

    if (normalized.startsWith('api_key:')) {
        return {
            actorId: normalized,
            actorType: 'api_key',
            actorSource: 'db'
        };
    }

    if (normalized.startsWith('env_key:')) {
        return {
            actorId: normalized,
            actorType: 'env_key',
            actorSource: 'env'
        };
    }

    if (normalized.startsWith('supervisor:')) {
        return {
            actorId: normalized,
            actorType: 'supervisor',
            actorSource: 'cookie'
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

    const apiKeyId = actor && typeof actor === 'object'
        ? resolveApiKeyId(actor)
        : undefined;

    return {
        ...identity,
        userId: apiKeyId ?? null
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
    actorRef?: number | string;
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

    if (principal.actorRef !== undefined && principal.actorRef !== null) {
        const actorRef = String(principal.actorRef).trim();
        if (actorRef.length > 0) {
            refs.add(actorRef);
        }
    }

    return Array.from(refs);
}

export function resolveApiKeyId(principal: PrincipalLike | null | undefined): number | undefined {
    if (!principal) {
        return undefined;
    }

    if (typeof principal.actorRef === 'number') {
        return principal.actorType === 'api_key' || !principal.actorType ? principal.actorRef : undefined;
    }

    if (typeof principal.actorRef === 'string' && /^\d+$/.test(principal.actorRef)) {
        const parsed = Number(principal.actorRef);
        return Number.isSafeInteger(parsed) ? parsed : undefined;
    }

    const actorId = principal.actorId?.trim();
    if (actorId?.startsWith('api_key:')) {
        const rawId = actorId.slice('api_key:'.length);
        if (/^\d+$/.test(rawId)) {
            const parsed = Number(rawId);
            return Number.isSafeInteger(parsed) ? parsed : undefined;
        }
    }

    return undefined;
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
