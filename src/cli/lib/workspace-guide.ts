import type { CurrentActorSnapshot } from '../../services/actor-identity.js';
import type { WorkspaceContextSnapshot } from '../../services/workspace-context.js';

export type WorkspaceGuideStep = {
    id: string;
    title: string;
    status: 'completed' | 'ready' | 'blocked' | 'optional';
    command: string | null;
    purpose: string;
    notes?: string[];
};

export type WorkspaceGuide = {
    taskId: 'discover-workspace';
    currentActor: CurrentActorSnapshot | null;
    actorReadiness: {
        status: 'ready' | 'blocked';
        notes: string[];
    };
    workspace: WorkspaceContextSnapshot | null;
    warnings?: string[];
    steps: WorkspaceGuideStep[];
};

export function buildWorkspaceGuide(options: {
    currentActor?: CurrentActorSnapshot | null;
    workspace?: WorkspaceContextSnapshot | null;
    baseCommand?: string;
}): WorkspaceGuide {
    const currentActor = options.currentActor ?? null;
    const workspace = options.workspace ?? null;
    const baseCommand = options.baseCommand ?? 'node dist/cli/index.js';
    const actorNotes: string[] = [];

    if (!currentActor) {
        actorNotes.push('No authenticated actor snapshot is available yet.');
    } else {
        actorNotes.push(`Current actor ${currentActor.actorId} is using profile ${currentActor.actorProfileId} in domain ${currentActor.domainId}.`);
        actorNotes.push(`Assignment refs: ${currentActor.assignmentRefs.join(', ')}.`);
    }

    const recommendedAuthoringTarget = workspace?.targets.authoring[0] ?? null;
    const recommendedReviewTarget = workspace?.targets.review[0] ?? null;

    return {
        taskId: 'discover-workspace',
        currentActor,
        actorReadiness: {
            status: currentActor ? 'ready' : 'blocked',
            notes: actorNotes,
        },
        workspace,
        warnings: workspace?.warnings,
        steps: [
            {
                id: 'confirm-actor',
                title: 'Confirm the current actor',
                status: currentActor ? 'completed' : 'blocked',
                command: `${baseCommand} capabilities whoami`,
                purpose: 'Verify the credential, domain, and scope set that will be used for workspace discovery.',
            },
            {
                id: 'read-workspace-context',
                title: 'Read the workspace context',
                status: workspace ? 'completed' : 'blocked',
                command: `${baseCommand} workspace guide`,
                purpose: 'Inspect the current domain, accessible domains, and content models available to the current actor.',
                notes: workspace
                    ? [
                        `${workspace.summary.totalContentTypes} content type(s), ${workspace.summary.contentTypesWithContent} with stored content.`,
                        `${workspace.summary.workflowEnabledContentTypes} model(s) have active workflows and ${workspace.summary.pendingReviewTaskCount} pending review task(s) are mapped into this domain.`,
                        ...(workspace.filter.intent !== 'all' || workspace.filter.search
                            ? [`Filter: intent=${workspace.filter.intent}${workspace.filter.search ? `, search="${workspace.filter.search}"` : ''}. ${workspace.filter.returnedContentTypes} returned from ${workspace.filter.totalContentTypesBeforeFilter} total model(s).`]
                            : []),
                    ]
                    : ['Workspace context is unavailable until an authenticated actor can read the active domain.'],
            },
            {
                id: 'choose-authoring-target',
                title: 'Choose an authoring target',
                status: recommendedAuthoringTarget ? 'ready' : 'blocked',
                command: recommendedAuthoringTarget
                    ? `${baseCommand} content guide --content-type-id ${recommendedAuthoringTarget.id}`
                    : null,
                purpose: 'Select a schema before drafting content, so the next guide can explain required fields and workflow behavior.',
                notes: recommendedAuthoringTarget
                    ? [
                        `Start with ${recommendedAuthoringTarget.name} (${recommendedAuthoringTarget.slug}).`,
                        recommendedAuthoringTarget.reason,
                    ]
                    : ['No content models are currently defined in the active domain.'],
            },
            {
                id: 'review-backlog',
                title: 'Inspect workflow backlog',
                status: workspace && workspace.summary.pendingReviewTaskCount > 0 ? 'ready' : 'optional',
                command: `${baseCommand} workflow guide`,
                purpose: 'Review pending tasks after you know which models have active workflows.',
                notes: workspace
                    ? [
                        `${workspace.summary.pendingReviewTaskCount} pending review task(s) are currently mapped into the active domain.`,
                        ...(recommendedReviewTarget
                            ? [`Highest-priority backlog target: ${recommendedReviewTarget.name}. ${recommendedReviewTarget.reason}`]
                            : []),
                    ]
                    : undefined,
            },
        ],
    };
}
