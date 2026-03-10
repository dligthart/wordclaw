#!/usr/bin/env node

import {
    getNumberFlag,
    getStringFlag,
    hasFlag,
    loadJsonFlag,
    optionalPositional,
    parseArgs,
    requirePositional,
    requireStringFlag,
    type ParsedArgs,
} from './lib/args.js';
import {
    buildUnknownCommandError,
    resolveAlias,
} from './lib/command-resolution.js';
import {
    inspectCapabilities,
    resolveMcpHttpEndpoint,
    resolveRepoRoot,
    runSmoke,
    WordClawMcpClient,
} from './lib/mcp-client.js';
import {
    RestCliClient,
    RestCliError,
    type RestCliResponse,
} from './lib/rest-client.js';

type JsonMap = Record<string, unknown>;

const TOP_LEVEL_COMMANDS = [
    'mcp',
    'capabilities',
    'rest',
    'content-types',
    'content',
    'workflow',
    'l402',
] as const;
const MCP_SUBCOMMANDS = ['inspect', 'call', 'prompt', 'resource', 'smoke'] as const;
const CAPABILITY_SUBCOMMANDS = ['show'] as const;
const REST_SUBCOMMANDS = ['request'] as const;
const CONTENT_TYPES_SUBCOMMANDS = ['list', 'get', 'create', 'update', 'delete'] as const;
const CONTENT_SUBCOMMANDS = ['list', 'get', 'create', 'update', 'versions', 'rollback', 'delete'] as const;
const WORKFLOW_SUBCOMMANDS = ['active', 'submit', 'tasks', 'decide'] as const;
const L402_SUBCOMMANDS = ['offers', 'purchase', 'confirm', 'entitlements', 'entitlement', 'read'] as const;

const TOP_LEVEL_ALIASES: Record<string, string> = {
    caps: 'capabilities',
    ct: 'content-types',
    wf: 'workflow',
};
const CONTENT_TYPES_SUBCOMMAND_ALIASES: Record<string, string> = {
    ls: 'list',
};
const CONTENT_SUBCOMMAND_ALIASES: Record<string, string> = {
    ls: 'list',
};

function printJson(value: unknown) {
    console.log(JSON.stringify(value, null, 2));
}

function printRaw(value: unknown) {
    if (typeof value === 'string') {
        console.log(value);
        return;
    }

    printJson(value);
}

function wantsRawOutput(args: ParsedArgs) {
    return hasFlag(args, 'raw');
}

function printStructured(args: ParsedArgs, structured: unknown, rawValue = structured) {
    if (wantsRawOutput(args)) {
        printRaw(rawValue);
        return;
    }

    printJson(structured);
}

