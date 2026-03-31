import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { sql, and, desc, eq, gt } from 'drizzle-orm';
import { isExperimentalAgentRunsEnabled, isExperimentalRevenueEnabled } from '../config/runtime-features.js';
import { db } from '../db/index.js';
import { auditLogs, contentItems, contentTypes, payments } from '../db/schema.js';
import type { ActorPrincipal } from '../services/actor-identity.js';
import { AgentRunMetricsService } from '../services/agent-run-metrics.js';
import { agentRunWorker } from '../workers/agent-run.worker.js';
import { resolveSupervisorSessionPrincipal, type SupervisorSessionClaims } from './supervisor-session.js';

export const supervisorDashboardRoutes: FastifyPluginAsync = async (server: FastifyInstance) => {
    // Shared authenticaton hook for these routes
    server.addHook('onRequest', async (request, reply) => {
        try {
            await request.jwtVerify({ onlyCookie: true });
            const user = request.user as SupervisorSessionClaims;
            const resolved = resolveSupervisorSessionPrincipal(user, request.headers);
            if (!resolved.ok) {
                return reply.status(resolved.statusCode).send(resolved.payload);
            }
            (request as { authPrincipal?: ActorPrincipal }).authPrincipal = resolved.principal;
        } catch (err) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
    });

    server.get('/dashboard', async (request, reply) => {
        const domainId = (request as { authPrincipal?: ActorPrincipal }).authPrincipal?.domainId;
        if (!domainId) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        // 1. System Health
        let dbOk = false;
        try {
            await db.execute(sql`SELECT 1`);
            dbOk = true;
        } catch {
            dbOk = false;
        }

        const health = {
            api: 'ok',
            database: dbOk ? 'ok' : 'down',
            rateLimitStatus: 'operational' // Placeholder for actual rate limit monitoring
        };

        // 2. Activity Summary (Last 24h)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        const recentLogs = await db
            .select()
            .from(auditLogs)
            .where(and(eq(auditLogs.domainId, domainId), gt(auditLogs.createdAt, yesterday)));

        const activitySummary = {
            creates: recentLogs.filter(l => l.action === 'create').length,
            updates: recentLogs.filter(l => l.action === 'update').length,
            deletes: recentLogs.filter(l => l.action === 'delete').length,
            rollbacks: recentLogs.filter(l => l.action === 'rollback').length,
            activeActors: new Set(
                recentLogs
                    .map((log) => log.actorId ?? (log.userId ? `api_key:${log.userId}` : null))
                    .filter((actor): actor is string => Boolean(actor))
            ).size
        };

        const paidPayments = await db
            .select()
            .from(payments)
            .where(and(eq(payments.domainId, domainId), eq(payments.status, 'paid')));
        const pendingPayments = await db
            .select()
            .from(payments)
            .where(and(eq(payments.domainId, domainId), eq(payments.status, 'pending')));

        const paymentSummary: {
            settledTotal: number;
            settledCount: number;
            pendingTotal: number;
            pendingCount: number;
        } = {
            settledTotal: paidPayments.reduce((acc, curr) => acc + curr.amountSatoshis, 0),
            settledCount: paidPayments.length,
            pendingTotal: pendingPayments.reduce((acc, curr) => acc + curr.amountSatoshis, 0),
            pendingCount: pendingPayments.length
        };
        let agentRunSummary: {
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
                sweepInProgress: boolean;
                intervalMs: number;
                maxRunsPerSweep: number;
                lastSweepCompletedAt: string | null;
                totalSweeps: number;
                lastError: {
                    message: string;
                    at: string;
                } | null;
            };
        } | null = null;

        if (isExperimentalAgentRunsEnabled()) {
            const metrics = await AgentRunMetricsService.getMetrics(domainId, {
                windowHours: 24
            });
            const workerStatus = agentRunWorker.getStatus();

            agentRunSummary = {
                queue: {
                    backlog: metrics.queue.backlog,
                    waitingApproval: metrics.queue.waitingApproval,
                    running: metrics.queue.running
                },
                throughput: {
                    completedRuns: metrics.throughput.completedRuns,
                    reviewActionsSucceeded: metrics.throughput.reviewActionsSucceeded,
                    qualityChecksSucceeded: metrics.throughput.qualityChecksSucceeded
                },
                failures: {
                    settledFailed: metrics.failureClasses.settledFailed,
                    policyDenied: metrics.failureClasses.policyDenied
                },
                worker: {
                    started: workerStatus.started,
                    sweepInProgress: workerStatus.sweepInProgress,
                    intervalMs: workerStatus.intervalMs,
                    maxRunsPerSweep: workerStatus.maxRunsPerSweep,
                    lastSweepCompletedAt: workerStatus.lastSweepCompletedAt,
                    totalSweeps: workerStatus.totalSweeps,
                    lastError: workerStatus.lastError
                }
            };
        }

        // 3. Recent Audit Events Feed (Last 20)
        const recentEvents = await db
            .select()
            .from(auditLogs)
            .where(eq(auditLogs.domainId, domainId))
            .orderBy(desc(auditLogs.createdAt))
            .limit(20);

        // 4. Alert Indicators
        const alerts = [];
        if (!dbOk) alerts.push({ type: 'critical', message: 'Database connection failed' });

        const errorLogs = await db
            .select()
            .from(auditLogs)
            .where(and(eq(auditLogs.domainId, domainId), eq(auditLogs.action, 'error')))
            .orderBy(desc(auditLogs.createdAt))
            .limit(5);

        for (const errLog of errorLogs) {
            alerts.push({ type: 'warning', message: `System Error: ${errLog.details || 'Unknown error'}` });
        }

        if (activitySummary.rollbacks > 5) {
            alerts.push({ type: 'warning', message: `High rollback activity in the last 24 hours (${activitySummary.rollbacks})` });
        }

        if (agentRunSummary) {
            if (!agentRunSummary.worker.started) {
                alerts.push({ type: 'warning', message: 'Autonomous-run worker is enabled but not started.' });
            }

            if (agentRunSummary.worker.lastError) {
                alerts.push({
                    type: 'warning',
                    message: `Autonomous-run worker error: ${agentRunSummary.worker.lastError.message}`
                });
            }

            if (agentRunSummary.queue.backlog > 25) {
                alerts.push({
                    type: 'warning',
                    message: `Autonomous-run backlog is elevated (${agentRunSummary.queue.backlog} queued or active runs).`
                });
            }
        }

        return {
            health,
            activitySummary,
            experimentalModules: {
                revenue: isExperimentalRevenueEnabled(),
                agentRuns: isExperimentalAgentRunsEnabled()
            },
            paymentSummary,
            agentRunSummary,
            recentEvents,
            alerts
        };
    });
};
