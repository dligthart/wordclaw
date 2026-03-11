import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadWordClawCliConfig, resolveCliBooleanOption, resolveCliStringOption } from './config.js';
import { parseArgs } from './args.js';

describe('loadWordClawCliConfig', () => {
    const tempRoot = path.join(os.tmpdir(), 'wordclaw-cli-config-tests');

    afterEach(async () => {
        await import('node:fs/promises').then((fs) => fs.rm(tempRoot, { recursive: true, force: true }));
    });

    it('loads an explicit config path', async () => {
        const fs = await import('node:fs/promises');
        const cwd = path.join(tempRoot, 'project');
        await fs.mkdir(cwd, { recursive: true });
        const configPath = path.join(cwd, 'custom-config.json');
        await fs.writeFile(configPath, JSON.stringify({
            baseUrl: 'http://localhost:4100',
            apiKey: 'writer',
            mcpTransport: 'http',
            format: 'yaml',
            raw: true,
        }), 'utf8');

        const loaded = await loadWordClawCliConfig(parseArgs(['--config', configPath]), {
            cwd,
            homeDir: path.join(tempRoot, 'home'),
        });

        expect(loaded.path).toBe(configPath);
        expect(loaded.config).toEqual({
            baseUrl: 'http://localhost:4100',
            apiKey: 'writer',
            mcpTransport: 'http',
            format: 'yaml',
            raw: true,
        });
    });

    it('falls back to .wordclaw.json in the current working directory', async () => {
        const fs = await import('node:fs/promises');
        const cwd = path.join(tempRoot, 'project');
        await fs.mkdir(cwd, { recursive: true });
        await fs.writeFile(path.join(cwd, '.wordclaw.json'), JSON.stringify({
            baseUrl: 'http://localhost:4000',
            mcpUrl: 'http://localhost:4000/mcp',
        }), 'utf8');

        const loaded = await loadWordClawCliConfig(parseArgs([]), {
            cwd,
            homeDir: path.join(tempRoot, 'home'),
        });

        expect(loaded.path).toBe(path.join(cwd, '.wordclaw.json'));
        expect(loaded.config).toEqual({
            baseUrl: 'http://localhost:4000',
            mcpUrl: 'http://localhost:4000/mcp',
        });
    });

    it('falls back to the home config when no local config exists', async () => {
        const fs = await import('node:fs/promises');
        const cwd = path.join(tempRoot, 'project');
        const home = path.join(tempRoot, 'home');
        await fs.mkdir(cwd, { recursive: true });
        await fs.mkdir(home, { recursive: true });
        await fs.writeFile(path.join(home, '.wordclaw.json'), JSON.stringify({
            baseUrl: 'http://localhost:4200',
            apiKey: 'home-key',
        }), 'utf8');

        const loaded = await loadWordClawCliConfig(parseArgs([]), {
            cwd,
            homeDir: home,
        });

        expect(loaded.path).toBe(path.join(home, '.wordclaw.json'));
        expect(loaded.config).toEqual({
            baseUrl: 'http://localhost:4200',
            apiKey: 'home-key',
        });
    });

    it('throws for invalid mcp transport values', async () => {
        const fs = await import('node:fs/promises');
        const cwd = path.join(tempRoot, 'project');
        await fs.mkdir(cwd, { recursive: true });
        const configPath = path.join(cwd, '.wordclaw.json');
        await fs.writeFile(configPath, JSON.stringify({
            mcpTransport: 'ws',
        }), 'utf8');

        await expect(loadWordClawCliConfig(parseArgs([]), {
            cwd,
            homeDir: path.join(tempRoot, 'home'),
        })).rejects.toThrow('CLI config field "mcpTransport" must be "stdio" or "http"');
    });

    it('throws for invalid format values', async () => {
        const fs = await import('node:fs/promises');
        const cwd = path.join(tempRoot, 'project');
        await fs.mkdir(cwd, { recursive: true });
        const configPath = path.join(cwd, '.wordclaw.json');
        await fs.writeFile(configPath, JSON.stringify({
            format: 'table',
        }), 'utf8');

        await expect(loadWordClawCliConfig(parseArgs([]), {
            cwd,
            homeDir: path.join(tempRoot, 'home'),
        })).rejects.toThrow('CLI config field "format" must be "json" or "yaml"');
    });
});

describe('resolveCli option helpers', () => {
    it('prefers flags over config over env', () => {
        expect(resolveCliStringOption('flag', 'config', 'env')).toBe('flag');
        expect(resolveCliStringOption(undefined, 'config', 'env')).toBe('config');
        expect(resolveCliStringOption(undefined, undefined, 'env')).toBe('env');
    });

    it('treats config raw mode as a fallback to --raw', () => {
        expect(resolveCliBooleanOption(false, true)).toBe(true);
        expect(resolveCliBooleanOption(true, false)).toBe(true);
        expect(resolveCliBooleanOption(false, false)).toBe(false);
    });
});
