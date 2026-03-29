import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveMcpHttpEndpoint } from './mcp-client.js';

export const SUPPORTED_PROVISION_AGENTS = ['openclaw', 'codex', 'claude-code', 'cursor'] as const;
export const SUPPORTED_PROVISION_TRANSPORTS = ['stdio', 'http'] as const;
export const SUPPORTED_PROVISION_SCOPES = ['project', 'user', 'local'] as const;

export type ProvisionAgent = typeof SUPPORTED_PROVISION_AGENTS[number];
export type ProvisionTransport = typeof SUPPORTED_PROVISION_TRANSPORTS[number];
export type ProvisionScope = typeof SUPPORTED_PROVISION_SCOPES[number];

type JsonServerDefinition = Record<string, unknown>;

type ProvisioningPlanBase = {
    agent: ProvisionAgent;
    transport: ProvisionTransport;
    scope: ProvisionScope;
    serverName: string;
    defaultConfigPath: string;
    configFormat: 'json' | 'toml';
    supportsWrite: boolean;
    snippet: string;
    notes: string[];
    installCommand: string | null;
};

export type ProvisioningPlan = (
    ProvisioningPlanBase & {
        configFormat: 'json';
        serverDefinition: JsonServerDefinition;
        tomlSectionName: null;
    }
) | (
    ProvisioningPlanBase & {
        configFormat: 'toml';
        serverDefinition: null;
        tomlSectionName: string;
    }
);

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expandHomePath(targetPath: string) {
    if (!targetPath.startsWith('~/')) {
        return path.resolve(targetPath);
    }

    const home = process.env.HOME;
    if (!home) {
        throw new Error('Cannot expand "~" because HOME is not set.');
    }

    return path.join(home, targetPath.slice(2));
}

function defaultScopeForAgent(agent: ProvisionAgent): ProvisionScope {
    if (agent === 'claude-code' || agent === 'cursor') {
        return 'project';
    }

    return 'user';
}

function validateScope(agent: ProvisionAgent, scope: ProvisionScope) {
    if (agent === 'openclaw' || agent === 'codex') {
        if (scope !== 'user') {
            throw new Error(`${agent} provisioning only supports --scope user because its primary config is user-scoped.`);
        }
        return;
    }

    if (agent === 'cursor' && scope === 'local') {
        throw new Error('cursor provisioning supports --scope project or --scope user.');
    }
}

function defaultConfigPath(agent: ProvisionAgent, scope: ProvisionScope) {
    switch (agent) {
        case 'openclaw':
            return '~/.openclaw/openclaw.json';
        case 'codex':
            return '~/.codex/config.toml';
        case 'claude-code':
            return scope === 'project' ? '.mcp.json' : '~/.claude.json';
        case 'cursor':
            return scope === 'project' ? '.cursor/mcp.json' : '~/.cursor/mcp.json';
    }
}

function defaultBaseUrl(baseUrl: string | undefined) {
    return resolveMcpHttpEndpoint(undefined, baseUrl ?? 'http://localhost:4000');
}

function prettyJsonServerSnippet(serverName: string, serverDefinition: JsonServerDefinition) {
    return `${JSON.stringify({
        mcpServers: {
            [serverName]: serverDefinition,
        }
    }, null, 2)}\n`;
}

