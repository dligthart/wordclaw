#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

import {
    getNumberFlag,
    getStringFlag,
    hasFlag,
    loadJsonFlag,
    loadTextFlag,
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
    loadWordClawCliConfig,
    resolveCliBooleanOption,
    resolveCliStringOption,
} from './lib/config.js';
import { buildUsage } from './lib/help.js';
import {
    formatStructuredOutput,
    normalizeOutputFormat,
    type OutputFormat,
} from './lib/output.js';
import { runCliRepl } from './lib/repl.js';
import { runCliScript } from './lib/script-runner.js';
import {
    inspectCapabilities,
    resolveMcpHttpEndpoint,
    resolveRepoRoot,
    runSmoke,
    WordClawMcpClient,
} from './lib/mcp-client.js';
import { buildOpenAiFunctionTools } from './lib/openai-tools.js';
import {
    buildProvisioningPlan,
    SUPPORTED_PROVISION_AGENTS,
    SUPPORTED_PROVISION_SCOPES,
    SUPPORTED_PROVISION_TRANSPORTS,
    writeProvisioningPlan,
    type ProvisionAgent,
    type ProvisionScope,
    type ProvisionTransport,
} from './lib/provisioning.js';
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
import { generateSchemaArtifacts, writeSchemaArtifacts, type ArtifactCapabilitySnapshot, type ArtifactContentType } from './lib/schema-artifacts.js';
import type { CurrentActorSnapshot } from '../services/actor-identity.js';
import type { WorkspaceContextSnapshot } from '../services/workspace-context.js';

type JsonMap = Record<string, unknown>;
type CliRuntimeOptions = {
    baseUrl?: string;
    apiKey?: string;
    mcpUrl?: string;
    mcpTransport?: 'stdio' | 'http';
    format: OutputFormat;
    raw: boolean;
    configPath: string | null;
};

const TOP_LEVEL_COMMANDS = [
    'repl',
    'provision',
    'script',
    'mcp',
    'capabilities',
    'workspace',
    'audit',
    'rest',
    'schema',
    'integrations',
    'forms',
    'jobs',
    'content-types',
    'globals',
    'content',
    'assets',
    'workflow',
    'l402',
] as const;
const MCP_SUBCOMMANDS = ['inspect', 'whoami', 'call', 'prompt', 'resource', 'openai-tools', 'smoke'] as const;
const SCRIPT_SUBCOMMANDS = ['run'] as const;
const CAPABILITY_SUBCOMMANDS = ['show', 'status', 'whoami'] as const;
const WORKSPACE_SUBCOMMANDS = ['guide', 'resolve'] as const;
const AUDIT_SUBCOMMANDS = ['list', 'guide'] as const;
const REST_SUBCOMMANDS = ['request'] as const;
const SCHEMA_SUBCOMMANDS = ['generate'] as const;
const INTEGRATIONS_SUBCOMMANDS = ['guide'] as const;
const FORMS_SUBCOMMANDS = ['list', 'get', 'public', 'create', 'update', 'delete', 'submit'] as const;
const JOBS_SUBCOMMANDS = ['list', 'get', 'worker-status', 'create', 'cancel', 'schedule-status'] as const;
const CONTENT_TYPES_SUBCOMMANDS = ['list', 'get', 'create', 'update', 'delete'] as const;
const GLOBALS_SUBCOMMANDS = ['list', 'get', 'update', 'preview-token'] as const;
const CONTENT_SUBCOMMANDS = ['list', 'project', 'guide', 'get', 'used-by', 'create', 'update', 'versions', 'preview-token', 'rollback', 'delete'] as const;
const ASSETS_SUBCOMMANDS = ['list', 'get', 'used-by', 'create', 'offers', 'access', 'delete', 'restore', 'purge'] as const;
const WORKFLOW_SUBCOMMANDS = ['active', 'guide', 'submit', 'tasks', 'decide'] as const;
const L402_SUBCOMMANDS = ['offers', 'guide', 'purchase', 'confirm', 'entitlements', 'entitlement', 'read'] as const;

const TOP_LEVEL_ALIASES: Record<string, string> = {
    caps: 'capabilities',
    ct: 'content-types',
    asset: 'assets',
    wf: 'workflow',
    interactive: 'repl',
};
const CONTENT_TYPES_SUBCOMMAND_ALIASES: Record<string, string> = {
    ls: 'list',
};
const CONTENT_SUBCOMMAND_ALIASES: Record<string, string> = {
    ls: 'list',
};
const ASSETS_SUBCOMMAND_ALIASES: Record<string, string> = {
    ls: 'list',
};
let currentRuntimeOptions: CliRuntimeOptions | null = null;

function printStructuredValue(value: unknown) {
    process.stdout.write(formatStructuredOutput(value, currentRuntimeOptions?.format ?? 'json'));
}

function printRaw(value: unknown) {
    if (typeof value === 'string') {
        console.log(value);
        return;
    }

    printStructuredValue(value);
}

function wantsRawOutput(args: ParsedArgs) {
    return currentRuntimeOptions?.raw === true || hasFlag(args, 'raw');
}

