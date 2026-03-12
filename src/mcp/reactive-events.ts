import { z } from 'zod';

import type { ActorPrincipal } from '../services/actor-identity.js';
import type { AuditEventPayload } from '../services/event-bus.js';

export const WORDCLAW_EVENT_NOTIFICATION_METHOD = 'notifications/wordclaw/event';

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
] as const;

export type ReactiveEventTopic = typeof SUPPORTED_REACTIVE_EVENT_TOPICS[number];

export type SubscribeEventsResult = {
    transport: 'streamable-http';
    sessionId: string | null;
    subscribedTopics: string[];
    newlyAddedTopics: string[];
    blockedTopics: Array<{ topic: string; reason: string }>;
    unsupportedTopics: string[];
};

export type ReactiveEventBindings = {
    subscribe(topics: string[], replaceExisting?: boolean): SubscribeEventsResult;
};

export const ReactiveEventNotificationSchema = z.object({
    method: z.literal(WORDCLAW_EVENT_NOTIFICATION_METHOD),
    params: z.object({
        topic: z.string(),
        matchedTopics: z.array(z.string()),
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

export function isReactiveTopicSupported(topic: string): topic is ReactiveEventTopic {
    return (SUPPORTED_REACTIVE_EVENT_TOPICS as readonly string[]).includes(topic);
}

export function canSubscribeToReactiveTopic(principal: ActorPrincipal, topic: string): boolean {
    if (topic === '*') {
        return principal.scopes.has('admin');
    }

    if (topic === 'audit.*') {
        return hasScope(principal, 'audit:read');
    }

    if (topic.startsWith('content_item.') || topic.startsWith('workflow.review.')) {
        return hasScope(principal, 'content:read') || hasScope(principal, 'content:write');
    }

    return false;
}

export function deriveReactiveTopics(event: AuditEventPayload): string[] {
    const details = parseAuditEventDetails(event.details);
    const topics = new Set<string>([
        'audit.*',
        `${event.entityType}.${event.action}`,
    ]);

    if (event.entityType === 'content_item') {
        topics.add('content_item.*');

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
    matchedTopics: string[],
) {
    const derivedTopics = deriveReactiveTopics(event);
    const topic = selectCanonicalReactiveTopic(derivedTopics);

    return ReactiveEventNotificationSchema.parse({
        method: WORDCLAW_EVENT_NOTIFICATION_METHOD,
        params: {
            topic,
            matchedTopics,
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
