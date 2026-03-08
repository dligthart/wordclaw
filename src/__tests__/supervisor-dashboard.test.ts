import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import { auditLogs, domains, payments } from '../db/schema.js';
import { supervisorDashboardRoutes } from '../api/supervisor-dashboard.js';
import { AgentRunMetricsService } from '../services/agent-run-metrics.js';
import { agentRunWorker } from '../workers/agent-run.worker.js';

describe('Supervisor Dashboard Domain Isolation', () => {
    let app: ReturnType<typeof Fastify>;
    let domainAId: number;
    let domainBId: number;
    let supervisorToken: string;
    const originalExperimentalRevenue = process.env.ENABLE_EXPERIMENTAL_REVENUE;
    const originalExperimentalAgentRuns = process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS;

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

        const [{ nextDomainId }] = await db
            .select({
                nextDomainId: sql<number>`coalesce(max(${domains.id}), 0) + 1`
            })
            .from(domains);

        const [domainA] = await db.insert(domains).values({
            id: nextDomainId,
            name: 'Supervisor Domain A',
            hostname: `supervisor-a-${Date.now()}.local`
        }).returning();
        domainAId = domainA.id;

        const [domainB] = await db.insert(domains).values({
            id: nextDomainId + 1,
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
        if (originalExperimentalRevenue === undefined) {
            delete process.env.ENABLE_EXPERIMENTAL_REVENUE;
        } else {
            process.env.ENABLE_EXPERIMENTAL_REVENUE = originalExperimentalRevenue;
        }
        if (originalExperimentalAgentRuns === undefined) {
            delete process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS;
        } else {
            process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = originalExperimentalAgentRuns;
        }
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
        process.env.ENABLE_EXPERIMENTAL_REVENUE = 'true';
        process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = 'false';

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
                activeActors: number;
            };
            experimentalModules: {
                revenue: boolean;
                agentRuns: boolean;
            };
            paymentSummary: {
                settledTotal: number;
                settledCount: number;
                pendingTotal: number;
                pendingCount: number;
            };
            agentRunSummary: null;
            recentEvents: Array<{ domainId: number; details: string | null }>;
            alerts: Array<{ type: string; message: string }>;
        };

        expect(payload.activitySummary.creates).toBe(1);
        expect(payload.activitySummary.updates).toBe(0);
        expect(payload.activitySummary.deletes).toBe(0);
        expect(payload.activitySummary.rollbacks).toBe(1);
        expect(payload.activitySummary.activeActors).toBe(2);

        expect(payload.experimentalModules.revenue).toBe(true);
        expect(payload.experimentalModules.agentRuns).toBe(false);
        expect(payload.paymentSummary).toEqual({
            settledTotal: 150,
            settledCount: 1,
            pendingTotal: 70,
            pendingCount: 1
        });
        expect(payload.agentRunSummary).toBeNull();

        expect(payload.recentEvents.every((event) => event.domainId === domainAId)).toBe(true);
        expect(payload.recentEvents.some((event) => event.details === 'domain-b-create')).toBe(false);

        const alertMessages = payload.alerts.map((alert) => alert.message);
        expect(alertMessages.some((message) => message.includes('domain-a-error'))).toBe(true);
        expect(alertMessages.some((message) => message.includes('domain-b-error'))).toBe(false);
    });

    it('returns core payment summary when experimental revenue is disabled', async () => {
        delete process.env.ENABLE_EXPERIMENTAL_REVENUE;
        process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = 'false';

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
            experimentalModules: {
                revenue: boolean;
                agentRuns: boolean;
            };
            paymentSummary: {
                settledTotal: number;
                settledCount: number;
                pendingTotal: number;
                pendingCount: number;
            };
            agentRunSummary: null;
        };

        expect(payload.experimentalModules.revenue).toBe(false);
        expect(payload.experimentalModules.agentRuns).toBe(false);
        expect(payload.paymentSummary).toEqual({
            settledTotal: 150,
            settledCount: 1,
            pendingTotal: 70,
            pendingCount: 1
        });
        expect(payload.agentRunSummary).toBeNull();
    });

    it('includes experimental autonomous-run summary when the module is enabled', async () => {
        process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = 'true';
        const metricsSpy = vi.spyOn(AgentRunMetricsService, 'getMetrics').mockResolvedValue({
            window: {
                hours: 24,
                from: '2026-03-07T00:00:00.000Z',
                to: '2026-03-08T00:00:00.000Z',
                runType: null
            },
            queue: {
                backlog: 7,
                queued: 5,
                planning: 0,
                waitingApproval: 1,
                running: 1
            },
            outcomes: {
                succeeded: 4,
                failed: 1,
                cancelled: 0,
                completionRate: 0.8
            },
            latencyMs: {
                queueToStartAvg: 1000,
                queueToStartSamples: 2,
                completionAvg: 2000,
                completionSamples: 2
            },
            throughput: {
                createdRuns: 5,
                startedRuns: 4,
                completedRuns: 5,
                reviewActionsPlanned: 3,
                reviewActionsSucceeded: 3,
                qualityChecksPlanned: 2,
                qualityChecksSucceeded: 1
            },
            failureClasses: {
                policyDenied: 1,
                reviewExecutionFailed: 0,
                qualityValidationFailed: 0,
                settledFailed: 1
            }
        });
        const workerSpy = vi.spyOn(agentRunWorker, 'getStatus').mockReturnValue({
            started: true,
            sweepInProgress: false,
            intervalMs: 1000,
            maxRunsPerSweep: 25,
            lastSweepStartedAt: '2026-03-08T12:00:00.000Z',
            lastSweepCompletedAt: '2026-03-08T12:00:01.000Z',
            lastSweepProcessedRuns: 2,
            totalSweeps: 17,
            totalProcessedRuns: 19,
            lastError: null
        });

        try {
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
                experimentalModules: {
                    agentRuns: boolean;
                };
                agentRunSummary: {
                    queue: {
                        backlog: number;
                        waitingApproval: number;
                        running: number;
                    };
                    throughput: {
                        completedRuns: number;
                        reviewActionsSucceeded: number;
                        qualityChecksSucceeded: number;
                    };
                    failures: {
                        settledFailed: number;
                        policyDenied: number;
                    };
                    worker: {
                        started: boolean;
                        totalSweeps: number;
                        lastError: null | { message: string };
                    };
                } | null;
                alerts: Array<{ message: string }>;
            };

            expect(metricsSpy).toHaveBeenCalledWith(domainAId, { windowHours: 24 });
            expect(workerSpy).toHaveBeenCalledTimes(1);
            expect(payload.experimentalModules.agentRuns).toBe(true);
            expect(payload.agentRunSummary).toMatchObject({
                queue: {
                    backlog: 7,
                    waitingApproval: 1,
                    running: 1
                },
                throughput: {
                    completedRuns: 5,
                    reviewActionsSucceeded: 3,
                    qualityChecksSucceeded: 1
                },
                failures: {
                    settledFailed: 1,
                    policyDenied: 1
                },
                worker: {
                    started: true,
                    totalSweeps: 17,
                    lastError: null
                }
            });
            expect(payload.alerts.some((alert) => alert.message.includes('Autonomous-run worker'))).toBe(false);
        } finally {
            metricsSpy.mockRestore();
            workerSpy.mockRestore();
        }
    });
});
