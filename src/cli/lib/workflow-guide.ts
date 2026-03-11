import type { CurrentActorSnapshot } from '../../services/actor-identity.js';

type WorkflowTaskRow = {
    task: {
        id: number;
        contentItemId: number;
        workflowTransitionId: number;
        status: string;
        assignee: string | null;
        createdAt?: string;
        updatedAt?: string;
    };
    transition: {
        id: number;
        fromState: string;
        toState: string;
        requiredRoles?: string[];
    };
    workflow: {
        id: number;
        name: string;
    };
    contentItem: {
        id: number;
        status?: string;
        version?: number;
    };
    contentType: {
        id: number;
        name: string;
        slug: string;
    };
};

export type WorkflowGuideTask = {
    taskId: number;
    contentItemId: number;
    workflowTransitionId: number;
    assignee: string | null;
    workflow: {
        id: number;
        name: string;
    };
    transition: {
        fromState: string;
        toState: string;
        requiredRoles: string[];
    };
    contentType: {
        id: number;
        name: string;
        slug: string;
    };
    submittedAt: string | null;
    decisionReadiness: {
        status: 'ready' | 'blocked';
        canDecide: boolean;
        reason: 'admin' | 'assignee' | 'unsupported-actor' | 'missing-scope' | 'different-assignee' | 'unassigned' | 'no-actor';
        notes: string[];
    };
    recommendedCommands: {
        approve: string | null;
        reject: string | null;
    };
};

export type WorkflowGuide = {
    taskId: number | null;
    requiredActorProfiles: Array<'api-key' | 'env-key' | 'supervisor-session' | 'mcp-local'>;
    requiredScopes: string[];
    currentActor: CurrentActorSnapshot | null;
    actorReadiness: {
        status: 'ready' | 'blocked';
        supportedActorProfile: boolean;
        requiredScopesSatisfied: boolean;
        notes: string[];
    };
    summary: {
        pendingTasks: number;
        actionableTasks: number;
        blockedTasks: number;
    };
    tasks: WorkflowGuideTask[];
    warnings?: string[];
};

function buildDecisionReadiness(options: {
    currentActor: CurrentActorSnapshot | null;
    task: WorkflowTaskRow;
    actorReady: boolean;
}): WorkflowGuideTask['decisionReadiness'] {
    const { currentActor, task, actorReady } = options;

    if (!currentActor) {
        return {
            status: 'blocked',
            canDecide: false,
            reason: 'no-actor',
            notes: ['No authenticated actor snapshot is available yet.'],
        };
    }

    if (!actorReady) {
        return {
            status: 'blocked',
            canDecide: false,
            reason: currentActor.scopes.includes('admin') || currentActor.scopes.includes('content:write')
                ? 'unsupported-actor'
                : 'missing-scope',
            notes: ['The current actor does not satisfy the workflow review profile or scope requirements.'],
        };
    }

    const isAdmin = currentActor.scopes.includes('admin');
    if (isAdmin) {
        return {
            status: 'ready',
            canDecide: true,
            reason: 'admin',
            notes: ['Admin scope can approve or reject any pending review task in the active domain.'],
        };
    }

    if (!task.task.assignee) {
        return {
            status: 'blocked',
            canDecide: false,
            reason: 'unassigned',
            notes: ['This task is unassigned. A non-admin actor cannot decide it until an explicit assignee is set.'],
        };
    }

    if (currentActor.assignmentRefs.includes(task.task.assignee)) {
        return {
            status: 'ready',
            canDecide: true,
            reason: 'assignee',
            notes: [`The task is assigned to ${task.task.assignee}, which matches the current actor.`],
        };
    }

    return {
        status: 'blocked',
        canDecide: false,
        reason: 'different-assignee',
        notes: [`The task is assigned to ${task.task.assignee}, not one of the current actor assignment refs.`],
    };
}

export function buildWorkflowGuide(options: {
    tasks: WorkflowTaskRow[];
    currentActor?: CurrentActorSnapshot | null;
    preferredTaskId?: number;
    baseCommand?: string;
}): WorkflowGuide {
    const currentActor = options.currentActor ?? null;
    const baseCommand = options.baseCommand ?? 'node dist/cli/index.js';
    const requiredActorProfiles: Array<'api-key' | 'env-key' | 'supervisor-session' | 'mcp-local'> = [
        'api-key',
        'env-key',
        'supervisor-session',
        'mcp-local',
    ];
    const requiredScopes = ['content:write'];
    const supportedActorProfile = currentActor
        ? requiredActorProfiles.includes(currentActor.actorProfileId as typeof requiredActorProfiles[number])
        : false;
    const requiredScopesSatisfied = currentActor
        ? currentActor.scopes.includes('admin') || requiredScopes.every((scope) => currentActor.scopes.includes(scope))
        : false;
    const actorReady = Boolean(currentActor && supportedActorProfile && requiredScopesSatisfied);
    const actorNotes: string[] = [];

    if (!currentActor) {
        actorNotes.push('No authenticated actor snapshot is available yet.');
    } else {
        actorNotes.push(`Current actor ${currentActor.actorId} is using profile ${currentActor.actorProfileId} in domain ${currentActor.domainId}.`);
        actorNotes.push(`Assignment refs: ${currentActor.assignmentRefs.join(', ')}.`);
        if (!supportedActorProfile) {
            actorNotes.push('Workflow review requires an API key, supervisor session, or local MCP actor profile.');
        }
        if (!requiredScopesSatisfied) {
            actorNotes.push('The current actor is missing content:write or admin scope for review task actions.');
        }
    }

    const filteredTasks = options.preferredTaskId === undefined
        ? options.tasks
        : options.tasks.filter((task) => task.task.id === options.preferredTaskId);

    const tasks = filteredTasks.map((entry) => {
        const decisionReadiness = buildDecisionReadiness({
            currentActor,
            task: entry,
            actorReady,
        });

        return {
            taskId: entry.task.id,
            contentItemId: entry.task.contentItemId,
            workflowTransitionId: entry.task.workflowTransitionId,
            assignee: entry.task.assignee,
            workflow: entry.workflow,
            transition: {
                fromState: entry.transition.fromState,
                toState: entry.transition.toState,
                requiredRoles: entry.transition.requiredRoles ?? [],
            },
            contentType: entry.contentType,
            submittedAt: entry.task.createdAt ?? null,
            decisionReadiness,
            recommendedCommands: {
                approve: decisionReadiness.canDecide
                    ? `${baseCommand} workflow decide --id ${entry.task.id} --decision approved`
                    : null,
                reject: decisionReadiness.canDecide
                    ? `${baseCommand} workflow decide --id ${entry.task.id} --decision rejected`
                    : null,
            },
        };
    });

    return {
        taskId: options.preferredTaskId ?? null,
        requiredActorProfiles,
        requiredScopes,
        currentActor,
        actorReadiness: {
            status: actorReady ? 'ready' : 'blocked',
            supportedActorProfile,
            requiredScopesSatisfied,
            notes: actorNotes,
        },
        summary: {
            pendingTasks: tasks.length,
            actionableTasks: tasks.filter((task) => task.decisionReadiness.canDecide).length,
            blockedTasks: tasks.filter((task) => !task.decisionReadiness.canDecide).length,
        },
        tasks,
    };
}
