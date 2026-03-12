/**
 * MCP demo agent for WordClaw.
 *
 * Run from the repo root:
 *   npx tsx demos/mcp-demo-agent.ts inspect
 *   npx tsx demos/mcp-demo-agent.ts smoke
 *   npx tsx demos/mcp-demo-agent.ts call list_content_types '{}'
 *   npx tsx demos/mcp-demo-agent.ts prompt workflow-guidance
 *   npx tsx demos/mcp-demo-agent.ts resource system://capabilities
 *   npx tsx demos/mcp-demo-agent.ts watch content_item.published --transport http --api-key remote-admin --once
 *
 * By default the demo agent starts a local stdio MCP session. Use --transport http
 * plus --api-key (or WORDCLAW_API_KEY) when you want a persistent remote session
 * that can receive reactive notifications over /mcp.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { parseJsonValue } from '../src/cli/lib/args.js';
import {
    inspectCapabilities,
    resolveMcpHttpEndpoint,
    resolveRepoRoot,
    runSmoke,
    WordClawMcpClient,
    type McpTransportMode,
} from '../src/cli/lib/mcp-client.js';
import {
    ReactiveEventNotificationSchema,
    WORDCLAW_EVENT_NOTIFICATION_METHOD,
} from '../src/mcp/reactive-events.js';

const HEADER = 'WordClaw MCP Demo Agent';

type DemoAgentOptions = {
    transport: McpTransportMode;
    endpoint?: string;
    apiKey?: string;
    baseUrl?: string;
    filters?: Record<string, unknown>;
    once: boolean;
};

type ParsedCommandArgs = {
    positionals: string[];
    options: DemoAgentOptions;
};

type SubscribeResult = {
    sessionId?: string | null;
    subscribedTopics?: string[];
    blockedTopics?: Array<{ topic: string; reason: string }>;
    unsupportedTopics?: string[];
};

type WordClawEnvelope<T> = {
    data: T;
};

type ContentItemResponse = WordClawEnvelope<{
    id: number;
    status?: string;
    version?: number;
    updatedAt?: string;
    data?: Record<string, unknown> | string;
}>;

type ReactiveNotification = ReturnType<typeof ReactiveEventNotificationSchema.parse>;

function printUsage() {
    console.log(`${HEADER}

Usage:
  npx tsx demos/mcp-demo-agent.ts inspect [options]
  npx tsx demos/mcp-demo-agent.ts smoke [options]
  npx tsx demos/mcp-demo-agent.ts call <toolName> [jsonArgs] [options]
  npx tsx demos/mcp-demo-agent.ts prompt <promptName> [jsonArgs] [options]
  npx tsx demos/mcp-demo-agent.ts resource <uri> [options]
  npx tsx demos/mcp-demo-agent.ts watch <topic> [options]

Examples:
  npx tsx demos/mcp-demo-agent.ts inspect
  npx tsx demos/mcp-demo-agent.ts call list_content_types
  npx tsx demos/mcp-demo-agent.ts call get_content_items '{"status":"draft","limit":5}'
  npx tsx demos/mcp-demo-agent.ts prompt content-generation-template '{"contentTypeId":"12","topic":"AI governance"}'
  npx tsx demos/mcp-demo-agent.ts resource system://capabilities
  npx tsx demos/mcp-demo-agent.ts watch content_item.published --transport http --api-key remote-admin
  npx tsx demos/mcp-demo-agent.ts watch content_item.published --transport http --api-key remote-admin --filters '{"contentTypeId":12}'

Options:
  --transport <stdio|http>  Choose stdio (default) or remote HTTP MCP transport
  --endpoint <url>          Explicit MCP endpoint (defaults to /mcp on WORDCLAW_BASE_URL)
  --base-url <url>          Base URL used to derive /mcp and optional REST follow-up reads
  --api-key <key>           API key for remote HTTP MCP sessions and REST follow-up reads
  --filters <json>          Optional reactive event filters, e.g. {"contentTypeId":12}
  --once                    Exit after the first matching reactive notification

Environment:
  WORDCLAW_MCP_TRANSPORT    Default transport override for this demo agent
  WORDCLAW_MCP_URL          Default MCP endpoint for remote sessions
  WORDCLAW_BASE_URL         Default base URL used to derive /mcp
  WORDCLAW_API_KEY          Default API key for remote sessions
`);
}

function parseJsonArg(raw: string | undefined): Record<string, unknown> {
    if (!raw) {
        return {};
    }

    const parsed = parseJsonValue(raw, 'JSON arguments');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Expected JSON object arguments.');
    }

    return parsed as Record<string, unknown>;
}

function readResourceText(result: unknown, context: string): string {
    if (!result || typeof result !== 'object' || !('contents' in result)) {
        throw new Error(`${context} returned an invalid payload.`);
    }

    const contents = (result as { contents?: Array<{ text?: string }> }).contents;
    const firstText = Array.isArray(contents) ? contents[0]?.text : undefined;

    if (typeof firstText !== 'string') {
        throw new Error(`${context} returned no text content.`);
    }

    return firstText;
}

function readToolText(result: unknown, context: string): string {
    if (!result || typeof result !== 'object' || !('content' in result)) {
        throw new Error(`${context} returned an invalid payload.`);
    }

    const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
    const firstText = Array.isArray(content)
        ? content.find((entry) => entry.type === 'text')?.text
        : undefined;

    if (typeof firstText !== 'string') {
        throw new Error(`${context} returned no text content.`);
    }

    return firstText;
}

function parseCommandArgs(rawArgs: string[]): ParsedCommandArgs {
    const positionals: string[] = [];
    const defaults: DemoAgentOptions = {
        transport: process.env.WORDCLAW_MCP_TRANSPORT === 'http' ? 'http' : 'stdio',
        endpoint: process.env.WORDCLAW_MCP_URL,
        apiKey: process.env.WORDCLAW_API_KEY,
        baseUrl: process.env.WORDCLAW_BASE_URL,
        filters: undefined,
        once: false,
    };

    for (let index = 0; index < rawArgs.length; index += 1) {
        const value = rawArgs[index];

        if (!value.startsWith('--')) {
            positionals.push(value);
            continue;
        }

        if (value === '--once') {
            defaults.once = true;
            continue;
        }

        const nextValue = rawArgs[index + 1];
        if (!nextValue || nextValue.startsWith('--')) {
            throw new Error(`Missing value for ${value}.`);
        }

        if (value === '--transport') {
            if (nextValue !== 'stdio' && nextValue !== 'http') {
                throw new Error('Expected --transport to be stdio or http.');
            }
            defaults.transport = nextValue;
        } else if (value === '--endpoint') {
            defaults.endpoint = nextValue;
        } else if (value === '--api-key') {
            defaults.apiKey = nextValue;
        } else if (value === '--base-url') {
            defaults.baseUrl = nextValue;
        } else if (value === '--filters') {
            const parsed = parseJsonValue(nextValue, 'reactive filters');
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('Expected --filters to be a JSON object.');
            }
            defaults.filters = parsed as Record<string, unknown>;
        } else {
            throw new Error(`Unknown option: ${value}`);
        }

        index += 1;
    }

    return {
        positionals,
        options: defaults,
    };
}

function resolveRemoteMcpEndpoint(options: DemoAgentOptions): string {
    return resolveMcpHttpEndpoint(options.endpoint, options.baseUrl);
}

function deriveBaseUrl(endpoint: string): string {
    const url = new URL(endpoint);
    return url.origin;
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStandaloneStream(endpoint: string, apiKey: string | undefined, sessionId: string) {
    const headers: Record<string, string> = {
        accept: 'text/event-stream',
        'mcp-session-id': sessionId,
    };
    if (apiKey) {
        headers['x-api-key'] = apiKey;
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
        const probe = await fetch(endpoint, {
            method: 'GET',
            headers,
        });

        if (probe.status === 409) {
            return;
        }

        await sleep(100);
    }

    throw new Error('Timed out waiting for the standalone MCP SSE stream to attach.');
}

async function fetchContentItemSummary(baseUrl: string, apiKey: string | undefined, id: number) {
    const headers: Record<string, string> = {};
    if (apiKey) {
        headers['x-api-key'] = apiKey;
    }

    const response = await fetch(new URL(`/api/content-items/${id}`, `${baseUrl}/`), { headers });
    if (!response.ok) {
        throw new Error(`REST read failed with ${response.status} ${await response.text()}`);
    }

    const payload = await response.json() as ContentItemResponse;
    return payload.data;
}

function normalizeContentFields(value: Record<string, unknown> | string | undefined) {
    if (!value) {
        return {};
    }

    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            return {};
        }
        return {};
    }

    return value;
}

function printReactiveSummary(topic: string, notification: ReactiveNotification) {
    console.log(`\n=== Reactive Event: ${topic} ===`);
    console.log(`Matched topics: ${notification.params.matchedTopics.join(', ')}`);
    console.log(`Matched subscriptions: ${JSON.stringify(notification.params.matchedSubscriptions)}`);
    console.log(`Entity: ${notification.params.event.entityType} #${notification.params.event.entityId}`);
    console.log(`Domain: ${notification.params.event.domainId}`);
    console.log(`Actor: ${notification.params.event.actorId ?? 'unknown'} (${notification.params.event.actorType ?? 'unknown'})`);
    console.log(`Created at: ${notification.params.event.createdAt}`);
}

async function watchReactiveTopic(options: DemoAgentOptions, topic: string) {
    if (options.transport !== 'http') {
        throw new Error('watch requires --transport http because reactive subscriptions only exist on remote session-backed /mcp.');
    }

    const endpoint = resolveRemoteMcpEndpoint(options);
    const baseUrl = options.baseUrl ?? deriveBaseUrl(endpoint);
    const client = new Client({
        name: 'wordclaw-mcp-demo-agent',
        version: '1.0.0',
    });

    let finishWatch: (() => void) | null = null;

    client.fallbackNotificationHandler = async (notification) => {
        if (notification.method !== WORDCLAW_EVENT_NOTIFICATION_METHOD) {
            return;
        }

        const parsed = ReactiveEventNotificationSchema.safeParse(notification);
        if (!parsed.success) {
            console.log('\nReceived a non-conforming WordClaw reactive notification.');
            console.log(JSON.stringify(notification, null, 2));
            return;
        }

        printReactiveSummary(topic, parsed.data);

        if (parsed.data.params.event.entityType === 'content_item') {
            try {
                const item = await fetchContentItemSummary(
                    baseUrl,
                    options.apiKey,
                    parsed.data.params.event.entityId,
                );
                const fields = normalizeContentFields(item.data);
                console.log('Reaction: fetched the latest content item snapshot.');
                console.log(JSON.stringify({
                    id: item.id,
                    title: typeof fields.title === 'string' ? fields.title : null,
                    slug: typeof fields.slug === 'string' ? fields.slug : null,
                    status: item.status ?? null,
                    version: item.version ?? null,
                    updatedAt: item.updatedAt ?? null,
                }, null, 2));
            } catch (error) {
                console.log(`Reaction fallback failed: ${(error as Error).message}`);
            }
        }

        if (options.once) {
            finishWatch?.();
        }
    };

    const headers: Record<string, string> = {};
    if (options.apiKey) {
        headers['x-api-key'] = options.apiKey;
    }

    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: Object.keys(headers).length > 0
            ? { headers }
            : undefined,
    });

    const onSignal = () => finishWatch?.();

    try {
        console.log(`Connecting to ${endpoint} ...`);
        await client.connect(transport);

        if (transport.sessionId) {
            await waitForStandaloneStream(endpoint, options.apiKey, transport.sessionId);
        }

        const manifestText = readResourceText(
            await client.readResource({ uri: 'system://capabilities' }),
            'system://capabilities',
        );
        const manifest = JSON.parse(manifestText) as {
            protocolSurfaces?: {
                mcp?: {
                    reactive?: {
                        subscriptionTool?: string;
                        notificationMethod?: string;
                        supportedTopics?: string[];
                    };
                };
            };
        };

        console.log('\n=== Reactive Contract ===');
        console.log(JSON.stringify(manifest.protocolSurfaces?.mcp?.reactive ?? {}, null, 2));

        const subscriptionText = readToolText(
            await client.callTool({
                name: 'subscribe_events',
                arguments: {
                    topics: [topic],
                    replaceExisting: true,
                    ...(options.filters ? { filters: options.filters } : {}),
                },
            }),
            'subscribe_events',
        );
        const subscription = JSON.parse(subscriptionText) as SubscribeResult;

        if (!subscription.subscribedTopics?.includes(topic)) {
            throw new Error(`Subscription failed: ${subscriptionText}`);
        }

        console.log('\n=== Subscription ===');
        console.log(JSON.stringify(subscription, null, 2));
        console.log(
            options.once
                ? '\nWaiting for one matching notification...'
                : '\nWatching for notifications. Press Ctrl+C to stop.',
        );

        process.once('SIGINT', onSignal);
        process.once('SIGTERM', onSignal);

        await new Promise<void>((resolve) => {
            finishWatch = resolve;
        });
    } finally {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
        await client.close();
    }
}

async function main() {
    const repoRoot = resolveRepoRoot();
    const command = process.argv[2];

    if (!command || ['-h', '--help', 'help'].includes(command)) {
        printUsage();
        return;
    }

    const parsed = parseCommandArgs(process.argv.slice(3));
    const client = new WordClawMcpClient(repoRoot, {
        transport: parsed.options.transport,
        endpoint: parsed.options.transport === 'http'
            ? resolveRemoteMcpEndpoint(parsed.options)
            : undefined,
        apiKey: parsed.options.apiKey,
    });

    if (command === 'watch') {
        const topic = parsed.positionals[0];
        if (!topic) {
            throw new Error('Missing topic for watch command.');
        }

        await watchReactiveTopic(parsed.options, topic);
        return;
    }

    try {
        await client.initialize();

        if (command === 'inspect') {
            const discovery = await inspectCapabilities(client);
            console.log('\n=== Discovery ===');
            console.log(`Tools (${discovery.tools.length})`);
            for (const tool of discovery.tools) {
                console.log(`- ${tool.name}${tool.description ? `: ${tool.description}` : ''}`);
            }

            console.log(`\nResources (${discovery.resources.length})`);
            for (const resource of discovery.resources) {
                const label = resource.uri ?? resource.name ?? 'unknown';
                console.log(`- ${label}${resource.description ? `: ${resource.description}` : ''}`);
            }

            console.log(`\nPrompts (${discovery.prompts.length})`);
            for (const prompt of discovery.prompts) {
                console.log(`- ${prompt.name}${prompt.description ? `: ${prompt.description}` : ''}`);
            }
            return;
        }

        if (command === 'call') {
            const toolName = parsed.positionals[0];
            if (!toolName) {
                throw new Error('Missing tool name for call command.');
            }

            const result = await client.callTool(toolName, parseJsonArg(parsed.positionals[1]));
            console.log(`\n=== Tool: ${toolName} ===`);
            console.log(result.rawText);
            if (result.isError) {
                process.exitCode = 1;
            }
            return;
        }

        if (command === 'prompt') {
            const promptName = parsed.positionals[0];
            if (!promptName) {
                throw new Error('Missing prompt name for prompt command.');
            }

            const result = await client.getPrompt(promptName, parseJsonArg(parsed.positionals[1]));
            console.log(`\n=== Prompt: ${promptName} ===`);
            console.log(result);
            return;
        }

        if (command === 'resource') {
            const uri = parsed.positionals[0];
            if (!uri) {
                throw new Error('Missing resource URI for resource command.');
            }

            const result = await client.readResource(uri);
            console.log(`\n=== Resource: ${uri} ===`);
            console.log(result);
            return;
        }

        if (command === 'smoke') {
            const summary = await runSmoke(client);
            console.log('\n=== Smoke Summary ===');
            for (const result of summary.results) {
                const label =
                    result.status === 'passed'
                        ? 'PASS'
                        : result.status === 'warned'
                            ? 'WARN'
                            : 'FAIL';
                console.log(`[${label}] ${result.name}: ${result.detail}`);
            }

            if (summary.failedCount > 0) {
                throw new Error(
                    `${summary.failedCount} smoke suite(s) failed: ${summary.results
                        .filter((result) => result.status === 'failed')
                        .map((result) => result.name)
                        .join(', ')}`,
                );
            }
            return;
        }

        throw new Error(`Unknown command: ${command}`);
    } finally {
        await client.stop();
    }
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n${HEADER} failed: ${message}`);
    process.exit(1);
});
