import { db } from '../db/index.js';
import { auditLogs } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { auditEventBus } from './event-bus.js';
import { emitAuditWebhookEvents } from './webhook.js';

// --- Typed enums ---

export type AuditAction = 'create' | 'update' | 'delete' | 'rollback';
export type EntityType = 'content_type' | 'content_item' | 'api_key' | 'webhook';

// --- Write ---

export async function logAudit(
    domainId: number,
    action: AuditAction,
    entityType: EntityType,
    entityId: number,
    details?: Record<string, unknown>,
    userId?: number,
    requestId?: string,
    skipWebhooks = false
) {
    try {
        const detailsWithContext = {
            ...(details || {}),
            ...(requestId ? { requestId } : {})
        };

        const [entry] = await db.insert(auditLogs).values({
            domainId,
            action,
            entityType,
            entityId,
            userId: userId ?? null,
            details: Object.keys(detailsWithContext).length > 0 ? JSON.stringify(detailsWithContext) : null,
        }).returning();

        const eventPayload = {
            id: entry.id,
            action: entry.action,
            entityType: entry.entityType,
            entityId: entry.entityId,
            userId: entry.userId ?? null,
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
