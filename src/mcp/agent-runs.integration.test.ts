import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WordClawMcpClient } from '../cli/lib/mcp-client.js';
import { db } from '../db/index.js';
import {
    agentRuns,
    contentItems,
    contentTypes,
    domains,
    reviewTasks,
} from '../db/schema.js';

function asObject(value: unknown, context: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${context} did not return an object payload.`);
    }

    return value as Record<string, unknown>;
}

function asArray<T = unknown>(value: unknown, context: string): T[] {
    if (!Array.isArray(value)) {
        throw new Error(`${context} did not return an array payload.`);
    }

    return value as T[];
}

function asNumber(value: unknown, context: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${context} did not return a numeric value.`);
    }

    return value;
}

function asString(value: unknown, context: string): string {
    if (typeof value !== 'string') {
        throw new Error(`${context} did not return a string value.`);
    }

    return value;
}

async function callToolJson(
    client: WordClawMcpClient,
    name: string,
    args: Record<string, unknown> = {},
) {
    const result = await client.callTool(name, args);
    if (result.isError) {
        throw new Error(`${name} failed: ${result.rawText}`);
    }

    return asObject(result.parsed, name);
}

describe.sequential('MCP Agent Run Integration', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousDomainId = process.env.WORDCLAW_DOMAIN_ID;
    const previousExperimentalAgentRuns = process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS;
    const domainId = 1;

    beforeAll(async () => {
        process.env.NODE_ENV = 'test';
        process.env.WORDCLAW_DOMAIN_ID = String(domainId);
        process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = 'true';

        const [domain] = await db.select().from(domains).where(eq(domains.id, domainId));
        if (!domain) {
            await db.insert(domains).values({
                id: domainId,
                name: 'Default Local Domain',
                hostname: 'localhost',
            });
        }
    });

    afterAll(() => {
        if (previousNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = previousNodeEnv;
        }

        if (previousDomainId === undefined) {
            delete process.env.WORDCLAW_DOMAIN_ID;
        } else {
            process.env.WORDCLAW_DOMAIN_ID = previousDomainId;
        }

        if (previousExperimentalAgentRuns === undefined) {
            delete process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS;
        } else {
            process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = previousExperimentalAgentRuns;
        }
    });

    it(
        'review_backlog_manager auto-submits review tasks and records settled checkpoints through MCP',
        async () => {
            let contentTypeId: number | null = null;
            let workflowId: number | null = null;
            let transitionId: number | null = null;
            let draftItemOneId: number | null = null;
            let draftItemTwoId: number | null = null;
            let runId: number | null = null;
            const client = new WordClawMcpClient(process.cwd());

            try {
                const [scopedType] = await db.insert(contentTypes).values({
                    domainId,
                    name: `MCP Agent Run Type ${crypto.randomUUID().slice(0, 6)}`,
                    slug: `mcp-agent-run-${crypto.randomUUID().slice(0, 8)}`,
                    schema: JSON.stringify({ type: 'object' }),
                    basePrice: 0,
                }).returning();
                contentTypeId = scopedType.id;

                const [draftOne] = await db.insert(contentItems).values({
                    domainId,
                    contentTypeId,
                    data: JSON.stringify({ title: 'mcp-auto-submit-one' }),
                    status: 'draft',
                }).returning();
                draftItemOneId = draftOne.id;

                const [draftTwo] = await db.insert(contentItems).values({
                    domainId,
                    contentTypeId,
                    data: JSON.stringify({ title: 'mcp-auto-submit-two' }),
                    status: 'draft',
                }).returning();
                draftItemTwoId = draftTwo.id;

                await client.initialize();

                const workflow = await callToolJson(client, 'create_workflow', {
                    name: `MCP Workflow ${crypto.randomUUID().slice(0, 6)}`,
                    contentTypeId,
                    active: true,
                });
                workflowId = asNumber(workflow.id, 'create_workflow.id');

                const transition = await callToolJson(client, 'create_workflow_transition', {
                    workflowId,
                    fromState: 'draft',
                    toState: 'pending_review',
                    requiredRoles: [],
                });
                transitionId = asNumber(
                    transition.id,
                    'create_workflow_transition.id',
                );

                const createdRun = await callToolJson(client, 'create_agent_run', {
                    goal: `mcp-review-backlog-${crypto.randomUUID().slice(0, 8)}`,
                    runType: 'review_backlog_manager',
                    requireApproval: true,
                    metadata: {
                        contentTypeId,
                        maxCandidates: 10,
                        autoSubmitReview: true,
                    },
                });
                runId = asNumber(createdRun.id, 'create_agent_run.id');
                expect(asString(createdRun.status, 'create_agent_run.status')).toBe(
                    'waiting_approval',
                );

                const listedRuns = await callToolJson(client, 'list_agent_runs', {
                    runType: 'review_backlog_manager',
                    limit: 100,
                    offset: 0,
                });
                const listedItems = asArray<Record<string, unknown>>(
                    listedRuns.items,
                    'list_agent_runs.items',
                );
                expect(
                    listedItems.some(
                        (item) => asNumber(item.id, 'list_agent_runs.items[].id') === runId,
                    ),
                ).toBe(true);

                const approvedRun = await callToolJson(client, 'control_agent_run', {
                    id: runId,
                    action: 'approve',
                });
                expect(asString(approvedRun.status, 'control_agent_run.status')).toBe(
                    'succeeded',
                );
                expect(approvedRun.completedAt).not.toBeNull();

                const runDetails = await callToolJson(client, 'get_agent_run', {
                    id: runId,
                });
                const run = asObject(runDetails.run, 'get_agent_run.run');
                expect(asString(run.status, 'get_agent_run.run.status')).toBe(
                    'succeeded',
                );

                const steps = asArray<Record<string, unknown>>(
                    runDetails.steps,
                    'get_agent_run.steps',
                );
                const submitSteps = steps.filter(
                    (step) =>
                        asString(step.actionType, 'get_agent_run.steps[].actionType')
                        === 'submit_review',
                );
                expect(submitSteps).toHaveLength(2);
                expect(
                    submitSteps.every(
                        (step) =>
                            asString(step.status, 'get_agent_run.steps[].status')
                            === 'succeeded',
                    ),
                ).toBe(true);
                expect(
                    submitSteps.every(
                        (step) =>
                            asNumber(
                                asObject(
                                    step.responseSnapshot,
                                    'get_agent_run.steps[].responseSnapshot',
                                ).workflowTransitionId,
                                'get_agent_run.steps[].responseSnapshot.workflowTransitionId',
                            ) === transitionId,
                    ),
                ).toBe(true);

                const checkpoints = asArray<Record<string, unknown>>(
                    runDetails.checkpoints,
                    'get_agent_run.checkpoints',
                );
                const completionCheckpoint = checkpoints.find(
                    (checkpoint) =>
                        asString(
                            checkpoint.checkpointKey,
                            'get_agent_run.checkpoints[].checkpointKey',
                        ) === 'review_execution_completed',
                );
                expect(
                    asNumber(
                        asObject(
                            completionCheckpoint?.payload,
                            'review_execution_completed.payload',
                        ).succeededCount,
                        'review_execution_completed.payload.succeededCount',
                    ),
                ).toBe(2);

                const settledCheckpoint = checkpoints.find(
                    (checkpoint) =>
                        asString(
                            checkpoint.checkpointKey,
                            'get_agent_run.checkpoints[].checkpointKey',
                        ) === 'control_approve_settled',
                );
                expect(
                    asString(
                        asObject(
                            settledCheckpoint?.payload,
                            'control_approve_settled.payload',
                        ).settledStatus,
                        'control_approve_settled.payload.settledStatus',
                    ),
                ).toBe('succeeded');

                const pendingTasks = await db.select()
                    .from(reviewTasks)
                    .where(and(
                        eq(reviewTasks.domainId, domainId),
                        eq(reviewTasks.workflowTransitionId, transitionId),
                    ));
                expect(pendingTasks).toHaveLength(2);
                expect(
                    pendingTasks.every((task) => task.status === 'pending'),
                ).toBe(true);
            } finally {
                await client.stop();

                if (runId) {
                    await db.delete(agentRuns).where(eq(agentRuns.id, runId));
                }
                if (draftItemOneId) {
                    await db.delete(contentItems).where(eq(contentItems.id, draftItemOneId));
                }
                if (draftItemTwoId) {
                    await db.delete(contentItems).where(eq(contentItems.id, draftItemTwoId));
                }
                if (contentTypeId) {
                    await db.delete(contentTypes).where(eq(contentTypes.id, contentTypeId));
                }
            }
        },
        30000,
    );

    it(
        'review_backlog_manager resumes failed auto-submit runs through MCP and records settled recovery checkpoints',
        async () => {
            let contentTypeId: number | null = null;
            let draftItemId: number | null = null;
            let runId: number | null = null;
            let transitionId: number | null = null;
            const client = new WordClawMcpClient(process.cwd());

            try {
                const [scopedType] = await db.insert(contentTypes).values({
                    domainId,
                    name: `MCP Retry Type ${crypto.randomUUID().slice(0, 6)}`,
                    slug: `mcp-retry-${crypto.randomUUID().slice(0, 8)}`,
                    schema: JSON.stringify({ type: 'object' }),
                    basePrice: 0,
                }).returning();
                contentTypeId = scopedType.id;

                const [draftItem] = await db.insert(contentItems).values({
                    domainId,
                    contentTypeId,
                    data: JSON.stringify({ title: 'mcp-retry-item' }),
                    status: 'draft',
                }).returning();
                draftItemId = draftItem.id;

                await client.initialize();

                const createdRun = await callToolJson(client, 'create_agent_run', {
                    goal: `mcp-review-retry-${crypto.randomUUID().slice(0, 8)}`,
                    runType: 'review_backlog_manager',
                    requireApproval: true,
                    metadata: {
                        contentTypeId,
                        autoSubmitReview: true,
                    },
                });
                runId = asNumber(createdRun.id, 'create_agent_run.id');
                expect(asString(createdRun.status, 'create_agent_run.status')).toBe(
                    'waiting_approval',
                );

                const initialApprove = await callToolJson(client, 'control_agent_run', {
                    id: runId,
                    action: 'approve',
                });
                expect(asString(initialApprove.status, 'control_agent_run.status')).toBe(
                    'failed',
                );

                const workflow = await callToolJson(client, 'create_workflow', {
                    name: `MCP Retry Workflow ${crypto.randomUUID().slice(0, 6)}`,
                    contentTypeId,
                    active: true,
                });
                const workflowId = asNumber(workflow.id, 'create_workflow.id');

                const transition = await callToolJson(client, 'create_workflow_transition', {
                    workflowId,
                    fromState: 'draft',
                    toState: 'pending_review',
                    requiredRoles: [],
                });
                transitionId = asNumber(
                    transition.id,
                    'create_workflow_transition.id',
                );

                const resumedRun = await callToolJson(client, 'control_agent_run', {
                    id: runId,
                    action: 'resume',
                });
                expect(asString(resumedRun.status, 'control_agent_run.status')).toBe(
                    'queued',
                );

                const finalApprove = await callToolJson(client, 'control_agent_run', {
                    id: runId,
                    action: 'approve',
                });
                expect(asString(finalApprove.status, 'control_agent_run.status')).toBe(
                    'succeeded',
                );
                expect(finalApprove.completedAt).not.toBeNull();

                const runDetails = await callToolJson(client, 'get_agent_run', {
                    id: runId,
                });
                const run = asObject(runDetails.run, 'get_agent_run.run');
                expect(asString(run.status, 'get_agent_run.run.status')).toBe(
                    'succeeded',
                );

                const steps = asArray<Record<string, unknown>>(
                    runDetails.steps,
                    'get_agent_run.steps',
                );
                const submitSteps = steps.filter(
                    (step) =>
                        asString(step.actionType, 'get_agent_run.steps[].actionType')
                        === 'submit_review',
                );
                expect(submitSteps).toHaveLength(1);
                expect(
                    asString(submitSteps[0].status, 'get_agent_run.steps[].status'),
                ).toBe('succeeded');
                expect(
                    asNumber(
                        asObject(
                            submitSteps[0].responseSnapshot,
                            'get_agent_run.steps[].responseSnapshot',
                        ).workflowTransitionId,
                        'get_agent_run.steps[].responseSnapshot.workflowTransitionId',
                    ),
                ).toBe(transitionId);

                const checkpoints = asArray<Record<string, unknown>>(
                    runDetails.checkpoints,
                    'get_agent_run.checkpoints',
                );
                const completionCheckpoint = checkpoints.find(
                    (checkpoint) =>
                        asString(
                            checkpoint.checkpointKey,
                            'get_agent_run.checkpoints[].checkpointKey',
                        ) === 'review_execution_completed',
                );
                expect(
                    asNumber(
                        asObject(
                            completionCheckpoint?.payload,
                            'review_execution_completed.payload',
                        ).succeededCount,
                        'review_execution_completed.payload.succeededCount',
                    ),
                ).toBe(1);

                const settledCheckpoints = checkpoints.filter(
                    (checkpoint) =>
                        asString(
                            checkpoint.checkpointKey,
                            'get_agent_run.checkpoints[].checkpointKey',
                        ) === 'control_approve_settled',
                );
                expect(
                    settledCheckpoints.some(
                        (checkpoint) =>
                            asString(
                                asObject(
                                    checkpoint.payload,
                                    'control_approve_settled.payload',
                                ).settledStatus,
                                'control_approve_settled.payload.settledStatus',
                            ) === 'failed',
                    ),
                ).toBe(true);
                expect(
                    settledCheckpoints.some(
                        (checkpoint) =>
                            asString(
                                asObject(
                                    checkpoint.payload,
                                    'control_approve_settled.payload',
                                ).settledStatus,
                                'control_approve_settled.payload.settledStatus',
                            ) === 'succeeded',
                    ),
                ).toBe(true);

                const pendingTasks = await db.select()
                    .from(reviewTasks)
                    .where(and(
                        eq(reviewTasks.domainId, domainId),
                        eq(reviewTasks.workflowTransitionId, transitionId),
                    ));
                expect(pendingTasks).toHaveLength(1);
                expect(pendingTasks[0]?.status).toBe('pending');
            } finally {
                await client.stop();

                if (runId) {
                    await db.delete(agentRuns).where(eq(agentRuns.id, runId));
                }
                if (draftItemId) {
                    await db.delete(contentItems).where(eq(contentItems.id, draftItemId));
                }
                if (contentTypeId) {
                    await db.delete(contentTypes).where(eq(contentTypes.id, contentTypeId));
                }
            }
        },
        30000,
    );
});
