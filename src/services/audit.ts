import { db } from '../db/index.js';
import { auditLogs } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { auditEventBus } from './event-bus.js';
import { emitAuditWebhookEvents } from './webhook.js';
import { toAuditActor, type AuditActor } from './actor-identity.js';

// --- Typed enums ---

export type AuditAction = 'create' | 'update' | 'delete' | 'rollback' | 'restore' | 'purge' | 'preview';
export type EntityType =
    | 'domain'
    | 'supervisor'
    | 'content_type'
    | 'content_item'
    | 'form_definition'
    | 'workforce_agent'
    | 'job'
    | 'asset'
    | 'api_key'
    | 'ai_provider_config'
    | 'webhook'
    | 'l402_operator_config'
    | 'agent_run'
    | 'agent_run_definition'
    | 'external_feedback_event';

// --- Write ---

export async function logAudit(
    domainId: number,
    action: AuditAction,
    entityType: EntityType,
    entityId: number,
    details?: Record<string, unknown>,
    actor?: number | AuditActor,
    requestId?: string,
    skipWebhooks = false
) {
    try {
        const auditActor = toAuditActor(actor);
        const detailsWithContext = {
            ...(details || {}),
            ...(requestId ? { requestId } : {})
        };

        const [entry] = await db.insert(auditLogs).values({
            domainId,
            action,
            entityType,
            entityId,
            userId: auditActor?.userId ?? null,
            actorId: auditActor?.actorId ?? null,
            actorType: auditActor?.actorType ?? null,
            actorSource: auditActor?.actorSource ?? null,
            details: Object.keys(detailsWithContext).length > 0 ? JSON.stringify(detailsWithContext) : null,
        }).returning();

        const eventPayload = {
            id: entry.id,
            domainId,
            action: entry.action,
            entityType: entry.entityType,
            entityId: entry.entityId,
            userId: entry.userId ?? null,
            actorId: entry.actorId ?? null,
            actorType: entry.actorType ?? null,
            actorSource: entry.actorSource ?? null,
            details: entry.details ?? null,
            createdAt: entry.createdAt
        };

        auditEventBus.emit('audit', eventPayload);
        if (!skipWebhooks) {
            await emitAuditWebhookEvents(domainId, eventPayload);
        }
    } catch (error) {
        console.error('Failed to log audit:', error);
        // Audit failure should not break the main operation
    }
}

// --- Read ---

export interface AuditLogFilters {
    entityType?: string;
    entityId?: number;
    action?: string;
    limit?: number;
}

export async function listAuditLogs(domainId: number, filters: AuditLogFilters = {}) {
    const { entityType, entityId, action, limit = 50 } = filters;

    const conditions = [eq(auditLogs.domainId, domainId)];
    if (entityType) conditions.push(eq(auditLogs.entityType, entityType));
    if (entityId) conditions.push(eq(auditLogs.entityId, entityId));
    if (action) conditions.push(eq(auditLogs.action, action));

    const query = db.select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        userId: auditLogs.userId,
        actorId: auditLogs.actorId,
        actorType: auditLogs.actorType,
        actorSource: auditLogs.actorSource,
        details: auditLogs.details,
        createdAt: auditLogs.createdAt,
    })
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit);

    if (conditions.length > 0) {
        query.where(and(...conditions));
    }

    return query;
}
