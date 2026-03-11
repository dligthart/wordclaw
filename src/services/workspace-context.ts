import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db/index.js';
import {
    contentItems,
    contentTypes,
    domains,
    offers,
    reviewTasks,
    workflowTransitions,
    workflows,
} from '../db/schema.js';
import type { CurrentActorSnapshot } from './actor-identity.js';

type WorkspaceDomainSummary = {
    id: number;
    name: string;
    hostname: string;
    current: boolean;
};

type WorkspaceContentTypeSummary = {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    fieldCount: number;
    requiredFieldCount: number;
    itemCount: number;
    hasContent: boolean;
    pendingReviewTaskCount: number;
    lastItemUpdatedAt: string | null;
    paid: {
        basePrice: number | null;
        activeTypeOfferCount: number;
        lowestTypeOfferSats: number | null;
    };
    workflow: {
        activeWorkflowCount: number;
        activeWorkflows: Array<{
            id: number;
            name: string;
            transitionCount: number;
        }>;
    };
    recommendedCommands: {
        contentGuide: string;
        listContent: string;
        workflowActive: string;
    };
};

type WorkspaceTargetSummary = {
    id: number;
    name: string;
    slug: string;
    itemCount: number;
    pendingReviewTaskCount: number;
    activeWorkflowCount: number;
    activeTypeOfferCount: number;
    reason: string;
    recommendedCommands: {
        contentGuide: string;
        listContent: string;
        workflowActive: string;
    };
};

type WorkspaceWorkTargetStatus = 'ready' | 'warning' | 'blocked';

type WorkspaceWorkTarget = {
    kind: 'content-type' | 'review-task' | 'workflow' | 'paid-content-item';
    status: WorkspaceWorkTargetStatus;
    label: string;
    reason: string;
    notes: string[];
    recommendedCommands: string[];
    contentType: {
        id: number;
        name: string;
        slug: string;
    };
    contentItem: {
        id: number;
        label: string;
        status: string;
        version: number;
        slug: string | null;
        createdAt: string;
        updatedAt: string;
    } | null;
    reviewTask: {
        id: number;
        status: string;
        assignee: string | null;
        workflowTransitionId: number;
        actionable: boolean;
        fromState: string;
        toState: string;
    } | null;
    workflow: {
        id: number;
        name: string;
        transitionCount: number;
    } | null;
    paid: {
        activeOfferCount: number;
        lowestOfferSats: number | null;
        offerScope: 'item' | 'type' | 'mixed' | 'none';
    } | null;
};

export type WorkspaceDiscoveryIntent = 'all' | 'authoring' | 'review' | 'workflow' | 'paid';
export type WorkspaceTargetIntent = Exclude<WorkspaceDiscoveryIntent, 'all'>;

export type WorkspaceContextOptions = {
    intent?: WorkspaceDiscoveryIntent;
    search?: string | null;
    limit?: number | null;
    targetLimit?: number | null;
};

export type WorkspaceContextSnapshot = {
    generatedAt: string;
    currentActor: CurrentActorSnapshot;
    currentDomain: WorkspaceDomainSummary;
    accessibleDomains: WorkspaceDomainSummary[];
    filter: {
        intent: WorkspaceDiscoveryIntent;
        search: string | null;
        limit: number | null;
        totalContentTypesBeforeFilter: number;
        totalContentTypesAfterSearch: number;
        returnedContentTypes: number;
    };
    summary: {
        totalContentTypes: number;
        contentTypesWithContent: number;
        workflowEnabledContentTypes: number;
        paidContentTypes: number;
        pendingReviewTaskCount: number;
    };
    targets: {
        authoring: WorkspaceTargetSummary[];
        review: WorkspaceTargetSummary[];
        workflow: WorkspaceTargetSummary[];
        paid: WorkspaceTargetSummary[];
    };
    contentTypes: WorkspaceContentTypeSummary[];
    warnings: string[];
};

export type ResolvedWorkspaceTarget = WorkspaceTargetSummary & {
    rank: number;
    contentType: WorkspaceContentTypeSummary | null;
    workTarget: WorkspaceWorkTarget | null;
};

export type WorkspaceTargetResolution = {
    generatedAt: string;
    currentActor: CurrentActorSnapshot;
    currentDomain: WorkspaceDomainSummary;
    intent: WorkspaceTargetIntent;
    search: string | null;
    availableTargetCount: number;
    target: ResolvedWorkspaceTarget | null;
    alternatives: ResolvedWorkspaceTarget[];
    warnings: string[];
};

