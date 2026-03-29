import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { and, eq } from 'drizzle-orm';

export async function isSafeWebhookUrl(urlStr: string): Promise<boolean> {
    try {
        const parsed = new URL(urlStr);
        if (parsed.protocol !== 'https:') return false;

        const hostname = parsed.hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false;
        if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return false;

        const ips = await dns.resolve(hostname).catch(() => []);
        if (ips.length === 0) return false;

        for (const ip of ips) {
            if (ip === '169.254.169.254') return false;
            if (ip.startsWith('127.')) return false;
            if (ip.startsWith('10.')) return false;
            if (ip.startsWith('192.168.')) return false;
            const parts = ip.split('.');
            if (parts.length === 4 && parts[0] === '172') {
                const second = parseInt(parts[1], 10);
                if (second >= 16 && second <= 31) return false;
            }
            if (ip === '::1') return false;
            if (ip.toLowerCase().startsWith('fe80:')) return false;
            if (ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')) return false;
        }

        return true;
    } catch {
        return false;
    }
}

import { db } from '../db/index.js';
import { webhooks } from '../db/schema.js';
import type { AuditEventPayload } from './event-bus.js';
import { logAudit } from './audit.js';
import { enqueueAuditWebhookJobs } from './jobs.js';

type CreateWebhookInput = {
    domainId: number;
    url: string;
    events: string[];
    secret: string;
    active?: boolean;
};

type UpdateWebhookInput = {
    url?: string;
    events?: string[];
    secret?: string;
    active?: boolean;
};

export function normalizeWebhookEvents(events: string[]): string[] {
    const normalized = Array.from(
        new Set(events.map((event) => event.trim()).filter(Boolean))
    );
    if (normalized.length === 0) {
        throw new Error('Webhook events cannot be empty');
    }

    return normalized;
}

export function serializeWebhookEvents(events: string[]): string {
    return normalizeWebhookEvents(events).join('|');
}

export function parseWebhookEvents(events: string): string[] {
    return events.split('|').map((event) => event.trim()).filter(Boolean);
}

export function signWebhookPayload(secret: string, body: string): string {
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function shouldDeliver(events: string[], payload: AuditEventPayload): boolean {
    if (events.includes('*')) {
        return true;
    }

    const candidates = [
        `${payload.entityType}.${payload.action}`,
        `audit.${payload.action}`
    ];

    return candidates.some((candidate) => events.includes(candidate));
}

export async function emitAuditWebhookEvents(domainId: number, payload: AuditEventPayload): Promise<void> {
    const targets = await db.select().from(webhooks).where(and(eq(webhooks.active, true), eq(webhooks.domainId, domainId)));
    if (targets.length === 0) {
        return;
    }

    Promise.resolve().then(async () => {
        const matchingTargets = targets.filter((hook) => shouldDeliver(parseWebhookEvents(hook.events), payload));
        if (matchingTargets.length === 0) {
            return;
        }

        await enqueueAuditWebhookJobs(domainId, payload as unknown as Record<string, unknown>);
    }).catch(async (error) => {
        console.error('Background webhook job enqueue failed', error);
        await Promise.allSettled(targets.map((hook) => logAudit(
            domainId,
            'update',
            'webhook',
            hook.id,
            {
                enqueued: false,
                url: hook.url,
                triggerAction: payload.action,
                triggerEntityType: payload.entityType,
                triggerEntityId: payload.entityId,
                error: error instanceof Error ? error.message : String(error),
            },
            undefined,
            undefined,
            true
        )));
    });
}

export async function createWebhook(input: CreateWebhookInput) {
    const [created] = await db.insert(webhooks).values({
        domainId: input.domainId,
        url: input.url,
        events: serializeWebhookEvents(input.events),
        secret: input.secret,
        active: input.active ?? true
    }).returning();

    return created;
}

export async function listWebhooks(domainId: number) {
    return db.select().from(webhooks).where(eq(webhooks.domainId, domainId));
}

export async function updateWebhook(id: number, domainId: number, input: UpdateWebhookInput) {
    const updates: Record<string, unknown> = {};
    if (input.url !== undefined) updates.url = input.url;
    if (input.secret !== undefined) updates.secret = input.secret;
    if (input.active !== undefined) updates.active = input.active;
    if (input.events !== undefined) updates.events = serializeWebhookEvents(input.events);

    if (Object.keys(updates).length === 0) {
        return null;
    }

    const [updated] = await db.update(webhooks)
        .set(updates)
        .where(and(eq(webhooks.id, id), eq(webhooks.domainId, domainId)))
        .returning();

    return updated || null;
}

export async function deleteWebhook(id: number, domainId: number) {
    const [deleted] = await db.delete(webhooks)
        .where(and(eq(webhooks.id, id), eq(webhooks.domainId, domainId)))
        .returning();

    return deleted || null;
}

export async function getWebhookById(id: number, domainId: number) {
    const [hook] = await db.select().from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.domainId, domainId)));
    return hook || null;
}
