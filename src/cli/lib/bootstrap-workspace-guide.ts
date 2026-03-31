import type { CurrentActorSnapshot } from '../../services/actor-identity.js';
import type { DeploymentStatusSnapshot } from '../../services/deployment-status.js';

export type BootstrapWorkspaceGuideStep = {
    id: string;
    title: string;
    status: 'completed' | 'ready' | 'blocked' | 'optional';
    command: string | null;
    purpose: string;
    notes?: string[];
};

export type BootstrapWorkspaceGuide = {
    taskId: 'bootstrap-workspace';
    currentActor: CurrentActorSnapshot | null;
    deploymentStatus: DeploymentStatusSnapshot | null;
    actorReadiness: {
        status: 'ready' | 'blocked' | 'warning';
        notes: string[];
    };
    bootstrap: {
        status: 'ready' | 'blocked';
        domainCount: number | null;
        contentWritesRequireDomain: boolean;
        supportsInBandDomainCreation: boolean;
        restCreateDomainPath: string | null;
        mcpCreateDomainTool: string | null;
        recommendedGuideTask: string | null;
        note: string | null;
    };
    warnings?: string[];
    steps: BootstrapWorkspaceGuideStep[];
};

function buildWhoAmICommand(currentActor: CurrentActorSnapshot | null, baseCommand: string) {
    if (currentActor?.actorProfileId === 'mcp-local') {
        return `${baseCommand} mcp whoami`;
    }

    return `${baseCommand} capabilities whoami`;
}

function buildCreateDomainCommand(
    bootstrapCheck: DeploymentStatusSnapshot['checks']['bootstrap'] | null,
    baseCommand: string,
) {
    if (bootstrapCheck?.restCreateDomainPath) {
        return `${baseCommand} domains create --name "Local Dev" --hostname local-dev.example.test`;
    }

    if (bootstrapCheck?.mcpCreateDomainTool) {
        return `${baseCommand} mcp call ${bootstrapCheck.mcpCreateDomainTool} --json '{"name":"Local Dev","hostname":"local-dev.example.test"}'`;
    }

    return null;
}