function summarizeSchema(rawSchema: string): {
    fieldCount: number;
    requiredFieldCount: number;
} {
    try {
        const parsed = JSON.parse(rawSchema) as {
            properties?: Record<string, unknown>;
            required?: unknown[];
        };
        const properties = typeof parsed.properties === 'object' && parsed.properties !== null
            ? Object.keys(parsed.properties)
            : [];
        const required = Array.isArray(parsed.required)
            ? parsed.required.filter((entry): entry is string => typeof entry === 'string')
            : [];

        return {
            fieldCount: properties.length,
            requiredFieldCount: required.length,
        };
    } catch {
        return {
            fieldCount: 0,
            requiredFieldCount: 0,
        };
    }
}

function toOptionalIso(value: Date | null | undefined): string | null {
    return value instanceof Date ? value.toISOString() : null;
}

function compareByNameThenId(left: { name: string; id: number }, right: { name: string; id: number }) {
    return left.name.localeCompare(right.name) || left.id - right.id;
}

function buildFallbackDomain(domainId: number): WorkspaceDomainSummary {
    return {
        id: domainId,
        name: `Domain ${domainId}`,
        hostname: '',
        current: true,
    };
}

function compareNullableNumberAsc(left: number | null, right: number | null) {
    if (left === null && right === null) {
        return 0;
    }
    if (left === null) {
        return 1;
    }
    if (right === null) {
        return -1;
    }
    return left - right;
}

function toIso(value: Date): string {
    return value.toISOString();
}

function extractStringField(record: Record<string, unknown>, field: string): string | null {
    const value = record[field];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function summarizeContentItem(data: string, itemId: number) {
    try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const label = extractStringField(parsed, 'title')
            ?? extractStringField(parsed, 'name')
            ?? extractStringField(parsed, 'headline')
            ?? extractStringField(parsed, 'subject')
            ?? extractStringField(parsed, 'label')
            ?? `Content item #${itemId}`;
        const slug = extractStringField(parsed, 'slug');

        return { label, slug };
    } catch {
        return {
            label: `Content item #${itemId}`,
            slug: null,
        };
    }
}

function supportsWriteActorProfile(currentActor: CurrentActorSnapshot) {
    return ['api-key', 'env-key', 'supervisor-session', 'mcp-local'].includes(currentActor.actorProfileId);
}

function canWrite(currentActor: CurrentActorSnapshot) {
    return currentActor.scopes.includes('admin') || currentActor.scopes.includes('content:write');
}

function canReadPaid(currentActor: CurrentActorSnapshot) {
    return currentActor.scopes.includes('admin') || currentActor.scopes.includes('content:read');
}

function canActOnReviewTask(currentActor: CurrentActorSnapshot, assignee: string | null) {
    if (!supportsWriteActorProfile(currentActor) || !canWrite(currentActor)) {
        return false;
    }

    if (currentActor.scopes.includes('admin')) {
        return true;
    }

    if (!assignee) {
        return false;
    }

    return currentActor.assignmentRefs.includes(assignee);
}

function buildTargetReason(type: WorkspaceContentTypeSummary, mode: 'authoring' | 'review' | 'workflow' | 'paid'): string {
    if (mode === 'review') {
        return `${type.pendingReviewTaskCount} pending review task(s) across ${type.itemCount} stored item(s).`;
    }

    if (mode === 'paid') {
        if (type.paid.lowestTypeOfferSats !== null) {
            return `${type.paid.activeTypeOfferCount} active type offer(s), starting at ${type.paid.lowestTypeOfferSats} sats.`;
        }
        return `${type.paid.activeTypeOfferCount} active type offer(s) are attached to this schema.`;
    }

    if (mode === 'workflow') {
        return `${type.workflow.activeWorkflowCount} active workflow(s) and ${type.pendingReviewTaskCount} pending review task(s) are mapped to this schema.`;
    }

    if (type.hasContent && type.workflow.activeWorkflowCount > 0) {
        return `${type.itemCount} stored item(s) and ${type.workflow.activeWorkflowCount} active workflow(s) make this a strong authoring target.`;
    }
    if (type.hasContent) {
        return `${type.itemCount} stored item(s) already exist for this schema, so an agent can infer the expected content shape quickly.`;
    }
    if (type.workflow.activeWorkflowCount > 0) {
        return `${type.workflow.activeWorkflowCount} active workflow(s) are ready even though this schema has no stored items yet.`;
    }
    return 'This schema is available for new drafts in the active domain.';
}

