#!/usr/bin/env node

import {
    getNumberFlag,
    getOptionalBooleanFlag,
    getStringFlag,
    hasFlag,
    loadJsonFlag,
    optionalPositional,
    parseArgs,
    requirePositional,
    requireStringFlag,
} from './lib/args.js';
import { resolveRepoRoot, inspectCapabilities, runSmoke, WordClawMcpClient } from './lib/mcp-client.js';
import { RestCliClient, RestCliError, type RestCliResponse } from './lib/rest-client.js';

type JsonMap = Record<string, unknown>;

function printJson(value: unknown) {
    console.log(JSON.stringify(value, null, 2));
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

Environment:
  WORDCLAW_BASE_URL   Default: http://localhost:4000
  WORDCLAW_API_KEY    API key used for REST requests
  WORDCLAW_DOMAIN_ID  Optional explicit domain header for REST requests
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

async function handleMcp(repoRoot: string, args: ReturnType<typeof parseArgs>) {
    const action = requirePositional(args, 1, 'mcp subcommand');
    const client = new WordClawMcpClient(repoRoot);

    try {
        await client.initialize();

        if (action === 'inspect') {
            printJson(await inspectCapabilities(client));
            return;
        }

        if (action === 'call') {
            const toolName = requirePositional(args, 2, 'tool name');
            const payload = requireJsonMap(
                (await loadJsonFlag(args, 'json', 'file')) ?? {},
                'MCP tool arguments',
            );
            const result = await client.callTool(toolName, payload);
            printJson({
                transport: 'mcp',
                action: 'call',
                tool: toolName,
                rawText: result.rawText,
                parsed: result.parsed,
                isError: result.isError,
            });
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
            printJson({
                transport: 'mcp',
                action: 'prompt',
                prompt: promptName,
                text,
            });
            return;
        }

        if (action === 'resource') {
            const uri = requirePositional(args, 2, 'resource URI');
            const text = await client.readResource(uri);
            printJson({
                transport: 'mcp',
                action: 'resource',
                uri,
                text,
            });
            return;
        }

        if (action === 'smoke') {
            const summary = await runSmoke(client);
            printJson({
                transport: 'mcp',
                action: 'smoke',
                ...summary,
            });
            if (summary.failedCount > 0) {
                process.exitCode = 1;
            }
            return;
        }

        throw new Error(`Unknown mcp subcommand: ${action}`);
    } finally {
        await client.stop();
    }
}

async function handleRest(client: RestCliClient, args: ReturnType<typeof parseArgs>) {
    const action = requirePositional(args, 1, 'rest subcommand');
    if (action !== 'request') {
        throw new Error(`Unknown rest subcommand: ${action}`);
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
    printJson(bodyFromResponse(response));
}

async function handleContentTypes(client: RestCliClient, args: ReturnType<typeof parseArgs>) {
    const action = requirePositional(args, 1, 'content-types subcommand');

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
        printJson(bodyFromResponse(response));
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
        printJson(bodyFromResponse(response));
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
        printJson(bodyFromResponse(response));
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
        printJson(bodyFromResponse(response));
        return;
    }

    if (action === 'delete') {
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
        printJson(bodyFromResponse(response));
        return;
    }

    throw new Error(`Unknown content-types subcommand: ${action}`);
}

async function handleContent(client: RestCliClient, args: ReturnType<typeof parseArgs>) {
    const action = requirePositional(args, 1, 'content subcommand');

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
        printJson(bodyFromResponse(response));
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
        printJson(bodyFromResponse(response));
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
        printJson(bodyFromResponse(response));
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
        printJson(bodyFromResponse(response));
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
        printJson(bodyFromResponse(response));
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
        printJson(bodyFromResponse(response));
        return;
    }

    if (action === 'delete') {
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
        printJson(bodyFromResponse(response));
        return;
    }

    throw new Error(`Unknown content subcommand: ${action}`);
}

async function handleWorkflow(client: RestCliClient, args: ReturnType<typeof parseArgs>) {
    const action = requirePositional(args, 1, 'workflow subcommand');

    if (action === 'active') {
        const contentTypeId = getNumberFlag(args, 'content-type-id');
        if (contentTypeId === undefined) {
            throw new Error('workflow active requires --content-type-id.');
        }

        const response = await client.request({
            method: 'GET',
            path: `/content-types/${contentTypeId}/workflows/active`,
        });
        printJson(bodyFromResponse(response));
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
        printJson(bodyFromResponse(response));
        return;
    }

    if (action === 'tasks') {
        const response = await client.request({
            method: 'GET',
            path: '/review-tasks',
        });
        printJson(bodyFromResponse(response));
        return;
    }

    if (action === 'decide') {
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
        printJson(bodyFromResponse(response));
        return;
    }

    throw new Error(`Unknown workflow subcommand: ${action}`);
}

async function handleL402(client: RestCliClient, args: ReturnType<typeof parseArgs>) {
    const action = requirePositional(args, 1, 'l402 subcommand');

    if (action === 'offers') {
        const itemId = getNumberFlag(args, 'item');
        if (itemId === undefined) {
            throw new Error('l402 offers requires --item.');
        }

        const response = await client.request({
            method: 'GET',
            path: `/content-items/${itemId}/offers`,
        });
        printJson(bodyFromResponse(response));
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
        printJson(bodyFromResponse(response));
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
        printJson(bodyFromResponse(response));
        return;
    }

    if (action === 'entitlements') {
        const response = await client.request({
            method: 'GET',
            path: '/entitlements/me',
        });
        printJson(bodyFromResponse(response));
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
        printJson(bodyFromResponse(response));
        return;
    }

    if (action === 'read') {
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
        printJson(bodyFromResponse(response));
        if (!response.ok) {
            process.exitCode = 1;
        }
        return;
    }

    throw new Error(`Unknown l402 subcommand: ${action}`);
}

async function main() {
    const repoRoot = resolveRepoRoot();
    const args = parseArgs(process.argv.slice(2));
    const command = optionalPositional(args, 0);

    if (!command || hasFlag(args, 'help') || hasFlag(args, 'h')) {
        console.log(buildUsage());
        return;
    }

    const client = new RestCliClient({
        baseUrl: getStringFlag(args, 'base-url'),
        apiKey: getStringFlag(args, 'api-key'),
        domainId: getNumberFlag(args, 'domain-id'),
    });

    if (command === 'mcp') {
        await handleMcp(repoRoot, args);
        return;
    }
    if (command === 'rest') {
        await handleRest(client, args);
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
    if (command === 'l402') {
        await handleL402(client, args);
        return;
    }

    throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
    if (error instanceof RestCliError) {
        printJson({
            error: error.message,
            response: bodyFromResponse(error.response),
        });
        process.exit(1);
    }

    printJson({
        error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
});
