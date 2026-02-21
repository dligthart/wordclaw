import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { webhooks } from '../db/schema.js';
import type { AuditEventPayload } from './event-bus.js';
import { logAudit } from './audit.js';

type CreateWebhookInput = {
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

export async function emitAuditWebhookEvents(payload: AuditEventPayload): Promise<void> {
    const targets = await db.select().from(webhooks).where(eq(webhooks.active, true));
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
        url: input.url,
        events: serializeWebhookEvents(input.events),
        secret: input.secret,
        active: input.active ?? true
    }).returning();

    return created;
}

export async function listWebhooks() {
    return db.select().from(webhooks);
}

export async function updateWebhook(id: number, input: UpdateWebhookInput) {
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
        .where(eq(webhooks.id, id))
        .returning();

    return updated || null;
}

export async function deleteWebhook(id: number) {
    const [deleted] = await db.delete(webhooks)
        .where(eq(webhooks.id, id))
        .returning();

    return deleted || null;
}

export async function getWebhookById(id: number) {
    const [hook] = await db.select().from(webhooks).where(and(eq(webhooks.id, id)));
    return hook || null;
}