function toTargetSummary(type: WorkspaceContentTypeSummary, mode: 'authoring' | 'review' | 'workflow' | 'paid'): WorkspaceTargetSummary {
    return {
        id: type.id,
        name: type.name,
        slug: type.slug,
        itemCount: type.itemCount,
        pendingReviewTaskCount: type.pendingReviewTaskCount,
        activeWorkflowCount: type.workflow.activeWorkflowCount,
        activeTypeOfferCount: type.paid.activeTypeOfferCount,
        reason: buildTargetReason(type, mode),
        recommendedCommands: type.recommendedCommands,
    };
}

function matchesSearch(type: WorkspaceContentTypeSummary, search: string | null) {
    if (!search) {
        return true;
    }

    const query = search.toLowerCase();
    return [
        type.name,
        type.slug,
        type.description ?? '',
    ].some((value) => value.toLowerCase().includes(query));
}

function buildWorkspaceTargets(summaries: WorkspaceContentTypeSummary[], limit: number | null) {
    const targetLimit = limit ?? 8;
    const authoring = [...summaries]
        .sort((left, right) => (
            Number(right.hasContent) - Number(left.hasContent)
            || right.workflow.activeWorkflowCount - left.workflow.activeWorkflowCount
            || right.itemCount - left.itemCount
            || compareByNameThenId(left, right)
        ))
        .slice(0, targetLimit)
        .map((summary) => toTargetSummary(summary, 'authoring'));

    const review = summaries
        .filter((summary) => summary.pendingReviewTaskCount > 0)
        .sort((left, right) => (
            right.pendingReviewTaskCount - left.pendingReviewTaskCount
            || right.workflow.activeWorkflowCount - left.workflow.activeWorkflowCount
            || right.itemCount - left.itemCount
            || compareByNameThenId(left, right)
        ))
        .slice(0, targetLimit)
        .map((summary) => toTargetSummary(summary, 'review'));

    const workflow = summaries
        .filter((summary) => summary.workflow.activeWorkflowCount > 0)
        .sort((left, right) => (
            right.workflow.activeWorkflowCount - left.workflow.activeWorkflowCount
            || right.pendingReviewTaskCount - left.pendingReviewTaskCount
            || right.itemCount - left.itemCount
            || compareByNameThenId(left, right)
        ))
        .slice(0, targetLimit)
        .map((summary) => toTargetSummary(summary, 'workflow'));

    const paid = summaries
        .filter((summary) => summary.paid.activeTypeOfferCount > 0 || summary.paid.basePrice !== null)
        .sort((left, right) => (
            right.paid.activeTypeOfferCount - left.paid.activeTypeOfferCount
            || compareNullableNumberAsc(left.paid.lowestTypeOfferSats, right.paid.lowestTypeOfferSats)
            || right.itemCount - left.itemCount
            || compareByNameThenId(left, right)
        ))
        .slice(0, targetLimit)
        .map((summary) => toTargetSummary(summary, 'paid'));

    return { authoring, review, workflow, paid };
}

