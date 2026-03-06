import fs from 'node:fs/promises';

export type ParsedArgs = {
    positionals: string[];
    flags: Record<string, string | boolean>;
};

export function parseArgs(argv: string[]): ParsedArgs {
    const positionals: string[] = [];
    const flags: Record<string, string | boolean> = {};

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];

        if (!token.startsWith('-') || token === '-') {
            positionals.push(token);
            continue;
        }

        if (token.startsWith('--')) {
            const withoutPrefix = token.slice(2);
            const equalIndex = withoutPrefix.indexOf('=');
            if (equalIndex >= 0) {
                const key = withoutPrefix.slice(0, equalIndex);
                const value = withoutPrefix.slice(equalIndex + 1);
                flags[key] = value;
                continue;
            }

            const next = argv[index + 1];
            if (next && !next.startsWith('-')) {
                flags[withoutPrefix] = next;
                index += 1;
            } else {
                flags[withoutPrefix] = true;
            }
            continue;
        }

        for (const shortFlag of token.slice(1)) {
            flags[shortFlag] = true;
        }
    }

    return { positionals, flags };
}

export function hasFlag(args: ParsedArgs, name: string): boolean {
    return args.flags[name] === true;
}

export function getStringFlag(args: ParsedArgs, name: string): string | undefined {
    const value = args.flags[name];
    return typeof value === 'string' ? value : undefined;
}

export function requireStringFlag(args: ParsedArgs, name: string): string {
    const value = getStringFlag(args, name);
    if (!value) {
        throw new Error(`Missing required flag --${name}.`);
    }

    return value;
}

export function getNumberFlag(args: ParsedArgs, name: string): number | undefined {
    const value = getStringFlag(args, name);
    if (value === undefined) {
        return undefined;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Flag --${name} must be a number.`);
    }

    return parsed;
}

export function getOptionalBooleanFlag(args: ParsedArgs, name: string): boolean | undefined {
    const value = args.flags[name];
    if (value === undefined) {
        return undefined;
    }

    if (value === true) {
        return true;
    }

    if (typeof value === 'string') {
        if (value === 'true') {
            return true;
        }
        if (value === 'false') {
            return false;
        }
    }

    throw new Error(`Flag --${name} must be true or false.`);
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
        process.stdin.on('data', (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        process.stdin.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf8'));
        });
        process.stdin.on('error', reject);
    });
}

async function readTextSource(source: string, kind: 'value' | 'file'): Promise<string> {
    if (source === '-') {
        return readStdin();
    }

    if (kind === 'file') {
        return fs.readFile(source, 'utf8');
    }

    return source;
}

export async function loadTextFlag(
    args: ParsedArgs,
    valueFlag: string,
    fileFlag: string,
): Promise<string | undefined> {
    const directValue = getStringFlag(args, valueFlag);
    const fileValue = getStringFlag(args, fileFlag);

    if (directValue && fileValue) {
        throw new Error(`Provide either --${valueFlag} or --${fileFlag}, not both.`);
    }

    if (directValue) {
        return readTextSource(directValue, 'value');
    }

    if (fileValue) {
        return readTextSource(fileValue, 'file');
    }

    return undefined;
}

export function parseJsonValue(raw: string, context: string): unknown {
    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new Error(
            `${context} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

export async function loadJsonFlag(
    args: ParsedArgs,
    valueFlag: string,
    fileFlag: string,
): Promise<unknown | undefined> {
    const raw = await loadTextFlag(args, valueFlag, fileFlag);
    if (raw === undefined) {
        return undefined;
    }

    return parseJsonValue(raw, `--${valueFlag}`);
}

export function requirePositional(
    args: ParsedArgs,
    index: number,
    name: string,
): string {
    const value = args.positionals[index];
    if (!value) {
        throw new Error(`Missing required argument: ${name}.`);
    }

    return value;
}

export function optionalPositional(args: ParsedArgs, index: number): string | undefined {
    return args.positionals[index];
}
