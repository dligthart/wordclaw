import { and, eq, gte } from 'drizzle-orm';

import { db } from '../db/index.js';
import { agentRunCheckpoints, agentRuns } from '../db/schema.js';

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function averageOrNull(values: number[]): number | null {
    if (values.length === 0) {
        return null;
    }

    return Math.round(
        values.reduce((sum, value) => sum + value, 0) / values.length,
    );
}

function normalizeWindowHours(value?: number): number {
    if (value === undefined) {
        return 24;
    }

    return Math.max(1, Math.min(Math.floor(value), 720));
}

export type AgentRunMetrics = {
    window: {
        hours: number;
        from: string;
        to: string;
        runType: string | null;
    };
    queue: {
        backlog: number;
        queued: number;
        planning: number;
        waitingApproval: number;
        running: number;
    };
    outcomes: {
        succeeded: number;
        failed: number;
        cancelled: number;
        completionRate: number | null;
    };
    latencyMs: {
        queueToStartAvg: number | null;
        queueToStartSamples: number;
        completionAvg: number | null;
        completionSamples: number;
    };
    throughput: {
        createdRuns: number;
        startedRuns: number;
        completedRuns: number;
        reviewActionsPlanned: number;
        reviewActionsSucceeded: number;
        qualityChecksPlanned: number;
        qualityChecksSucceeded: number;
    };
    failureClasses: {
        policyDenied: number;
        reviewExecutionFailed: number;
        qualityValidationFailed: number;
        settledFailed: number;
    };
};

export class AgentRunMetricsService {
    static async getMetrics(
        domainId: number,
        options: { windowHours?: number; runType?: string } = {},
    ): Promise<AgentRunMetrics> {
        const windowHours = normalizeWindowHours(options.windowHours);
        const runType = options.runType?.trim() || undefined;
        const now = new Date();
        const windowStart = new Date(now.getTime() - windowHours * 60 * 60 * 1000);

        const runConditions = [
            eq(agentRuns.domainId, domainId),
            runType ? eq(agentRuns.runType, runType) : undefined,
        ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

        const runs = await db.select({
            id: agentRuns.id,
            status: agentRuns.status,
            createdAt: agentRuns.createdAt,
            startedAt: agentRuns.startedAt,
            completedAt: agentRuns.completedAt,
        })
            .from(agentRuns)
            .where(and(...runConditions));

        const checkpointConditions = [
            eq(agentRunCheckpoints.domainId, domainId),
            gte(agentRunCheckpoints.createdAt, windowStart),
            runType ? eq(agentRuns.runType, runType) : undefined,
        ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

        const checkpoints = await db.select({
            checkpointKey: agentRunCheckpoints.checkpointKey,
            payload: agentRunCheckpoints.payload,
        })
            .from(agentRunCheckpoints)
            .innerJoin(agentRuns, eq(agentRunCheckpoints.runId, agentRuns.id))
            .where(and(...checkpointConditions));

        const queue = {
            queued: 0,
            planning: 0,
            waitingApproval: 0,
            running: 0,
        };
        const outcomeCounts = {
            succeeded: 0,
            failed: 0,
            cancelled: 0,
        };
        const queueToStartSamples: number[] = [];
        const completionSamples: number[] = [];
        const throughput = {
            createdRuns: 0,
            startedRuns: 0,
            completedRuns: 0,
            reviewActionsPlanned: 0,
            reviewActionsSucceeded: 0,
            qualityChecksPlanned: 0,
            qualityChecksSucceeded: 0,
        };
        const failureClasses = {
            policyDenied: 0,
            reviewExecutionFailed: 0,
            qualityValidationFailed: 0,
            settledFailed: 0,
        };

        for (const run of runs) {
            if (run.status === 'queued') {
                queue.queued += 1;
            } else if (run.status === 'planning') {
                queue.planning += 1;
            } else if (run.status === 'waiting_approval') {
                queue.waitingApproval += 1;
            } else if (run.status === 'running') {
                queue.running += 1;
            }

            if (run.createdAt >= windowStart) {
                throughput.createdRuns += 1;
            }

            if (run.startedAt && run.startedAt >= windowStart) {
                throughput.startedRuns += 1;
                queueToStartSamples.push(
                    Math.max(0, run.startedAt.getTime() - run.createdAt.getTime()),
                );
            }

            if (run.completedAt && run.completedAt >= windowStart) {
                throughput.completedRuns += 1;
                completionSamples.push(
                    Math.max(0, run.completedAt.getTime() - run.createdAt.getTime()),
                );

                if (run.status === 'succeeded') {
                    outcomeCounts.succeeded += 1;
                } else if (run.status === 'failed') {
                    outcomeCounts.failed += 1;
                } else if (run.status === 'cancelled') {
                    outcomeCounts.cancelled += 1;
                }
            }
        }

        for (const checkpoint of checkpoints) {
            const payload = isRecord(checkpoint.payload) ? checkpoint.payload : {};

            if (checkpoint.checkpointKey === 'planned_review_actions') {
                throughput.reviewActionsPlanned += asNumber(payload.selectedCount) ?? 0;
                continue;
            }

            if (checkpoint.checkpointKey === 'review_execution_completed') {
                throughput.reviewActionsSucceeded += asNumber(payload.succeededCount) ?? 0;
                continue;
            }

            if (checkpoint.checkpointKey === 'planned_quality_checks') {
                throughput.qualityChecksPlanned += asNumber(payload.selectedCount) ?? 0;
                continue;
            }

            if (checkpoint.checkpointKey === 'quality_validation_completed') {
                throughput.qualityChecksSucceeded += asNumber(payload.succeededCount) ?? 0;
                continue;
            }

            if (checkpoint.checkpointKey === 'policy_denied') {
                failureClasses.policyDenied += 1;
                continue;
            }

            if (checkpoint.checkpointKey === 'review_execution_failed') {
                failureClasses.reviewExecutionFailed += 1;
                continue;
            }

            if (checkpoint.checkpointKey === 'quality_validation_failed') {
                failureClasses.qualityValidationFailed += 1;
                continue;
            }

            if (
                checkpoint.checkpointKey.endsWith('_settled')
                && payload.settledStatus === 'failed'
            ) {
                failureClasses.settledFailed += 1;
            }
        }

        const completedTotal = outcomeCounts.succeeded + outcomeCounts.failed + outcomeCounts.cancelled;

        return {
            window: {
                hours: windowHours,
                from: windowStart.toISOString(),
                to: now.toISOString(),
                runType: runType ?? null,
            },
            queue: {
                backlog: queue.queued + queue.planning + queue.waitingApproval + queue.running,
                ...queue,
            },
            outcomes: {
                ...outcomeCounts,
                completionRate: completedTotal === 0
                    ? null
                    : Number((outcomeCounts.succeeded / completedTotal).toFixed(4)),
            },
            latencyMs: {
                queueToStartAvg: averageOrNull(queueToStartSamples),
                queueToStartSamples: queueToStartSamples.length,
                completionAvg: averageOrNull(completionSamples),
                completionSamples: completionSamples.length,
            },
            throughput,
            failureClasses,
        };
    }
}
