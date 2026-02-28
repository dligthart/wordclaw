import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import { agentRunCheckpoints, agentRunDefinitions, agentRunSteps, agentRuns } from '../db/schema.js';
import { logAudit } from './audit.js';

export const AGENT_RUN_STATUSES = [
    'queued',
    'planning',
    'waiting_approval',
    'running',
    'succeeded',
    'failed',
    'cancelled'
] as const;

export const AGENT_RUN_STEP_STATUSES = [
    'pending',
    'executing',
    'succeeded',
    'failed',
    'skipped'
] as const;

export const AGENT_RUN_CONTROL_ACTIONS = [
    'approve',
    'pause',
    'resume',
    'cancel'
] as const;

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];
export type AgentRunStepStatus = (typeof AGENT_RUN_STEP_STATUSES)[number];
export type AgentRunControlAction = (typeof AGENT_RUN_CONTROL_ACTIONS)[number];

export type CreateAgentRunInput = {
    goal: string;
    runType?: string;
    definitionId?: number;
    requireApproval?: boolean;
    metadata?: Record<string, unknown> | null;
    requestedBy?: string;
};

export type ListAgentRunsOptions = {
    status?: AgentRunStatus;
    limit?: number;
    offset?: number;
};

export type AgentRunWithDetails = {
    run: typeof agentRuns.$inferSelect;
    steps: Array<typeof agentRunSteps.$inferSelect>;
    checkpoints: Array<typeof agentRunCheckpoints.$inferSelect>;
};

export class AgentRunServiceError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = 'AgentRunServiceError';
    }
}

function clampLimit(limit?: number, fallback = 50, max = 500): number {
    if (limit === undefined) {
        return fallback;
    }

    return Math.max(1, Math.min(limit, max));
}

function clampOffset(offset?: number): number {
    if (offset === undefined) {
        return 0;
    }

    return Math.max(0, offset);
}

export function isAgentRunStatus(value: string): value is AgentRunStatus {
    return (AGENT_RUN_STATUSES as readonly string[]).includes(value);
}

export function isAgentRunControlAction(value: string): value is AgentRunControlAction {
    return (AGENT_RUN_CONTROL_ACTIONS as readonly string[]).includes(value);
}

export function resolveAgentRunTransition(
    currentStatus: AgentRunStatus,
    action: AgentRunControlAction,
    hasStarted: boolean
): AgentRunStatus {
    if (action === 'approve') {
        if (currentStatus === 'waiting_approval') {
            return 'running';
        }
        if (currentStatus === 'running') {
            return 'running';
        }
        throw new AgentRunServiceError(
            'AGENT_RUN_INVALID_TRANSITION',
            `Cannot approve run from status '${currentStatus}'.`
        );
    }

    if (action === 'pause') {
        if (currentStatus === 'queued' || currentStatus === 'planning' || currentStatus === 'running' || currentStatus === 'waiting_approval') {
            return 'waiting_approval';
        }
        throw new AgentRunServiceError(
            'AGENT_RUN_INVALID_TRANSITION',
            `Cannot pause run from status '${currentStatus}'.`
        );
    }

    if (action === 'resume') {
        if (currentStatus === 'waiting_approval') {
            return hasStarted ? 'running' : 'queued';
        }
        if (currentStatus === 'queued' || currentStatus === 'running') {
            return currentStatus;
        }
        throw new AgentRunServiceError(
            'AGENT_RUN_INVALID_TRANSITION',
            `Cannot resume run from status '${currentStatus}'.`
        );
    }

    if (action === 'cancel') {
        if (currentStatus === 'cancelled') {
            return 'cancelled';
        }
        if (currentStatus === 'succeeded' || currentStatus === 'failed') {
            throw new AgentRunServiceError(
                'AGENT_RUN_INVALID_TRANSITION',
                `Cannot cancel run from terminal status '${currentStatus}'.`
            );
        }
        return 'cancelled';
    }

    throw new AgentRunServiceError('AGENT_RUN_INVALID_ACTION', `Unsupported action '${action}'.`);
}

export class AgentRunService {
    static async createRun(domainId: number, input: CreateAgentRunInput) {
        const goal = input.goal?.trim();
        if (!goal) {
            throw new AgentRunServiceError(
                'AGENT_RUN_INVALID_GOAL',
                'Goal is required to create an agent run.'
            );
        }

        let definitionId: number | null = null;
        let inferredRunType: string | null = null;

        if (input.definitionId !== undefined) {
            const [definition] = await db.select()
                .from(agentRunDefinitions)
                .where(and(
                    eq(agentRunDefinitions.id, input.definitionId),
                    eq(agentRunDefinitions.domainId, domainId)
                ));

            if (!definition) {
                throw new AgentRunServiceError(
                    'AGENT_RUN_DEFINITION_NOT_FOUND',
                    `Run definition ${input.definitionId} was not found in this domain.`
                );
            }

            definitionId = definition.id;
            inferredRunType = definition.runType;
        }

        const runType = input.runType?.trim() || inferredRunType || 'review_backlog_manager';
        const status: AgentRunStatus = input.requireApproval ? 'waiting_approval' : 'queued';

        const created = await db.transaction(async (tx) => {
            const [newRun] = await tx.insert(agentRuns).values({
                domainId,
                definitionId,
                goal,
                runType,
                status,
                requestedBy: input.requestedBy,
                metadata: input.metadata ?? null
            }).returning();

            await tx.insert(agentRunSteps).values({
                runId: newRun.id,
                domainId,
                stepIndex: 0,
                stepKey: 'plan_run',
                actionType: 'plan',
                status: 'pending'
            });

            await tx.insert(agentRunCheckpoints).values({
                runId: newRun.id,
                domainId,
                checkpointKey: 'created',
                payload: {
                    status: newRun.status,
                    goal: newRun.goal,
                    runType: newRun.runType,
                    requestedBy: newRun.requestedBy
                }
            });

            return newRun;
        });

        await logAudit(domainId, 'create', 'agent_run', created.id, {
            goal: created.goal,
            runType: created.runType,
            status: created.status,
            definitionId: created.definitionId,
            requestedBy: created.requestedBy
        });

        return created;
    }

