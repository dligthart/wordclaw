import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { sql, and, desc, eq, gt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { auditLogs, contentItems, contentTypes, payments } from '../db/schema.js';

export const supervisorDashboardRoutes: FastifyPluginAsync = async (server: FastifyInstance) => {
    // Shared authenticaton hook for these routes
    server.addHook('onRequest', async (request, reply) => {
        try {
            await request.jwtVerify({ onlyCookie: true });
        } catch (err) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
    });

    server.get('/dashboard', async (request, reply) => {
        const rawDomainHeader = request.headers['x-wordclaw-domain'];
        const domainHeader = Array.isArray(rawDomainHeader) ? rawDomainHeader[0] : rawDomainHeader;
        const domainId = Number.parseInt(domainHeader ?? '', 10);

        if (!Number.isInteger(domainId) || domainId <= 0) {
            return reply.status(400).send({
                error: 'Invalid domain context',
                code: 'INVALID_DOMAIN_CONTEXT',
                remediation: 'Provide x-wordclaw-domain header with a positive integer domain ID.'
            });
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
            totalAgentsActive: new Set(recentLogs.filter(l => l.userId).map(l => l.userId)).size
        };

        // 3. Earnings Summary
        const allPaid = await db
            .select()
            .from(payments)
            .where(and(eq(payments.domainId, domainId), eq(payments.status, 'paid')));
        const totalEarnings = allPaid.reduce((acc, curr) => acc + curr.amountSatoshis, 0);

        const pendingPayments = await db
            .select()
            .from(payments)
            .where(and(eq(payments.domainId, domainId), eq(payments.status, 'pending')));
        const pendingEarnings = pendingPayments.reduce((acc, curr) => acc + curr.amountSatoshis, 0);

        const earningsSummary = {
            total: totalEarnings,
            pending: pendingEarnings,
            pendingCount: pendingPayments.length
        };

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

        return {
            health,
            activitySummary,
            earningsSummary,
            recentEvents,
            alerts
        };
    });
};
