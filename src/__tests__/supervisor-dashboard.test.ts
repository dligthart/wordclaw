import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { auditLogs, domains, payments } from '../db/schema.js';
import { supervisorDashboardRoutes } from '../api/supervisor-dashboard.js';

describe('Supervisor Dashboard Domain Isolation', () => {
    let app: ReturnType<typeof Fastify>;
    let domainAId: number;
    let domainBId: number;
    let supervisorToken: string;

    beforeAll(async () => {
        app = Fastify({ logger: false });
        await app.register(fastifyJwt, {
            secret: 'test-supervisor-secret',
            cookie: {
                cookieName: 'supervisor_session',
                signed: false
            }
        });
        await app.register(fastifyCookie, {
            secret: 'test-cookie-secret',
            hook: 'onRequest'
        });
        await app.register(supervisorDashboardRoutes, { prefix: '/api/supervisors' });
        await app.ready();

        supervisorToken = app.jwt.sign({ sub: 1, role: 'supervisor' });

        const [domainA] = await db.insert(domains).values({
            name: 'Supervisor Domain A',
            hostname: `supervisor-a-${Date.now()}.local`
        }).returning();
        domainAId = domainA.id;

        const [domainB] = await db.insert(domains).values({
            name: 'Supervisor Domain B',
            hostname: `supervisor-b-${Date.now()}.local`
        }).returning();
        domainBId = domainB.id;

        await db.insert(auditLogs).values([
            { domainId: domainAId, action: 'create', entityType: 'content_item', entityId: 1, userId: 10, details: 'domain-a-create' },
            { domainId: domainAId, action: 'rollback', entityType: 'content_item', entityId: 2, userId: 10, details: 'domain-a-rollback' },
            { domainId: domainAId, action: 'error', entityType: 'system', entityId: 3, userId: 11, details: 'domain-a-error' },
            { domainId: domainBId, action: 'create', entityType: 'content_item', entityId: 4, userId: 12, details: 'domain-b-create' },
            { domainId: domainBId, action: 'error', entityType: 'system', entityId: 5, userId: 13, details: 'domain-b-error' }
        ]);

        await db.insert(payments).values([
            {
                domainId: domainAId,
                paymentHash: `hash-a-paid-${Date.now()}`,
                paymentRequest: 'lnbc1domainapaid',
                amountSatoshis: 150,
                status: 'paid',
                resourcePath: '/api/content-items/1'
            },
            {
                domainId: domainAId,
                paymentHash: `hash-a-pending-${Date.now()}`,
                paymentRequest: 'lnbc1domainapending',
                amountSatoshis: 70,
                status: 'pending',
                resourcePath: '/api/content-items/2'
            },
            {
                domainId: domainBId,
                paymentHash: `hash-b-paid-${Date.now()}`,
                paymentRequest: 'lnbc1domainbpaid',
                amountSatoshis: 999,
                status: 'paid',
                resourcePath: '/api/content-items/3'
            },
            {
                domainId: domainBId,
                paymentHash: `hash-b-pending-${Date.now()}`,
                paymentRequest: 'lnbc1domainbpending',
                amountSatoshis: 333,
                status: 'pending',
                resourcePath: '/api/content-items/4'
            }
        ]);
    });

    afterAll(async () => {
        await app?.close();
        if (domainAId) {
            await db.delete(domains).where(eq(domains.id, domainAId));
        }
        if (domainBId) {
            await db.delete(domains).where(eq(domains.id, domainBId));
        }
    });

    it('rejects dashboard requests without explicit domain context', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/supervisors/dashboard',
            headers: {
                cookie: `supervisor_session=${supervisorToken}`
            }
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().code).toBe('INVALID_DOMAIN_CONTEXT');
    });

    it('scopes dashboard aggregates and events to requested domain', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/supervisors/dashboard',
            headers: {
                cookie: `supervisor_session=${supervisorToken}`,
                'x-wordclaw-domain': String(domainAId)
            }
        });

        expect(response.statusCode).toBe(200);
        const payload = response.json() as {
            activitySummary: {
                creates: number;
                updates: number;
                deletes: number;
                rollbacks: number;
                totalAgentsActive: number;
            };
            earningsSummary: {
                total: number;
                pending: number;
                pendingCount: number;
            };
            recentEvents: Array<{ domainId: number; details: string | null }>;
            alerts: Array<{ type: string; message: string }>;
        };

        expect(payload.activitySummary.creates).toBe(1);
        expect(payload.activitySummary.updates).toBe(0);
        expect(payload.activitySummary.deletes).toBe(0);
        expect(payload.activitySummary.rollbacks).toBe(1);
        expect(payload.activitySummary.totalAgentsActive).toBe(2);

        expect(payload.earningsSummary.total).toBe(150);
        expect(payload.earningsSummary.pending).toBe(70);
        expect(payload.earningsSummary.pendingCount).toBe(1);

        expect(payload.recentEvents.every((event) => event.domainId === domainAId)).toBe(true);
        expect(payload.recentEvents.some((event) => event.details === 'domain-b-create')).toBe(false);

        const alertMessages = payload.alerts.map((alert) => alert.message);
        expect(alertMessages.some((message) => message.includes('domain-a-error'))).toBe(true);
        expect(alertMessages.some((message) => message.includes('domain-b-error'))).toBe(false);
    });
});
