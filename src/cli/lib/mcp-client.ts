import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

type JsonRpcRequest = {
    jsonrpc: '2.0';
    id?: number;
    method: string;
    params?: Record<string, unknown>;
};

type JsonRpcResponse = {
    jsonrpc: '2.0';
    id?: number;
    result?: unknown;
    error?: {
        code?: number;
        message?: string;
        data?: unknown;
    };
    method?: string;
    params?: Record<string, unknown>;
};

type PendingRequest = {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
};

export type ToolDefinition = {
    name: string;
    description?: string;
    inputSchema?: unknown;
};

export type ResourceDefinition = {
    name?: string;
    uri?: string;
    description?: string;
};

export type PromptDefinition = {
    name: string;
    description?: string;
};

export type ToolCallOutput = {
    rawText: string;
    parsed: unknown;
    isError: boolean;
};

export type SmokeState = {
    lifecycleTypeId?: number;
    lifecycleItemId?: number;
    batchItemIds: number[];
    workflowTypeId?: number;
    workflowDraftItemId?: number;
    workflowId?: number;
    workflowTransitionId?: number;
    reviewTaskId?: number;
    apiKeyId?: number;
    webhookId?: number;
};

export type SmokeSuiteResult = {
    name: string;
    status: 'passed' | 'warned' | 'failed';
    detail: string;
};

export type SmokeSummary = {
    results: SmokeSuiteResult[];
    passedCount: number;
    warnedCount: number;
    failedCount: number;
};

const REQUEST_TIMEOUT_MS = 30_000;

export function resolveRepoRoot(entryPath = process.argv[1]): string {
    const cwdCandidate = path.join(process.cwd(), 'src', 'mcp', 'index.ts');
    if (fs.existsSync(cwdCandidate)) {
        return process.cwd();
    }

    const scriptPath = path.resolve(entryPath ?? '');
    return path.resolve(path.dirname(scriptPath), '..', '..');
}

function resolveMcpCommand(repoRoot: string): { command: string; args: string[] } {
    const sourceScript = path.join(repoRoot, 'src', 'mcp', 'index.ts');
    const distScript = path.join(repoRoot, 'dist', 'mcp', 'index.js');
    const currentScript = path.resolve(process.argv[1] ?? '');
    const runningDist = currentScript.includes(`${path.sep}dist${path.sep}`);

    if (runningDist && fs.existsSync(distScript)) {
        return {
            command: 'node',
            args: [distScript],
        };
    }

    return {
        command: 'npx',
        args: ['tsx', sourceScript],
    };
}