function buildUsage() {
    return `WordClaw CLI

Usage:
  node dist/cli/index.js <command> [subcommand] [options]
  npx tsx src/cli/index.ts <command> [subcommand] [options]

Commands:
  mcp inspect
  mcp call <tool> [--json <object>|--file <path>]
  mcp prompt <prompt> [--json <object>|--file <path>]
  mcp resource <uri>
  mcp smoke
    MCP options: [--mcp-transport stdio|http] [--mcp-url <url>]

  capabilities show

  rest request <method> <path> [--query-json <object>] [--body-json <object>|--body-file <path>]

  content-types list [--limit <n>] [--offset <n>] [--include-stats]
  content-types get --id <n>
  content-types create --name <value> --slug <value> [--description <value>] [--schema-json <json>|--schema-file <path>] [--base-price <n>] [--dry-run]
  content-types update --id <n> [--name <value>] [--slug <value>] [--description <value>] [--schema-json <json>|--schema-file <path>] [--base-price <n>] [--dry-run]
  content-types delete --id <n> [--dry-run]

  content list [--content-type-id <n>] [--status <value>] [--q <value>] [--created-after <iso>] [--created-before <iso>] [--sort-by updatedAt|createdAt|version] [--sort-dir asc|desc] [--limit <n>] [--offset <n>]
  content get --id <n>
  content create --content-type-id <n> [--status <value>] [--data-json <json>|--data-file <path>] [--dry-run]
  content update --id <n> [--content-type-id <n>] [--status <value>] [--data-json <json>|--data-file <path>] [--dry-run]
  content versions --id <n>
  content rollback --id <n> --version <n> [--dry-run]
  content delete --id <n> [--dry-run]

  workflow active --content-type-id <n>
  workflow submit --id <n> --transition <n> [--assignee <value>]
  workflow tasks
  workflow decide --id <n> --decision approved|rejected

  l402 offers --item <n>
  l402 purchase --offer <n> [--payment-method lightning]
  l402 confirm --offer <n> --macaroon <value> --preimage <value> [--payment-hash <hash>]
  l402 entitlements
  l402 entitlement --id <n>
  l402 read --item <n> [--entitlement-id <n>]

Aliases:
  caps -> capabilities
  ct -> content-types
  wf -> workflow
  content-types ls -> content-types list
  content ls -> content list

Global options:
  --raw               Print plain body/text without the CLI envelope when possible
  --help, -h          Show this help message
  --base-url <url>    Override WORDCLAW_BASE_URL for REST commands
  --api-key <key>     Override WORDCLAW_API_KEY for REST commands
  --mcp-transport     MCP transport for mcp commands: stdio or http
  --mcp-url <url>     Remote MCP endpoint. Defaults to <base-url>/mcp for HTTP mode

Environment:
  WORDCLAW_BASE_URL   Default: http://localhost:4000
  WORDCLAW_API_KEY    API key used for REST requests
  WORDCLAW_MCP_URL    Remote MCP endpoint for mcp commands
  WORDCLAW_MCP_TRANSPORT  Default MCP transport override for mcp commands
`;
}

function bodyFromResponse(response: RestCliResponse) {
    return {
        transport: response.transport,
        method: response.method,
        url: response.url,
        status: response.status,
        ok: response.ok,
        headers: response.headers,
        body: response.body,
    };
}

function printResponse(args: ParsedArgs, response: RestCliResponse) {
    printStructured(args, bodyFromResponse(response), response.body);
}

function maybeNumber(value: number | undefined): number | undefined {
    return value === undefined ? undefined : value;
}

function omitUndefined<T extends JsonMap>(value: T): JsonMap {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => entry !== undefined),
    );
}

