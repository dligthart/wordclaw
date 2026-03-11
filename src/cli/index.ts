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
import { buildContentGuide } from './lib/content-guide.js';
import { buildIntegrationGuide } from './lib/integration-guide.js';
import { buildL402Guide } from './lib/l402-guide.js';
import { buildWorkflowGuide } from './lib/workflow-guide.js';
import { buildAuditGuide } from './lib/audit-guide.js';
import { buildWorkspaceGuide } from './lib/workspace-guide.js';
import type { CurrentActorSnapshot } from '../services/actor-identity.js';
import type { WorkspaceContextSnapshot } from '../services/workspace-context.js';

type JsonMap = Record<string, unknown>;

const TOP_LEVEL_COMMANDS = [
    'mcp',
    'capabilities',
    'workspace',
    'audit',
    'rest',
    'integrations',
    'content-types',
    'content',
    'workflow',
    'l402',
] as const;
const MCP_SUBCOMMANDS = ['inspect', 'whoami', 'call', 'prompt', 'resource', 'smoke'] as const;
const CAPABILITY_SUBCOMMANDS = ['show', 'status', 'whoami'] as const;
const WORKSPACE_SUBCOMMANDS = ['guide'] as const;
const AUDIT_SUBCOMMANDS = ['list', 'guide'] as const;
const REST_SUBCOMMANDS = ['request'] as const;
const INTEGRATIONS_SUBCOMMANDS = ['guide'] as const;
const CONTENT_TYPES_SUBCOMMANDS = ['list', 'get', 'create', 'update', 'delete'] as const;
const CONTENT_SUBCOMMANDS = ['list', 'guide', 'get', 'create', 'update', 'versions', 'rollback', 'delete'] as const;
const WORKFLOW_SUBCOMMANDS = ['active', 'guide', 'submit', 'tasks', 'decide'] as const;
const L402_SUBCOMMANDS = ['offers', 'guide', 'purchase', 'confirm', 'entitlements', 'entitlement', 'read'] as const;

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
  mcp whoami
  mcp call <tool> [--json <object>|--file <path>]
  mcp prompt <prompt> [--json <object>|--file <path>]
  mcp resource <uri>
  mcp smoke
    MCP options: [--mcp-transport stdio|http] [--mcp-url <url>]

  capabilities show
  capabilities status
  capabilities whoami

  workspace guide

  audit list [--actor-id <value>] [--actor-type <value>] [--entity-type <value>] [--entity-id <n>] [--action <value>] [--limit <n>] [--cursor <value>]
  audit guide [--actor-id <value>] [--actor-type <value>] [--entity-type <value>] [--entity-id <n>] [--action <value>] [--limit <n>]

  rest request <method> <path> [--query-json <object>] [--body-json <object>|--body-file <path>]
  integrations guide

  content-types list [--limit <n>] [--offset <n>] [--include-stats]
  content-types get --id <n>
  content-types create --name <value> --slug <value> [--description <value>] [--schema-json <json>|--schema-file <path>] [--base-price <n>] [--dry-run]
  content-types update --id <n> [--name <value>] [--slug <value>] [--description <value>] [--schema-json <json>|--schema-file <path>] [--base-price <n>] [--dry-run]
  content-types delete --id <n> [--dry-run]

  content list [--content-type-id <n>] [--status <value>] [--q <value>] [--created-after <iso>] [--created-before <iso>] [--sort-by updatedAt|createdAt|version] [--sort-dir asc|desc] [--limit <n>] [--offset <n>]
  content guide --content-type-id <n>
  content get --id <n>
  content create --content-type-id <n> [--status <value>] [--data-json <json>|--data-file <path>] [--dry-run]
  content update --id <n> [--content-type-id <n>] [--status <value>] [--data-json <json>|--data-file <path>] [--dry-run]
  content versions --id <n>
  content rollback --id <n> --version <n> [--dry-run]
  content delete --id <n> [--dry-run]

  workflow active --content-type-id <n>
  workflow guide [--task <n>]
  workflow submit --id <n> --transition <n> [--assignee <value>]
  workflow tasks
  workflow decide --id <n> --decision approved|rejected

  l402 offers --item <n>
  l402 guide --item <n> [--offer <n>]
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

function omitUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
    const filteredEntries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    return Object.fromEntries(filteredEntries) as Partial<T>;
}

function requireJsonMap(value: unknown, context: string): JsonMap {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${context} must be a JSON object.`);
    }

    return value as JsonMap;
}

function extractErrorCode(error: unknown): string | null {
    if (
        error instanceof RestCliError
        && error.response.body
        && typeof error.response.body === 'object'
        && 'code' in (error.response.body as Record<string, unknown>)
    ) {
        return String((error.response.body as Record<string, unknown>).code);
    }

    return null;
}

function isMissingActorErrorCode(code: string | null): boolean {
    return code === 'AUTH_MISSING_API_KEY'
        || code === 'AUTH_INSUFFICIENT_SCOPE'
        || code === 'API_KEY_REQUIRED';
}

async function tryFetchCurrentActor(client: RestCliClient): Promise<{
    currentActor: CurrentActorSnapshot | null;
    warnings: string[];
}> {
    try {
        const identityResponse = await client.request({
            method: 'GET',
            path: '/identity',
        });
        const identityBody = requireJsonMap(identityResponse.body, 'Current actor identity response');
        const data = identityBody.data;
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            return {
                currentActor: data as CurrentActorSnapshot,
                warnings: [],
            };
        }

        return {
            currentActor: null,
            warnings: ['Current actor identity response did not include a valid actor snapshot.'],
        };
    } catch (error) {
        if (
            error instanceof RestCliError
            && error.response.body
            && typeof error.response.body === 'object'
            && 'code' in (error.response.body as Record<string, unknown>)
        ) {
            const code = String((error.response.body as Record<string, unknown>).code);
            if (code === 'AUTH_MISSING_API_KEY' || code === 'AUTH_INSUFFICIENT_SCOPE' || code === 'API_KEY_REQUIRED') {
                return {
                    currentActor: null,
                    warnings: ['Current actor identity is unavailable until an API key is configured.'],
                };
            }
        }

        throw error;
    }
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

        if (action === 'whoami') {
            const text = await client.readResource('system://current-actor');
            printStructured(
                args,
                {
                    transport: 'mcp',
                    action: 'whoami',
                    actor: JSON.parse(text),
                },
                text,
            );
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

async function handleIntegrations(client: RestCliClient, args: ParsedArgs) {
    resolveSupportedSubcommand(
        args,
        1,
        'integrations subcommand',
        INTEGRATIONS_SUBCOMMANDS,
    );

    const actorResult = await tryFetchCurrentActor(client);
    const warnings = [...actorResult.warnings];
    type IntegrationGuideApiKey = {
        id: number;
        name: string;
        keyPrefix: string;
        scopes: string[];
        createdBy: number | null;
        createdAt: string;
        expiresAt: string | null;
        revokedAt: string | null;
        lastUsedAt: string | null;
    };
    type IntegrationGuideWebhook = {
        id: number;
        url: string;
        events: string[];
        active: boolean;
        createdAt: string;
    };
    let apiKeys: IntegrationGuideApiKey[] | null = null;
    let webhooks: IntegrationGuideWebhook[] | null = null;

    try {
        const response = await client.request({
            method: 'GET',
            path: '/auth/keys',
        });
        const body = requireJsonMap(response.body, 'Integrations guide API key response');
        apiKeys = Array.isArray(body.data) ? body.data as IntegrationGuideApiKey[] : [];
    } catch (error) {
        const code = extractErrorCode(error);
        if (isMissingActorErrorCode(code)) {
            warnings.push('API key inventory is unavailable until an authenticated actor with integration access is configured.');
        } else {
            throw error;
        }
    }

    try {
        const response = await client.request({
            method: 'GET',
            path: '/webhooks',
        });
        const body = requireJsonMap(response.body, 'Integrations guide webhook response');
        webhooks = Array.isArray(body.data) ? body.data as IntegrationGuideWebhook[] : [];
    } catch (error) {
        const code = extractErrorCode(error);
        if (isMissingActorErrorCode(code)) {
            warnings.push('Webhook inventory is unavailable until an authenticated actor with integration access is configured.');
        } else {
            throw error;
        }
    }

    const guide = buildIntegrationGuide({
        currentActor: actorResult.currentActor,
        apiKeys,
        webhooks,
    });
    if (warnings.length > 0) {
        guide.warnings = warnings;
    }

    printStructured(
        args,
        {
            transport: 'rest',
            action: 'guide',
            guide,
        },
        guide,
    );
}

async function handleCapabilities(client: RestCliClient, args: ParsedArgs) {
    const action = resolveSupportedSubcommand(
        args,
        1,
        'capabilities subcommand',
        CAPABILITY_SUBCOMMANDS,
    );

    if (action === 'show') {
        const response = await client.request({
            method: 'GET',
            path: '/capabilities',
        });
        printResponse(args, response);
        return;
    }

    if (action === 'whoami') {
        const response = await client.request({
            method: 'GET',
            path: '/identity',
        });
        printResponse(args, response);
        return;
    }

    if (action === 'status') {
        const response = await client.request({
            method: 'GET',
            path: '/deployment-status',
            acceptStatuses: [503],
        });
        printResponse(args, response);
        return;
    }

    throw buildUnknownCommandError('capabilities subcommand', action, CAPABILITY_SUBCOMMANDS);
}

async function handleWorkspace(client: RestCliClient, args: ParsedArgs) {
    const action = resolveSupportedSubcommand(
        args,
        1,
        'workspace subcommand',
        WORKSPACE_SUBCOMMANDS,
    );

    const actorResult = await tryFetchCurrentActor(client);
    const warnings = [...actorResult.warnings];
    let workspace: WorkspaceContextSnapshot | null = null;

    if (action === 'guide') {
        try {
            const response = await client.request({
                method: 'GET',
                path: '/workspace-context',
            });
            const body = requireJsonMap(response.body, 'Workspace guide response');
            const data = body.data;
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                workspace = data as WorkspaceContextSnapshot;
            }
        } catch (error) {
            const code = extractErrorCode(error);
            if (isMissingActorErrorCode(code)) {
                warnings.push('Workspace context is unavailable until an authenticated actor is configured.');
            } else {
                throw error;
            }
        }

        const guide = buildWorkspaceGuide({
            currentActor: actorResult.currentActor,
            workspace,
        });
        if (warnings.length > 0) {
            guide.warnings = [...(guide.warnings ?? []), ...warnings];
        }

        printStructured(
            args,
            {
                transport: 'rest',
                action: 'guide',
                guide,
            },
            guide,
        );
        return;
    }

    throw buildUnknownCommandError('workspace subcommand', action, WORKSPACE_SUBCOMMANDS);
}

async function handleAudit(client: RestCliClient, args: ParsedArgs) {
    const action = resolveSupportedSubcommand(
        args,
        1,
        'audit subcommand',
        AUDIT_SUBCOMMANDS,
    );

    if (action === 'list') {
        const response = await client.request({
            method: 'GET',
            path: '/audit-logs',
            query: omitUndefined({
                actorId: getStringFlag(args, 'actor-id'),
                actorType: getStringFlag(args, 'actor-type'),
                entityType: getStringFlag(args, 'entity-type'),
                entityId: maybeNumber(getNumberFlag(args, 'entity-id')),
                action: getStringFlag(args, 'action'),
                limit: maybeNumber(getNumberFlag(args, 'limit')),
                cursor: getStringFlag(args, 'cursor'),
            }),
        });
        printResponse(args, response);
        return;
    }

    const actorResult = await tryFetchCurrentActor(client);
    const actorId = getStringFlag(args, 'actor-id') ?? actorResult.currentActor?.actorId ?? undefined;
    const actorType = getStringFlag(args, 'actor-type') ?? actorResult.currentActor?.actorType ?? undefined;
    const entityType = getStringFlag(args, 'entity-type') ?? undefined;
    const entityId = getNumberFlag(args, 'entity-id');
    const auditAction = getStringFlag(args, 'action') ?? undefined;
    const limit = getNumberFlag(args, 'limit') ?? 20;
    const warnings = [...actorResult.warnings];
    let entries: Array<{
        id: number;
        action: string;
        entityType: string;
        entityId: number;
        actorId: string | null;
        actorType: string | null;
        actorSource?: string | null;
        details?: string | null;
        createdAt: string;
    }> = [];

    try {
        const response = await client.request({
            method: 'GET',
            path: '/audit-logs',
            query: omitUndefined({
                actorId,
                actorType,
                entityType,
                entityId: maybeNumber(entityId),
                action: auditAction,
                limit,
            }),
        });
        const body = requireJsonMap(response.body, 'Audit guide response');
        entries = Array.isArray(body.data) ? body.data as typeof entries : [];
    } catch (error) {
        const code = extractErrorCode(error);
        if (isMissingActorErrorCode(code)) {
            warnings.push('Audit trail inspection is unavailable until an authenticated actor with audit access is configured.');
        } else {
            throw error;
        }
    }

    const guide = buildAuditGuide({
        currentActor: actorResult.currentActor,
        entries,
        actorId,
        actorType,
        entityType,
        entityId,
        action: auditAction,
        limit,
    });
    if (warnings.length > 0) {
        guide.warnings = [...(guide.warnings ?? []), ...warnings];
    }

    printStructured(
        args,
        {
            transport: 'rest',
            action: 'guide',
            guide,
        },
        guide,
    );
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

    if (action === 'guide') {
        const contentTypeId = getNumberFlag(args, 'content-type-id');
        if (contentTypeId === undefined) {
            throw new Error('content guide requires --content-type-id.');
        }

        const actorResult = await tryFetchCurrentActor(client);
        const currentActor = actorResult.currentActor;
        const warnings = [...actorResult.warnings];
        type ContentGuideContentType = {
            id: number;
            name: string;
            slug: string;
            description?: string;
            schema: string;
            basePrice?: number;
            createdAt: string;
            updatedAt: string;
        };
        type ContentGuideWorkflow = {
            id: number;
            name: string;
            contentTypeId: number;
            active: boolean;
            transitions: Array<{
                id: number;
                workflowId: number;
                fromState: string;
                toState: string;
                requiredRoles?: string[];
            }>;
        };
        let contentType: ContentGuideContentType | null = null;
        let workflow: ContentGuideWorkflow | null | undefined = undefined;

        try {
            const response = await client.request({
                method: 'GET',
                path: `/content-types/${contentTypeId}`,
            });
            const body = requireJsonMap(response.body, 'Content guide response');
            const data = body.data;
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                contentType = data as ContentGuideContentType;
            }
        } catch (error) {
            const code = extractErrorCode(error);
            if (isMissingActorErrorCode(code)) {
                warnings.push('Schema inspection is unavailable until an authenticated actor with content access is configured.');
            } else {
                throw error;
            }
        }

        if (contentType) {
            try {
                const response = await client.request({
                    method: 'GET',
                    path: `/content-types/${contentTypeId}/workflows/active`,
                });
                const body = requireJsonMap(response.body, 'Content guide workflow response');
                const data = body.data;
                if (data && typeof data === 'object' && !Array.isArray(data)) {
                    workflow = data as ContentGuideWorkflow;
                }
            } catch (error) {
                const code = extractErrorCode(error);
                if (code === 'WORKFLOW_NOT_FOUND') {
                    workflow = null;
                } else if (isMissingActorErrorCode(code)) {
                    warnings.push('Active workflow inspection is unavailable until an authenticated actor with content access is configured.');
                } else {
                    throw error;
                }
            }
        }

        const guide = buildContentGuide({
            contentTypeId,
            contentType,
            workflow,
            currentActor,
        });
        if (warnings.length > 0) {
            guide.warnings = [...(guide.warnings ?? []), ...warnings];
        }

        printStructured(
            args,
            {
                transport: 'rest',
                action: 'guide',
                guide,
            },
            guide,
        );
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

    if (action === 'guide') {
        const { currentActor, warnings } = await tryFetchCurrentActor(client);
        let tasks: Array<{
            task: {
                id: number;
                contentItemId: number;
                workflowTransitionId: number;
                status: string;
                assignee: string | null;
                createdAt?: string;
                updatedAt?: string;
            };
            transition: {
                id: number;
                fromState: string;
                toState: string;
                requiredRoles?: string[];
            };
            workflow: {
                id: number;
                name: string;
            };
            contentItem: {
                id: number;
                status?: string;
                version?: number;
            };
            contentType: {
                id: number;
                name: string;
                slug: string;
            };
        }> = [];
        let taskWarnings = [...warnings];

        try {
            const response = await client.request({
                method: 'GET',
                path: '/review-tasks',
            });
            const body = requireJsonMap(response.body, 'Workflow guide response');
            tasks = Array.isArray(body.data) ? body.data as typeof tasks : [];
        } catch (error) {
            const code = extractErrorCode(error);
            if (isMissingActorErrorCode(code)) {
                taskWarnings.push('Pending review tasks are unavailable until an authenticated actor with review access is configured.');
            } else {
                throw error;
            }
        }

        const guide = buildWorkflowGuide({
            tasks,
            currentActor,
            preferredTaskId: getNumberFlag(args, 'task'),
        });
        if (taskWarnings.length > 0) {
            guide.warnings = taskWarnings;
        }

        printStructured(
            args,
            {
                transport: 'rest',
                action: 'guide',
                guide,
            },
            guide,
        );
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

    if (action === 'guide') {
        const itemId = getNumberFlag(args, 'item');
        if (itemId === undefined) {
            throw new Error('l402 guide requires --item.');
        }
        const apiKeyConfigured = Boolean(getStringFlag(args, 'api-key') ?? process.env.WORDCLAW_API_KEY);
        const actorResult = await tryFetchCurrentActor(client);
        const currentActor = actorResult.currentActor;
        let offers: Array<{
            id: number;
            slug: string;
            name: string;
            scopeType: string;
            scopeRef: number | null;
            priceSats: number;
            active: boolean;
        }> = [];
        let warnings: string[] = actorResult.warnings.length > 0
            ? ['Current actor identity is unavailable until an API key is configured. The guide is showing a blocked paid-content path.']
            : [];

        try {
            const response = await client.request({
                method: 'GET',
                path: `/content-items/${itemId}/offers`,
            });
            const body = requireJsonMap(response.body, 'L402 guide response');
            offers = Array.isArray(body.data) ? body.data as typeof offers : [];
        } catch (error) {
            const code = extractErrorCode(error);
            if (isMissingActorErrorCode(code)) {
                warnings = ['Live offer discovery is unavailable until an API key is configured. Showing the generic paid-content task plan instead.'];
            } else {
                throw error;
            }
        }

        const guide = buildL402Guide({
            itemId,
            offers,
            apiKeyConfigured,
            currentActor,
            preferredOfferId: getNumberFlag(args, 'offer'),
        });
        if (warnings.length > 0) {
            guide.warnings = [...(guide.warnings ?? []), ...warnings];
        }

        printStructured(
            args,
            {
                transport: 'rest',
                action: 'guide',
                guide,
            },
            guide,
        );
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
    if (command === 'integrations') {
        await handleIntegrations(client, args);
        return;
    }
    if (command === 'capabilities') {
        await handleCapabilities(client, args);
        return;
    }
    if (command === 'workspace') {
        await handleWorkspace(client, args);
        return;
    }
    if (command === 'audit') {
        await handleAudit(client, args);
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
