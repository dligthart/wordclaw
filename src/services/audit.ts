import { db } from '../db/index.js';
import { auditLogs } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';

// --- Typed enums ---

export type AuditAction = 'create' | 'update' | 'delete' | 'rollback';
export type EntityType = 'content_type' | 'content_item';

// --- Write ---

export async function logAudit(
    action: AuditAction,
    entityType: EntityType,
    entityId: number,
    details?: Record<string, unknown>,
    userId?: number
) {
    try {
        await db.insert(auditLogs).values({
            action,
            entityType,
            entityId,
            userId: userId ?? null,
            details: details ? JSON.stringify(details) : null,
        });
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

export async function listAuditLogs(filters: AuditLogFilters = {}) {
    const { entityType, entityId, action, limit = 50 } = filters;

    const conditions = [];
    if (entityType) conditions.push(eq(auditLogs.entityType, entityType));
    if (entityId) conditions.push(eq(auditLogs.entityId, entityId));
    if (action) conditions.push(eq(auditLogs.action, action));

    const query = db.select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
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
