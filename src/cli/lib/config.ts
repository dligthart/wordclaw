import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getStringFlag, type ParsedArgs } from './args.js';
import type { OutputFormat } from './output.js';

export type WordClawCliConfig = {
    baseUrl?: string;
    apiKey?: string;
    mcpUrl?: string;
    mcpTransport?: 'stdio' | 'http';
    format?: OutputFormat;
    raw?: boolean;
};

export type LoadedCliConfig = {
    path: string | null;
    config: WordClawCliConfig;
};

async function fileExists(filePath: string) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function requireObject(value: unknown, context: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${context} must be a JSON object.`);
    }

    return value as Record<string, unknown>;
}

function readOptionalString(
    value: unknown,
    key: string,
): string | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`CLI config field "${key}" must be a non-empty string when set.`);
    }

    return value.trim();
}

function readOptionalBoolean(
    value: unknown,
    key: string,
): boolean | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value !== 'boolean') {
        throw new Error(`CLI config field "${key}" must be a boolean when set.`);
    }

    return value;
}

function parseWordClawCliConfig(raw: unknown): WordClawCliConfig {
    const parsed = requireObject(raw, 'WordClaw CLI config');
    const rawTransport = readOptionalString(parsed.mcpTransport, 'mcpTransport');
    const rawFormat = readOptionalString(parsed.format, 'format');
    if (rawTransport && rawTransport !== 'stdio' && rawTransport !== 'http') {
        throw new Error('CLI config field "mcpTransport" must be "stdio" or "http".');
    }
    if (rawFormat && rawFormat !== 'json' && rawFormat !== 'yaml') {
        throw new Error('CLI config field "format" must be "json" or "yaml".');
    }
    const mcpTransport = rawTransport as 'stdio' | 'http' | undefined;
    const format = rawFormat as OutputFormat | undefined;

    return {
        baseUrl: readOptionalString(parsed.baseUrl, 'baseUrl'),
        apiKey: readOptionalString(parsed.apiKey, 'apiKey'),
        mcpUrl: readOptionalString(parsed.mcpUrl, 'mcpUrl'),
        mcpTransport,
        format,
        raw: readOptionalBoolean(parsed.raw, 'raw'),
    };
}

export async function loadWordClawCliConfig(
    args: ParsedArgs,
    options: {
        cwd?: string;
        homeDir?: string;
    } = {},
): Promise<LoadedCliConfig> {
    const explicitPath = getStringFlag(args, 'config') ?? process.env.WORDCLAW_CONFIG;
    const cwd = options.cwd ?? process.cwd();
    const homeDir = options.homeDir ?? os.homedir();
    const candidates = explicitPath
        ? [path.resolve(cwd, explicitPath)]
        : [
            path.resolve(cwd, '.wordclaw.json'),
            path.resolve(homeDir, '.wordclaw.json'),
        ];

    for (const candidate of candidates) {
        if (!(await fileExists(candidate))) {
            continue;
        }

        const raw = await fs.readFile(candidate, 'utf8');
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            throw new Error(
                `CLI config at ${candidate} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
            );
        }

        return {
            path: candidate,
            config: parseWordClawCliConfig(parsed),
        };
    }

    return {
        path: explicitPath ? path.resolve(cwd, explicitPath) : null,
        config: {},
    };
}

export function resolveCliStringOption(
    cliFlagValue: string | undefined,
    configValue: string | undefined,
    envValue: string | undefined,
) {
    return cliFlagValue ?? configValue ?? envValue;
}

export function resolveCliBooleanOption(
    cliFlagValue: boolean,
    configValue: boolean | undefined,
) {
    return cliFlagValue || configValue === true;
}
