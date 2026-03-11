import type { CurrentActorSnapshot } from '../../services/actor-identity.js';

type AuditEntryLike = {
    id: number;
    action: string;
    entityType: string;
    entityId: number;
    actorId: string | null;
    actorType: string | null;
    actorSource?: string | null;
    details?: string | null;
    createdAt: string;
};

export type AuditGuideStep = {
    id: string;
    title: string;
    status: 'completed' | 'ready' | 'blocked' | 'optional';
    command: string | null;
    purpose: string;
    notes?: string[];
};

export type AuditGuide = {
    taskId: 'verify-provenance';
    requiredActorProfiles: Array<'api-key' | 'env-key' | 'supervisor-session' | 'mcp-local'>;
    requiredScopes: string[];
    currentActor: CurrentActorSnapshot | null;
    actorReadiness: {
        status: 'ready' | 'blocked' | 'warning';
        supportedActorProfile: boolean;
        requiredScopesSatisfied: boolean;
        notes: string[];
    };
    filters: {
        actorId: string | null;
        actorType: string | null;
        entityType: string | null;
        entityId: number | null;
        action: string | null;
        limit: number;
    };
    summary: {
        returnedEvents: number;
        actorMatches: number;
        uniqueEntities: number;
        latestEventAt: string | null;
    };
    recentEvents: AuditEntryLike[];
    warnings?: string[];
    steps: AuditGuideStep[];
};

function buildAuditListCommand(options: {
    baseCommand: string;
    actorId?: string | null;
    actorType?: string | null;
    entityType?: string | null;
    entityId?: number | null;
    action?: string | null;
    limit: number;
}): string {
    const flags = [
        options.actorId ? `--actor-id ${JSON.stringify(options.actorId)}` : null,
        options.actorType ? `--actor-type ${JSON.stringify(options.actorType)}` : null,
        options.entityType ? `--entity-type ${JSON.stringify(options.entityType)}` : null,
        options.entityId !== null && options.entityId !== undefined ? `--entity-id ${options.entityId}` : null,
        options.action ? `--action ${JSON.stringify(options.action)}` : null,
        `--limit ${options.limit}`,
    ].filter((value): value is string => Boolean(value));

    return `${options.baseCommand} audit list ${flags.join(' ')}`.trim();
}

export function buildAuditGuide(options: {
    currentActor?: CurrentActorSnapshot | null;
    entries?: AuditEntryLike[] | null;
    actorId?: string | null;
    actorType?: string | null;
    entityType?: string | null;
    entityId?: number | null;
    action?: string | null;
    limit?: number;
    baseCommand?: string;
}): AuditGuide {
    const currentActor = options.currentActor ?? null;
    const entries = options.entries ?? [];
    const limit = options.limit ?? 20;
    const baseCommand = options.baseCommand ?? 'node dist/cli/index.js';
    const requiredActorProfiles: Array<'api-key' | 'env-key' | 'supervisor-session' | 'mcp-local'> = [
        'api-key',
        'env-key',
        'supervisor-session',
        'mcp-local',
    ];
    const requiredScopes = ['audit:read'];
    const supportedActorProfile = currentActor
        ? requiredActorProfiles.includes(currentActor.actorProfileId as typeof requiredActorProfiles[number])
        : false;
    const requiredScopesSatisfied = currentActor
        ? currentActor.scopes.includes('admin') || requiredScopes.every((scope) => currentActor.scopes.includes(scope))
        : false;
    const actorReadinessNotes: string[] = [];

    if (!currentActor) {
        actorReadinessNotes.push('No authenticated actor snapshot is available yet.');
    } else {
        actorReadinessNotes.push(`Current actor ${currentActor.actorId} is using profile ${currentActor.actorProfileId} in domain ${currentActor.domainId}.`);
        if (!supportedActorProfile) {
            actorReadinessNotes.push('Provenance verification requires an API key, supervisor session, or local MCP actor profile.');
        }
        if (!requiredScopesSatisfied) {
            actorReadinessNotes.push('The current actor is missing audit:read or admin scope for audit trail inspection.');
        }
        if (currentActor.actorProfileId === 'env-key') {
            actorReadinessNotes.push('Environment-configured API keys are acceptable for local provenance checks but are less portable than database-backed keys.');
        }
    }

    const actorReadinessStatus = !currentActor
        ? 'blocked'
        : !supportedActorProfile || !requiredScopesSatisfied
            ? 'blocked'
            : currentActor.actorProfileId === 'env-key'
                ? 'warning'
                : 'ready';

    const actorId = options.actorId ?? currentActor?.actorId ?? null;
    const actorType = options.actorType ?? currentActor?.actorType ?? null;
    const summary = {
        returnedEvents: entries.length,
        actorMatches: actorId ? entries.filter((entry) => entry.actorId === actorId).length : 0,
        uniqueEntities: new Set(entries.map((entry) => `${entry.entityType}:${entry.entityId}`)).size,
        latestEventAt: entries[0]?.createdAt ?? null,
    };

    return {
        taskId: 'verify-provenance',
        requiredActorProfiles,
        requiredScopes,
        currentActor,
        actorReadiness: {
            status: actorReadinessStatus,
            supportedActorProfile,
            requiredScopesSatisfied,
            notes: actorReadinessNotes,
        },
        filters: {
            actorId,
            actorType,
            entityType: options.entityType ?? null,
            entityId: options.entityId ?? null,
            action: options.action ?? null,
            limit,
        },
        summary,
        recentEvents: entries,
        steps: [
            {
                id: 'inspect-current-actor-trail',
                title: 'Inspect the current actor trail',
                status: actorReadinessStatus === 'blocked' || !actorId ? 'blocked' : entries.length > 0 ? 'completed' : 'ready',
                command: actorId
                    ? buildAuditListCommand({
                        baseCommand,
                        actorId,
                        actorType,
                        limit,
                    })
                    : null,
                purpose: 'Confirm which recent writes and configuration changes were attributed to the current actor.',
                notes: actorId
                    ? [`Current actor filter: ${actorId}.`]
                    : ['No actor id is available yet, so actor-scoped audit lookups remain blocked.'],
            },
            {
                id: 'narrow-provenance',
                title: 'Narrow to a specific entity or action',
                status: actorReadinessStatus === 'blocked' ? 'blocked' : 'ready',
                command: buildAuditListCommand({
                    baseCommand,
                    actorId,
                    actorType,
                    entityType: options.entityType ?? 'content_item',
                    entityId: options.entityId,
                    action: options.action,
                    limit,
                }),
                purpose: 'Filter the audit log to one entity, action, or workflow step when you need a tighter post-action check.',
                notes: ['Override --entity-type, --entity-id, or --action to focus the audit trail on one operation.'],
            },
            {
                id: 'inspect-latest-details',
                title: 'Inspect the latest audit payload details',
                status: entries.length > 0 ? 'completed' : actorReadinessStatus === 'blocked' ? 'blocked' : 'optional',
                command: actorId
                    ? buildAuditListCommand({
                        baseCommand,
                        actorId,
                        actorType,
                        entityType: options.entityType ?? null,
                        entityId: options.entityId ?? null,
                        action: options.action ?? null,
                        limit: 1,
                    })
                    : null,
                purpose: 'Review the newest audit entry details for request ids or operation context after a mutation.',
                notes: entries.length > 0
                    ? [`Latest event: ${entries[0].action} ${entries[0].entityType}#${entries[0].entityId}.`]
                    : ['No matching audit entries were returned yet.'],
            },
        ],
    };
}
