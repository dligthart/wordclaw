import { describe, expect, it, vi } from 'vitest';

import {
    buildReplHelp,
    parseReplCommand,
    runCliRepl,
    tokenizeReplInput,
} from './repl.js';

describe('tokenizeReplInput', () => {
    it('splits plain whitespace-separated tokens', () => {
        expect(tokenizeReplInput('content guide --content-type-id 12')).toEqual([
            'content',
            'guide',
            '--content-type-id',
            '12',
        ]);
    });

    it('supports quoted values', () => {
        expect(tokenizeReplInput('content create --data-json "{\\"title\\":\\"Hello world\\"}"')).toEqual([
            'content',
            'create',
            '--data-json',
            '{"title":"Hello world"}',
        ]);
    });

    it('throws on unterminated quotes', () => {
        expect(() => tokenizeReplInput('content create --data-json "oops')).toThrow(
            'Unterminated quoted string in REPL input.',
        );
    });
});

describe('parseReplCommand', () => {
    it('recognizes built-in help and exit commands', () => {
        expect(parseReplCommand('help')).toEqual({ kind: 'help' });
        expect(parseReplCommand(':q')).toEqual({ kind: 'exit' });
        expect(parseReplCommand('context')).toEqual({ kind: 'context' });
    });

    it('removes an optional wordclaw prefix', () => {
        expect(parseReplCommand('wordclaw capabilities show')).toEqual({
            kind: 'cli',
            args: ['capabilities', 'show'],
        });
    });
});

describe('buildReplHelp', () => {
    it('describes interactive usage', () => {
        const help = buildReplHelp();
        expect(help).toContain('WordClaw REPL');
        expect(help).toContain('workspace guide --intent review --limit 5');
    });
});

describe('runCliRepl', () => {
    it('executes built-ins and command lines in sequence', async () => {
        const answers = ['help', 'context', 'capabilities show', 'exit'];
        const lines: string[] = [];
        const execute = vi.fn(async () => 0);
        const io = {
            question: vi.fn(async () => answers.shift() ?? 'exit'),
            close: vi.fn(),
        };

        await runCliRepl({
            repoRoot: process.cwd(),
            inheritedFlags: ['--base-url', 'http://localhost:4000'],
            io: io as never,
            onExecute: execute,
            writeLine: (line) => lines.push(line),
        });

        expect(lines[0]).toContain('WordClaw interactive mode');
        expect(lines.some((line) => line.includes('"--base-url"'))).toBe(true);
        expect(execute).toHaveBeenCalledWith(['capabilities', 'show']);
        expect(io.close).not.toHaveBeenCalled();
    });

    it('warns instead of nesting repl invocations', async () => {
        const answers = ['repl', 'exit'];
        const lines: string[] = [];
        const execute = vi.fn(async () => 0);
        const io = {
            question: vi.fn(async () => answers.shift() ?? 'exit'),
            close: vi.fn(),
        };

        await runCliRepl({
            repoRoot: process.cwd(),
            inheritedFlags: [],
            io: io as never,
            onExecute: execute,
            writeLine: (line) => lines.push(line),
        });

        expect(lines.some((line) => line.includes('Already in the WordClaw REPL'))).toBe(true);
        expect(execute).not.toHaveBeenCalled();
    });
});
