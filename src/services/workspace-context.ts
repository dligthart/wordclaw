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

export type WorkspaceContextSnapshot = {
    generatedAt: string;
    currentActor: CurrentActorSnapshot;
    currentDomain: WorkspaceDomainSummary;
    accessibleDomains: WorkspaceDomainSummary[];
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

export async function getWorkspaceContextSnapshot(currentActor: CurrentActorSnapshot): Promise<WorkspaceContextSnapshot> {
    const warnings: string[] = [];
    const domainId = currentActor.domainId;

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

    const authoringTargets = [...summaries]
        .sort((left, right) => (
            Number(right.hasContent) - Number(left.hasContent)
            || right.workflow.activeWorkflowCount - left.workflow.activeWorkflowCount
            || right.itemCount - left.itemCount
            || compareByNameThenId(left, right)
        ))
        .slice(0, 8)
        .map((summary) => toTargetSummary(summary, 'authoring'));

    const reviewTargets = summaries
        .filter((summary) => summary.pendingReviewTaskCount > 0)
        .sort((left, right) => (
            right.pendingReviewTaskCount - left.pendingReviewTaskCount
            || right.workflow.activeWorkflowCount - left.workflow.activeWorkflowCount
            || right.itemCount - left.itemCount
            || compareByNameThenId(left, right)
        ))
        .slice(0, 8)
        .map((summary) => toTargetSummary(summary, 'review'));

    const workflowTargets = summaries
        .filter((summary) => summary.workflow.activeWorkflowCount > 0)
        .sort((left, right) => (
            right.workflow.activeWorkflowCount - left.workflow.activeWorkflowCount
            || right.pendingReviewTaskCount - left.pendingReviewTaskCount
            || right.itemCount - left.itemCount
            || compareByNameThenId(left, right)
        ))
        .slice(0, 8)
        .map((summary) => toTargetSummary(summary, 'workflow'));

    const paidTargets = summaries
        .filter((summary) => summary.paid.activeTypeOfferCount > 0 || summary.paid.basePrice !== null)
        .sort((left, right) => (
            right.paid.activeTypeOfferCount - left.paid.activeTypeOfferCount
            || compareNullableNumberAsc(left.paid.lowestTypeOfferSats, right.paid.lowestTypeOfferSats)
            || right.itemCount - left.itemCount
            || compareByNameThenId(left, right)
        ))
        .slice(0, 8)
        .map((summary) => toTargetSummary(summary, 'paid'));

    return {
        generatedAt: new Date().toISOString(),
        currentActor,
        currentDomain,
        accessibleDomains,
        summary: {
            totalContentTypes: summaries.length,
            contentTypesWithContent: summaries.filter((summary) => summary.hasContent).length,
            workflowEnabledContentTypes: summaries.filter((summary) => summary.workflow.activeWorkflowCount > 0).length,
            paidContentTypes: summaries.filter((summary) => summary.paid.activeTypeOfferCount > 0 || summary.paid.basePrice !== null).length,
            pendingReviewTaskCount: summaries.reduce((total, summary) => total + summary.pendingReviewTaskCount, 0),
        },
        targets: {
            authoring: authoringTargets,
            review: reviewTargets,
            workflow: workflowTargets,
            paid: paidTargets,
        },
        contentTypes: summaries,
        warnings,
    };
}
