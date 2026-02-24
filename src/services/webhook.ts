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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function deliverWebhook(url: string, secret: string, payload: AuditEventPayload): Promise<boolean> {
    const body = JSON.stringify(payload);
    const signature = signWebhookPayload(secret, body);
    const retryDelays = [100, 300, 900];

    for (let attempt = 0; attempt < retryDelays.length + 1; attempt += 1) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-wordclaw-signature': signature
                },
                body,
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.ok) {
                return true;
            }
        } catch {
            // retry with backoff
        }

        if (attempt < retryDelays.length) {
            await sleep(retryDelays[attempt]);
        }
    }

    return false;
}

export async function emitAuditWebhookEvents(domainId: number, payload: AuditEventPayload): Promise<void> {
    const targets = await db.select().from(webhooks).where(and(eq(webhooks.active, true), eq(webhooks.domainId, domainId)));
    if (targets.length === 0) {
        return;
    }

    // Fire and forget: don't block the caller (the HTTP request)
    Promise.allSettled(
        targets.map(async (hook) => {
            const events = parseWebhookEvents(hook.events);
            if (!shouldDeliver(events, payload)) {
                return;
            }

            const delivered = await deliverWebhook(hook.url, hook.secret, payload);
            if (!delivered) {
                console.error(`Webhook delivery failed for webhook ${hook.id} (${hook.url})`);
                await logAudit(
                    domainId,
                    'update',
                    'webhook',
                    hook.id,
                    { delivered: false, url: hook.url, triggerAction: payload.action, triggerEntityType: payload.entityType, triggerEntityId: payload.entityId },
                    undefined,
                    undefined,
                    true // skipWebhooks — prevent infinite recursion
                );
            }
        })
    ).catch(e => console.error('Background webhook dispatch failed', e));
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
