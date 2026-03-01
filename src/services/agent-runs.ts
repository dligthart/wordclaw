import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import { agentRunCheckpoints, agentRunDefinitions, agentRunSteps, agentRuns, contentItems } from '../db/schema.js';
import { logAudit } from './audit.js';
import { WorkflowService } from './workflow.js';

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

export type CreateAgentRunDefinitionInput = {
    name: string;
    runType: string;
    strategyConfig?: Record<string, unknown> | null;
    active?: boolean;
};

export type UpdateAgentRunDefinitionInput = {
    name?: string;
    runType?: string;
    strategyConfig?: Record<string, unknown> | null;
    active?: boolean;
};

export type ListAgentRunDefinitionsOptions = {
    active?: boolean;
    runType?: string;
    limit?: number;
    offset?: number;
};

export type ListAgentRunsOptions = {
    status?: AgentRunStatus;
    runType?: string;
    definitionId?: number;
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseOptionalPositiveInt(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number.parseInt(value.trim(), 10);
        if (Number.isInteger(parsed) && parsed > 0) {
            return parsed;
        }
    }

    return undefined;
}

function parseBooleanFlag(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    return fallback;
}

function extractReviewCandidateIds(payload: unknown): number[] {
    if (!isRecord(payload) || !Array.isArray(payload.candidates)) {
        return [];
    }

    const ids: number[] = [];
    for (const candidate of payload.candidates) {
        if (!isRecord(candidate)) {
            continue;
        }
        const id = parseOptionalPositiveInt(candidate.id);
        if (id !== undefined && !ids.includes(id)) {
            ids.push(id);
        }
    }

    return ids;
}

