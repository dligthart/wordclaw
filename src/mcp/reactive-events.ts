import { z } from 'zod';

import { hasAdministrativeScope, type ActorPrincipal } from '../services/actor-identity.js';
import type { AuditEventPayload } from '../services/event-bus.js';

export const WORDCLAW_EVENT_NOTIFICATION_METHOD = 'notifications/wordclaw/event';

const CONTENT_TYPE_REACTIVE_EVENT_TOPICS = [
    'content_type.*',
    'content_type.create',
    'content_type.update',
    'content_type.delete',
] as const;

const API_KEY_REACTIVE_EVENT_TOPICS = [
    'api_key.*',
    'api_key.create',
    'api_key.update',
    'api_key.delete',
] as const;

const WEBHOOK_REACTIVE_EVENT_TOPICS = [
    'webhook.*',
    'webhook.create',
    'webhook.update',
    'webhook.delete',
] as const;

const AI_PROVIDER_CONFIG_REACTIVE_EVENT_TOPICS = [
    'ai_provider_config.*',
    'ai_provider_config.create',
    'ai_provider_config.update',
    'ai_provider_config.delete',
] as const;

const WORKFORCE_AGENT_REACTIVE_EVENT_TOPICS = [
    'workforce_agent.*',
    'workforce_agent.create',
    'workforce_agent.update',
    'workforce_agent.delete',
] as const;

export const SUPPORTED_REACTIVE_EVENT_TOPICS = [
    '*',
    'audit.*',
    'content_item.*',
    'content_item.create',
    'content_item.update',
    'content_item.delete',
    'content_item.rollback',
    'content_item.approved',
    'content_item.published',
    'workflow.review.approved',
    'workflow.review.rejected',
    ...CONTENT_TYPE_REACTIVE_EVENT_TOPICS,
    ...API_KEY_REACTIVE_EVENT_TOPICS,
    ...WEBHOOK_REACTIVE_EVENT_TOPICS,
    ...AI_PROVIDER_CONFIG_REACTIVE_EVENT_TOPICS,
    ...WORKFORCE_AGENT_REACTIVE_EVENT_TOPICS,
] as const;

export type ReactiveEventTopic = typeof SUPPORTED_REACTIVE_EVENT_TOPICS[number];

export const SUPPORTED_REACTIVE_FILTER_FIELDS = [
    'entityType',
    'entityId',
    'action',
    'contentTypeId',
    'status',
    'decision',
    'actorId',
    'actorType',
    'workflowTransitionId',
    'reviewTaskId',
] as const;

export const SUPPORTED_REACTIVE_SUBSCRIPTION_RECIPES = [
    {
        id: 'content-publication',
        title: 'Content publication',
        description: 'Watch published content items as they become visible to downstream consumers.',
        topics: ['content_item.published'],
        requiredScopes: ['content:read', 'content:write', 'admin'],
    },
    {
        id: 'review-decisions',
        title: 'Review decisions',
        description: 'Watch review approval and rejection outcomes for supervisor workflows.',
        topics: ['workflow.review.approved', 'workflow.review.rejected'],
        requiredScopes: ['content:read', 'content:write', 'admin'],
    },
    {
        id: 'content-lifecycle',
        title: 'Content lifecycle',
        description: 'Watch content item creation, updates, rollback, and publication in one subscription set.',
        topics: [
            'content_item.create',
            'content_item.update',
            'content_item.delete',
            'content_item.rollback',
            'content_item.published',
        ],
        requiredScopes: ['content:read', 'content:write', 'admin'],
    },
    {
        id: 'schema-governance',
        title: 'Schema governance',
        description: 'Watch content model creation, updates, and deletion events.',
        topics: ['content_type.create', 'content_type.update', 'content_type.delete'],
        requiredScopes: ['content:read', 'content:write', 'admin'],
    },
    {
        id: 'integration-admin',
        title: 'Integration administration',
        description: 'Watch API keys, outbound webhooks, tenant AI providers, and workforce-agent registry changes for integration setup.',
        topics: [
            'api_key.create',
            'api_key.update',
            'api_key.delete',
            'webhook.create',
            'webhook.update',
            'webhook.delete',
            'ai_provider_config.create',
            'ai_provider_config.update',
            'ai_provider_config.delete',
            'workforce_agent.create',
            'workforce_agent.update',
            'workforce_agent.delete',
        ],
        requiredScopes: ['admin', 'tenant:admin'],
    },
] as const;

