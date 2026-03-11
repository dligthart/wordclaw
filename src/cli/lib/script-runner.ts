import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export type CliScriptStep = {
    name?: string;
    args: string[];
    continueOnError?: boolean;
};

export type CliScriptDefinition = {
    continueOnError?: boolean;
    steps: CliScriptStep[];
};

export type CliScriptStepResult = {
    index: number;
    name: string;
    args: string[];
    status: 'passed' | 'failed' | 'warned';
    exitCode: number;
    stdout: string;
    stderr: string;
    parsed: unknown;
};

function asObject(value: unknown, context: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${context} must be a JSON object.`);
    }

    return value as Record<string, unknown>;
}

function asStep(value: unknown, index: number): CliScriptStep {
    const parsed = asObject(value, `Script step ${index + 1}`);
    if (!Array.isArray(parsed.args) || !parsed.args.every((entry) => typeof entry === 'string')) {
        throw new Error(`Script step ${index + 1} must include an "args" array of strings.`);
    }

    if (parsed.name !== undefined && typeof parsed.name !== 'string') {
        throw new Error(`Script step ${index + 1} field "name" must be a string when set.`);
    }

    if (parsed.continueOnError !== undefined && typeof parsed.continueOnError !== 'boolean') {
        throw new Error(`Script step ${index + 1} field "continueOnError" must be a boolean when set.`);
    }

    return {
        name: parsed.name as string | undefined,
        args: parsed.args as string[],
        continueOnError: parsed.continueOnError as boolean | undefined,
    };
}

export function parseCliScript(raw: unknown): CliScriptDefinition {
    if (Array.isArray(raw)) {
        return {
            steps: raw.map((entry, index) => asStep(entry, index)),
        };
    }

    const parsed = asObject(raw, 'CLI script');
    if (!Array.isArray(parsed.steps)) {
        throw new Error('CLI script must include a "steps" array or be an array directly.');
    }
    if (parsed.continueOnError !== undefined && typeof parsed.continueOnError !== 'boolean') {
        throw new Error('CLI script field "continueOnError" must be a boolean when set.');
    }

    return {
        continueOnError: parsed.continueOnError as boolean | undefined,
        steps: parsed.steps.map((entry, index) => asStep(entry, index)),
    };
}

export async function loadCliScript(filePath: string): Promise<CliScriptDefinition> {
    const raw = await fs.readFile(filePath, 'utf8');
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new Error(
            `CLI script at ${filePath} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    return parseCliScript(parsed);
}

export function resolveCliInvocation(repoRoot: string, entryPath = process.argv[1]): {
    command: string;
    args: string[];
} {
    const sourceScript = path.join(repoRoot, 'src', 'cli', 'index.ts');
    const distScript = path.join(repoRoot, 'dist', 'cli', 'index.js');
    const currentScript = path.resolve(entryPath ?? '');
    const runningDist = currentScript.includes(`${path.sep}dist${path.sep}`);

    if (runningDist && existsSync(distScript)) {
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

function tryParseStdout(stdout: string): unknown {
    const trimmed = stdout.trim();
    if (!trimmed) {
        return null;
    }

    try {
        return JSON.parse(trimmed);
    } catch {
        return trimmed;
    }
}

async function runCliProcess(
    command: string,
    args: string[],
    cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => {
            resolve({
                exitCode: code ?? 1,
                stdout,
                stderr,
            });
        });
    });
}

export async function runCliScript(options: {
    repoRoot: string;
    scriptPath: string;
    inheritedFlags: string[];
    continueOnErrorOverride?: boolean;
}): Promise<{
    scriptPath: string;
    continueOnError: boolean;
    completedCount: number;
    warnedCount: number;
    failedCount: number;
    steps: CliScriptStepResult[];
}> {
    const definition = await loadCliScript(options.scriptPath);
    const invocation = resolveCliInvocation(options.repoRoot);
    const continueOnError = options.continueOnErrorOverride ?? definition.continueOnError ?? false;
    const results: CliScriptStepResult[] = [];

    for (const [index, step] of definition.steps.entries()) {
        const stepArgs = [
            ...invocation.args,
            ...options.inheritedFlags,
            ...step.args,
        ];
        const result = await runCliProcess(invocation.command, stepArgs, options.repoRoot);
        const failed = result.exitCode !== 0;
        const allowFailure = step.continueOnError === true || continueOnError;
        const status = failed
            ? (allowFailure ? 'warned' : 'failed')
            : 'passed';

        results.push({
            index,
            name: step.name ?? step.args.join(' '),
            args: step.args,
            status,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            parsed: tryParseStdout(result.stdout),
        });

        if (failed && !allowFailure) {
            break;
        }
    }

    return {
        scriptPath: options.scriptPath,
        continueOnError,
        completedCount: results.filter((result) => result.status === 'passed').length,
        warnedCount: results.filter((result) => result.status === 'warned').length,
        failedCount: results.filter((result) => result.status === 'failed').length,
        steps: results,
    };
}