async function resolveWorkTargetForContentType(
    currentActor: CurrentActorSnapshot,
    intent: WorkspaceTargetIntent,
    contentType: WorkspaceContentTypeSummary,
    target: WorkspaceTargetSummary,
): Promise<WorkspaceWorkTarget | null> {
    if (intent === 'authoring') {
        const workflow = [...contentType.workflow.activeWorkflows]
            .sort((left, right) => right.transitionCount - left.transitionCount || compareByNameThenId(left, right))[0] ?? null;
        const ready = supportsWriteActorProfile(currentActor) && canWrite(currentActor);

        return {
            kind: 'content-type',
            status: ready ? 'ready' : 'blocked',
            label: `Create a new draft in ${contentType.name}`,
            reason: ready
                ? 'This schema is ready for authoring in the active domain.'
                : 'The current actor cannot create drafts for this schema yet.',
            notes: [
                target.reason,
                ready
                    ? 'Start with a dry-run create to validate the payload before persisting.'
                    : 'Use an actor with content:write or admin scope to author against this schema.',
            ],
            recommendedCommands: [
                `node dist/cli/index.js content guide --content-type-id ${contentType.id}`,
                `node dist/cli/index.js content create --content-type-id ${contentType.id} --data-file item.json --dry-run`,
                ...(workflow ? [`node dist/cli/index.js workflow active --content-type-id ${contentType.id}`] : []),
            ],
            contentType: {
                id: contentType.id,
                name: contentType.name,
                slug: contentType.slug,
            },
            contentItem: null,
            reviewTask: null,
            workflow: workflow
                ? {
                    id: workflow.id,
                    name: workflow.name,
                    transitionCount: workflow.transitionCount,
                }
                : null,
            paid: null,
        };
    }

    const itemRows = await db.select({
        id: contentItems.id,
        contentTypeId: contentItems.contentTypeId,
        data: contentItems.data,
        status: contentItems.status,
        version: contentItems.version,
        createdAt: contentItems.createdAt,
        updatedAt: contentItems.updatedAt,
    }).from(contentItems).where(and(
        eq(contentItems.domainId, currentActor.domainId),
        eq(contentItems.contentTypeId, contentType.id),
    ));

    const workflowsForType = await db.select({
        id: workflows.id,
        name: workflows.name,
        contentTypeId: workflows.contentTypeId,
    }).from(workflows).where(and(
        eq(workflows.domainId, currentActor.domainId),
        eq(workflows.contentTypeId, contentType.id),
        eq(workflows.active, true),
    ));

    const transitionRows = workflowsForType.length > 0
        ? await db.select({
            id: workflowTransitions.id,
            workflowId: workflowTransitions.workflowId,
            fromState: workflowTransitions.fromState,
            toState: workflowTransitions.toState,
        }).from(workflowTransitions).where(inArray(
            workflowTransitions.workflowId,
            workflowsForType.map((workflow) => workflow.id),
        ))
        : [];

    const pendingReviewTasks = itemRows.length > 0
        ? await db.select({
            id: reviewTasks.id,
            contentItemId: reviewTasks.contentItemId,
            workflowTransitionId: reviewTasks.workflowTransitionId,
            status: reviewTasks.status,
            assignee: reviewTasks.assignee,
            createdAt: reviewTasks.createdAt,
            updatedAt: reviewTasks.updatedAt,
        }).from(reviewTasks).where(and(
            eq(reviewTasks.domainId, currentActor.domainId),
            eq(reviewTasks.status, 'pending'),
            inArray(reviewTasks.contentItemId, itemRows.map((item) => item.id)),
        ))
        : [];

    const itemsById = new Map(itemRows.map((item) => [item.id, item]));
    const workflowById = new Map(workflowsForType.map((workflow) => [workflow.id, workflow]));
    const transitionById = new Map(transitionRows.map((transition) => [transition.id, transition]));

    if (intent === 'review' || intent === 'workflow') {
        const reviewCandidates = pendingReviewTasks
            .map((task) => {
                const item = itemsById.get(task.contentItemId);
                const transition = transitionById.get(task.workflowTransitionId);
                const workflow = transition ? workflowById.get(transition.workflowId) ?? null : null;
                if (!item || !transition || !workflow) {
                    return null;
                }

                const itemSummary = summarizeContentItem(item.data, item.id);
                const actionable = canActOnReviewTask(currentActor, task.assignee);

                return {
                    task,
                    item,
                    itemSummary,
                    transition,
                    workflow,
                    actionable,
                };
            })
            .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
            .sort((left, right) => (
                Number(right.actionable) - Number(left.actionable)
                || left.task.createdAt.getTime() - right.task.createdAt.getTime()
                || left.task.id - right.task.id
            ));

        if (reviewCandidates.length > 0) {
            const candidate = reviewCandidates[0];
            const status: WorkspaceWorkTargetStatus = candidate.actionable ? 'ready' : 'blocked';

            return {
                kind: 'review-task',
                status,
                label: `${candidate.itemSummary.label} (${candidate.transition.fromState} → ${candidate.transition.toState})`,
                reason: candidate.actionable
                    ? `Review task #${candidate.task.id} is actionable for the current actor.`
                    : candidate.task.assignee
                        ? `Review task #${candidate.task.id} is assigned to ${candidate.task.assignee}, so the current actor cannot decide it yet.`
                        : `Review task #${candidate.task.id} is unassigned, so a non-admin actor cannot decide it yet.`,
                notes: [
                    `Workflow: ${candidate.workflow.name}.`,
                    `Content item #${candidate.item.id} is currently ${candidate.item.status}.`,
                ],
                recommendedCommands: [
                    `node dist/cli/index.js workflow guide --task ${candidate.task.id}`,
                    ...(candidate.actionable
                        ? [`node dist/cli/index.js workflow decide --id ${candidate.task.id} --decision approved`]
                        : []),
                    `node dist/cli/index.js content get --id ${candidate.item.id}`,
                ],
                contentType: {
                    id: contentType.id,
                    name: contentType.name,
                    slug: contentType.slug,
                },
                contentItem: {
                    id: candidate.item.id,
                    label: candidate.itemSummary.label,
                    status: candidate.item.status,
                    version: candidate.item.version,
                    slug: candidate.itemSummary.slug,
                    createdAt: toIso(candidate.item.createdAt),
                    updatedAt: toIso(candidate.item.updatedAt),
                },
                reviewTask: {
                    id: candidate.task.id,
                    status: candidate.task.status,
                    assignee: candidate.task.assignee,
                    workflowTransitionId: candidate.task.workflowTransitionId,
                    actionable: candidate.actionable,
                    fromState: candidate.transition.fromState,
                    toState: candidate.transition.toState,
                },
                workflow: {
                    id: candidate.workflow.id,
                    name: candidate.workflow.name,
                    transitionCount: transitionRows.filter((transition) => transition.workflowId === candidate.workflow.id).length,
                },
                paid: null,
            };
        }

        if (intent === 'workflow' && workflowsForType.length > 0) {
            const workflow = [...workflowsForType]
                .sort((left, right) => (
                    transitionRows.filter((transition) => transition.workflowId === right.id).length
                    - transitionRows.filter((transition) => transition.workflowId === left.id).length
                    || compareByNameThenId(left, right)
                ))[0];
            const transitionCount = transitionRows.filter((transition) => transition.workflowId === workflow.id).length;
            const ready = supportsWriteActorProfile(currentActor) && canWrite(currentActor);

            return {
                kind: 'workflow',
                status: ready ? 'ready' : 'blocked',
                label: workflow.name,
                reason: ready
                    ? `Workflow ${workflow.name} is active for this schema.`
                    : `Workflow ${workflow.name} is active, but the current actor cannot operate it yet.`,
                notes: [
                    `${transitionCount} transition(s) are configured for this workflow.`,
                    target.reason,
                ],
                recommendedCommands: [
                    `node dist/cli/index.js workflow active --content-type-id ${contentType.id}`,
                    `node dist/cli/index.js content guide --content-type-id ${contentType.id}`,
                ],
                contentType: {
                    id: contentType.id,
                    name: contentType.name,
                    slug: contentType.slug,
                },
                contentItem: null,
                reviewTask: null,
                workflow: {
                    id: workflow.id,
                    name: workflow.name,
                    transitionCount,
                },
                paid: null,
            };
        }

        return null;
    }

    const activeOffers = await db.select({
        id: offers.id,
        scopeType: offers.scopeType,
        scopeRef: offers.scopeRef,
        priceSats: offers.priceSats,
    }).from(offers).where(and(
        eq(offers.domainId, currentActor.domainId),
        eq(offers.active, true),
    ));

    const typeOfferPrices = activeOffers
        .filter((offer) => offer.scopeType === 'type' && offer.scopeRef === contentType.id)
        .map((offer) => offer.priceSats);
    const directOfferPricesByItemId = new Map<number, number[]>();
    for (const offer of activeOffers) {
        if (offer.scopeType !== 'item' || typeof offer.scopeRef !== 'number') {
            continue;
        }
        const bucket = directOfferPricesByItemId.get(offer.scopeRef) ?? [];
        bucket.push(offer.priceSats);
        directOfferPricesByItemId.set(offer.scopeRef, bucket);
    }

    const paidCandidates = itemRows
        .map((item) => {
            const itemSummary = summarizeContentItem(item.data, item.id);
            const directOffers = directOfferPricesByItemId.get(item.id) ?? [];
            const allPrices = [...directOffers, ...typeOfferPrices];
            const activeOfferCount = directOffers.length + typeOfferPrices.length;
            const offerScope: WorkspaceWorkTarget['paid'] extends infer Paid
                ? Paid extends { offerScope: infer Scope } ? Scope : never
                : never = directOffers.length > 0 && typeOfferPrices.length > 0
                ? 'mixed'
                : directOffers.length > 0
                    ? 'item'
                    : typeOfferPrices.length > 0
                        ? 'type'
                        : 'none';

            return {
                item,
                itemSummary,
                activeOfferCount,
                lowestOfferSats: allPrices.length > 0 ? Math.min(...allPrices) : null,
                offerScope,
                hasOffer: allPrices.length > 0,
            };
        })
        .sort((left, right) => (
            Number(right.hasOffer) - Number(left.hasOffer)
            || Number(right.item.status === 'published') - Number(left.item.status === 'published')
            || right.item.updatedAt.getTime() - left.item.updatedAt.getTime()
            || right.item.id - left.item.id
        ));

    const paidCandidate = paidCandidates[0] ?? null;
    if (!paidCandidate) {
        return null;
    }

    const supportedProfile = ['api-key', 'env-key'].includes(currentActor.actorProfileId);
    const actorCanConsume = supportedProfile && canReadPaid(currentActor);
    const status: WorkspaceWorkTargetStatus = !paidCandidate.hasOffer || !actorCanConsume
        ? 'blocked'
        : currentActor.actorProfileId === 'env-key'
            ? 'warning'
            : 'ready';

    return {
        kind: 'paid-content-item',
        status,
        label: paidCandidate.itemSummary.label,
        reason: paidCandidate.hasOffer
            ? `Content item #${paidCandidate.item.id} has ${paidCandidate.activeOfferCount} active offer(s) available for paid reads.`
            : `Content item #${paidCandidate.item.id} belongs to a paid schema, but no active offers are attached yet.`,
        notes: [
            paidCandidate.hasOffer
                ? `Lowest available price: ${paidCandidate.lowestOfferSats} sats via ${paidCandidate.offerScope} offer(s).`
                : 'Create or activate an offer before attempting an L402 purchase flow.',
            actorCanConsume
                ? 'The current actor can attempt the paid-content flow.'
                : 'Use an API-key-backed actor with content:read or admin scope for paid-content flows.',
        ],
        recommendedCommands: [
            `node dist/cli/index.js l402 guide --item ${paidCandidate.item.id}`,
            `node dist/cli/index.js l402 offers --item ${paidCandidate.item.id}`,
            ...(paidCandidate.hasOffer && actorCanConsume
                ? [`node dist/cli/index.js l402 read --item ${paidCandidate.item.id} --entitlement-id <entitlementId>`]
                : []),
        ],
        contentType: {
            id: contentType.id,
            name: contentType.name,
            slug: contentType.slug,
        },
        contentItem: {
            id: paidCandidate.item.id,
            label: paidCandidate.itemSummary.label,
            status: paidCandidate.item.status,
            version: paidCandidate.item.version,
            slug: paidCandidate.itemSummary.slug,
            createdAt: toIso(paidCandidate.item.createdAt),
            updatedAt: toIso(paidCandidate.item.updatedAt),
        },
        reviewTask: null,
        workflow: null,
        paid: {
            activeOfferCount: paidCandidate.activeOfferCount,
            lowestOfferSats: paidCandidate.lowestOfferSats,
            offerScope: paidCandidate.offerScope,
        },
    };
}

