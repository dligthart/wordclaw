import { EventEmitter } from 'node:events';

export type AuditEventPayload = {
    id: number;
    action: string;
    entityType: string;
    entityId: number;
    userId: number | null;
    details: string | null;
    createdAt: Date;
};

export const auditEventBus = new EventEmitter();