export const REACTIVE_SUBSCRIPTION_RECIPE_IDS = SUPPORTED_REACTIVE_SUBSCRIPTION_RECIPES.map(
    (recipe) => recipe.id,
) as [string, ...string[]];

export const ReactiveEventFiltersSchema = z.object({
    entityType: z.string().optional(),
    entityId: z.number().int().positive().optional(),
    action: z.string().optional(),
    contentTypeId: z.number().int().positive().optional(),
    status: z.string().optional(),
    decision: z.string().optional(),
    actorId: z.string().optional(),
    actorType: z.string().optional(),
    workflowTransitionId: z.number().int().positive().optional(),
    reviewTaskId: z.number().int().positive().optional(),
});

export type ReactiveEventFilters = z.infer<typeof ReactiveEventFiltersSchema>;
export type ReactiveSubscriptionRecipe = typeof SUPPORTED_REACTIVE_SUBSCRIPTION_RECIPES[number];

export type ReactiveSubscription = {
    topic: string;
    filters: ReactiveEventFilters;
};

export type SubscribeEventsResult = {
    transport: 'streamable-http';
    sessionId: string | null;
    subscribedTopics: string[];
    newlyAddedTopics: string[];
    subscriptions: ReactiveSubscription[];
    blockedTopics: Array<{ topic: string; reason: string }>;
    unsupportedTopics: string[];
};

export type ReactiveEventBindings = {
    subscribe(
        topics: string[],
        replaceExisting?: boolean,
        filters?: ReactiveEventFilters,
    ): SubscribeEventsResult;
};

export const ReactiveEventNotificationSchema = z.object({
    method: z.literal(WORDCLAW_EVENT_NOTIFICATION_METHOD),
    params: z.object({
        topic: z.string(),
        matchedTopics: z.array(z.string()),
        matchedSubscriptions: z.array(z.object({
            topic: z.string(),
            filters: ReactiveEventFiltersSchema,
        })),
        event: z.object({
            source: z.literal('audit'),
            name: z.string(),
            domainId: z.number(),
            auditId: z.number(),
            entityType: z.string(),
            action: z.string(),
            entityId: z.number(),
            actorId: z.union([z.string(), z.null()]),
            actorType: z.union([z.string(), z.null()]),
            actorSource: z.union([z.string(), z.null()]),
            userId: z.union([z.number(), z.null()]),
            details: z.unknown().nullable(),
            createdAt: z.string(),
        }),
    }),
});

function hasScope(principal: ActorPrincipal, scope: string): boolean {
    return principal.scopes.has('admin') || principal.scopes.has(scope);
}

function matchesTopicFamily(topic: string, family: string): boolean {
    return topic === `${family}.*` || topic.startsWith(`${family}.`);
}

export function parseAuditEventDetails(details: string | null): Record<string, unknown> | null {
    if (!details) {
        return null;
    }

    try {
        const parsed = JSON.parse(details) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        return { value: parsed };
    } catch {
        return { raw: details };
    }
}

export function normalizeReactiveFilters(filters: ReactiveEventFilters | undefined): ReactiveEventFilters {
    return Object.fromEntries(
        Object.entries(filters ?? {}).filter(([, value]) => value !== undefined),
    ) as ReactiveEventFilters;
}

function toNumericDetail(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return null;
}

function stableSerializeFilters(filters: ReactiveEventFilters): string {
    const normalized = normalizeReactiveFilters(filters);
    const sortedEntries = Object.entries(normalized).sort(([left], [right]) => left.localeCompare(right));
    return JSON.stringify(Object.fromEntries(sortedEntries));
}

export function isSameReactiveSubscription(
    left: ReactiveSubscription,
    right: ReactiveSubscription,
): boolean {
    return left.topic === right.topic
        && stableSerializeFilters(left.filters) === stableSerializeFilters(right.filters);
}

export function isReactiveTopicSupported(topic: string): topic is ReactiveEventTopic {
    return (SUPPORTED_REACTIVE_EVENT_TOPICS as readonly string[]).includes(topic);
}

export function getReactiveSubscriptionRecipe(recipeId: string): ReactiveSubscriptionRecipe | null {
    return SUPPORTED_REACTIVE_SUBSCRIPTION_RECIPES.find((recipe) => recipe.id === recipeId) ?? null;
}