function maybeParseJson(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

function asObject(value: unknown, context: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${context} returned an invalid object payload.`);
    }

    return value as Record<string, unknown>;
}

function asArray<T = unknown>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function extractToolText(result: unknown, context: string): ToolCallOutput {
    const payload = asObject(result, context);
    const content = asArray<{ text?: string }>(payload.content);
    const firstText = content[0]?.text;

    if (typeof firstText !== 'string') {
        throw new Error(`${context} returned no text content.`);
    }

    return {
        rawText: firstText,
        parsed: maybeParseJson(firstText),
        isError: payload.isError === true,
    };
}

function extractPromptText(result: unknown, context: string): string {
    const payload = asObject(result, context);
    const messages = asArray<{ content?: { text?: string } }>(payload.messages);
    const firstText = messages[0]?.content?.text;

    if (typeof firstText !== 'string') {
        throw new Error(`${context} returned no prompt text.`);
    }

    return firstText;
}

function extractResourceText(result: unknown, context: string): string {
    const payload = asObject(result, context);
    const contents = asArray<{ text?: string }>(payload.contents);
    const firstText = contents[0]?.text;

    if (typeof firstText !== 'string') {
        throw new Error(`${context} returned no resource text.`);
    }

    return firstText;
}

function parseIdFromText(text: string, label = 'ID'): number {
    const match = text.match(/ID:\s*(\d+)/i) ?? text.match(/\b(\d+)\b/);
    if (!match) {
        throw new Error(`Unable to parse ${label} from "${text}"`);
    }

    return Number.parseInt(match[1], 10);
}

function uniqueSlug(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class WordClawMcpClient {
    private readonly repoRoot: string;
    private readonly child: ChildProcessWithoutNullStreams;
    private readonly pending = new Map<number, PendingRequest>();
    private buffer = '';
    private requestId = 0;

    constructor(repoRoot: string) {
        this.repoRoot = repoRoot;
        const mcp = resolveMcpCommand(repoRoot);
        this.child = spawn(mcp.command, mcp.args, {
            cwd: this.repoRoot,
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.child.stdout.on('data', (data: Buffer) => this.handleData(data));
        this.child.stderr.on('data', (data: Buffer) => {
            const message = data.toString().trim();
            if (message) {
                console.error(`[mcp] ${message}`);
            }
        });
        this.child.on('exit', (code, signal) => {
            const error = new Error(
                `MCP child exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`,
            );

            for (const pending of this.pending.values()) {
                clearTimeout(pending.timeout);
                pending.reject(error);
            }
            this.pending.clear();
        });
    }

    private handleData(data: Buffer) {
        this.buffer += data.toString();
        const lines = this.buffer.split('\n');

        while (lines.length > 1) {
            const line = lines.shift();
            if (!line || !line.trim()) {
                continue;
            }

            try {
                const response = JSON.parse(line) as JsonRpcResponse;

                if (typeof response.id === 'number') {
                    const pending = this.pending.get(response.id);
                    if (!pending) {
                        continue;
                    }

                    clearTimeout(pending.timeout);
                    this.pending.delete(response.id);

                    if (response.error) {
                        pending.reject(
                            new Error(
                                response.error.message ??
                                    `JSON-RPC error on request ${response.id}`,
                            ),
                        );
                    } else {
                        pending.resolve(response.result);
                    }
                }
            } catch {
                // Ignore non-JSON log noise on stdout.
            }
        }

        this.buffer = lines.join('\n');
    }

    private send(
        method: string,
        params: Record<string, unknown> = {},
    ): Promise<unknown> {
        this.requestId += 1;
        const id = this.requestId;
        const request: JsonRpcRequest = {
            jsonrpc: '2.0',
            id,
            method,
            params,
        };

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(
                    new Error(
                        `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s: ${method}`,
                    ),
                );
            }, REQUEST_TIMEOUT_MS);

            this.pending.set(id, { resolve, reject, timeout });
            this.child.stdin.write(`${JSON.stringify(request)}\n`);
        });
    }

    private notify(method: string, params: Record<string, unknown> = {}) {
        const request: JsonRpcRequest = {
            jsonrpc: '2.0',
            method,
            params,
        };
        this.child.stdin.write(`${JSON.stringify(request)}\n`);
    }

    async initialize() {
        await this.send('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
                name: 'wordclaw-cli',
                version: '1.0.0',
            },
        });
        this.notify('notifications/initialized');
    }

    async listTools(): Promise<ToolDefinition[]> {
        const result = asObject(await this.send('tools/list'), 'tools/list');
        return asArray<ToolDefinition>(result.tools);
    }

    async listResources(): Promise<ResourceDefinition[]> {
        const result = asObject(await this.send('resources/list'), 'resources/list');
        return asArray<ResourceDefinition>(result.resources);
    }

    async readResource(uri: string): Promise<string> {
        return extractResourceText(
            await this.send('resources/read', { uri }),
            `resources/read(${uri})`,
        );
    }

    async listPrompts(): Promise<PromptDefinition[]> {
        const result = asObject(await this.send('prompts/list'), 'prompts/list');
        return asArray<PromptDefinition>(result.prompts);
    }

    async getPrompt(
        name: string,
        args: Record<string, unknown> = {},
    ): Promise<string> {
        return extractPromptText(
            await this.send('prompts/get', {
                name,
                arguments: args,
            }),
            `prompts/get(${name})`,
        );
    }

    async callTool(
        name: string,
        args: Record<string, unknown> = {},
    ): Promise<ToolCallOutput> {
        return extractToolText(
            await this.send('tools/call', {
                name,
                arguments: args,
            }),
            `tools/call(${name})`,
        );
    }

    async stop() {
        this.child.kill();
    }
}

export async function inspectCapabilities(client: WordClawMcpClient) {
    const [tools, resources, prompts] = await Promise.all([
        client.listTools(),
        client.listResources(),
        client.listPrompts(),
    ]);

    return {
        toolCount: tools.length,
        resourceCount: resources.length,
        promptCount: prompts.length,
        tools,
        resources,
        prompts,
    };
}

async function cleanup(client: WordClawMcpClient, state: SmokeState) {
    if (state.webhookId) {
        await client.callTool('delete_webhook', { id: state.webhookId }).catch(
            () => undefined,
        );
    }

    if (state.apiKeyId) {
        await client.callTool('revoke_api_key', { id: state.apiKeyId }).catch(
            () => undefined,
        );
    }

    if (state.batchItemIds.length > 0) {
        await client
            .callTool('delete_content_items_batch', {
                ids: state.batchItemIds,
                atomic: false,
            })
            .catch(() => undefined);
    }

    if (state.workflowDraftItemId) {
        await client
            .callTool('delete_content_item', { id: state.workflowDraftItemId })
            .catch(() => undefined);
    }

    if (state.lifecycleItemId) {
        await client
            .callTool('delete_content_item', { id: state.lifecycleItemId })
            .catch(() => undefined);
    }

    if (state.lifecycleTypeId) {
        await client
            .callTool('delete_content_type', { id: state.lifecycleTypeId })
            .catch(() => undefined);
    }

    if (state.workflowTypeId && !state.workflowId) {
        await client
            .callTool('delete_content_type', { id: state.workflowTypeId })
            .catch(() => undefined);
    }
}

export async function runSmoke(client: WordClawMcpClient): Promise<SmokeSummary> {
    const toolDefs = await client.listTools();
    const toolNames = new Set(toolDefs.map((tool) => tool.name));
    const state: SmokeState = {
        batchItemIds: [],
    };
    const results: SmokeSuiteResult[] = [];

    const addResult = (
        name: string,
        status: SmokeSuiteResult['status'],
        detail: string,
    ) => {
        results.push({ name, status, detail });
    };

    const runHardSuite = async (name: string, fn: () => Promise<string>) => {
        try {
            addResult(name, 'passed', await fn());
        } catch (error) {
            addResult(
                name,
                'failed',
                error instanceof Error ? error.message : String(error),
            );
        }
    };

    const runSoftSuite = async (name: string, fn: () => Promise<string>) => {
        try {
            addResult(name, 'passed', await fn());
        } catch (error) {
            addResult(
                name,
                'warned',
                error instanceof Error ? error.message : String(error),
            );
        }
    };

    const requireTool = async (
        name: string,
        args: Record<string, unknown> = {},
    ) => {
        const result = await client.callTool(name, args);
        if (result.isError) {
            throw new Error(result.rawText);
        }

        return result;
    };

    try {
        await runHardSuite('Discovery', async () => {
            const resources = await client.listResources();
            const prompts = await client.listPrompts();
            return `Discovered ${toolDefs.length} tools, ${resources.length} resources, ${prompts.length} prompts.`;
        });

        await runHardSuite('Content Type Lifecycle', async () => {
            const slug = uniqueSlug('demo-agent-type');
            const create = await requireTool('create_content_type', {
                name: 'Demo Agent Type',
                slug,
                description: 'Created by the MCP demo agent',
                schema: {
                    type: 'object',
                    properties: {
                        title: { type: 'string' },
                        body: { type: 'string' },
                    },
                    required: ['title', 'body'],
                },
            });

            state.lifecycleTypeId = parseIdFromText(
                create.rawText,
                'content type ID',
            );

            const list = await requireTool('list_content_types', {
                limit: 500,
            });
            const listPayload = asObject(list.parsed, 'list_content_types');
            const listedTypes = asArray<Record<string, unknown>>(listPayload.items);
            if (!listedTypes.some((item) => Number(item.id) === state.lifecycleTypeId)) {
                throw new Error('Created content type was not returned by list_content_types.');
            }

            const getById = await requireTool('get_content_type', {
                id: state.lifecycleTypeId,
            });
            const typePayload = asObject(getById.parsed, 'get_content_type');
            if (Number(typePayload.id) !== state.lifecycleTypeId) {
                throw new Error('get_content_type returned an unexpected record.');
            }

            await requireTool('update_content_type', {
                id: state.lifecycleTypeId,
                description: 'Updated by the MCP demo agent',
            });

            return `Created, listed, fetched, and updated content type ${state.lifecycleTypeId}.`;
        });

        await runHardSuite('Content Item Lifecycle', async () => {
            if (!state.lifecycleTypeId) {
                throw new Error('Missing lifecycle content type.');
            }

            const create = await requireTool('create_content_item', {
                contentTypeId: state.lifecycleTypeId,
                data: {
                    title: 'Demo Agent Draft',
                    body: 'Created from the MCP demo agent.',
                },
                status: 'draft',
            });

            state.lifecycleItemId = parseIdFromText(
                create.rawText,
                'content item ID',
            );

            const get = await requireTool('get_content_item', {
                id: state.lifecycleItemId,
            });
            const itemPayload = asObject(get.parsed, 'get_content_item');
            if (Number(itemPayload.id) !== state.lifecycleItemId) {
                throw new Error('get_content_item returned an unexpected record.');
            }

            const update = await requireTool('update_content_item', {
                id: state.lifecycleItemId,
                data: {
                    title: 'Demo Agent Draft v2',
                    body: 'Updated by the MCP demo agent.',
                },
                status: 'published',
            });
            if (!update.rawText.toLowerCase().includes('version')) {
                throw new Error('update_content_item did not report a version increment.');
            }

            const list = await requireTool('get_content_items', {
                contentTypeId: state.lifecycleTypeId,
                limit: 10,
            });
            const listPayload = asObject(list.parsed, 'get_content_items');
            const items = asArray<Record<string, unknown>>(listPayload.items);
            if (!items.some((item) => Number(item.id) === state.lifecycleItemId)) {
                throw new Error('Updated content item was not returned by get_content_items.');
            }

            const versions = await requireTool('get_content_item_versions', {
                id: state.lifecycleItemId,
            });
            const versionRows = asArray<Record<string, unknown>>(versions.parsed);
            if (versionRows.length === 0) {
                throw new Error('get_content_item_versions returned no historical versions.');
            }

            const rollback = await requireTool('rollback_content_item', {
                id: state.lifecycleItemId,
                version: 1,
                dryRun: true,
            });
            if (!rollback.rawText.includes('[Dry Run]')) {
                throw new Error('rollback_content_item dry run did not return a dry-run message.');
            }

            return `Created, read, updated, listed, versioned, and dry-run rolled back item ${state.lifecycleItemId}.`;
        });

        if (toolNames.has('create_content_items_batch')) {
            await runHardSuite('Batch Item Operations', async () => {
                if (!state.lifecycleTypeId) {
                    throw new Error('Missing lifecycle content type.');
                }

                const create = await requireTool('create_content_items_batch', {
                    atomic: true,
                    items: [
                        {
                            contentTypeId: state.lifecycleTypeId,
                            data: {
                                title: 'Batch item 1',
                                body: 'First batch item',
                            },
                            status: 'draft',
                        },
                        {
                            contentTypeId: state.lifecycleTypeId,
                            data: {
                                title: 'Batch item 2',
                                body: 'Second batch item',
                            },
                            status: 'draft',
                        },
                    ],
                });

                const createPayload = asObject(
                    create.parsed,
                    'create_content_items_batch',
                );
                const createdRows = asArray<Record<string, unknown>>(
                    createPayload.results,
                );
                state.batchItemIds = createdRows
                    .map((row) => Number(row.id))
                    .filter((value) => Number.isFinite(value));

                if (state.batchItemIds.length === 0) {
                    throw new Error('Batch create returned no item IDs.');
                }

                await requireTool('update_content_items_batch', {
                    atomic: false,
                    items: [
                        {
                            id: state.batchItemIds[0],
                            data: JSON.stringify({
                                title: 'Batch item 1 updated',
                                body: 'Updated through batch operation',
                            }),
                            status: 'published',
                        },
                    ],
                });

                const dryDelete = await requireTool('delete_content_items_batch', {
                    ids: state.batchItemIds,
                    dryRun: true,
                });
                const dryDeletePayload = asObject(
                    dryDelete.parsed,
                    'delete_content_items_batch',
                );
                const dryDeleteRows = asArray<Record<string, unknown>>(
                    dryDeletePayload.results,
                );
                if (!dryDeleteRows.every((row) => row.ok === true)) {
                    throw new Error('delete_content_items_batch dry run did not return successful result rows.');
                }

                return `Created ${state.batchItemIds.length} batch items and updated the first item.`;
            });
        }

        if (
            toolNames.has('create_workflow') &&
            toolNames.has('create_workflow_transition') &&
            toolNames.has('submit_review_task') &&
            toolNames.has('add_review_comment') &&
            toolNames.has('decide_review_task')
        ) {
            await runHardSuite('Workflow Review Flow', async () => {
                const workflowTypeSlug = uniqueSlug('demo-agent-workflow-type');
                const createType = await requireTool('create_content_type', {
                    name: 'Demo Workflow Type',
                    slug: workflowTypeSlug,
                    schema: {
                        type: 'object',
                        properties: {
                            title: { type: 'string' },
                            body: { type: 'string' },
                        },
                        required: ['title', 'body'],
                    },
                });

                state.workflowTypeId = parseIdFromText(createType.rawText);

                const createWorkflow = await requireTool('create_workflow', {
                    name: `Demo Workflow ${Date.now()}`,
                    contentTypeId: state.workflowTypeId,
                    active: true,
                });
                const workflow = asObject(
                    createWorkflow.parsed,
                    'create_workflow',
                );
                state.workflowId = Number(workflow.id);
                if (!Number.isFinite(state.workflowId)) {
                    throw new Error('create_workflow did not return a workflow ID.');
                }

                const createTransition = await requireTool(
                    'create_workflow_transition',
                    {
                        workflowId: state.workflowId,
                        fromState: 'draft',
                        toState: 'in_review',
                        requiredRoles: ['admin'],
                    },
                );
                const transition = asObject(
                    createTransition.parsed,
                    'create_workflow_transition',
                );
                state.workflowTransitionId = Number(transition.id);
                if (!Number.isFinite(state.workflowTransitionId)) {
                    throw new Error('create_workflow_transition did not return a transition ID.');
                }

                const createItem = await requireTool('create_content_item', {
                    contentTypeId: state.workflowTypeId,
                    data: {
                        title: 'Workflow draft item',
                        body: 'Created for review flow testing.',
                    },
                    status: 'draft',
                });
                state.workflowDraftItemId = parseIdFromText(createItem.rawText);

                const submit = await requireTool('submit_review_task', {
                    contentItemId: state.workflowDraftItemId,
                    workflowTransitionId: state.workflowTransitionId,
                    assignee: 'mcp-agent',
                });
                const reviewTask = asObject(
                    submit.parsed,
                    'submit_review_task',
                );
                state.reviewTaskId = Number(reviewTask.id);
                if (!Number.isFinite(state.reviewTaskId)) {
                    throw new Error('submit_review_task did not return a review task ID.');
                }

                await requireTool('add_review_comment', {
                    contentItemId: state.workflowDraftItemId,
                    comment: 'Demo agent review comment.',
                });

                const decide = await requireTool('decide_review_task', {
                    taskId: state.reviewTaskId,
                    decision: 'approved',
                });
                if (
                    !JSON.stringify(decide.parsed)
                        .toLowerCase()
                        .includes('approved')
                ) {
                    throw new Error('decide_review_task did not report an approved result.');
                }

                return `Created workflow ${state.workflowId}, transition ${state.workflowTransitionId}, and approved review task ${state.reviewTaskId}.`;
            });
        }

        if (toolNames.has('get_audit_logs')) {
            await runHardSuite('Audit Logs', async () => {
                const audit = await requireTool('get_audit_logs', {
                    limit: 10,
                });
                const auditPayload = asObject(audit.parsed, 'get_audit_logs');
                const entries = asArray<Record<string, unknown>>(auditPayload.items);
                if (entries.length === 0) {
                    throw new Error('get_audit_logs returned no entries.');
                }

                return `Fetched ${entries.length} audit log entries.`;
            });
        }

        if (
            toolNames.has('create_api_key') &&
            toolNames.has('list_api_keys') &&
            toolNames.has('revoke_api_key')
        ) {
            await runHardSuite('API Key Tools', async () => {
                const create = await requireTool('create_api_key', {
                    name: `Demo Agent Key ${Date.now()}`,
                    scopes: ['content:read', 'content:write', 'audit:read'],
                });

                const key = asObject(create.parsed, 'create_api_key');
                state.apiKeyId = Number(key.id);
                if (!Number.isFinite(state.apiKeyId)) {
                    throw new Error('create_api_key did not return a key ID.');
                }

                const list = await requireTool('list_api_keys');
                const keys = asArray<Record<string, unknown>>(list.parsed);
                if (!keys.some((item) => Number(item.id) === state.apiKeyId)) {
                    throw new Error('Created API key was not returned by list_api_keys.');
                }

                await requireTool('revoke_api_key', {
                    id: state.apiKeyId,
                });

                return `Created and revoked API key ${state.apiKeyId}.`;
            });
        }

        if (
            toolNames.has('create_webhook') &&
            toolNames.has('list_webhooks') &&
            toolNames.has('get_webhook') &&
            toolNames.has('update_webhook') &&
            toolNames.has('delete_webhook')
        ) {
            await runHardSuite('Webhook Tools', async () => {
                const create = await requireTool('create_webhook', {
                    url: 'https://example.com/hooks/wordclaw-demo',
                    events: ['content_item.create', 'content_item.update'],
                    secret: 'demo-agent-webhook-secret',
                    active: true,
                });

                const webhook = asObject(create.parsed, 'create_webhook');
                state.webhookId = Number(webhook.id);
                if (!Number.isFinite(state.webhookId)) {
                    throw new Error('create_webhook did not return a webhook ID.');
                }

                const list = await requireTool('list_webhooks');
                const hooks = asArray<Record<string, unknown>>(list.parsed);
                if (!hooks.some((item) => Number(item.id) === state.webhookId)) {
                    throw new Error('Created webhook was not returned by list_webhooks.');
                }

                const get = await requireTool('get_webhook', {
                    id: state.webhookId,
                });
                const webhookPayload = asObject(get.parsed, 'get_webhook');
                if (Number(webhookPayload.id) !== state.webhookId) {
                    throw new Error('get_webhook returned an unexpected record.');
                }

                await requireTool('update_webhook', {
                    id: state.webhookId,
                    active: false,
                    events: ['content_item.create'],
                });

                await requireTool('delete_webhook', {
                    id: state.webhookId,
                });
                state.webhookId = undefined;

                return 'Created, listed, read, updated, and deleted a webhook.';
            });
        }

        if (toolNames.has('evaluate_policy')) {
            await runSoftSuite('Policy Evaluation', async () => {
                const result = await requireTool('evaluate_policy', {
                    operation: 'content.read',
                    resourceType: 'system',
                });
                const decision = asObject(result.parsed, 'evaluate_policy');
                if (!('allowed' in decision)) {
                    throw new Error('evaluate_policy did not return an authorization decision.');
                }

                return 'Evaluated a policy decision.';
            });
        }

        await runHardSuite('Resources and Prompts', async () => {
            const resourceText = await client.readResource('content://types');
            if (!resourceText) {
                throw new Error('Resource content://types returned empty text.');
            }

            const workflowPrompt = await client.getPrompt('workflow-guidance');
            if (!workflowPrompt.includes('List available content types')) {
                throw new Error('workflow-guidance prompt did not return expected guidance.');
            }

            if (!state.lifecycleTypeId) {
                throw new Error('Missing lifecycle content type for content-generation-template.');
            }

            const contentPrompt = await client.getPrompt(
                'content-generation-template',
                {
                    contentTypeId: String(state.lifecycleTypeId),
                    topic: 'AI-safe content operations',
                },
            );
            if (!contentPrompt.includes('Provide ONLY the JSON data')) {
                throw new Error('content-generation-template prompt did not return expected instructions.');
            }

            return 'Read content-types resource and resolved both prompts.';
        });

        if (toolNames.has('search_semantic_knowledge')) {
            await runSoftSuite('Semantic Search', async () => {
                await requireTool('search_semantic_knowledge', {
                    query: 'AI-safe content operations',
                    limit: 3,
                });

                return 'Semantic search tool responded successfully.';
            });
        }

        if (toolNames.has('list_payments')) {
            await runSoftSuite('Payment Read Tools', async () => {
                const list = await requireTool('list_payments', {
                    limit: 10,
                    offset: 0,
                });

                const payload = asObject(list.parsed, 'list_payments');
                const payments = asArray<Record<string, unknown>>(
                    payload.payments,
                );

                if (payments.length === 0) {
                    return 'list_payments succeeded; no payment records were available to fetch individually.';
                }

                if (!toolNames.has('get_payment')) {
                    return 'list_payments succeeded; get_payment is not exposed.';
                }

                const id = Number(payments[0]?.id);
                await requireTool('get_payment', { id });
                return `Fetched payment ${id}.`;
            });
        }
    } finally {
        await cleanup(client, state);
    }

    return {
        results,
        passedCount: results.filter((result) => result.status === 'passed').length,
        warnedCount: results.filter((result) => result.status === 'warned').length,
        failedCount: results.filter((result) => result.status === 'failed').length,
    };
}