function buildOpenClawPlan(options: {
    transport: ProvisionTransport;
    serverName: string;
    repoRoot: string;
    baseUrl?: string;
    scope: ProvisionScope;
}): ProvisioningPlan {
    if (options.transport === 'stdio') {
        const serverDefinition = {
            command: 'npx',
            args: ['tsx', path.join(options.repoRoot, 'src', 'mcp', 'index.ts')],
            env: {
                DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/wordclaw',
                AUTH_REQUIRED: 'true',
                API_KEYS: 'writer=content:read|content:write|audit:read'
            }
        } satisfies JsonServerDefinition;

        return {
            agent: 'openclaw',
            transport: 'stdio',
            scope: options.scope,
            serverName: options.serverName,
            defaultConfigPath: defaultConfigPath('openclaw', options.scope),
            configFormat: 'json',
            supportsWrite: true,
            snippet: prettyJsonServerSnippet(options.serverName, serverDefinition),
            serverDefinition,
            tomlSectionName: null,
            installCommand: null,
            notes: [
                'OpenClaw uses ~/.openclaw/openclaw.json as its primary user config.',
                'Stdio is the safest local bootstrap path when the API server is running from the same repo checkout.',
                'Read system://deployment-status or GET /api/deployment-status before the first write to confirm bootstrap readiness.'
            ],
        };
    }

    const serverDefinition = {
        url: defaultBaseUrl(options.baseUrl),
        headers: {
            'x-api-key': '<set-wordclaw-api-key-here>'
        }
    } satisfies JsonServerDefinition;

    return {
        agent: 'openclaw',
        transport: 'http',
        scope: options.scope,
        serverName: options.serverName,
        defaultConfigPath: defaultConfigPath('openclaw', options.scope),
        configFormat: 'json',
        supportsWrite: true,
        snippet: prettyJsonServerSnippet(options.serverName, serverDefinition),
        serverDefinition,
        tomlSectionName: null,
        installCommand: null,
        notes: [
            'OpenClaw uses ~/.openclaw/openclaw.json as its primary user config.',
            'Remote HTTP is the recommended attachable transport for shared or long-lived agent sessions.',
            'Replace the placeholder x-api-key header with a real WordClaw API key before use.'
        ],
    };
}

function buildCodexPlan(options: {
    transport: ProvisionTransport;
    serverName: string;
    repoRoot: string;
    baseUrl?: string;
    scope: ProvisionScope;
}): ProvisioningPlan {
    const sectionName = `mcp_servers.${options.serverName}`;

    if (options.transport === 'stdio') {
        const snippet = [
            `[${sectionName}]`,
            'command = "npx"',
            'args = ["tsx", "src/mcp/index.ts"]',
            `cwd = ${JSON.stringify(options.repoRoot)}`,
            'env = { DATABASE_URL = "postgres://postgres:postgres@localhost:5432/wordclaw", AUTH_REQUIRED = "true", API_KEYS = "writer=content:read|content:write|audit:read" }',
            'required = true',
            'startup_timeout_sec = 20.0',
            '',
        ].join('\n');

        return {
            agent: 'codex',
            transport: 'stdio',
            scope: options.scope,
            serverName: options.serverName,
            defaultConfigPath: defaultConfigPath('codex', options.scope),
            configFormat: 'toml',
            supportsWrite: true,
            snippet,
            serverDefinition: null,
            tomlSectionName: sectionName,
            installCommand: null,
            notes: [
                'Codex uses ~/.codex/config.toml for user-scoped MCP registration.',
                'The generated stdio block assumes the current repo checkout contains src/mcp/index.ts.',
                'If you run the built MCP server instead, replace the args array with your preferred production command.'
            ],
        };
    }

    const snippet = [
        `[${sectionName}]`,
        `url = ${JSON.stringify(defaultBaseUrl(options.baseUrl))}`,
        'env_http_headers = { "x-api-key" = "WORDCLAW_API_KEY" }',
        'required = true',
        'startup_timeout_sec = 20.0',
        '',
    ].join('\n');

    return {
        agent: 'codex',
        transport: 'http',
        scope: options.scope,
        serverName: options.serverName,
        defaultConfigPath: defaultConfigPath('codex', options.scope),
        configFormat: 'toml',
        supportsWrite: true,
        snippet,
        serverDefinition: null,
        tomlSectionName: sectionName,
        installCommand: null,
        notes: [
            'Codex uses ~/.codex/config.toml for user-scoped MCP registration.',
            'Set WORDCLAW_API_KEY in the shell that launches Codex before using the remote HTTP configuration.',
            'Remote HTTP is the best option when you want attachable agent sessions or a hosted WordClaw runtime.'
        ],
    };
}