function selectReturnedContentTypes(options: {
    intent: WorkspaceDiscoveryIntent;
    summaries: WorkspaceContentTypeSummary[];
    targets: ReturnType<typeof buildWorkspaceTargets>;
    limit: number | null;
}) {
    const { intent, summaries, targets, limit } = options;
    if (intent === 'all') {
        return limit === null ? summaries : summaries.slice(0, limit);
    }

    const ids = new Set(targets[intent].map((target) => target.id));
    const ordered = targets[intent]
        .map((target) => summaries.find((summary) => summary.id === target.id))
        .filter((summary): summary is WorkspaceContentTypeSummary => Boolean(summary));

    return limit === null ? ordered : ordered.filter((summary) => ids.has(summary.id)).slice(0, limit);
}

export async function getWorkspaceContextSnapshot(
    currentActor: CurrentActorSnapshot,
    options: WorkspaceContextOptions = {},
): Promise<WorkspaceContextSnapshot> {
    const warnings: string[] = [];
    const domainId = currentActor.domainId;
    const intent = options.intent ?? 'all';
    const normalizedSearch = options.search?.trim() ? options.search.trim() : null;
    const limit = typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
        ? Math.floor(options.limit)
        : null;
    const targetLimit = typeof options.targetLimit === 'number' && Number.isFinite(options.targetLimit) && options.targetLimit > 0
        ? Math.floor(options.targetLimit)
        : limit;

    const [currentDomainRow] = await db.select().from(domains).where(eq(domains.id, domainId));
    const currentDomain = currentDomainRow
        ? {
            id: currentDomainRow.id,
            name: currentDomainRow.name,
            hostname: currentDomainRow.hostname,
            current: true,
        }
        : buildFallbackDomain(domainId);

    if (!currentDomainRow) {
        warnings.push(`Current domain ${domainId} could not be resolved from the domains table. Using a fallback domain label.`);
    }

    const accessibleDomainsRows = currentActor.actorProfileId === 'supervisor-session'
        ? await db.select().from(domains)
        : [];
    const accessibleDomains = currentActor.actorProfileId === 'supervisor-session'
        ? accessibleDomainsRows
            .map((domain) => ({
                id: domain.id,
                name: domain.name,
                hostname: domain.hostname,
                current: domain.id === domainId,
            }))
            .sort(compareByNameThenId)
        : [currentDomain];

    if (currentActor.actorProfileId === 'supervisor-session' && !accessibleDomains.some((domain) => domain.id === domainId)) {
        accessibleDomains.unshift(currentDomain);
    }

    const typeRows = await db.select().from(contentTypes).where(eq(contentTypes.domainId, domainId));
    const itemRows = typeRows.length > 0
        ? await db.select({
            id: contentItems.id,
            contentTypeId: contentItems.contentTypeId,
            status: contentItems.status,
            updatedAt: contentItems.updatedAt,
        }).from(contentItems).where(eq(contentItems.domainId, domainId))
        : [];
    const activeWorkflowRows = typeRows.length > 0
        ? await db.select().from(workflows).where(and(
            eq(workflows.domainId, domainId),
            eq(workflows.active, true),
        ))
        : [];
    const transitionRows = activeWorkflowRows.length > 0
        ? await db.select({
            workflowId: workflowTransitions.workflowId,
        }).from(workflowTransitions).where(inArray(
            workflowTransitions.workflowId,
            activeWorkflowRows.map((workflow) => workflow.id),
        ))
        : [];
    const typeOfferRows = typeRows.length > 0
        ? await db.select({
            scopeRef: offers.scopeRef,
            priceSats: offers.priceSats,
        }).from(offers).where(and(
            eq(offers.domainId, domainId),
            eq(offers.active, true),
            eq(offers.scopeType, 'type'),
        ))
        : [];
    const pendingTaskRows = itemRows.length > 0
        ? await db.select({
            contentItemId: reviewTasks.contentItemId,
        }).from(reviewTasks).where(and(
            eq(reviewTasks.domainId, domainId),
            eq(reviewTasks.status, 'pending'),
        ))
        : [];

    const itemsByTypeId = new Map<number, Array<{
        id: number;
        status: string;
        updatedAt: Date;
    }>>();
    const itemTypeById = new Map<number, number>();
    for (const item of itemRows) {
        itemTypeById.set(item.id, item.contentTypeId);
        const bucket = itemsByTypeId.get(item.contentTypeId) ?? [];
        bucket.push({
            id: item.id,
            status: item.status,
            updatedAt: item.updatedAt,
        });
        itemsByTypeId.set(item.contentTypeId, bucket);
    }

    const workflowsByTypeId = new Map<number, Array<{
        id: number;
        name: string;
        transitionCount: number;
    }>>();
    const transitionCountByWorkflowId = new Map<number, number>();
    for (const row of transitionRows) {
        transitionCountByWorkflowId.set(
            row.workflowId,
            (transitionCountByWorkflowId.get(row.workflowId) ?? 0) + 1,
        );
    }
    for (const workflow of activeWorkflowRows) {
        const bucket = workflowsByTypeId.get(workflow.contentTypeId) ?? [];
        bucket.push({
            id: workflow.id,
            name: workflow.name,
            transitionCount: transitionCountByWorkflowId.get(workflow.id) ?? 0,
        });
        workflowsByTypeId.set(workflow.contentTypeId, bucket);
    }

    const offersByTypeId = new Map<number, Array<number>>();
    for (const offer of typeOfferRows) {
        if (typeof offer.scopeRef !== 'number') {
            continue;
        }
        const bucket = offersByTypeId.get(offer.scopeRef) ?? [];
        bucket.push(offer.priceSats);
        offersByTypeId.set(offer.scopeRef, bucket);
    }

    const pendingTaskCountByTypeId = new Map<number, number>();
    for (const task of pendingTaskRows) {
        const contentTypeId = itemTypeById.get(task.contentItemId);
        if (contentTypeId === undefined) {
            continue;
        }
        pendingTaskCountByTypeId.set(
            contentTypeId,
            (pendingTaskCountByTypeId.get(contentTypeId) ?? 0) + 1,
        );
    }

    const summaries = typeRows
        .map((type) => {
            const schemaSummary = summarizeSchema(type.schema);
            const items = itemsByTypeId.get(type.id) ?? [];
            const activeWorkflows = workflowsByTypeId.get(type.id) ?? [];
            const offerPrices = offersByTypeId.get(type.id) ?? [];
            const latestItem = items.reduce<Date | null>((latest, item) => {
                if (!latest || item.updatedAt > latest) {
                    return item.updatedAt;
                }
                return latest;
            }, null);

            return {
                id: type.id,
                name: type.name,
                slug: type.slug,
                description: type.description,
                fieldCount: schemaSummary.fieldCount,
                requiredFieldCount: schemaSummary.requiredFieldCount,
                itemCount: items.length,
                hasContent: items.length > 0,
                pendingReviewTaskCount: pendingTaskCountByTypeId.get(type.id) ?? 0,
                lastItemUpdatedAt: toOptionalIso(latestItem),
                paid: {
                    basePrice: type.basePrice,
                    activeTypeOfferCount: offerPrices.length,
                    lowestTypeOfferSats: offerPrices.length > 0
                        ? Math.min(...offerPrices)
                        : null,
                },
                workflow: {
                    activeWorkflowCount: activeWorkflows.length,
                    activeWorkflows,
                },
                recommendedCommands: {
                    contentGuide: `node dist/cli/index.js content guide --content-type-id ${type.id}`,
                    listContent: `node dist/cli/index.js content list --content-type-id ${type.id}`,
                    workflowActive: `node dist/cli/index.js workflow active --content-type-id ${type.id}`,
                },
            };
        })
        .sort(compareByNameThenId);

    const searchedSummaries = summaries.filter((summary) => matchesSearch(summary, normalizedSearch));
    const targets = buildWorkspaceTargets(searchedSummaries, targetLimit);
    const returnedContentTypes = selectReturnedContentTypes({
        intent,
        summaries: searchedSummaries,
        targets,
        limit,
    });

    return {
        generatedAt: new Date().toISOString(),
        currentActor,
        currentDomain,
        accessibleDomains,
        filter: {
            intent,
            search: normalizedSearch,
            limit,
            totalContentTypesBeforeFilter: summaries.length,
            totalContentTypesAfterSearch: searchedSummaries.length,
            returnedContentTypes: returnedContentTypes.length,
        },
        summary: {
            totalContentTypes: returnedContentTypes.length,
            contentTypesWithContent: returnedContentTypes.filter((summary) => summary.hasContent).length,
            workflowEnabledContentTypes: returnedContentTypes.filter((summary) => summary.workflow.activeWorkflowCount > 0).length,
            paidContentTypes: returnedContentTypes.filter((summary) => summary.paid.activeTypeOfferCount > 0 || summary.paid.basePrice !== null).length,
            pendingReviewTaskCount: returnedContentTypes.reduce((total, summary) => total + summary.pendingReviewTaskCount, 0),
        },
        targets: {
            authoring: targets.authoring,
            review: targets.review,
            workflow: targets.workflow,
            paid: targets.paid,
        },
        contentTypes: returnedContentTypes,
        warnings,
    };
}

export async function resolveWorkspaceTarget(
    currentActor: CurrentActorSnapshot,
    options: {
        intent: WorkspaceTargetIntent;
        search?: string | null;
    },
): Promise<WorkspaceTargetResolution> {
    const snapshot = await getWorkspaceContextSnapshot(currentActor, {
        intent: options.intent,
        search: options.search,
        targetLimit: 25,
    });

    const rankedTargets = await Promise.all(snapshot.targets[options.intent].map(async (target, index) => {
        const contentType = snapshot.contentTypes.find((entry) => entry.id === target.id) ?? null;

        return {
            ...target,
            rank: index + 1,
            contentType,
            workTarget: contentType
                ? await resolveWorkTargetForContentType(currentActor, options.intent, contentType, target)
                : null,
        };
    }));

    return {
        generatedAt: new Date().toISOString(),
        currentActor: snapshot.currentActor,
        currentDomain: snapshot.currentDomain,
        intent: options.intent,
        search: snapshot.filter.search,
        availableTargetCount: rankedTargets.length,
        target: rankedTargets[0] ?? null,
        alternatives: rankedTargets.slice(1, 4),
        warnings: snapshot.warnings,
    };
}