function printStructured(args: ParsedArgs, structured: unknown, rawValue = structured) {
    if (wantsRawOutput(args)) {
        printRaw(rawValue);
        return;
    }

    printStructuredValue(structured);
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

function maybeBooleanFlag(args: ParsedArgs, name: string): boolean | undefined {
    const raw = getStringFlag(args, name);
    if (raw === undefined) {
        return undefined;
    }

    if (raw === 'true') {
        return true;
    }

    if (raw === 'false') {
        return false;
    }

    throw new Error(`--${name} must be true or false.`);
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

async function resolveCliRuntimeOptions(args: ParsedArgs): Promise<CliRuntimeOptions> {
    const loadedConfig = await loadWordClawCliConfig(args);
    const requestedTransport = resolveCliStringOption(
        getStringFlag(args, 'mcp-transport'),
        loadedConfig.config.mcpTransport,
        process.env.WORDCLAW_MCP_TRANSPORT,
    );
    if (requestedTransport && requestedTransport !== 'stdio' && requestedTransport !== 'http') {
        throw new Error('--mcp-transport must be "stdio" or "http".');
    }

    const outputFormat = normalizeOutputFormat(
        resolveCliStringOption(
            getStringFlag(args, 'format'),
            loadedConfig.config.format,
            undefined,
        ),
    ) ?? 'json';

    return {
        baseUrl: resolveCliStringOption(
            getStringFlag(args, 'base-url'),
            loadedConfig.config.baseUrl,
            process.env.WORDCLAW_BASE_URL,
        ),
        apiKey: resolveCliStringOption(
            getStringFlag(args, 'api-key'),
            loadedConfig.config.apiKey,
            process.env.WORDCLAW_API_KEY,
        ),
        mcpUrl: resolveCliStringOption(
            getStringFlag(args, 'mcp-url'),
            loadedConfig.config.mcpUrl,
            process.env.WORDCLAW_MCP_URL,
        ),
        mcpTransport: requestedTransport as 'stdio' | 'http' | undefined,
        format: outputFormat,
        raw: resolveCliBooleanOption(hasFlag(args, 'raw'), loadedConfig.config.raw),
        configPath: loadedConfig.path,
    };
}

function buildErrorSuggestions(error: unknown, runtimeOptions: CliRuntimeOptions | null) {
    const suggestions: string[] = [];

    if (error instanceof RestCliError) {
        const code = extractErrorCode(error);
        if (code === 'AUTH_MISSING_API_KEY' || code === 'API_KEY_REQUIRED') {
            suggestions.push('Configure an API key with --api-key, WORDCLAW_API_KEY, or .wordclaw.json before running authenticated REST commands.');
            suggestions.push('Use `wordclaw capabilities whoami` or `wordclaw capabilities show` to confirm which actor and auth mode the deployment expects.');
        } else if (code === 'AUTH_INSUFFICIENT_SCOPE') {
            suggestions.push('Use `wordclaw capabilities whoami` to inspect the current actor profile and scopes.');
            suggestions.push('Use a key with the recommended scope set for this task, or switch to a supervisor session when the manifest recommends it.');
        } else if (code === 'INVALID_DOMAIN_CONTEXT') {
            suggestions.push('Use a domain-scoped API key or a supervisor session with x-wordclaw-domain rather than trying to override tenant context manually.');
        } else if (code) {
            const body = error.response.body;
            if (
                body
                && typeof body === 'object'
                && 'remediation' in (body as Record<string, unknown>)
                && typeof (body as Record<string, unknown>).remediation === 'string'
            ) {
                suggestions.push(String((body as Record<string, unknown>).remediation));
            }
        }
    } else if (error instanceof Error && error.message.includes('fetch failed')) {
        suggestions.push('Check that the WordClaw server is reachable and the base URL is correct.');
        suggestions.push(`Try \`wordclaw capabilities status${runtimeOptions?.baseUrl ? ` --base-url ${runtimeOptions.baseUrl}` : ''}\` once the server is up.`);
    }

    return Array.from(new Set(suggestions));
}

function resolveHelpScope(args: ParsedArgs) {
    if (hasFlag(args, 'help-all')) {
        return buildUsage();
    }

    const rawCommand = optionalPositional(args, 0);
    if (!rawCommand) {
        return buildUsage();
    }

    if (!hasFlag(args, 'help') && !hasFlag(args, 'h')) {
        return null;
    }

    const command = resolveAlias(rawCommand, TOP_LEVEL_ALIASES) ?? rawCommand;
    if (!(TOP_LEVEL_COMMANDS as readonly string[]).includes(command)) {
        return buildUsage();
    }

    const rawSubcommand = optionalPositional(args, 1);
    if (!rawSubcommand) {
        return buildUsage({ command });
    }

    const subcommandAliases = command === 'content-types'
        ? CONTENT_TYPES_SUBCOMMAND_ALIASES
        : command === 'content'
            ? CONTENT_SUBCOMMAND_ALIASES
            : {};
    const subcommand = resolveAlias(rawSubcommand, subcommandAliases) ?? rawSubcommand;
    return buildUsage({ command, subcommand });
}

function resolveProvisionAgent(args: ParsedArgs): ProvisionAgent {
    const agent = getStringFlag(args, 'agent');
    if (!agent || !(SUPPORTED_PROVISION_AGENTS as readonly string[]).includes(agent)) {
        throw new Error(`provision requires --agent ${SUPPORTED_PROVISION_AGENTS.join('|')}.`);
    }

    return agent as ProvisionAgent;
}

function resolveProvisionTransport(args: ParsedArgs): ProvisionTransport | undefined {
    const transport = getStringFlag(args, 'transport');
    if (transport === undefined) {
        return undefined;
    }

    if (!(SUPPORTED_PROVISION_TRANSPORTS as readonly string[]).includes(transport)) {
        throw new Error(`--transport must be ${SUPPORTED_PROVISION_TRANSPORTS.join('|')}.`);
    }

    return transport as ProvisionTransport;
}

function resolveProvisionScope(args: ParsedArgs): ProvisionScope | undefined {
    const scope = getStringFlag(args, 'scope');
    if (scope === undefined) {
        return undefined;
    }

    if (!(SUPPORTED_PROVISION_SCOPES as readonly string[]).includes(scope)) {
        throw new Error(`--scope must be ${SUPPORTED_PROVISION_SCOPES.join('|')}.`);
    }

    return scope as ProvisionScope;
}

async function handleProvision(repoRoot: string, args: ParsedArgs, runtimeOptions: CliRuntimeOptions) {
    const plan = buildProvisioningPlan({
        agent: resolveProvisionAgent(args),
        transport: resolveProvisionTransport(args),
        scope: resolveProvisionScope(args),
        serverName: getStringFlag(args, 'name'),
        repoRoot,
        baseUrl: runtimeOptions.baseUrl,
    });
    const requestedConfigPath = getStringFlag(args, 'config-path');
    const writeResult = hasFlag(args, 'write')
        ? await writeProvisioningPlan(plan, requestedConfigPath)
        : null;

    printStructured(
        args,
        {
            transport: 'local',
            action: 'provision',
            agent: plan.agent,
            mcpTransport: plan.transport,
            scope: plan.scope,
            serverName: plan.serverName,
            configFormat: plan.configFormat,
            defaultConfigPath: plan.defaultConfigPath,
            configPath: writeResult?.configPath ?? null,
            wrote: writeResult !== null,
            supportsWrite: plan.supportsWrite,
            installCommand: plan.installCommand,
            notes: plan.notes,
            snippet: plan.snippet,
        },
        plan.snippet,
    );
}

async function handleMcp(repoRoot: string, args: ParsedArgs, runtimeOptions: CliRuntimeOptions) {
    const action = resolveSupportedSubcommand(
        args,
        1,
        'mcp subcommand',
        MCP_SUBCOMMANDS,
    );
    const transport = runtimeOptions.mcpTransport === 'http' || runtimeOptions.mcpUrl
        ? 'http'
        : 'stdio';
    const endpoint = transport === 'http'
        ? resolveMcpHttpEndpoint(runtimeOptions.mcpUrl, runtimeOptions.baseUrl)
        : undefined;
    const client = new WordClawMcpClient(repoRoot, {
        transport,
        endpoint,
        apiKey: runtimeOptions.apiKey,
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

        if (action === 'openai-tools') {
            const tools = buildOpenAiFunctionTools(await client.listTools());
            printStructured(
                args,
                {
                    transport: 'mcp',
                    action: 'openai-tools',
                    toolCount: tools.length,
                    tools,
                },
                tools,
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

async function handleScript(repoRoot: string, args: ParsedArgs, runtimeOptions: CliRuntimeOptions) {
    const action = resolveSupportedSubcommand(
        args,
        1,
        'script subcommand',
        SCRIPT_SUBCOMMANDS,
    );

    if (action !== 'run') {
        throw buildUnknownCommandError('script subcommand', action, SCRIPT_SUBCOMMANDS);
    }

    const scriptPath = requireStringFlag(args, 'file');
    const inheritedFlags: string[] = [];
    if (runtimeOptions.baseUrl) {
        inheritedFlags.push('--base-url', runtimeOptions.baseUrl);
    }
    if (runtimeOptions.apiKey) {
        inheritedFlags.push('--api-key', runtimeOptions.apiKey);
    }
    if (runtimeOptions.mcpTransport) {
        inheritedFlags.push('--mcp-transport', runtimeOptions.mcpTransport);
    }
    if (runtimeOptions.mcpUrl) {
        inheritedFlags.push('--mcp-url', runtimeOptions.mcpUrl);
    }
    inheritedFlags.push('--format', 'json');

    const result = await runCliScript({
        repoRoot,
        scriptPath,
        inheritedFlags,
        continueOnErrorOverride: hasFlag(args, 'continue-on-error') ? true : undefined,
    });

    printStructured(
        args,
        {
            transport: 'script',
            action: 'run',
            ...result,
        },
        result,
    );

    if (result.failedCount > 0) {
        process.exitCode = 1;
    }
}

async function handleRepl(repoRoot: string, runtimeOptions: CliRuntimeOptions) {
    const inheritedFlags: string[] = [];
    if (runtimeOptions.baseUrl) {
        inheritedFlags.push('--base-url', runtimeOptions.baseUrl);
    }
    if (runtimeOptions.apiKey) {
        inheritedFlags.push('--api-key', runtimeOptions.apiKey);
    }
    if (runtimeOptions.mcpTransport) {
        inheritedFlags.push('--mcp-transport', runtimeOptions.mcpTransport);
    }
    if (runtimeOptions.mcpUrl) {
        inheritedFlags.push('--mcp-url', runtimeOptions.mcpUrl);
    }
    if (runtimeOptions.configPath) {
        inheritedFlags.push('--config', runtimeOptions.configPath);
    }
    inheritedFlags.push('--format', runtimeOptions.format);
    if (runtimeOptions.raw) {
        inheritedFlags.push('--raw');
    }

    await runCliRepl({
        repoRoot,
        inheritedFlags,
    });
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

async function fetchAllContentTypesForArtifacts(client: RestCliClient): Promise<ArtifactContentType[]> {
    const limit = 500;
    const items: ArtifactContentType[] = [];
    let offset = 0;

    while (true) {
        const response = await client.request({
            method: 'GET',
            path: '/content-types',
            query: {
                limit,
                offset
            }
        });
        const body = requireJsonMap(response.body, 'Schema generation content-type response');
        const data = Array.isArray(body.data) ? body.data : [];

        items.push(...data.flatMap((entry) => {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                return [];
            }

            const candidate = entry as Record<string, unknown>;
            if (
                typeof candidate.id !== 'number'
                || typeof candidate.name !== 'string'
                || typeof candidate.slug !== 'string'
                || typeof candidate.schema !== 'string'
            ) {
                return [];
            }

            return [{
                id: candidate.id,
                name: candidate.name,
                slug: candidate.slug,
                kind: candidate.kind === 'singleton' ? 'singleton' : 'collection',
                description: typeof candidate.description === 'string' ? candidate.description : null,
                schema: candidate.schema
            } satisfies ArtifactContentType];
        }));

        if (data.length < limit) {
            break;
        }
        offset += limit;
    }

    return items;
}

async function handleSchema(client: RestCliClient, args: ParsedArgs) {
    const action = resolveSupportedSubcommand(
        args,
        1,
        'schema subcommand',
        SCHEMA_SUBCOMMANDS,
    );

    if (action !== 'generate') {
        throw new Error(`Unsupported schema action: ${action}`);
    }

    const outputDir = requireStringFlag(args, 'out');
    const packageName = getStringFlag(args, 'package-name') ?? 'wordclaw-generated';
    const requestedSlugs = getStringFlag(args, 'content-type-slugs')
        ?.split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);

    const [capabilityResponse, contentTypes] = await Promise.all([
        client.request({
            method: 'GET',
            path: '/capabilities'
        }),
        fetchAllContentTypesForArtifacts(client)
    ]);

    const capabilityBody = requireJsonMap(capabilityResponse.body, 'Schema generation capability response');
    const capabilityData = requireJsonMap(capabilityBody.data, 'Schema generation capability data') as ArtifactCapabilitySnapshot;

    const filteredContentTypes = requestedSlugs && requestedSlugs.length > 0
        ? contentTypes.filter((contentType) => requestedSlugs.includes(contentType.slug))
        : contentTypes;

    if (filteredContentTypes.length === 0) {
        throw new Error(
            requestedSlugs && requestedSlugs.length > 0
                ? `No content types matched --content-type-slugs=${requestedSlugs.join(',')}.`
                : 'No content types were returned by the runtime.'
        );
    }

    if (requestedSlugs && requestedSlugs.length > 0) {
        const matchedSlugs = new Set(filteredContentTypes.map((contentType) => contentType.slug));
        const missingSlugs = requestedSlugs.filter((slug) => !matchedSlugs.has(slug));
        if (missingSlugs.length > 0) {
            throw new Error(`Unknown content-type slugs: ${missingSlugs.join(', ')}.`);
        }
    }

    const artifacts = generateSchemaArtifacts({
        contentTypes: filteredContentTypes,
        capabilitySnapshot: capabilityData,
        packageName
    });
    const writtenFiles = await writeSchemaArtifacts(outputDir, artifacts);

    printStructured(args, {
        transport: 'local',
        action: 'schema-generate',
        packageName,
        outputDir: path.resolve(outputDir),
        contentTypeCount: filteredContentTypes.length,
        contentTypes: filteredContentTypes.map((contentType) => ({
            id: contentType.id,
            slug: contentType.slug,
            kind: contentType.kind
        })),
        files: writtenFiles
    });
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
                query: omitUndefined({
                    intent: getStringFlag(args, 'intent'),
                    search: getStringFlag(args, 'search'),
                    limit: maybeNumber(getNumberFlag(args, 'limit')),
                }),
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

    if (action === 'resolve') {
        const intent = getStringFlag(args, 'intent');
        if (intent !== 'authoring' && intent !== 'review' && intent !== 'workflow' && intent !== 'paid') {
            throw new Error('workspace resolve requires --intent authoring|review|workflow|paid');
        }

        const response = await client.request({
            method: 'GET',
            path: '/workspace-target',
            query: omitUndefined({
                intent,
                search: getStringFlag(args, 'search'),
            }),
        });
        printResponse(args, response);
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
        const schemaManifest = await loadJsonFlag(args, 'schema-manifest-json', 'schema-manifest-file');
        if (schema !== undefined && schemaManifest !== undefined) {
            throw new Error('content-types create accepts either schema or schema manifest input, but not both.');
        }
        if (schema === undefined && schemaManifest === undefined) {
            throw new Error('content-types create requires --schema-json, --schema-file, --schema-manifest-json, or --schema-manifest-file.');
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
                kind: getStringFlag(args, 'kind'),
                description: getStringFlag(args, 'description'),
                schema,
                schemaManifest,
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
        const schemaManifest = await loadJsonFlag(args, 'schema-manifest-json', 'schema-manifest-file');
        if (schema !== undefined && schemaManifest !== undefined) {
            throw new Error('content-types update accepts either schema or schema manifest input, but not both.');
        }
        const body = omitUndefined({
            name: getStringFlag(args, 'name'),
            slug: getStringFlag(args, 'slug'),
            kind: getStringFlag(args, 'kind'),
            description: getStringFlag(args, 'description'),
            schema,
            schemaManifest,
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

async function handleGlobals(client: RestCliClient, args: ParsedArgs) {
    const action = resolveSupportedSubcommand(
        args,
        1,
        'globals subcommand',
        GLOBALS_SUBCOMMANDS,
    );

    if (action === 'list') {
        const response = await client.request({
            method: 'GET',
            path: '/globals',
            query: {
                draft: hasFlag(args, 'published') ? false : undefined,
                locale: getStringFlag(args, 'locale'),
                fallbackLocale: getStringFlag(args, 'fallback-locale'),
            },
        });
        printResponse(args, response);
        return;
    }

    const slug = getStringFlag(args, 'slug');
    if (!slug) {
        throw new Error(`globals ${action} requires --slug.`);
    }

    if (action === 'get') {
        const response = await client.request({
            method: 'GET',
            path: `/globals/${slug}`,
            query: {
                draft: hasFlag(args, 'published') ? false : undefined,
                locale: getStringFlag(args, 'locale'),
                fallbackLocale: getStringFlag(args, 'fallback-locale'),
            },
        });
        printResponse(args, response);
        return;
    }

    if (action === 'preview-token') {
        const response = await client.request({
            method: 'POST',
            path: `/globals/${slug}/preview-token`,
            body: omitUndefined({
                draft: hasFlag(args, 'published') ? false : undefined,
                locale: getStringFlag(args, 'locale'),
                fallbackLocale: getStringFlag(args, 'fallback-locale'),
                ttlSeconds: maybeNumber(getNumberFlag(args, 'ttl-seconds')),
            }),
        });
        printResponse(args, response);
        return;
    }

    const data = await loadJsonFlag(args, 'data-json', 'data-file');
    if (data === undefined) {
        throw new Error('globals update requires --data-json or --data-file.');
    }

    const response = await client.request({
        method: 'PUT',
        path: `/globals/${slug}`,
        query: {
            mode: hasFlag(args, 'dry-run') ? 'dry_run' : undefined,
        },
        body: omitUndefined({
            data,
            status: getStringFlag(args, 'status'),
        }),
        acceptStatuses: hasFlag(args, 'dry-run') ? [200, 201] : undefined,
    });
    printResponse(args, response);
}

async function handleForms(client: RestCliClient, args: ParsedArgs) {
    const action = resolveSupportedSubcommand(
        args,
        1,
        'forms subcommand',
        FORMS_SUBCOMMANDS,
    );

    if (action === 'list') {
        const response = await client.request({
            method: 'GET',
            path: '/forms',
        });
        printResponse(args, response);
        return;
    }

    if (action === 'get') {
        const id = getNumberFlag(args, 'id');
        if (id === undefined) {
            throw new Error('forms get requires --id.');
        }

        const response = await client.request({
            method: 'GET',
            path: `/forms/${id}`,
        });
        printResponse(args, response);
        return;
    }

    if (action === 'public') {
        const slug = getStringFlag(args, 'slug');
        const domainId = getNumberFlag(args, 'domain-id');
        if (!slug || domainId === undefined) {
            throw new Error('forms public requires --slug and --domain-id.');
        }

        const response = await client.request({
            method: 'GET',
            path: `/public/forms/${slug}`,
            query: { domainId },
        });
        printResponse(args, response);
        return;
    }

    if (action === 'submit') {
        const slug = getStringFlag(args, 'slug');
        const domainId = getNumberFlag(args, 'domain-id');
        if (!slug || domainId === undefined) {
            throw new Error('forms submit requires --slug and --domain-id.');
        }

        const data = await loadJsonFlag(args, 'data-json', 'data-file');
        if (data === undefined) {
            throw new Error('forms submit requires --data-json or --data-file.');
        }

        const response = await client.request({
            method: 'POST',
            path: `/public/forms/${slug}/submissions`,
            query: { domainId },
            body: { data },
            acceptStatuses: [201, 402],
        });
        printResponse(args, response);
        if (!response.ok) {
            process.exitCode = 1;
        }
        return;
    }

    if (action === 'create') {
        const fields = await loadJsonFlag(args, 'fields-json', 'fields-file');
        if (fields === undefined) {
            throw new Error('forms create requires --fields-json or --fields-file.');
        }

        const defaultData = await loadJsonFlag(args, 'default-data-json', 'default-data-file');
        const response = await client.request({
            method: 'POST',
            path: '/forms',
            body: omitUndefined({
                name: requireStringFlag(args, 'name'),
                slug: requireStringFlag(args, 'slug'),
                description: getStringFlag(args, 'description'),
                contentTypeId: maybeNumber(getNumberFlag(args, 'content-type-id')),
                fields,
                defaultData,
                active: maybeBooleanFlag(args, 'active'),
                publicRead: maybeBooleanFlag(args, 'public-read'),
                submissionStatus: getStringFlag(args, 'submission-status'),
                workflowTransitionId: maybeNumber(getNumberFlag(args, 'workflow-transition-id')),
                requirePayment: maybeBooleanFlag(args, 'require-payment'),
                webhookUrl: getStringFlag(args, 'webhook-url'),
                webhookSecret: getStringFlag(args, 'webhook-secret'),
                successMessage: getStringFlag(args, 'success-message'),
            }),
        });
        printResponse(args, response);
        return;
    }

    if (action === 'update') {
        const id = getNumberFlag(args, 'id');
        if (id === undefined) {
            throw new Error('forms update requires --id.');
        }

        const fields = await loadJsonFlag(args, 'fields-json', 'fields-file');
        const defaultData = await loadJsonFlag(args, 'default-data-json', 'default-data-file');
        const body = omitUndefined({
            name: getStringFlag(args, 'name'),
            slug: getStringFlag(args, 'slug'),
            description: getStringFlag(args, 'description'),
            contentTypeId: maybeNumber(getNumberFlag(args, 'content-type-id')),
            fields,
            defaultData,
            active: maybeBooleanFlag(args, 'active'),
            publicRead: maybeBooleanFlag(args, 'public-read'),
            submissionStatus: getStringFlag(args, 'submission-status'),
            workflowTransitionId: getStringFlag(args, 'workflow-transition-id') === 'null'
                ? null
                : maybeNumber(getNumberFlag(args, 'workflow-transition-id')),
            requirePayment: maybeBooleanFlag(args, 'require-payment'),
            webhookUrl: getStringFlag(args, 'webhook-url'),
            webhookSecret: getStringFlag(args, 'webhook-secret'),
            successMessage: getStringFlag(args, 'success-message'),
        });
        assertHasUpdateFields(body, 'forms update');

        const response = await client.request({
            method: 'PUT',
            path: `/forms/${id}`,
            body,
        });
        printResponse(args, response);
        return;
    }

    if (action === 'delete') {
        const id = getNumberFlag(args, 'id');
        if (id === undefined) {
            throw new Error('forms delete requires --id.');
        }

        const response = await client.request({
            method: 'DELETE',
            path: `/forms/${id}`,
        });
        printResponse(args, response);
        return;
    }
}

async function handleJobs(client: RestCliClient, args: ParsedArgs) {
    const action = resolveSupportedSubcommand(
        args,
        1,
        'jobs subcommand',
        JOBS_SUBCOMMANDS,
    );

    if (action === 'list') {
        const response = await client.request({
            method: 'GET',
            path: '/jobs',
            query: {
                status: getStringFlag(args, 'status'),
                kind: getStringFlag(args, 'kind'),
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
            throw new Error('jobs get requires --id.');
        }

        const response = await client.request({
            method: 'GET',
            path: `/jobs/${id}`,
        });
        printResponse(args, response);
        return;
    }

    if (action === 'worker-status') {
        const response = await client.request({
            method: 'GET',
            path: '/jobs/worker-status',
        });
        printResponse(args, response);
        return;
    }

    if (action === 'create') {
        const kind = getStringFlag(args, 'kind');
        if (!kind) {
            throw new Error('jobs create requires --kind.');
        }

        const payload = await loadJsonFlag(args, 'payload-json', 'payload-file');
        if (payload === undefined) {
            throw new Error('jobs create requires --payload-json or --payload-file.');
        }

        const response = await client.request({
            method: 'POST',
            path: '/jobs',
            body: omitUndefined({
                kind,
                payload,
                queue: getStringFlag(args, 'queue'),
                runAt: getStringFlag(args, 'run-at'),
                maxAttempts: maybeNumber(getNumberFlag(args, 'max-attempts')),
            }),
        });
        printResponse(args, response);
        return;
    }

    if (action === 'cancel') {
        const id = getNumberFlag(args, 'id');
        if (id === undefined) {
            throw new Error('jobs cancel requires --id.');
        }

        const response = await client.request({
            method: 'DELETE',
            path: `/jobs/${id}`,
        });
        printResponse(args, response);
        return;
    }

    const id = getNumberFlag(args, 'id');
    const targetStatus = getStringFlag(args, 'status');
    const runAt = getStringFlag(args, 'run-at');
    if (id === undefined || !targetStatus || !runAt) {
        throw new Error('jobs schedule-status requires --id, --status, and --run-at.');
    }

    const response = await client.request({
        method: 'POST',
        path: `/content-items/${id}/schedule-status`,
        body: omitUndefined({
            targetStatus,
            runAt,
            maxAttempts: maybeNumber(getNumberFlag(args, 'max-attempts')),
        }),
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
                draft: hasFlag(args, 'published') ? false : undefined,
                locale: getStringFlag(args, 'locale'),
                fallbackLocale: getStringFlag(args, 'fallback-locale'),
                createdAfter: getStringFlag(args, 'created-after'),
                createdBefore: getStringFlag(args, 'created-before'),
                fieldName: getStringFlag(args, 'field-name'),
                fieldOp: getStringFlag(args, 'field-op'),
                fieldValue: getStringFlag(args, 'field-value'),
                sortField: getStringFlag(args, 'sort-field'),
                sortBy: getStringFlag(args, 'sort-by'),
                sortDir: getStringFlag(args, 'sort-dir'),
                includeArchived: hasFlag(args, 'include-archived') ? true : undefined,
                limit: maybeNumber(getNumberFlag(args, 'limit')),
                offset: getStringFlag(args, 'cursor') ? undefined : maybeNumber(getNumberFlag(args, 'offset')),
                cursor: getStringFlag(args, 'cursor'),
            },
        });
        printResponse(args, response);
        return;
    }

    if (action === 'project') {
        const contentTypeId = getNumberFlag(args, 'content-type-id');
        const groupBy = getStringFlag(args, 'group-by');

        if (contentTypeId === undefined) {
            throw new Error('content project requires --content-type-id.');
        }

        if (!groupBy) {
            throw new Error('content project requires --group-by.');
        }

        const response = await client.request({
            method: 'GET',
            path: '/content-items/projections',
            query: {
                contentTypeId,
                status: getStringFlag(args, 'status'),
                createdAfter: getStringFlag(args, 'created-after'),
                createdBefore: getStringFlag(args, 'created-before'),
                fieldName: getStringFlag(args, 'field-name'),
                fieldOp: getStringFlag(args, 'field-op'),
                fieldValue: getStringFlag(args, 'field-value'),
                groupBy,
                metric: getStringFlag(args, 'metric'),
                metricField: getStringFlag(args, 'metric-field'),
                orderBy: getStringFlag(args, 'order-by'),
                orderDir: getStringFlag(args, 'order-dir'),
                includeArchived: hasFlag(args, 'include-archived') ? true : undefined,
                limit: maybeNumber(getNumberFlag(args, 'limit')),
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
            query: {
                draft: hasFlag(args, 'published') ? false : undefined,
                locale: getStringFlag(args, 'locale'),
                fallbackLocale: getStringFlag(args, 'fallback-locale'),
            },
        });
        printResponse(args, response);
        return;
    }

    if (action === 'used-by') {
        const id = getNumberFlag(args, 'id');
        if (id === undefined) {
            throw new Error('content used-by requires --id.');
        }

        const response = await client.request({
            method: 'GET',
            path: `/content-items/${id}/used-by`,
        });
        printResponse(args, response);
        return;
    }

    if (action === 'preview-token') {
        const id = getNumberFlag(args, 'id');
        if (id === undefined) {
            throw new Error('content preview-token requires --id.');
        }

        const response = await client.request({
            method: 'POST',
            path: `/content-items/${id}/preview-token`,
            body: omitUndefined({
                draft: hasFlag(args, 'published') ? false : undefined,
                locale: getStringFlag(args, 'locale'),
                fallbackLocale: getStringFlag(args, 'fallback-locale'),
                ttlSeconds: maybeNumber(getNumberFlag(args, 'ttl-seconds')),
            }),
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

async function handleAssets(client: RestCliClient, args: ParsedArgs) {
    const action = resolveSupportedSubcommand(
        args,
        1,
        'assets subcommand',
        ASSETS_SUBCOMMANDS,
        ASSETS_SUBCOMMAND_ALIASES,
    );

    if (action === 'list') {
        const response = await client.request({
            method: 'GET',
            path: '/assets',
            query: {
                q: getStringFlag(args, 'q'),
                accessMode: getStringFlag(args, 'access-mode'),
                status: getStringFlag(args, 'status'),
                sourceAssetId: maybeNumber(getNumberFlag(args, 'source-asset-id')),
                limit: maybeNumber(getNumberFlag(args, 'limit')),
                offset: getStringFlag(args, 'cursor') ? undefined : maybeNumber(getNumberFlag(args, 'offset')),
                cursor: getStringFlag(args, 'cursor'),
            },
        });
        printResponse(args, response);
        return;
    }

    if (action === 'get') {
        const id = getNumberFlag(args, 'id');
        if (id === undefined) {
            throw new Error('assets get requires --id.');
        }

        const response = await client.request({
            method: 'GET',
            path: `/assets/${id}`,
        });
        printResponse(args, response);
        return;
    }

    if (action === 'used-by') {
        const id = getNumberFlag(args, 'id');
        if (id === undefined) {
            throw new Error('assets used-by requires --id.');
        }

        const response = await client.request({
            method: 'GET',
            path: `/assets/${id}/used-by`,
        });
        printResponse(args, response);
        return;
    }

    if (action === 'create') {
        const metadata = await loadJsonFlag(args, 'metadata-json', 'metadata-file');
        const entitlementScope = await loadJsonFlag(args, 'entitlement-scope-json', 'entitlement-scope-file');
        const transformSpec = await loadJsonFlag(args, 'transform-spec-json', 'transform-spec-file');
        const contentBase64 = await loadTextFlag(args, 'content-base64', 'content-base64-file');
        const contentFile = getStringFlag(args, 'content-file');
        const filenameFlag = getStringFlag(args, 'filename');
        const originalFilenameFlag = getStringFlag(args, 'original-filename');
        const mimeType = requireStringFlag(args, 'mime-type');
        const accessMode = getStringFlag(args, 'access-mode');
        const sourceAssetId = getNumberFlag(args, 'source-asset-id');
        const variantKey = getStringFlag(args, 'variant-key');

        if (contentBase64 !== undefined && contentFile) {
            throw new Error('assets create accepts either --content-file or --content-base64/--content-base64-file, not both.');
        }

        let response: RestCliResponse;
        if (contentFile) {
            const fileBytes = await fs.readFile(contentFile);
            const derivedFilename = filenameFlag ?? path.basename(contentFile);
            const derivedOriginalFilename = originalFilenameFlag ?? path.basename(contentFile);
            const form = new FormData();

            form.append('filename', derivedFilename);
            form.append('originalFilename', derivedOriginalFilename);
            form.append('mimeType', mimeType);
            if (accessMode) {
                form.append('accessMode', accessMode);
            }
            if (metadata !== undefined) {
                form.append('metadata', JSON.stringify(metadata));
            }
            if (entitlementScope !== undefined) {
                form.append('entitlementScope', JSON.stringify(entitlementScope));
            }
            if (sourceAssetId !== undefined) {
                form.append('sourceAssetId', String(sourceAssetId));
            }
            if (variantKey) {
                form.append('variantKey', variantKey);
            }
            if (transformSpec !== undefined) {
                form.append('transformSpec', JSON.stringify(transformSpec));
            }
            form.append('file', new Blob([fileBytes], { type: mimeType }), derivedOriginalFilename);

            response = await client.request({
                method: 'POST',
                path: '/assets',
                body: form,
                acceptStatuses: [201],
            });
        } else {
            if (contentBase64 === undefined) {
                throw new Error('assets create requires --content-file or --content-base64/--content-base64-file.');
            }

            const filename = filenameFlag ?? originalFilenameFlag;
            if (!filename) {
                throw new Error('assets create requires --filename when uploading inline base64 content.');
            }

            response = await client.request({
                method: 'POST',
                path: '/assets',
                body: omitUndefined({
                    filename,
                    originalFilename: originalFilenameFlag,
                    mimeType,
                    contentBase64,
                    accessMode,
                    entitlementScope,
                    metadata,
                    sourceAssetId,
                    variantKey,
                    transformSpec,
                }),
                acceptStatuses: [201],
            });
        }

        printResponse(args, response);
        return;
    }

    if (action === 'offers') {
        const id = getNumberFlag(args, 'id');
        if (id === undefined) {
            throw new Error('assets offers requires --id.');
        }

        const response = await client.request({
            method: 'GET',
            path: `/assets/${id}/offers`,
        });
        printResponse(args, response);
        return;
    }

    if (action === 'access') {
        const id = getNumberFlag(args, 'id');
        if (id === undefined) {
            throw new Error('assets access requires --id.');
        }

        const ttlSeconds = getNumberFlag(args, 'ttl-seconds');
        const response = await client.request({
            method: 'POST',
            path: `/assets/${id}/access`,
            body: ttlSeconds === undefined ? null : { ttlSeconds },
        });
        printResponse(args, response);
        return;
    }

    if (action === 'delete') {
        const id = getNumberFlag(args, 'id');
        if (id === undefined) {
            throw new Error('assets delete requires --id.');
        }

        const response = await client.request({
            method: 'DELETE',
            path: `/assets/${id}`,
        });
        printResponse(args, response);
        return;
    }

    if (action === 'restore') {
        const id = getNumberFlag(args, 'id');
        if (id === undefined) {
            throw new Error('assets restore requires --id.');
        }

        const response = await client.request({
            method: 'POST',
            path: `/assets/${id}/restore`,
        });
        printResponse(args, response);
        return;
    }

    const id = getNumberFlag(args, 'id');
    if (id === undefined) {
        throw new Error('assets purge requires --id.');
    }

    const response = await client.request({
        method: 'POST',
        path: `/assets/${id}/purge`,
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

async function handleL402(client: RestCliClient, args: ParsedArgs, runtimeOptions: CliRuntimeOptions) {
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
        const apiKeyConfigured = Boolean(runtimeOptions.apiKey);
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

async function main(args: ParsedArgs, runtimeOptions: CliRuntimeOptions) {
    const rawCommand = requirePositional(args, 0, 'command');
    const command = resolveAlias(rawCommand, TOP_LEVEL_ALIASES) ?? rawCommand;
    if (!(TOP_LEVEL_COMMANDS as readonly string[]).includes(command)) {
        throw buildUnknownCommandError('command', rawCommand, TOP_LEVEL_COMMANDS);
    }

    if (command === 'mcp') {
        await handleMcp(resolveRepoRoot(), args, runtimeOptions);
        return;
    }
    if (command === 'repl') {
        await handleRepl(resolveRepoRoot(), runtimeOptions);
        return;
    }
    if (command === 'provision') {
        await handleProvision(resolveRepoRoot(), args, runtimeOptions);
        return;
    }
    if (command === 'script') {
        await handleScript(resolveRepoRoot(), args, runtimeOptions);
        return;
    }

    const client = new RestCliClient({
        baseUrl: runtimeOptions.baseUrl,
        apiKey: runtimeOptions.apiKey,
        domainId: getNumberFlag(args, 'domain-id'),
    });

    if (command === 'rest') {
        await handleRest(client, args);
        return;
    }
    if (command === 'schema') {
        await handleSchema(client, args);
        return;
    }
    if (command === 'integrations') {
        await handleIntegrations(client, args);
        return;
    }
    if (command === 'forms') {
        await handleForms(client, args);
        return;
    }
    if (command === 'jobs') {
        await handleJobs(client, args);
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
    if (command === 'globals') {
        await handleGlobals(client, args);
        return;
    }
    if (command === 'content') {
        await handleContent(client, args);
        return;
    }
    if (command === 'assets') {
        await handleAssets(client, args);
        return;
    }
    if (command === 'workflow') {
        await handleWorkflow(client, args);
        return;
    }

    await handleL402(client, args, runtimeOptions);
}

const parsedArgs = parseArgs(process.argv.slice(2));
const helpOutput = resolveHelpScope(parsedArgs);

if (helpOutput) {
    console.log(helpOutput);
} else {
    resolveCliRuntimeOptions(parsedArgs)
        .then(async (runtimeOptions) => {
            currentRuntimeOptions = runtimeOptions;
            await main(parsedArgs, runtimeOptions);
        })
        .catch((error) => {
            const suggestions = buildErrorSuggestions(error, currentRuntimeOptions);
            if (error instanceof RestCliError) {
                if (wantsRawOutput(parsedArgs)) {
                    if (suggestions.length === 0) {
                        printRaw(error.response.body);
                    } else {
                        const body = error.response.body;
                        const baseText = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
                        console.log(`${baseText}\n\nSuggestions:\n${suggestions.map((suggestion) => `- ${suggestion}`).join('\n')}`);
                    }
                } else {
                    printStructuredValue({
                        error: error.message,
                        response: bodyFromResponse(error.response),
                        suggestions,
                    });
                }
                process.exit(1);
            }

            const message = error instanceof Error ? error.message : String(error);
            if (wantsRawOutput(parsedArgs)) {
                if (suggestions.length === 0) {
                    printRaw(message);
                } else {
                    console.log(`${message}\n\nSuggestions:\n${suggestions.map((suggestion) => `- ${suggestion}`).join('\n')}`);
                }
            } else {
                printStructuredValue({
                    error: message,
                    suggestions,
                });
            }
            process.exit(1);
        });
}