export function buildBootstrapWorkspaceGuide(options: {
    currentActor?: CurrentActorSnapshot | null;
    deploymentStatus?: DeploymentStatusSnapshot | null;
    baseCommand?: string;
}): BootstrapWorkspaceGuide {
    const baseCommand = options.baseCommand ?? 'node dist/cli/index.js';
    const currentActor = options.currentActor ?? null;
    const deploymentStatus = options.deploymentStatus ?? null;
    const bootstrapCheck = deploymentStatus?.checks.bootstrap ?? null;
    const domainCount = bootstrapCheck?.domainCount ?? null;
    const bootstrapReady = domainCount !== null && domainCount > 0;
    const isPlatformAdminActor = currentActor
        ? currentActor.scopes.includes('tenant:admin')
            || (currentActor.scopes.includes('admin') && currentActor.actorProfileId !== 'api-key')
        : false;
    const actorReadinessNotes: string[] = [];

    if (!currentActor) {
        actorReadinessNotes.push('No authenticated actor snapshot is available yet.');
    } else {
        actorReadinessNotes.push(`Current actor ${currentActor.actorId} is using profile ${currentActor.actorProfileId} in domain ${currentActor.domainId}.`);
        if (!isPlatformAdminActor) {
            actorReadinessNotes.push('Additional domains require a platform-admin actor such as a supervisor session, env-backed admin key, or local bootstrap admin once the first domain already exists.');
        }
        if (domainCount === 0) {
            actorReadinessNotes.push('The current domain reference is only a placeholder until the first domain is created.');
        }
    }

    const actorReadinessStatus = !currentActor
        ? 'blocked'
        : !isPlatformAdminActor && bootstrapReady
            ? 'warning'
            : 'ready';
    const createDomainCommand = buildCreateDomainCommand(bootstrapCheck, baseCommand);
    const createDomainNotes = !bootstrapCheck
        ? ['Bootstrap readiness is unavailable until deployment status can be read.']
        : bootstrapReady
            ? [
                `${bootstrapCheck.domainCount} domain(s) already exist, so first-domain bootstrap is complete.`,
                isPlatformAdminActor
                    ? 'Use the same path only if you intentionally need an additional domain.'
                    : 'Use a platform-admin actor before creating additional domains.',
            ]
            : [
                bootstrapCheck.note,
                'Preferred local CLI path: domains create.',
                ...(bootstrapCheck.mcpCreateDomainTool
                    ? [`MCP alternative: ${bootstrapCheck.mcpCreateDomainTool}.`]
                    : []),
                ...(bootstrapCheck.restCreateDomainPath
                    ? [`REST fallback: POST ${bootstrapCheck.restCreateDomainPath}.`]
                    : []),
            ];

    return {
        taskId: 'bootstrap-workspace',
        currentActor,
        deploymentStatus,
        actorReadiness: {
            status: actorReadinessStatus,
            notes: actorReadinessNotes,
        },
        bootstrap: {
            status: bootstrapReady ? 'ready' : 'blocked',
            domainCount,
            contentWritesRequireDomain: bootstrapCheck?.contentWritesRequireDomain ?? true,
            supportsInBandDomainCreation: bootstrapCheck?.supportsInBandDomainCreation ?? false,
            restCreateDomainPath: bootstrapCheck?.restCreateDomainPath ?? null,
            mcpCreateDomainTool: bootstrapCheck?.mcpCreateDomainTool ?? null,
            recommendedGuideTask: bootstrapCheck?.recommendedGuideTask ?? null,
            note: bootstrapCheck?.note ?? null,
        },
        warnings: deploymentStatus?.warnings,
        steps: [
            {
                id: 'read-deployment-status',
                title: 'Read the live deployment status',
                status: deploymentStatus ? 'completed' : 'blocked',
                command: `${baseCommand} capabilities status`,
                purpose: 'Confirm whether the install already has a provisioned domain and whether content writes are currently blocked.',
                notes: deploymentStatus
                    ? [
                        `Overall status: ${deploymentStatus.overallStatus}.`,
                        ...(bootstrapCheck ? [`Bootstrap status: ${bootstrapCheck.status}; domain count: ${bootstrapCheck.domainCount}.`] : []),
                    ]
                    : ['Deployment status is unavailable, so bootstrap decisions cannot be confirmed yet.'],
            },
            {
                id: 'confirm-actor',
                title: 'Confirm the current actor',
                status: currentActor ? 'completed' : 'blocked',
                command: buildWhoAmICommand(currentActor, baseCommand),
                purpose: 'Verify which profile, scopes, and domain context will execute the bootstrap step.',
                notes: actorReadinessNotes,
            },
            {
                id: 'create-domain',
                title: 'Create the first domain',
                status: !bootstrapCheck
                    ? 'blocked'
                    : bootstrapReady
                        ? 'completed'
                        : 'ready',
                command: createDomainCommand,
                purpose: 'Provision the workspace bootstrap tenant before attempting schema or content mutations.',
                notes: createDomainNotes,
            },
            {
                id: 'verify-bootstrap',
                title: 'Verify bootstrap readiness',
                status: !deploymentStatus
                    ? 'blocked'
                    : bootstrapReady
                        ? 'completed'
                        : 'blocked',
                command: `${baseCommand} capabilities status`,
                purpose: 'Re-read deployment status until domainCount is non-zero and content writes are no longer blocked by bootstrap.',
                notes: bootstrapReady
                    ? ['Bootstrap prerequisites are already satisfied for content writes.']
                    : ['This step remains blocked until the first domain has been created.'],
            },
            {
                id: 'handoff-discover-workspace',
                title: 'Hand off to workspace discovery',
                status: bootstrapReady ? 'ready' : 'blocked',
                command: `${baseCommand} mcp call guide_task --json '{"taskId":"discover-workspace"}'`,
                purpose: 'Inspect the active domain and content-model inventory before authoring or review tasks.',
                notes: bootstrapReady
                    ? ['Use discover-workspace immediately after bootstrap to confirm which models and review targets are actionable.']
                    : ['Bootstrap the first domain before discovering the workspace.'],
            },
        ],
    };
}