function isUniqueViolation(error: unknown, constraintName: string): boolean {
    const visited = new Set<unknown>();
    let candidate: unknown = error;

    while (candidate && typeof candidate === 'object' && !visited.has(candidate)) {
        visited.add(candidate);
        const maybeDbError = candidate as { code?: string; constraint?: string; cause?: unknown };
        if (
            maybeDbError.code === '23505'
            && maybeDbError.constraint === constraintName
        ) {
            return true;
        }
        candidate = maybeDbError.cause;
    }

    return false;
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
        if (currentStatus === 'queued' || currentStatus === 'planning') {
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
        if (currentStatus === 'queued') {
            return 'running';
        }
        if (currentStatus === 'failed') {
            return 'queued';
        }
        if (currentStatus === 'running') {
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
    private static async executeReviewSubmissionSteps(
        domainId: number,
        runId: number,
        metadata?: Record<string, unknown> | null
    ) {
        const assignee = metadata && typeof metadata.reviewAssignee === 'string' && metadata.reviewAssignee.trim().length > 0
            ? metadata.reviewAssignee.trim()
            : undefined;

        const pendingSteps = await db.select()
            .from(agentRunSteps)
            .where(and(
                eq(agentRunSteps.runId, runId),
                eq(agentRunSteps.domainId, domainId),
                eq(agentRunSteps.actionType, 'submit_review'),
                eq(agentRunSteps.status, 'pending')
            ))
            .orderBy(asc(agentRunSteps.stepIndex), asc(agentRunSteps.id));

        for (const step of pendingSteps) {
            const stepStart = new Date();
            await db.update(agentRunSteps)
                .set({
                    status: 'executing',
                    startedAt: step.startedAt ?? stepStart,
                    updatedAt: stepStart
                })
                .where(and(
                    eq(agentRunSteps.id, step.id),
                    eq(agentRunSteps.domainId, domainId),
                    eq(agentRunSteps.runId, runId),
                    eq(agentRunSteps.status, 'pending')
                ));

            const requestSnapshot = isRecord(step.requestSnapshot) ? step.requestSnapshot : {};
            const contentItemId = parseOptionalPositiveInt(requestSnapshot.contentItemId);
            if (!contentItemId) {
                const failedAt = new Date();
                await db.update(agentRunSteps)
                    .set({
                        status: 'failed',
                        completedAt: failedAt,
                        updatedAt: failedAt,
                        errorMessage: 'Missing contentItemId in submit_review request snapshot.'
                    })
                    .where(and(eq(agentRunSteps.id, step.id), eq(agentRunSteps.domainId, domainId)));
                continue;
            }

            const [contentItem] = await db.select({
                id: contentItems.id,
                contentTypeId: contentItems.contentTypeId,
                status: contentItems.status
            })
                .from(contentItems)
                .where(and(
                    eq(contentItems.id, contentItemId),
                    eq(contentItems.domainId, domainId)
                ));
            if (!contentItem) {
                const failedAt = new Date();
                await db.update(agentRunSteps)
                    .set({
                        status: 'failed',
                        completedAt: failedAt,
                        updatedAt: failedAt,
                        errorMessage: `Content item ${contentItemId} not found in this domain.`
                    })
                    .where(and(eq(agentRunSteps.id, step.id), eq(agentRunSteps.domainId, domainId)));
                continue;
            }

            const workflow = await WorkflowService.getActiveWorkflowWithTransitions(domainId, contentItem.contentTypeId);
            if (!workflow || workflow.transitions.length === 0) {
                const failedAt = new Date();
                await db.update(agentRunSteps)
                    .set({
                        status: 'failed',
                        completedAt: failedAt,
                        updatedAt: failedAt,
                        errorMessage: `No active workflow transitions for content type ${contentItem.contentTypeId}.`
                    })
                    .where(and(eq(agentRunSteps.id, step.id), eq(agentRunSteps.domainId, domainId)));
                continue;
            }

            const transition = workflow.transitions.find((candidate) => candidate.fromState === contentItem.status);
            if (!transition) {
                const failedAt = new Date();
                await db.update(agentRunSteps)
                    .set({
                        status: 'failed',
                        completedAt: failedAt,
                        updatedAt: failedAt,
                        errorMessage: `No workflow transition matches content item state '${contentItem.status}'.`
                    })
                    .where(and(eq(agentRunSteps.id, step.id), eq(agentRunSteps.domainId, domainId)));
                continue;
            }

            try {
                const reviewTask = await WorkflowService.submitForReview({
                    domainId,
                    contentItemId: contentItem.id,
                    workflowTransitionId: transition.id,
                    assignee,
                    authPrincipal: {
                        scopes: new Set<string>(['admin']),
                        domainId
                    }
                });

                const succeededAt = new Date();
                await db.update(agentRunSteps)
                    .set({
                        status: 'succeeded',
                        completedAt: succeededAt,
                        updatedAt: succeededAt,
                        errorMessage: null,
                        responseSnapshot: {
                            reviewTaskId: reviewTask.id,
                            workflowId: workflow.id,
                            workflowTransitionId: transition.id,
                            itemStatusBefore: contentItem.status,
                            itemStatusAfter: transition.toState
                        }
                    })
                    .where(and(eq(agentRunSteps.id, step.id), eq(agentRunSteps.domainId, domainId)));

                await db.insert(agentRunCheckpoints).values({
                    runId,
                    domainId,
                    checkpointKey: 'review_task_created',
                    payload: {
                        stepId: step.id,
                        contentItemId: contentItem.id,
                        reviewTaskId: reviewTask.id,
                        workflowTransitionId: transition.id
                    }
                });
            } catch (error) {
                const failedAt = new Date();
                await db.update(agentRunSteps)
                    .set({
                        status: 'failed',
                        completedAt: failedAt,
                        updatedAt: failedAt,
                        errorMessage: (error as Error).message
                    })
                    .where(and(eq(agentRunSteps.id, step.id), eq(agentRunSteps.domainId, domainId)));
            }
        }

        const submissionSteps = await db.select({ status: agentRunSteps.status })
            .from(agentRunSteps)
            .where(and(
                eq(agentRunSteps.runId, runId),
                eq(agentRunSteps.domainId, domainId),
                eq(agentRunSteps.actionType, 'submit_review')
            ));
        if (submissionSteps.length === 0) {
            return;
        }

        const pendingCount = submissionSteps.filter(
            (step) => step.status === 'pending' || step.status === 'executing'
        ).length;
        if (pendingCount > 0) {
            return;
        }

        const failedCount = submissionSteps.filter((step) => step.status === 'failed').length;
        const succeededCount = submissionSteps.filter((step) => step.status === 'succeeded').length;
        const settledAt = new Date();

        if (failedCount > 0) {
            await db.update(agentRuns)
                .set({
                    status: 'failed',
                    completedAt: settledAt,
                    updatedAt: settledAt
                })
                .where(and(
                    eq(agentRuns.id, runId),
                    eq(agentRuns.domainId, domainId),
                    eq(agentRuns.status, 'running')
                ));

            await db.insert(agentRunCheckpoints).values({
                runId,
                domainId,
                checkpointKey: 'review_execution_failed',
                payload: {
                    failedCount,
                    succeededCount
                }
            });
            return;
        }

        await db.update(agentRuns)
            .set({
                status: 'succeeded',
                completedAt: settledAt,
                updatedAt: settledAt
            })
            .where(and(
                eq(agentRuns.id, runId),
                eq(agentRuns.domainId, domainId),
                eq(agentRuns.status, 'running')
            ));

        await db.insert(agentRunCheckpoints).values({
            runId,
            domainId,
            checkpointKey: 'review_execution_completed',
            payload: {
                succeededCount
            }
        });
    }

    private static async buildReviewBacklogPlanSnapshot(domainId: number, metadata: Record<string, unknown>) {
        const maxCandidates = clampLimit(parseOptionalPositiveInt(metadata.maxCandidates), 25, 250);
        const requestedContentTypeId = parseOptionalPositiveInt(metadata.contentTypeId);
        const dryRun = parseBooleanFlag(metadata.dryRun, true);

        const whereConditions = [
            eq(contentItems.domainId, domainId),
            eq(contentItems.status, 'draft'),
            requestedContentTypeId ? eq(contentItems.contentTypeId, requestedContentTypeId) : undefined
        ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

        const whereClause = whereConditions.length > 1
            ? and(...whereConditions)
            : whereConditions[0];

        const [{ totalDrafts }] = await db.select({ totalDrafts: sql<number>`count(*)::int` })
            .from(contentItems)
            .where(whereClause);

        const candidates = await db.select({
            id: contentItems.id,
            contentTypeId: contentItems.contentTypeId,
            status: contentItems.status,
            updatedAt: contentItems.updatedAt
        })
            .from(contentItems)
            .where(whereClause)
            .orderBy(asc(contentItems.updatedAt), asc(contentItems.id))
            .limit(maxCandidates);

        return {
            mode: dryRun ? 'dry_run' : 'live_preview',
            runType: 'review_backlog_manager',
            criteria: {
                status: 'draft',
                contentTypeId: requestedContentTypeId ?? null
            },
            summary: {
                backlogCount: totalDrafts,
                selectedCount: candidates.length,
                maxCandidates
            },
            candidates: candidates.map((candidate) => ({
                id: candidate.id,
                contentTypeId: candidate.contentTypeId,
                status: candidate.status,
                updatedAt: candidate.updatedAt.toISOString()
            }))
        };
    }

    static async createDefinition(domainId: number, input: CreateAgentRunDefinitionInput) {
        const name = input.name?.trim();
        const runType = input.runType?.trim();
        if (!name) {
            throw new AgentRunServiceError(
                'AGENT_RUN_DEFINITION_INVALID_NAME',
                'Definition name is required.'
            );
        }
        if (!runType) {
            throw new AgentRunServiceError(
                'AGENT_RUN_DEFINITION_INVALID_RUN_TYPE',
                'Definition runType is required.'
            );
        }

        let created: typeof agentRunDefinitions.$inferSelect;
        try {
            [created] = await db.insert(agentRunDefinitions).values({
                domainId,
                name,
                runType,
                strategyConfig: input.strategyConfig ?? {},
                active: input.active ?? true
            }).returning();
        } catch (error) {
            if (isUniqueViolation(error, 'agent_run_definitions_domain_name_unique')) {
                throw new AgentRunServiceError(
                    'AGENT_RUN_DEFINITION_NAME_CONFLICT',
                    `A run definition named '${name}' already exists in this domain.`
                );
            }
            throw error;
        }

        await logAudit(domainId, 'create', 'agent_run_definition', created.id, {
            name: created.name,
            runType: created.runType,
            active: created.active
        });

        return created;
    }

    static async listDefinitions(domainId: number, options: ListAgentRunDefinitionsOptions = {}) {
        const limit = clampLimit(options.limit);
        const offset = clampOffset(options.offset);
        const runType = options.runType?.trim();

        const whereConditions = [
            eq(agentRunDefinitions.domainId, domainId),
            options.active === undefined ? undefined : eq(agentRunDefinitions.active, options.active),
            runType ? eq(agentRunDefinitions.runType, runType) : undefined
        ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

        const whereClause = whereConditions.length > 1
            ? and(...whereConditions)
            : whereConditions[0];

        const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
            .from(agentRunDefinitions)
            .where(whereClause);

        const items = await db.select()
            .from(agentRunDefinitions)
            .where(whereClause)
            .orderBy(desc(agentRunDefinitions.createdAt), desc(agentRunDefinitions.id))
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

    static async getDefinition(domainId: number, definitionId: number) {
        const [definition] = await db.select()
            .from(agentRunDefinitions)
            .where(and(
                eq(agentRunDefinitions.id, definitionId),
                eq(agentRunDefinitions.domainId, domainId)
            ));

        return definition ?? null;
    }

    static async updateDefinition(domainId: number, definitionId: number, input: UpdateAgentRunDefinitionInput) {
        const updateData: Partial<typeof agentRunDefinitions.$inferInsert> = {};

        if (input.name !== undefined) {
            const name = input.name.trim();
            if (!name) {
                throw new AgentRunServiceError(
                    'AGENT_RUN_DEFINITION_INVALID_NAME',
                    'Definition name cannot be empty.'
                );
            }
            updateData.name = name;
        }

        if (input.runType !== undefined) {
            const runType = input.runType.trim();
            if (!runType) {
                throw new AgentRunServiceError(
                    'AGENT_RUN_DEFINITION_INVALID_RUN_TYPE',
                    'Definition runType cannot be empty.'
                );
            }
            updateData.runType = runType;
        }

        if (input.strategyConfig !== undefined) {
            updateData.strategyConfig = input.strategyConfig ?? {};
        }

        if (input.active !== undefined) {
            updateData.active = input.active;
        }

        if (Object.keys(updateData).length === 0) {
            throw new AgentRunServiceError(
                'AGENT_RUN_DEFINITION_EMPTY_UPDATE',
                'Provide at least one field to update.'
            );
        }

        updateData.updatedAt = new Date();

        let updated: typeof agentRunDefinitions.$inferSelect | undefined;
        try {
            [updated] = await db.update(agentRunDefinitions)
                .set(updateData)
                .where(and(
                    eq(agentRunDefinitions.id, definitionId),
                    eq(agentRunDefinitions.domainId, domainId)
                ))
                .returning();
        } catch (error) {
            if (isUniqueViolation(error, 'agent_run_definitions_domain_name_unique')) {
                throw new AgentRunServiceError(
                    'AGENT_RUN_DEFINITION_NAME_CONFLICT',
                    `A run definition named '${updateData.name ?? ''}' already exists in this domain.`
                );
            }
            throw error;
        }

        if (!updated) {
            throw new AgentRunServiceError(
                'AGENT_RUN_DEFINITION_NOT_FOUND',
                `Run definition ${definitionId} was not found in this domain.`
            );
        }

        await logAudit(domainId, 'update', 'agent_run_definition', updated.id, {
            changes: {
                name: updateData.name,
                runType: updateData.runType,
                strategyConfig: updateData.strategyConfig,
                active: updateData.active
            }
        });

        return updated;
    }

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
        let baseMetadata: Record<string, unknown> = {};

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

            if (!definition.active) {
                throw new AgentRunServiceError(
                    'AGENT_RUN_DEFINITION_INACTIVE',
                    `Run definition ${input.definitionId} is inactive and cannot be used for new runs.`
                );
            }

            definitionId = definition.id;
            inferredRunType = definition.runType;
            if (isRecord(definition.strategyConfig)) {
                baseMetadata = definition.strategyConfig;
            }
        }

        const runType = inferredRunType || input.runType?.trim() || 'review_backlog_manager';
        const metadata = {
            ...baseMetadata,
            ...(input.metadata ?? {})
        };
        const planningSnapshot = runType === 'review_backlog_manager'
            ? await AgentRunService.buildReviewBacklogPlanSnapshot(domainId, metadata)
            : null;
        const status: AgentRunStatus = input.requireApproval ? 'waiting_approval' : 'queued';

        const created = await db.transaction(async (tx) => {
            const [newRun] = await tx.insert(agentRuns).values({
                domainId,
                definitionId,
                goal,
                runType,
                status,
                requestedBy: input.requestedBy,
                metadata: Object.keys(metadata).length > 0 ? metadata : null
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
                    requestedBy: newRun.requestedBy,
                    definitionId: newRun.definitionId,
                    metadata: newRun.metadata
                }
            });

            if (planningSnapshot) {
                await tx.insert(agentRunCheckpoints).values({
                    runId: newRun.id,
                    domainId,
                    checkpointKey: 'plan_review_backlog',
                    payload: planningSnapshot
                });
            }

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

        const runType = options.runType?.trim();
        const whereConditions = [
            eq(agentRuns.domainId, domainId),
            options.status ? eq(agentRuns.status, options.status) : undefined,
            runType ? eq(agentRuns.runType, runType) : undefined,
            options.definitionId !== undefined ? eq(agentRuns.definitionId, options.definitionId) : undefined
        ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

        const whereClause = whereConditions.length > 1
            ? and(...whereConditions)
            : whereConditions[0];

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

        const isNonTerminalStatus = nextStatus === 'queued'
            || nextStatus === 'planning'
            || nextStatus === 'waiting_approval'
            || nextStatus === 'running';
        if (isNonTerminalStatus && run.completedAt) {
            setPayload.completedAt = null;
        }

        const shouldUpdate =
            nextStatus !== run.status
            || (nextStatus === 'running' && !run.startedAt)
            || (nextStatus === 'cancelled' && !run.completedAt)
            || (isNonTerminalStatus && Boolean(run.completedAt));

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

                if (updatedRun.runType === 'review_backlog_manager') {
                    const [existingReviewStep] = await tx.select({ id: agentRunSteps.id })
                        .from(agentRunSteps)
                        .where(and(
                            eq(agentRunSteps.runId, runId),
                            eq(agentRunSteps.domainId, domainId),
                            eq(agentRunSteps.actionType, 'submit_review')
                        ))
                        .limit(1);

                    if (!existingReviewStep) {
                        const [planCheckpoint] = await tx.select({ payload: agentRunCheckpoints.payload })
                            .from(agentRunCheckpoints)
                            .where(and(
                                eq(agentRunCheckpoints.runId, runId),
                                eq(agentRunCheckpoints.domainId, domainId),
                                eq(agentRunCheckpoints.checkpointKey, 'plan_review_backlog')
                            ))
                            .orderBy(desc(agentRunCheckpoints.createdAt), desc(agentRunCheckpoints.id))
                            .limit(1);

                        const candidateIds = extractReviewCandidateIds(planCheckpoint?.payload);
                        const [stepStats] = await tx.select({
                            maxStepIndex: sql<number>`coalesce(max(${agentRunSteps.stepIndex}), -1)`
                        })
                            .from(agentRunSteps)
                            .where(and(
                                eq(agentRunSteps.runId, runId),
                                eq(agentRunSteps.domainId, domainId)
                            ));
                        const nextStepIndex = (stepStats?.maxStepIndex ?? -1) + 1;

                        if (candidateIds.length > 0) {
                            await tx.insert(agentRunSteps).values(candidateIds.map((contentItemId, index) => ({
                                runId,
                                domainId,
                                stepIndex: nextStepIndex + index,
                                stepKey: `submit_review_${contentItemId}`,
                                actionType: 'submit_review',
                                status: 'pending',
                                requestSnapshot: {
                                    contentItemId
                                }
                            })));
                        }

                        await tx.update(agentRunSteps)
                            .set({
                                status: 'succeeded',
                                completedAt: now,
                                updatedAt: now,
                                responseSnapshot: {
                                    selectedCount: candidateIds.length,
                                    checkpointKey: 'planned_review_actions'
                                }
                            })
                            .where(and(
                                eq(agentRunSteps.runId, runId),
                                eq(agentRunSteps.domainId, domainId),
                                eq(agentRunSteps.stepIndex, 0),
                                inArray(agentRunSteps.status, ['pending', 'executing'])
                            ));

                        await tx.insert(agentRunCheckpoints).values({
                            runId,
                            domainId,
                            checkpointKey: 'planned_review_actions',
                            payload: {
                                selectedCount: candidateIds.length,
                                candidateIds
                            }
                        });
                    }
                }
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

        if (
            updated.status === 'running'
            && updated.runType === 'review_backlog_manager'
            && isRecord(updated.metadata)
            && parseBooleanFlag(updated.metadata.autoSubmitReview, false)
        ) {
            await AgentRunService.executeReviewSubmissionSteps(domainId, runId, updated.metadata);
        }

        const [latestRun] = await db.select()
            .from(agentRuns)
            .where(and(eq(agentRuns.id, runId), eq(agentRuns.domainId, domainId)));
        const resultRun = latestRun ?? updated;

        await logAudit(domainId, 'update', 'agent_run', resultRun.id, {
            action,
            fromStatus: run.status,
            toStatus: resultRun.status,
            startedAt: resultRun.startedAt,
            completedAt: resultRun.completedAt
        });

        return resultRun;
    }
}