    static async listRuns(domainId: number, options: ListAgentRunsOptions = {}) {
        const limit = clampLimit(options.limit);
        const offset = clampOffset(options.offset);

        if (options.status && !isAgentRunStatus(options.status)) {
            throw new AgentRunServiceError(
                'AGENT_RUN_INVALID_STATUS',
                `Invalid run status '${options.status}'.`
            );
        }

        const whereClause = options.status
            ? and(eq(agentRuns.domainId, domainId), eq(agentRuns.status, options.status))
            : eq(agentRuns.domainId, domainId);

        const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
            .from(agentRuns)
            .where(whereClause);

        const items = await db.select()
            .from(agentRuns)
            .where(whereClause)
            .orderBy(desc(agentRuns.createdAt), desc(agentRuns.id))
            .limit(limit)
            .offset(offset);

        return {
            items,
            total,
            limit,
            offset,
            hasMore: offset + items.length < total
        };
    }

    static async getRun(domainId: number, runId: number): Promise<AgentRunWithDetails | null> {
        const [run] = await db.select()
            .from(agentRuns)
            .where(and(eq(agentRuns.id, runId), eq(agentRuns.domainId, domainId)));

        if (!run) {
            return null;
        }

        const steps = await db.select()
            .from(agentRunSteps)
            .where(and(
                eq(agentRunSteps.domainId, domainId),
                eq(agentRunSteps.runId, runId)
            ))
            .orderBy(asc(agentRunSteps.stepIndex), asc(agentRunSteps.id));

        const checkpoints = await db.select()
            .from(agentRunCheckpoints)
            .where(and(
                eq(agentRunCheckpoints.domainId, domainId),
                eq(agentRunCheckpoints.runId, runId)
            ))
            .orderBy(desc(agentRunCheckpoints.createdAt), desc(agentRunCheckpoints.id));

        return {
            run,
            steps,
            checkpoints
        };
    }

    static async controlRun(domainId: number, runId: number, action: AgentRunControlAction) {
        if (!isAgentRunControlAction(action)) {
            throw new AgentRunServiceError(
                'AGENT_RUN_INVALID_ACTION',
                `Unsupported control action '${action}'.`
            );
        }

        const [run] = await db.select()
            .from(agentRuns)
            .where(and(eq(agentRuns.id, runId), eq(agentRuns.domainId, domainId)));

        if (!run) {
            throw new AgentRunServiceError(
                'AGENT_RUN_NOT_FOUND',
                `Agent run ${runId} was not found in this domain.`
            );
        }

        if (!isAgentRunStatus(run.status)) {
            throw new AgentRunServiceError(
                'AGENT_RUN_CORRUPT_STATUS',
                `Run ${run.id} has unsupported status '${run.status}'.`
            );
        }

        const nextStatus = resolveAgentRunTransition(run.status, action, Boolean(run.startedAt));
        const now = new Date();

        const setPayload: Partial<typeof agentRuns.$inferInsert> = {
            status: nextStatus,
            updatedAt: now
        };

        if (nextStatus === 'running' && !run.startedAt) {
            setPayload.startedAt = now;
        }

        if (nextStatus === 'cancelled' && !run.completedAt) {
            setPayload.completedAt = now;
        }

        const shouldUpdate =
            nextStatus !== run.status
            || (nextStatus === 'running' && !run.startedAt)
            || (nextStatus === 'cancelled' && !run.completedAt);

        if (!shouldUpdate) {
            return run;
        }

        const updated = await db.transaction(async (tx) => {
            const [updatedRun] = await tx.update(agentRuns)
                .set(setPayload)
                .where(and(eq(agentRuns.id, runId), eq(agentRuns.domainId, domainId)))
                .returning();

            if (!updatedRun) {
                return null;
            }

            if (updatedRun.status === 'running') {
                await tx.update(agentRunSteps)
                    .set({
                        status: 'executing',
                        startedAt: now,
                        updatedAt: now
                    })
                    .where(and(
                        eq(agentRunSteps.runId, runId),
                        eq(agentRunSteps.domainId, domainId),
                        eq(agentRunSteps.stepIndex, 0),
                        eq(agentRunSteps.status, 'pending')
                    ));
            }

            if (updatedRun.status === 'cancelled') {
                await tx.update(agentRunSteps)
                    .set({
                        status: 'skipped',
                        completedAt: now,
                        updatedAt: now
                    })
                    .where(and(
                        eq(agentRunSteps.runId, runId),
                        eq(agentRunSteps.domainId, domainId),
                        inArray(agentRunSteps.status, ['pending', 'executing'])
                    ));
            }

            await tx.insert(agentRunCheckpoints).values({
                runId,
                domainId,
                checkpointKey: `control_${action}`,
                payload: {
                    action,
                    fromStatus: run.status,
                    toStatus: updatedRun.status,
                    at: now.toISOString()
                }
            });

            return updatedRun;
        });

        if (!updated) {
            throw new AgentRunServiceError(
                'AGENT_RUN_NOT_FOUND',
                `Agent run ${runId} was not found in this domain.`
            );
        }

        await logAudit(domainId, 'update', 'agent_run', updated.id, {
            action,
            fromStatus: run.status,
            toStatus: updated.status,
            startedAt: updated.startedAt,
            completedAt: updated.completedAt
        });

        return updated;
    }
}