function requireJsonMap(value: unknown, context: string): JsonMap {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${context} must be a JSON object.`);
    }

    return value as JsonMap;
}

function assertHasUpdateFields(body: JsonMap, context: string) {
    if (Object.keys(body).length === 0) {
        throw new Error(`${context} requires at least one update field.`);
    }
}

function resolveSupportedSubcommand(
    args: ParsedArgs,
    index: number,
    label: string,
    supported: readonly string[],
    aliases: Record<string, string> = {},
) {
    const raw = requirePositional(args, index, label);
    const resolved = resolveAlias(raw, aliases) ?? raw;

    if (!supported.includes(resolved)) {
        throw buildUnknownCommandError(label, raw, supported);
    }

    return resolved;
}

async function handleMcp(repoRoot: string, args: ParsedArgs) {
    const action = resolveSupportedSubcommand(
        args,
        1,
        'mcp subcommand',
        MCP_SUBCOMMANDS,
    );
    const baseUrl = getStringFlag(args, 'base-url') ?? process.env.WORDCLAW_BASE_URL;
    const explicitEndpoint = getStringFlag(args, 'mcp-url') ?? process.env.WORDCLAW_MCP_URL;
    const requestedTransport = getStringFlag(args, 'mcp-transport') ?? process.env.WORDCLAW_MCP_TRANSPORT;
    if (requestedTransport && requestedTransport !== 'stdio' && requestedTransport !== 'http') {
        throw new Error('--mcp-transport must be "stdio" or "http".');
    }
    const transport = requestedTransport === 'http' || explicitEndpoint
        ? 'http'
        : 'stdio';
    const endpoint = transport === 'http'
        ? resolveMcpHttpEndpoint(explicitEndpoint, baseUrl)
        : undefined;
    const client = new WordClawMcpClient(repoRoot, {
        transport,
        endpoint,
        apiKey: getStringFlag(args, 'api-key') ?? process.env.WORDCLAW_API_KEY,
    });

    try {
        await client.initialize();

        if (action === 'inspect') {
            printStructured(args, await inspectCapabilities(client));
            return;
        }

        if (action === 'call') {
            const toolName = requirePositional(args, 2, 'tool name');
            const payload = requireJsonMap(
                (await loadJsonFlag(args, 'json', 'file')) ?? {},
                'MCP tool arguments',
            );
            const result = await client.callTool(toolName, payload);
            printStructured(
                args,
                {
                    transport: 'mcp',
                    action: 'call',
                    tool: toolName,
                    rawText: result.rawText,
                    parsed: result.parsed,
                    isError: result.isError,
                },
                result.rawText,
            );
            if (result.isError) {
                process.exitCode = 1;
            }
            return;
        }

        if (action === 'prompt') {
            const promptName = requirePositional(args, 2, 'prompt name');
            const payload = requireJsonMap(
                (await loadJsonFlag(args, 'json', 'file')) ?? {},
                'MCP prompt arguments',
            );
            const text = await client.getPrompt(promptName, payload);
            printStructured(
                args,
                {
                    transport: 'mcp',
                    action: 'prompt',
                    prompt: promptName,
                    text,
                },
                text,
            );
            return;
        }

        if (action === 'resource') {
            const uri = requirePositional(args, 2, 'resource URI');
            const text = await client.readResource(uri);
            printStructured(
                args,
                {
                    transport: 'mcp',
                    action: 'resource',
                    uri,
                    text,
                },
                text,
            );
            return;
        }

        const summary = await runSmoke(client);
        printStructured(
            args,
            {
                transport: 'mcp',
                action: 'smoke',
                ...summary,
            },
        );
        if (summary.failedCount > 0) {
            process.exitCode = 1;
        }
    } finally {
        await client.stop();
    }
}

async function handleRest(client: RestCliClient, args: ParsedArgs) {
    const action = resolveSupportedSubcommand(
        args,
        1,
        'rest subcommand',
        REST_SUBCOMMANDS,
    );

    if (action !== 'request') {
        throw buildUnknownCommandError('rest subcommand', action, REST_SUBCOMMANDS);
    }

    const method = requirePositional(args, 2, 'HTTP method');
    const path = requirePositional(args, 3, 'path');
    const query = requireJsonMap(
        (await loadJsonFlag(args, 'query-json', 'query-file')) ?? {},
        'REST query',
    );
    const body = await loadJsonFlag(args, 'body-json', 'body-file');

    const response = await client.request({
        method,
        path,
        query: query as Record<string, string | number | boolean | undefined>,
        body,
    });
    printResponse(args, response);
}

async function handleCapabilities(client: RestCliClient, args: ParsedArgs) {
    const action = resolveSupportedSubcommand(
        args,
        1,
        'capabilities subcommand',
        CAPABILITY_SUBCOMMANDS,
    );

    if (action !== 'show') {
        throw buildUnknownCommandError('capabilities subcommand', action, CAPABILITY_SUBCOMMANDS);
    }

    const response = await client.request({
        method: 'GET',
        path: '/capabilities',
    });
    printResponse(args, response);
}

async function handleContentTypes(client: RestCliClient, args: ParsedArgs) {
    const action = resolveSupportedSubcommand(
        args,
        1,
        'content-types subcommand',
        CONTENT_TYPES_SUBCOMMANDS,
        CONTENT_TYPES_SUBCOMMAND_ALIASES,
    );

    if (action === 'list') {
        const response = await client.request({
            method: 'GET',
            path: '/content-types',
            query: {
                limit: maybeNumber(getNumberFlag(args, 'limit')),
                offset: maybeNumber(getNumberFlag(args, 'offset')),
                includeStats: hasFlag(args, 'include-stats') ? true : undefined,
            },
        });
        printResponse(args, response);
        return;
    }

    if (action === 'get') {
        const id = getNumberFlag(args, 'id');
        if (id === undefined) {
            throw new Error('content-types get requires --id.');
        }
        const response = await client.request({
            method: 'GET',
            path: `/content-types/${id}`,
        });
        printResponse(args, response);
        return;
    }

    if (action === 'create') {
        const schema = await loadJsonFlag(args, 'schema-json', 'schema-file');
        if (schema === undefined) {
            throw new Error('content-types create requires --schema-json or --schema-file.');
        }

        const response = await client.request({
            method: 'POST',
            path: '/content-types',
            query: {
                mode: hasFlag(args, 'dry-run') ? 'dry_run' : undefined,
            },
            body: omitUndefined({
                name: requireStringFlag(args, 'name'),
                slug: requireStringFlag(args, 'slug'),
                description: getStringFlag(args, 'description'),
                schema,
                basePrice: maybeNumber(getNumberFlag(args, 'base-price')),
            }),
            acceptStatuses: hasFlag(args, 'dry-run') ? [200] : undefined,
        });
        printResponse(args, response);
        return;
    }

    if (action === 'update') {
        const id = getNumberFlag(args, 'id');
        if (id === undefined) {
            throw new Error('content-types update requires --id.');
        }

        const schema = await loadJsonFlag(args, 'schema-json', 'schema-file');
        const body = omitUndefined({
            name: getStringFlag(args, 'name'),
            slug: getStringFlag(args, 'slug'),
            description: getStringFlag(args, 'description'),
            schema,
            basePrice: maybeNumber(getNumberFlag(args, 'base-price')),
        });
        assertHasUpdateFields(body, 'content-types update');

        const response = await client.request({
            method: 'PUT',
            path: `/content-types/${id}`,
            query: {
                mode: hasFlag(args, 'dry-run') ? 'dry_run' : undefined,
            },
            body,
        });
        printResponse(args, response);
        return;
    }

    const id = getNumberFlag(args, 'id');
    if (id === undefined) {
        throw new Error('content-types delete requires --id.');
    }

    const response = await client.request({
        method: 'DELETE',
        path: `/content-types/${id}`,
        query: {
            mode: hasFlag(args, 'dry-run') ? 'dry_run' : undefined,
        },
    });
    printResponse(args, response);
}

async function handleContent(client: RestCliClient, args: ParsedArgs) {
    const action = resolveSupportedSubcommand(
        args,
        1,
        'content subcommand',
        CONTENT_SUBCOMMANDS,
        CONTENT_SUBCOMMAND_ALIASES,
    );

    if (action === 'list') {
        const response = await client.request({
            method: 'GET',
            path: '/content-items',
            query: {
                contentTypeId: maybeNumber(getNumberFlag(args, 'content-type-id')),
                status: getStringFlag(args, 'status'),
                q: getStringFlag(args, 'q'),
                createdAfter: getStringFlag(args, 'created-after'),
                createdBefore: getStringFlag(args, 'created-before'),
                sortBy: getStringFlag(args, 'sort-by'),
                sortDir: getStringFlag(args, 'sort-dir'),
                limit: maybeNumber(getNumberFlag(args, 'limit')),
                offset: maybeNumber(getNumberFlag(args, 'offset')),
            },
        });
        printResponse(args, response);
        return;
    }

    if (action === 'get') {
        const id = getNumberFlag(args, 'id');
        if (id === undefined) {
            throw new Error('content get requires --id.');
        }

        const response = await client.request({
            method: 'GET',
            path: `/content-items/${id}`,
        });
        printResponse(args, response);
        return;
    }

    if (action === 'create') {
        const contentTypeId = getNumberFlag(args, 'content-type-id');
        if (contentTypeId === undefined) {
            throw new Error('content create requires --content-type-id.');
        }

        const data = await loadJsonFlag(args, 'data-json', 'data-file');
        if (data === undefined) {
            throw new Error('content create requires --data-json or --data-file.');
        }

        const response = await client.request({
            method: 'POST',
            path: '/content-items',
            query: {
                mode: hasFlag(args, 'dry-run') ? 'dry_run' : undefined,
            },
            body: omitUndefined({
                contentTypeId,
                data,
                status: getStringFlag(args, 'status'),
            }),
            acceptStatuses: hasFlag(args, 'dry-run') ? [200] : undefined,
        });
        printResponse(args, response);
        return;
    }

    if (action === 'update') {
        const id = getNumberFlag(args, 'id');
        if (id === undefined) {
            throw new Error('content update requires --id.');
        }

        const data = await loadJsonFlag(args, 'data-json', 'data-file');
        const body = omitUndefined({
            contentTypeId: maybeNumber(getNumberFlag(args, 'content-type-id')),
            data,
            status: getStringFlag(args, 'status'),
        });
        assertHasUpdateFields(body, 'content update');

        const response = await client.request({
            method: 'PUT',
            path: `/content-items/${id}`,
            query: {
                mode: hasFlag(args, 'dry-run') ? 'dry_run' : undefined,
            },
            body,
        });
        printResponse(args, response);
        return;
    }

    if (action === 'versions') {
        const id = getNumberFlag(args, 'id');
        if (id === undefined) {
            throw new Error('content versions requires --id.');
        }

        const response = await client.request({
            method: 'GET',
            path: `/content-items/${id}/versions`,
        });
        printResponse(args, response);
        return;
    }

    if (action === 'rollback') {
        const id = getNumberFlag(args, 'id');
        const version = getNumberFlag(args, 'version');
        if (id === undefined || version === undefined) {
            throw new Error('content rollback requires --id and --version.');
        }

        const response = await client.request({
            method: 'POST',
            path: `/content-items/${id}/rollback`,
            query: {
                mode: hasFlag(args, 'dry-run') ? 'dry_run' : undefined,
            },
            body: { version },
        });
        printResponse(args, response);
        return;
    }

    const id = getNumberFlag(args, 'id');
    if (id === undefined) {
        throw new Error('content delete requires --id.');
    }

    const response = await client.request({
        method: 'DELETE',
        path: `/content-items/${id}`,
        query: {
            mode: hasFlag(args, 'dry-run') ? 'dry_run' : undefined,
        },
    });
    printResponse(args, response);
}

async function handleWorkflow(client: RestCliClient, args: ParsedArgs) {
    const action = resolveSupportedSubcommand(
        args,
        1,
        'workflow subcommand',
        WORKFLOW_SUBCOMMANDS,
    );

    if (action === 'active') {
        const contentTypeId = getNumberFlag(args, 'content-type-id');
        if (contentTypeId === undefined) {
            throw new Error('workflow active requires --content-type-id.');
        }

        const response = await client.request({
            method: 'GET',
            path: `/content-types/${contentTypeId}/workflows/active`,
        });
        printResponse(args, response);
        return;
    }

    if (action === 'submit') {
        const id = getNumberFlag(args, 'id');
        const transition = getNumberFlag(args, 'transition');
        if (id === undefined || transition === undefined) {
            throw new Error('workflow submit requires --id and --transition.');
        }

        const response = await client.request({
            method: 'POST',
            path: `/content-items/${id}/submit`,
            body: omitUndefined({
                workflowTransitionId: transition,
                assignee: getStringFlag(args, 'assignee'),
            }),
            acceptStatuses: [201],
        });
        printResponse(args, response);
        return;
    }

    if (action === 'tasks') {
        const response = await client.request({
            method: 'GET',
            path: '/review-tasks',
        });
        printResponse(args, response);
        return;
    }

    const id = getNumberFlag(args, 'id');
    const decision = getStringFlag(args, 'decision');
    if (id === undefined || !decision) {
        throw new Error('workflow decide requires --id and --decision.');
    }

    const response = await client.request({
        method: 'POST',
        path: `/review-tasks/${id}/decide`,
        body: { decision },
    });
    printResponse(args, response);
}

async function handleL402(client: RestCliClient, args: ParsedArgs) {
    const action = resolveSupportedSubcommand(
        args,
        1,
        'l402 subcommand',
        L402_SUBCOMMANDS,
    );

    if (action === 'offers') {
        const itemId = getNumberFlag(args, 'item');
        if (itemId === undefined) {
            throw new Error('l402 offers requires --item.');
        }

        const response = await client.request({
            method: 'GET',
            path: `/content-items/${itemId}/offers`,
        });
        printResponse(args, response);
        return;
    }

    if (action === 'purchase') {
        const offerId = getNumberFlag(args, 'offer');
        if (offerId === undefined) {
            throw new Error('l402 purchase requires --offer.');
        }

        const response = await client.request({
            method: 'POST',
            path: `/offers/${offerId}/purchase`,
            body: omitUndefined({
                paymentMethod: getStringFlag(args, 'payment-method') ?? 'lightning',
            }),
            acceptStatuses: [402],
        });
        printResponse(args, response);
        return;
    }

    if (action === 'confirm') {
        const offerId = getNumberFlag(args, 'offer');
        if (offerId === undefined) {
            throw new Error('l402 confirm requires --offer.');
        }

        const macaroon = requireStringFlag(args, 'macaroon');
        const preimage = requireStringFlag(args, 'preimage');
        const paymentHash = getStringFlag(args, 'payment-hash');

        const response = await client.request({
            method: 'POST',
            path: `/offers/${offerId}/purchase/confirm`,
            headers: omitUndefined({
                authorization: `L402 ${macaroon}:${preimage}`,
                'x-payment-hash': paymentHash,
            }) as Record<string, string>,
        });
        printResponse(args, response);
        return;
    }

    if (action === 'entitlements') {
        const response = await client.request({
            method: 'GET',
            path: '/entitlements/me',
        });
        printResponse(args, response);
        return;
    }

    if (action === 'entitlement') {
        const id = getNumberFlag(args, 'id');
        if (id === undefined) {
            throw new Error('l402 entitlement requires --id.');
        }
        const response = await client.request({
            method: 'GET',
            path: `/entitlements/${id}`,
        });
        printResponse(args, response);
        return;
    }

    const itemId = getNumberFlag(args, 'item');
    if (itemId === undefined) {
        throw new Error('l402 read requires --item.');
    }

    const entitlementId = getNumberFlag(args, 'entitlement-id');
    const response = await client.request({
        method: 'GET',
        path: `/content-items/${itemId}`,
        headers: omitUndefined({
            'x-entitlement-id': entitlementId !== undefined ? String(entitlementId) : undefined,
        }) as Record<string, string>,
        acceptStatuses: [402, 403, 409],
    });
    printResponse(args, response);
    if (!response.ok) {
        process.exitCode = 1;
    }
}

async function main(args: ParsedArgs) {
    const rawCommand = optionalPositional(args, 0);

    if (!rawCommand || hasFlag(args, 'help') || hasFlag(args, 'h')) {
        console.log(buildUsage());
        return;
    }

    const command = resolveAlias(rawCommand, TOP_LEVEL_ALIASES) ?? rawCommand;
    if (!(TOP_LEVEL_COMMANDS as readonly string[]).includes(command)) {
        throw buildUnknownCommandError('command', rawCommand, TOP_LEVEL_COMMANDS);
    }

    if (command === 'mcp') {
        await handleMcp(resolveRepoRoot(), args);
        return;
    }

    const client = new RestCliClient({
        baseUrl: getStringFlag(args, 'base-url'),
        apiKey: getStringFlag(args, 'api-key'),
        domainId: getNumberFlag(args, 'domain-id'),
    });

    if (command === 'rest') {
        await handleRest(client, args);
        return;
    }
    if (command === 'capabilities') {
        await handleCapabilities(client, args);
        return;
    }
    if (command === 'content-types') {
        await handleContentTypes(client, args);
        return;
    }
    if (command === 'content') {
        await handleContent(client, args);
        return;
    }
    if (command === 'workflow') {
        await handleWorkflow(client, args);
        return;
    }

    await handleL402(client, args);
}

const parsedArgs = parseArgs(process.argv.slice(2));

main(parsedArgs).catch((error) => {
    if (error instanceof RestCliError) {
        if (wantsRawOutput(parsedArgs)) {
            printRaw(error.response.body);
        } else {
            printJson({
                error: error.message,
                response: bodyFromResponse(error.response),
            });
        }
        process.exit(1);
    }

    const message = error instanceof Error ? error.message : String(error);
    if (wantsRawOutput(parsedArgs)) {
        printRaw(message);
    } else {
        printJson({ error: message });
    }
    process.exit(1);
});