export function canSubscribeToReactiveTopic(principal: ActorPrincipal, topic: string): boolean {
    if (topic === '*') {
        return principal.scopes.has('admin');
    }

    if (topic === 'audit.*') {
        return hasScope(principal, 'audit:read');
    }

    if (
        matchesTopicFamily(topic, 'content_item')
        || matchesTopicFamily(topic, 'content_type')
        || topic.startsWith('workflow.review.')
    ) {
        return hasScope(principal, 'content:read') || hasScope(principal, 'content:write');
    }

    if (
        matchesTopicFamily(topic, 'api_key')
        || matchesTopicFamily(topic, 'webhook')
        || matchesTopicFamily(topic, 'ai_provider_config')
        || matchesTopicFamily(topic, 'workforce_agent')
    ) {
        return hasAdministrativeScope(principal);
    }

    return false;
}

export function deriveReactiveTopics(event: AuditEventPayload): string[] {
    const details = parseAuditEventDetails(event.details);
    const topics = new Set<string>([
        'audit.*',
        `${event.entityType}.${event.action}`,
    ]);

    if (event.entityType === 'content_item'
        || event.entityType === 'content_type'
        || event.entityType === 'api_key'
        || event.entityType === 'webhook'
        || event.entityType === 'ai_provider_config'
        || event.entityType === 'workforce_agent') {
        topics.add(`${event.entityType}.*`);
    }

    if (event.entityType === 'content_item') {
        const status = typeof details?.status === 'string' ? details.status : null;
        const decision = typeof details?.decision === 'string' ? details.decision : null;

        if (status === 'published') {
            topics.add('content_item.published');
        }

        if (decision === 'approved') {
            topics.add('content_item.approved');
            topics.add('workflow.review.approved');
        }

        if (decision === 'rejected') {
            topics.add('workflow.review.rejected');
        }
    }

    return [...topics];
}

export function matchesReactiveSubscription(
    event: AuditEventPayload,
    derivedTopics: string[],
    subscription: ReactiveSubscription,
): boolean {
    if (subscription.topic !== '*' && !derivedTopics.includes(subscription.topic)) {
        return false;
    }

    const details = parseAuditEventDetails(event.details);
    const filters = normalizeReactiveFilters(subscription.filters);

    if (filters.entityType && event.entityType !== filters.entityType) {
        return false;
    }

    if (filters.entityId !== undefined && event.entityId !== filters.entityId) {
        return false;
    }

    if (filters.action && event.action !== filters.action) {
        return false;
    }

    if (filters.actorId && event.actorId !== filters.actorId) {
        return false;
    }

    if (filters.actorType && event.actorType !== filters.actorType) {
        return false;
    }

    if (filters.contentTypeId !== undefined && toNumericDetail(details?.contentTypeId) !== filters.contentTypeId) {
        return false;
    }

    if (filters.workflowTransitionId !== undefined && toNumericDetail(details?.workflowTransitionId) !== filters.workflowTransitionId) {
        return false;
    }

    if (filters.reviewTaskId !== undefined && toNumericDetail(details?.reviewTaskId) !== filters.reviewTaskId) {
        return false;
    }

    if (filters.status && details?.status !== filters.status) {
        return false;
    }

    if (filters.decision && details?.decision !== filters.decision) {
        return false;
    }

    return true;
}

export function selectCanonicalReactiveTopic(topics: string[]): string {
    const priority = [
        'workflow.review.approved',
        'workflow.review.rejected',
        'content_item.published',
        'content_item.approved',
    ];

    for (const topic of priority) {
        if (topics.includes(topic)) {
            return topic;
        }
    }

    return topics.find((topic) => topic !== 'audit.*' && topic !== 'content_item.*')
        ?? topics[0]
        ?? 'audit.*';
}

export function buildReactiveEventNotification(
    event: AuditEventPayload,
    matchedSubscriptions: ReactiveSubscription[],
) {
    const derivedTopics = deriveReactiveTopics(event);
    const topic = selectCanonicalReactiveTopic(derivedTopics);
    const matchedTopics = Array.from(new Set(matchedSubscriptions.map((subscription) => subscription.topic)));

    return ReactiveEventNotificationSchema.parse({
        method: WORDCLAW_EVENT_NOTIFICATION_METHOD,
        params: {
            topic,
            matchedTopics,
            matchedSubscriptions: matchedSubscriptions.map((subscription) => ({
                topic: subscription.topic,
                filters: normalizeReactiveFilters(subscription.filters),
            })),
            event: {
                source: 'audit',
                name: topic,
                domainId: event.domainId,
                auditId: event.id,
                entityType: event.entityType,
                action: event.action,
                entityId: event.entityId,
                actorId: event.actorId,
                actorType: event.actorType,
                actorSource: event.actorSource,
                userId: event.userId,
                details: parseAuditEventDetails(event.details),
                createdAt: event.createdAt.toISOString(),
            },
        },
    });
}
