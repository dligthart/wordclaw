import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    buildProvisioningPlan,
    writeProvisioningPlan,
} from './provisioning.js';

describe('buildProvisioningPlan', () => {
    it('builds a project-scoped Claude Code HTTP provisioning plan', () => {
        const plan = buildProvisioningPlan({
            agent: 'claude-code',
            transport: 'http',
            scope: 'project',
            repoRoot: '/workspace/wordclaw',
            baseUrl: 'http://localhost:4000',
        });

        expect(plan.configFormat).toBe('json');
        expect(plan.defaultConfigPath).toBe('.mcp.json');
        expect(plan.supportsWrite).toBe(true);
        expect(plan.snippet).toContain('"type": "http"');
        expect(plan.snippet).toContain('"url": "http://localhost:4000/mcp"');
        expect(plan.snippet).toContain('"x-api-key": "${WORDCLAW_API_KEY}"');
        expect(plan.installCommand).toContain('claude mcp add-json wordclaw');
    });

    it('builds a user-scoped Codex stdio provisioning plan', () => {
        const plan = buildProvisioningPlan({
            agent: 'codex',
            transport: 'stdio',
            repoRoot: '/workspace/wordclaw',
        });

        expect(plan.configFormat).toBe('toml');
        expect(plan.defaultConfigPath).toBe('~/.codex/config.toml');
        expect(plan.snippet).toContain('[mcp_servers.wordclaw]');
        expect(plan.snippet).toContain('cwd = "/workspace/wordclaw"');
        expect(plan.snippet).toContain('args = ["tsx", "src/mcp/index.ts"]');
    });

    it('rejects unsupported scope combinations', () => {
        expect(() => buildProvisioningPlan({
            agent: 'openclaw',
            transport: 'http',
            scope: 'project',
            repoRoot: '/workspace/wordclaw',
        })).toThrow('openclaw provisioning only supports --scope user');
    });
});

describe('writeProvisioningPlan', () => {
    const tempRoots: string[] = [];

    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map(async (tempRoot) => {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }));
    });

    it('merges JSON config snippets into existing mcpServers config', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wordclaw-provision-json-'));
        tempRoots.push(tempRoot);
        const targetPath = path.join(tempRoot, 'mcp.json');

        await fs.writeFile(targetPath, JSON.stringify({
            mcpServers: {
                existing: {
                    url: 'https://example.test/mcp'
                }
            }
        }, null, 2), 'utf8');

        const plan = buildProvisioningPlan({
            agent: 'cursor',
            transport: 'http',
            scope: 'project',
            repoRoot: '/workspace/wordclaw',
            baseUrl: 'http://localhost:4000',
        });

        const result = await writeProvisioningPlan(plan, targetPath);
        const written = JSON.parse(await fs.readFile(targetPath, 'utf8')) as {
            mcpServers: Record<string, unknown>;
        };

        expect(result.configPath).toBe(targetPath);
        expect(written.mcpServers.existing).toEqual({
            url: 'https://example.test/mcp'
        });
        expect(written.mcpServers.wordclaw).toEqual(expect.objectContaining({
            url: 'http://localhost:4000/mcp',
        }));
    });

    it('replaces an existing Codex server block when rewriting TOML config', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wordclaw-provision-toml-'));
        tempRoots.push(tempRoot);
        const targetPath = path.join(tempRoot, 'config.toml');

        await fs.writeFile(targetPath, [
            '[mcp_servers.wordclaw]',
            'url = "https://old.example/mcp"',
            '',
            '[mcp_servers.github]',
            'url = "https://github.example/mcp"',
            '',
        ].join('\n'), 'utf8');

        const plan = buildProvisioningPlan({
            agent: 'codex',
            transport: 'http',
            repoRoot: '/workspace/wordclaw',
            baseUrl: 'http://localhost:4000',
        });

        await writeProvisioningPlan(plan, targetPath);
        const written = await fs.readFile(targetPath, 'utf8');

        expect(written).toContain('[mcp_servers.wordclaw]');
        expect(written).toContain('url = "http://localhost:4000/mcp"');
        expect(written).toContain('[mcp_servers.github]');
        expect(written).not.toContain('https://old.example/mcp');
    });
});
