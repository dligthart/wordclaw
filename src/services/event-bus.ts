import { EventEmitter } from 'node:events';

export type AuditEventPayload = {
    id: number;
    domainId: number;
    action: string;
    entityType: string;
    entityId: number;
    userId: number | null;
    actorId: string | null;
    actorType: string | null;
    actorSource: string | null;
    details: string | null;
    createdAt: Date;
};

export const auditEventBus = new EventEmitter();