function buildClaudeCodePlan(options: {
    transport: ProvisionTransport;
    serverName: string;
    repoRoot: string;
    baseUrl?: string;
    scope: ProvisionScope;
}): ProvisioningPlan {
    const supportsWrite = options.scope === 'project';

    if (options.transport === 'stdio') {
        const serverDefinition = {
            type: 'stdio',
            command: 'npx',
            args: ['tsx', path.join(options.repoRoot, 'src', 'mcp', 'index.ts')],
            env: {
                DATABASE_URL: '${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/wordclaw}',
                AUTH_REQUIRED: '${AUTH_REQUIRED:-true}',
                API_KEYS: '${API_KEYS:-writer=content:read|content:write|audit:read}'
            }
        } satisfies JsonServerDefinition;

        return {
            agent: 'claude-code',
            transport: 'stdio',
            scope: options.scope,
            serverName: options.serverName,
            defaultConfigPath: defaultConfigPath('claude-code', options.scope),
            configFormat: 'json',
            supportsWrite,
            snippet: prettyJsonServerSnippet(options.serverName, serverDefinition),
            serverDefinition,
            tomlSectionName: null,
            installCommand: `claude mcp add-json ${options.serverName} '${JSON.stringify(serverDefinition)}' --scope ${options.scope}`,
            notes: [
                supportsWrite
                    ? 'Project-scoped Claude Code servers are stored in .mcp.json and can be written directly.'
                    : 'Direct file writes intentionally only target project-scoped Claude Code config. Use the install command for local or user scope.',
                'Claude Code project config supports environment-variable expansion, so the generated defaults remain portable across machines.',
                'If your Claude Code build does not yet expose MCP registration in the expected way, use the REST bootstrap fallback until MCP registry support is available.'
            ],
        };
    }

    const serverDefinition = {
        type: 'http',
        url: defaultBaseUrl(options.baseUrl),
        headers: {
            'x-api-key': '${WORDCLAW_API_KEY}'
        }
    } satisfies JsonServerDefinition;

    return {
        agent: 'claude-code',
        transport: 'http',
        scope: options.scope,
        serverName: options.serverName,
        defaultConfigPath: defaultConfigPath('claude-code', options.scope),
        configFormat: 'json',
        supportsWrite,
        snippet: prettyJsonServerSnippet(options.serverName, serverDefinition),
        serverDefinition,
        tomlSectionName: null,
        installCommand: `claude mcp add-json ${options.serverName} '${JSON.stringify(serverDefinition)}' --scope ${options.scope}`,
        notes: [
            supportsWrite
                ? 'Project-scoped Claude Code servers are stored in .mcp.json and can be written directly.'
                : 'Direct file writes intentionally only target project-scoped Claude Code config. Use the install command for local or user scope.',
            'Set WORDCLAW_API_KEY before launching Claude Code so the generated HTTP headers resolve cleanly.',
            'HTTP is the preferred transport for remote or shared MCP servers in Claude Code.'
        ],
    };
}

function buildCursorPlan(options: {
    transport: ProvisionTransport;
    serverName: string;
    repoRoot: string;
    baseUrl?: string;
    scope: ProvisionScope;
}): ProvisioningPlan {
    if (options.transport === 'stdio') {
        const serverDefinition = {
            command: 'npx',
            args: ['tsx', path.join(options.repoRoot, 'src', 'mcp', 'index.ts')],
            env: {
                DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/wordclaw',
                AUTH_REQUIRED: 'true',
                API_KEYS: 'writer=content:read|content:write|audit:read'
            }
        } satisfies JsonServerDefinition;

        return {
            agent: 'cursor',
            transport: 'stdio',
            scope: options.scope,
            serverName: options.serverName,
            defaultConfigPath: defaultConfigPath('cursor', options.scope),
            configFormat: 'json',
            supportsWrite: true,
            snippet: prettyJsonServerSnippet(options.serverName, serverDefinition),
            serverDefinition,
            tomlSectionName: null,
            installCommand: null,
            notes: [
                options.scope === 'project'
                    ? 'Project-scoped Cursor MCP config lives at .cursor/mcp.json.'
                    : 'User-scoped Cursor MCP config lives at ~/.cursor/mcp.json.',
                'Use stdio when the Cursor workspace already contains the WordClaw repo and local database access is available.',
                'If you want a shared or hosted runtime instead, switch to --transport http.'
            ],
        };
    }

    const serverDefinition = {
        url: defaultBaseUrl(options.baseUrl),
        headers: {
            'x-api-key': '<set-wordclaw-api-key-here>'
        }
    } satisfies JsonServerDefinition;

    return {
        agent: 'cursor',
        transport: 'http',
        scope: options.scope,
        serverName: options.serverName,
        defaultConfigPath: defaultConfigPath('cursor', options.scope),
        configFormat: 'json',
        supportsWrite: true,
        snippet: prettyJsonServerSnippet(options.serverName, serverDefinition),
        serverDefinition,
        tomlSectionName: null,
        installCommand: null,
        notes: [
            options.scope === 'project'
                ? 'Project-scoped Cursor MCP config lives at .cursor/mcp.json.'
                : 'User-scoped Cursor MCP config lives at ~/.cursor/mcp.json.',
            'Replace the placeholder x-api-key header with a real WordClaw API key before use.',
            'HTTP transport is the best Cursor option when the API server is already reachable over the network.'
        ],
    };
}

