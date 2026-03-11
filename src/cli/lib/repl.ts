import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import type { Interface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { resolveCliInvocation } from './script-runner.js';

export type ParsedReplCommand =
    | { kind: 'empty' }
    | { kind: 'help' }
    | { kind: 'context' }
    | { kind: 'exit' }
    | { kind: 'cli'; args: string[] };

function pushCurrentToken(tokens: string[], current: string[]) {
    if (current.length > 0) {
        tokens.push(current.join(''));
        current.length = 0;
    }
}

export function tokenizeReplInput(line: string): string[] {
    const tokens: string[] = [];
    const current: string[] = [];
    let quote: '"' | "'" | null = null;
    let escaping = false;

    for (const character of line) {
        if (escaping) {
            current.push(character);
            escaping = false;
            continue;
        }

        if (character === '\\') {
            escaping = true;
            continue;
        }

        if (quote) {
            if (character === quote) {
                quote = null;
                continue;
            }
            current.push(character);
            continue;
        }

        if (character === '"' || character === '\'') {
            quote = character;
            continue;
        }

        if (/\s/.test(character)) {
            pushCurrentToken(tokens, current);
            continue;
        }

        current.push(character);
    }

    if (escaping) {
        current.push('\\');
    }

    if (quote) {
        throw new Error('Unterminated quoted string in REPL input.');
    }

    pushCurrentToken(tokens, current);
    return tokens;
}

export function parseReplCommand(line: string): ParsedReplCommand {
    const trimmed = line.trim();
    if (!trimmed) {
        return { kind: 'empty' };
    }

    const tokens = tokenizeReplInput(trimmed);
    if (tokens.length === 0) {
        return { kind: 'empty' };
    }

    const [first, ...rest] = tokens;
    if (first === 'exit' || first === 'quit' || first === ':q') {
        return { kind: 'exit' };
    }
    if (first === 'help' || first === ':help') {
        return { kind: 'help' };
    }
    if (first === 'context' || first === ':context') {
        return { kind: 'context' };
    }
    if (first === 'wordclaw') {
        return rest.length === 0
            ? { kind: 'help' }
            : { kind: 'cli', args: rest };
    }

    return { kind: 'cli', args: tokens };
}

export function buildReplHelp() {
    return `WordClaw REPL

Enter normal CLI commands without the "wordclaw" prefix.

Built-ins:
  help, :help       Show this REPL help
  context           Show inherited runtime flags for this session
  exit, quit, :q    Leave the REPL

Examples:
  capabilities show
  capabilities whoami
  workspace guide --intent review --limit 5
  content guide --content-type-id 12
  mcp inspect --mcp-transport http --mcp-url http://localhost:4000/mcp
`;
}

function buildContextSummary(inheritedFlags: string[]) {
    return {
        inheritedFlags,
        note: 'These flags are applied to every command in this REPL session unless you override them on the command itself.',
    };
}

async function runInteractiveCliCommand(
    repoRoot: string,
    inheritedFlags: string[],
    commandArgs: string[],
) {
    const invocation = resolveCliInvocation(repoRoot);
    const child = spawn(
        invocation.command,
        [...invocation.args, ...inheritedFlags, ...commandArgs],
        {
            cwd: repoRoot,
            env: process.env,
            stdio: 'inherit',
        },
    );

    return await new Promise<number>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? 1));
    });
}

export async function runCliRepl(options: {
    repoRoot: string;
    inheritedFlags: string[];
    prompt?: string;
    io?: Interface;
    onExecute?: (args: string[]) => Promise<number>;
    writeLine?: (line: string) => void;
}) {
    const repl = options.io ?? createInterface({
        input,
        output,
        terminal: true,
    });
    const writeLine = options.writeLine ?? ((line: string) => output.write(`${line}\n`));
    const prompt = options.prompt ?? 'wordclaw> ';
    const execute = options.onExecute
        ?? ((args: string[]) => runInteractiveCliCommand(options.repoRoot, options.inheritedFlags, args));
    const ownsInterface = options.io === undefined;

    try {
        writeLine('WordClaw interactive mode. Type "help" for commands or "exit" to leave.');
        while (true) {
            const line = await repl.question(prompt);
            const parsed = parseReplCommand(line);

            if (parsed.kind === 'empty') {
                continue;
            }
            if (parsed.kind === 'help') {
                writeLine(buildReplHelp());
                continue;
            }
            if (parsed.kind === 'context') {
                writeLine(JSON.stringify(buildContextSummary(options.inheritedFlags), null, 2));
                continue;
            }
            if (parsed.kind === 'exit') {
                break;
            }

            if (parsed.args[0] === 'repl') {
                writeLine('Already in the WordClaw REPL. Run another command or type "exit".');
                continue;
            }

            const exitCode = await execute(parsed.args);
            if (exitCode !== 0) {
                writeLine(`Command exited with status ${exitCode}.`);
            }
        }
    } finally {
        if (ownsInterface) {
            repl.close();
        }
    }
}
