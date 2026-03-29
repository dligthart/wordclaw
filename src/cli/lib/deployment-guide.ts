import type { CurrentActorSnapshot } from '../../services/actor-identity.js';
import type { DeploymentStatusSnapshot } from '../../services/deployment-status.js';

export type DeploymentGuideStep = {
    id: string;
    title: string;
    status: 'completed' | 'ready' | 'blocked' | 'optional';
    command: string | null;
    purpose: string;
    notes?: string[];
};

export type DeploymentGuide = {
    taskId: 'discover-deployment';
    currentActor: CurrentActorSnapshot | null;
    deploymentStatus: DeploymentStatusSnapshot | null;
    overallStatus: DeploymentStatusSnapshot['overallStatus'] | null;
    checks: DeploymentStatusSnapshot['checks'] | null;
    bootstrap: {
        status: 'ready' | 'blocked';
        domainCount: number | null;
        nextAction: string | null;
        recommendedGuideTask: string | null;
        note: string | null;
    };
    auth: {
        status: 'ready' | 'blocked';
        writeRequiresCredential: boolean;
        actorCanWrite: boolean;
        note: string | null;
    };
    vectorRag: {
        status: 'ready' | 'disabled';
        enabled: boolean;
        reason: string | null;
        note: string | null;
    };
    warnings?: string[];
    steps: DeploymentGuideStep[];
};

function buildWhoAmICommand(currentActor: CurrentActorSnapshot | null, baseCommand: string) {
    if (currentActor?.actorProfileId === 'mcp-local') {
        return `${baseCommand} mcp whoami`;
    }

    return `${baseCommand} capabilities whoami`;
}

function actorCanWrite(currentActor: CurrentActorSnapshot | null) {
    if (!currentActor) {
        return false;
    }

    return currentActor.scopes.includes('admin')
        || currentActor.scopes.includes('tenant:admin')
        || currentActor.scopes.includes('content:write');
}

export function buildDeploymentGuide(options: {
    currentActor?: CurrentActorSnapshot | null;
    deploymentStatus?: DeploymentStatusSnapshot | null;
    baseCommand?: string;
}): DeploymentGuide {
    const currentActor = options.currentActor ?? null;
    const deploymentStatus = options.deploymentStatus ?? null;
    const baseCommand = options.baseCommand ?? 'node dist/cli/index.js';
    const bootstrapCheck = deploymentStatus?.checks.bootstrap ?? null;
    const authCheck = deploymentStatus?.checks.auth ?? null;
    const vectorRagCheck = deploymentStatus?.checks.vectorRag ?? null;
    const bootstrapBlocked = (bootstrapCheck?.domainCount ?? 0) === 0;
    const hasWriteActor = actorCanWrite(currentActor);
    const writeBlocked = Boolean(authCheck?.writeRequiresCredential) && !hasWriteActor;

    return {
        taskId: 'discover-deployment',
        currentActor,
        deploymentStatus,
        overallStatus: deploymentStatus?.overallStatus ?? null,
        checks: deploymentStatus?.checks ?? null,
        bootstrap: {
            status: bootstrapBlocked ? 'blocked' : 'ready',
            domainCount: bootstrapCheck?.domainCount ?? null,
            nextAction: bootstrapCheck?.nextAction ?? null,
            recommendedGuideTask: bootstrapCheck?.recommendedGuideTask ?? null,
            note: bootstrapCheck?.note ?? null,
        },
        auth: {
            status: writeBlocked ? 'blocked' : 'ready',
            writeRequiresCredential: authCheck?.writeRequiresCredential ?? true,
            actorCanWrite: hasWriteActor,
            note: authCheck?.note ?? null,
        },
        vectorRag: {
            status: vectorRagCheck?.enabled ? 'ready' : 'disabled',
            enabled: vectorRagCheck?.enabled ?? false,
            reason: vectorRagCheck?.reason ?? null,
            note: vectorRagCheck?.note ?? null,
        },
        warnings: deploymentStatus?.warnings,
        steps: [
            {
                id: 'read-manifest',
                title: 'Read the deployment manifest',
                status: 'completed',
                command: `${baseCommand} capabilities show`,
                purpose: 'Inspect enabled modules, actor profiles, transport options, and task routing hints.',
            },
            {
                id: 'read-status',
                title: 'Read the live deployment status',
                status: deploymentStatus ? 'completed' : 'blocked',
                command: `${baseCommand} capabilities status`,
                purpose: 'Confirm database connectivity and live transport, worker, and readiness state before mutating runtime state.',
                notes: deploymentStatus
                    ? [
                        `Overall status: ${deploymentStatus.overallStatus}.`,
                        ...(bootstrapCheck ? [`Bootstrap status: ${bootstrapCheck.status}; domain count: ${bootstrapCheck.domainCount}.`] : []),
                    ]
                    : ['Deployment status is unavailable, so runtime blockers cannot be confirmed yet.'],
            },
            {
                id: 'resolve-bootstrap-blocker',
                title: 'Resolve bootstrap blockers',
                status: !bootstrapCheck
                    ? 'blocked'
                    : bootstrapBlocked
                        ? 'ready'
                        : 'completed',
                command: bootstrapBlocked
                    ? `${baseCommand} mcp call guide_task --json '{"taskId":"bootstrap-workspace"}'`
                    : `${baseCommand} capabilities status`,
                purpose: 'If the install has no domains yet, hand off to the dedicated bootstrap recipe before creating schemas or content.',
                notes: bootstrapCheck
                    ? bootstrapBlocked
                        ? [
                            bootstrapCheck.nextAction,
                            bootstrapCheck.note,
                            ...(bootstrapCheck.recommendedGuideTask
                                ? [`Recommended guide task: ${bootstrapCheck.recommendedGuideTask}.`]
                                : []),
                        ]
                        : ['Bootstrap prerequisites are already satisfied for content writes.']
                    : ['Bootstrap readiness is unavailable until deployment status can be read.'],
            },
            {
                id: 'confirm-write-actor',
                title: 'Confirm a write-capable actor',
                status: !authCheck
                    ? 'blocked'
                    : writeBlocked
                        ? 'ready'
                        : 'completed',
                command: buildWhoAmICommand(currentActor, baseCommand),
                purpose: 'Verify whether the current actor can mutate runtime state or whether a stronger credential is still required.',
                notes: authCheck
                    ? [
                        authCheck.note,
                        writeBlocked
                            ? `Current actor ${currentActor?.actorId ?? 'unknown'} is discovery-only for write operations.`
                            : `Current actor ${currentActor?.actorId ?? 'unknown'} can satisfy the current write posture.`,
                    ]
                    : ['Auth posture is unavailable until deployment status can be read.'],
            },
            {
                id: 'check-semantic-search-posture',
                title: 'Check semantic search posture',
                status: !vectorRagCheck
                    ? 'blocked'
                    : vectorRagCheck.enabled
                        ? 'completed'
                        : 'optional',
                command: `${baseCommand} capabilities status`,
                purpose: 'Confirm whether semantic search is available now, or whether OPENAI_API_KEY still needs to be configured before RAG verification.',
                notes: vectorRagCheck
                    ? [
                        vectorRagCheck.note,
                        ...(vectorRagCheck.enabled ? [] : [`Current reason: ${vectorRagCheck.reason}.`]),
                    ]
                    : ['Vector RAG readiness is unavailable until deployment status can be read.'],
            },
        ],
    };
}
