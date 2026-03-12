import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
    parseWebhookDetails,
    shouldTriggerVercelDeploy,
    verifyWordClawWebhookSignature,
} from './vercel-publish-webhook.js';

describe('vercel publish webhook helpers', () => {
    it('verifies a signed WordClaw webhook body', () => {
        const body = '{"id":1}';
        const secret = 'demo-secret';
        const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');

        expect(verifyWordClawWebhookSignature(secret, body, signature)).toBe(true);
        expect(verifyWordClawWebhookSignature(secret, body, `${signature}x`)).toBe(false);
    });

    it('parses webhook details when audit details contain a JSON object', () => {
        expect(parseWebhookDetails('{"status":"published"}')).toEqual({
            status: 'published',
        });
        expect(parseWebhookDetails('not-json')).toBeNull();
        expect(parseWebhookDetails(null)).toBeNull();
    });

    it('triggers deploys only for published content item create/update events', () => {
        expect(
            shouldTriggerVercelDeploy({
                id: 1,
                domainId: 1,
                action: 'update',
                entityType: 'content_item',
                entityId: 7,
                userId: null,
                actorId: 'api_key:1',
                actorType: 'api_key',
                actorSource: 'db',
                details: '{"status":"published"}',
                createdAt: new Date(),
            }),
        ).toEqual(expect.objectContaining({
            trigger: true,
            reason: 'Published content item detected.',
        }));

        expect(
            shouldTriggerVercelDeploy({
                id: 2,
                domainId: 1,
                action: 'update',
                entityType: 'content_item',
                entityId: 8,
                userId: null,
                actorId: 'api_key:1',
                actorType: 'api_key',
                actorSource: 'db',
                details: '{"status":"draft"}',
                createdAt: new Date(),
            }),
        ).toEqual(expect.objectContaining({
            trigger: false,
            reason: 'The content item is not published in this audit event.',
        }));
    });
});
