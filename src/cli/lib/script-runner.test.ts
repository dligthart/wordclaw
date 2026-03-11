import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { loadCliScript, parseCliScript, resolveCliInvocation, runCliScript } from './script-runner.js';

describe('parseCliScript', () => {
    it('accepts object scripts with steps', () => {
        const script = parseCliScript({
            continueOnError: true,
            steps: [
                { name: 'whoami', args: ['mcp', 'whoami'] },
            ],
        });

        expect(script).toEqual({
            continueOnError: true,
            steps: [
                { name: 'whoami', args: ['mcp', 'whoami'], continueOnError: undefined },
            ],
        });
    });

    it('accepts array shorthand', () => {
        const script = parseCliScript([
            { args: ['capabilities', 'show'] },
        ]);

        expect(script.steps).toHaveLength(1);
        expect(script.steps[0].args).toEqual(['capabilities', 'show']);
    });
});

describe('loadCliScript', () => {
    const tempRoot = path.join(os.tmpdir(), 'wordclaw-cli-script-tests');

    afterEach(async () => {
        await fs.rm(tempRoot, { recursive: true, force: true });
    });

    it('loads and parses a script file', async () => {
        await fs.mkdir(tempRoot, { recursive: true });
        const filePath = path.join(tempRoot, 'script.json');
        await fs.writeFile(filePath, JSON.stringify({
            steps: [
                { args: ['capabilities', 'show'] },
            ],
        }), 'utf8');

        const script = await loadCliScript(filePath);
        expect(script.steps[0].args).toEqual(['capabilities', 'show']);
    });
});

describe('resolveCliInvocation', () => {
    it('resolves the tsx source invocation by default', () => {
        const resolved = resolveCliInvocation('/repo', '/repo/src/cli/index.ts');
        expect(resolved).toEqual({
            command: 'npx',
            args: ['tsx', '/repo/src/cli/index.ts'],
        });
    });

    it('resolves the dist invocation when the current entry is in dist', () => {
        const resolved = resolveCliInvocation(process.cwd(), path.join(process.cwd(), 'dist', 'cli', 'index.js'));
        expect(resolved).toEqual({
            command: 'node',
            args: [path.join(process.cwd(), 'dist', 'cli', 'index.js')],
        });
    });
});

describe('runCliScript', () => {
    const tempRoot = path.join(os.tmpdir(), 'wordclaw-cli-script-run-tests');

    afterEach(async () => {
        await fs.rm(tempRoot, { recursive: true, force: true });
    });

    it('runs steps sequentially and captures structured results', async () => {
        await fs.mkdir(tempRoot, { recursive: true });
        const scriptPath = path.join(tempRoot, 'script.json');
        await fs.writeFile(scriptPath, JSON.stringify({
            steps: [
                { name: 'help', args: ['--help'] },
                { name: 'content-help', args: ['content', '--help'] },
            ],
        }), 'utf8');

        const result = await runCliScript({
            repoRoot: process.cwd(),
            scriptPath,
            inheritedFlags: [],
        });

        expect(result.failedCount).toBe(0);
        expect(result.completedCount).toBe(2);
        expect(result.steps[0].status).toBe('passed');
        expect(result.steps[0].stdout).toContain('WordClaw CLI');
        expect(result.steps[1].stdout).toContain('WordClaw CLI: content');
    }, 30000);
});
