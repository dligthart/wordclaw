import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '../db/index.js';
import {
    agentRunCheckpoints,
    agentRuns,
    domains,
} from '../db/schema.js';
import { AgentRunMetricsService } from './agent-run-metrics.js';

describe.sequential('AgentRunMetricsService', () => {
    const domainId = 91001;

    beforeAll(async () => {
        const [domain] = await db.select().from(domains).where(eq(domains.id, domainId));
        if (!domain) {
            await db.insert(domains).values({
                id: domainId,
                name: 'Agent Run Metrics Test Domain',
                hostname: `agent-run-metrics-${domainId}.local`,
            });
        }
    });

    afterAll(async () => {
        await db.delete(domains).where(eq(domains.id, domainId));
    });

    it('summarizes queue health, latency, throughput, and failure classes', async () => {
        await db.delete(agentRunCheckpoints).where(eq(agentRunCheckpoints.domainId, domainId));
        await db.delete(agentRuns).where(eq(agentRuns.domainId, domainId));

        const now = new Date();
        const minutesAgo = (minutes: number) =>
            new Date(now.getTime() - minutes * 60 * 1000);
        const hoursAgo = (hours: number) =>
            new Date(now.getTime() - hours * 60 * 60 * 1000);

        const insertedRuns = await db.insert(agentRuns).values([
            {
                domainId,
                goal: 'queued-review-run',
                runType: 'review_backlog_manager',
                status: 'queued',
                createdAt: minutesAgo(30),
                updatedAt: minutesAgo(30),
            },
            {
                domainId,
                goal: 'running-review-run',
                runType: 'review_backlog_manager',
                status: 'running',
                createdAt: minutesAgo(20),
                startedAt: minutesAgo(15),
                updatedAt: minutesAgo(15),
            },
            {
                domainId,
                goal: 'succeeded-review-run',
                runType: 'review_backlog_manager',
                status: 'succeeded',
                createdAt: hoursAgo(12),
                startedAt: hoursAgo(11),
                completedAt: hoursAgo(10),
                updatedAt: hoursAgo(10),
            },
            {
                domainId,
                goal: 'failed-review-run',
                runType: 'review_backlog_manager',
                status: 'failed',
                createdAt: hoursAgo(11),
                startedAt: hoursAgo(10.5),
                completedAt: hoursAgo(10),
                updatedAt: hoursAgo(10),
            },
            {
                domainId,
                goal: 'succeeded-quality-run',
                runType: 'quality_refiner',
                status: 'succeeded',
                createdAt: hoursAgo(7),
                startedAt: hoursAgo(6.5),
                completedAt: hoursAgo(6),
                updatedAt: hoursAgo(6),
            },
            {
                domainId,
                goal: 'failed-quality-run',
                runType: 'quality_refiner',
                status: 'failed',
                createdAt: hoursAgo(6),
                startedAt: hoursAgo(5.5),
                completedAt: hoursAgo(5),
                updatedAt: hoursAgo(5),
            },
            {
                domainId,
                goal: 'cancelled-quality-run',
                runType: 'quality_refiner',
                status: 'cancelled',
                createdAt: hoursAgo(4),
                startedAt: hoursAgo(3.5),
                completedAt: hoursAgo(3),
                updatedAt: hoursAgo(3),
            },
        ]).returning();

        const runIds = new Map(
            insertedRuns.map((run) => [run.goal, run.id]),
        );

        await db.insert(agentRunCheckpoints).values([
            {
                runId: runIds.get('succeeded-review-run')!,
                domainId,
                checkpointKey: 'planned_review_actions',
                payload: { selectedCount: 3 },
                createdAt: hoursAgo(11),
            },
            {
                runId: runIds.get('succeeded-review-run')!,
                domainId,
                checkpointKey: 'review_execution_completed',
                payload: { succeededCount: 3 },
                createdAt: hoursAgo(10),
            },
            {
                runId: runIds.get('succeeded-review-run')!,
                domainId,
                checkpointKey: 'control_approve_settled',
                payload: { settledStatus: 'succeeded' },
                createdAt: hoursAgo(10),
            },
            {
                runId: runIds.get('failed-review-run')!,
                domainId,
                checkpointKey: 'planned_review_actions',
                payload: { selectedCount: 2 },
                createdAt: hoursAgo(10.75),
            },
            {
                runId: runIds.get('failed-review-run')!,
                domainId,
                checkpointKey: 'policy_denied',
                payload: { code: 'POLICY_DENIED' },
                createdAt: hoursAgo(10.5),
            },
            {
                runId: runIds.get('failed-review-run')!,
                domainId,
                checkpointKey: 'review_execution_failed',
                payload: { failedCount: 1, succeededCount: 1 },
                createdAt: hoursAgo(10),
            },
            {
                runId: runIds.get('failed-review-run')!,
                domainId,
                checkpointKey: 'control_approve_settled',
                payload: { settledStatus: 'failed' },
                createdAt: hoursAgo(10),
            },
            {
                runId: runIds.get('succeeded-quality-run')!,
                domainId,
                checkpointKey: 'planned_quality_checks',
                payload: { selectedCount: 4 },
                createdAt: hoursAgo(6.75),
            },
            {
                runId: runIds.get('succeeded-quality-run')!,
                domainId,
                checkpointKey: 'quality_validation_completed',
                payload: { succeededCount: 4 },
                createdAt: hoursAgo(6),
            },
            {
                runId: runIds.get('failed-quality-run')!,
                domainId,
                checkpointKey: 'planned_quality_checks',
                payload: { selectedCount: 4 },
                createdAt: hoursAgo(5.75),
            },
            {
                runId: runIds.get('failed-quality-run')!,
                domainId,
                checkpointKey: 'quality_validation_failed',
                payload: { failedCount: 1 },
                createdAt: hoursAgo(5),
            },
            {
                runId: runIds.get('failed-quality-run')!,
                domainId,
                checkpointKey: 'control_approve_settled',
                payload: { settledStatus: 'failed' },
                createdAt: hoursAgo(5),
            },
        ]);

        const allMetrics = await AgentRunMetricsService.getMetrics(domainId, {
            windowHours: 24,
        });

        expect(allMetrics.queue).toEqual({
            backlog: 2,
            queued: 1,
            planning: 0,
            waitingApproval: 0,
            running: 1,
        });
        expect(allMetrics.outcomes).toEqual({
            succeeded: 2,
            failed: 2,
            cancelled: 1,
            completionRate: 0.4,
        });
        expect(allMetrics.latencyMs).toEqual({
            queueToStartAvg: 1850000,
            queueToStartSamples: 6,
            completionAvg: 4320000,
            completionSamples: 5,
        });
        expect(allMetrics.throughput).toEqual({
            createdRuns: 7,
            startedRuns: 6,
            completedRuns: 5,
            reviewActionsPlanned: 5,
            reviewActionsSucceeded: 3,
            qualityChecksPlanned: 8,
            qualityChecksSucceeded: 4,
        });
        expect(allMetrics.failureClasses).toEqual({
            policyDenied: 1,
            reviewExecutionFailed: 1,
            qualityValidationFailed: 1,
            settledFailed: 2,
        });

        const reviewMetrics = await AgentRunMetricsService.getMetrics(domainId, {
            windowHours: 24,
            runType: 'review_backlog_manager',
        });

        expect(reviewMetrics.window.runType).toBe('review_backlog_manager');
        expect(reviewMetrics.queue).toEqual({
            backlog: 2,
            queued: 1,
            planning: 0,
            waitingApproval: 0,
            running: 1,
        });
        expect(reviewMetrics.outcomes).toEqual({
            succeeded: 1,
            failed: 1,
            cancelled: 0,
            completionRate: 0.5,
        });
        expect(reviewMetrics.throughput).toEqual({
            createdRuns: 4,
            startedRuns: 3,
            completedRuns: 2,
            reviewActionsPlanned: 5,
            reviewActionsSucceeded: 3,
            qualityChecksPlanned: 0,
            qualityChecksSucceeded: 0,
        });
        expect(reviewMetrics.failureClasses).toEqual({
            policyDenied: 1,
            reviewExecutionFailed: 1,
            qualityValidationFailed: 0,
            settledFailed: 1,
        });

        const remainingRuns = await db.select()
            .from(agentRuns)
            .where(and(eq(agentRuns.domainId, domainId), eq(agentRuns.runType, 'review_backlog_manager')));
        expect(remainingRuns).toHaveLength(4);
    });
});