export function buildProvisioningPlan(options: {
    agent: ProvisionAgent;
    transport?: ProvisionTransport;
    scope?: ProvisionScope;
    serverName?: string;
    repoRoot: string;
    baseUrl?: string;
}): ProvisioningPlan {
    const scope = options.scope ?? defaultScopeForAgent(options.agent);
    validateScope(options.agent, scope);
    const transport = options.transport ?? 'stdio';
    const serverName = options.serverName?.trim() || 'wordclaw';

    if (options.agent === 'openclaw') {
        return buildOpenClawPlan({
            transport,
            scope,
            serverName,
            repoRoot: options.repoRoot,
            baseUrl: options.baseUrl,
        });
    }

    if (options.agent === 'codex') {
        return buildCodexPlan({
            transport,
            scope,
            serverName,
            repoRoot: options.repoRoot,
            baseUrl: options.baseUrl,
        });
    }

    if (options.agent === 'claude-code') {
        return buildClaudeCodePlan({
            transport,
            scope,
            serverName,
            repoRoot: options.repoRoot,
            baseUrl: options.baseUrl,
        });
    }

    return buildCursorPlan({
        transport,
        scope,
        serverName,
        repoRoot: options.repoRoot,
        baseUrl: options.baseUrl,
    });
}

async function writeJsonProvisioningPlan(plan: Extract<ProvisioningPlan, { configFormat: 'json' }>, configPath: string) {
    const targetPath = expandHomePath(configPath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    let existingRoot: Record<string, unknown> = {};

    try {
        const raw = await fs.readFile(targetPath, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`Existing JSON config at ${targetPath} is not an object.`);
        }
        existingRoot = parsed as Record<string, unknown>;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }

    const existingServers = existingRoot.mcpServers;
    const mcpServers = (
        existingServers
        && typeof existingServers === 'object'
        && !Array.isArray(existingServers)
    )
        ? { ...(existingServers as Record<string, unknown>) }
        : {};

    mcpServers[plan.serverName] = plan.serverDefinition;

    await fs.writeFile(targetPath, `${JSON.stringify({
        ...existingRoot,
        mcpServers,
    }, null, 2)}\n`, 'utf8');

    return targetPath;
}

async function writeTomlProvisioningPlan(plan: Extract<ProvisioningPlan, { configFormat: 'toml' }>, configPath: string) {
    const targetPath = expandHomePath(configPath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    let existing = '';

    try {
        existing = await fs.readFile(targetPath, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }

    const sectionPattern = new RegExp(
        `^\\[${escapeRegExp(plan.tomlSectionName)}\\][\\s\\S]*?(?=^\\[[^\\]]+\\]|\\Z)`,
        'm',
    );
    const normalizedSnippet = plan.snippet.trim();
    const next = existing.match(sectionPattern)
        ? existing.replace(sectionPattern, normalizedSnippet)
        : `${existing.trimEnd()}${existing.trimEnd().length > 0 ? '\n\n' : ''}${normalizedSnippet}\n`;

    await fs.writeFile(targetPath, next, 'utf8');
    return targetPath;
}

export async function writeProvisioningPlan(plan: ProvisioningPlan, configPath?: string) {
    if (!plan.supportsWrite) {
        throw new Error(
            `Direct writes are not supported for ${plan.agent} with scope ${plan.scope}. Use the printed install command or switch to a project-scoped config.`,
        );
    }

    const targetPath = configPath ?? plan.defaultConfigPath;

    if (plan.configFormat === 'json') {
        return {
            configPath: await writeJsonProvisioningPlan(plan, targetPath),
        };
    }

    return {
        configPath: await writeTomlProvisioningPlan(plan, targetPath),
    };
}
