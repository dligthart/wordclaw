import crypto from 'node:crypto';

import type { AuditEventPayload } from '../services/event-bus.js';

export function verifyWordClawWebhookSignature(
    secret: string,
    body: string,
    signature: string | null | undefined,
): boolean {
    if (!signature) {
        return false;
    }

    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const receivedBuffer = Buffer.from(signature, 'utf8');

    if (expectedBuffer.length !== receivedBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function parseWebhookDetails(
    details: string | null,
): Record<string, unknown> | null {
    if (!details) {
        return null;
    }

    try {
        const parsed = JSON.parse(details);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        return null;
    }

    return null;
}

export function shouldTriggerVercelDeploy(payload: AuditEventPayload): {
    trigger: boolean;
    reason: string;
    details: Record<string, unknown> | null;
} {
    if (payload.entityType !== 'content_item') {
        return {
            trigger: false,
            reason: 'Only content_item audit events trigger deploy checks.',
            details: null,
        };
    }

    if (payload.action !== 'create' && payload.action !== 'update') {
        return {
            trigger: false,
            reason: 'Only create/update content_item events are relevant for publish deploys.',
            details: null,
        };
    }

    const details = parseWebhookDetails(payload.details);
    if (!details) {
        return {
            trigger: false,
            reason: 'Webhook details do not contain a parseable JSON object.',
            details: null,
        };
    }

    if (details.status !== 'published') {
        return {
            trigger: false,
            reason: 'The content item is not published in this audit event.',
            details,
        };
    }

    return {
        trigger: true,
        reason: 'Published content item detected.',
        details,
    };
}
