import { describe, expect, it } from 'vitest';

import { buildUsage } from './help.js';

describe('buildUsage', () => {
    it('builds the root help output', () => {
        const usage = buildUsage();

        expect(usage).toContain('WordClaw CLI');
        expect(usage).toContain('wordclaw <command> [subcommand] [options]');
        expect(usage).toContain('repl');
        expect(usage).toContain('script run --file <path> [--continue-on-error]');
        expect(usage).toContain('mcp openai-tools');
        expect(usage).toContain('workspace resolve --intent authoring|review|workflow|paid');
        expect(usage).toContain('assets create [--filename <value>] [--original-filename <value>] --mime-type <value>');
        expect(usage).toContain('--config <path>');
        expect(usage).toContain('--format <type>');
        expect(usage).toContain('asset -> assets');
        expect(usage).toContain('interactive -> repl');
    });

    it('builds scoped command help', () => {
        const usage = buildUsage({ command: 'content' });

        expect(usage).toContain('WordClaw CLI: content');
        expect(usage).toContain('wordclaw content <subcommand> [options]');
        expect(usage).toContain('content guide --content-type-id <n>');
        expect(usage).toContain('content project --content-type-id <n> --group-by <value>');
        expect(usage).toContain('content list [--content-type-id <n>] [--status <value>] [--q <value>] [--created-after <iso>] [--created-before <iso>] [--field-name <value>] [--field-op eq|contains|gte|lte] [--field-value <value>] [--sort-field <value>]');
        expect(usage).not.toContain('workflow decide --id <n> --decision approved|rejected');
    });

    it('builds scoped assets command help', () => {
        const usage = buildUsage({ command: 'assets' });

        expect(usage).toContain('WordClaw CLI: assets');
        expect(usage).toContain('wordclaw assets <subcommand> [options]');
        expect(usage).toContain('assets list [--q <value>] [--access-mode public|signed|entitled]');
        expect(usage).toContain('wordclaw assets create --content-file ./hero.png --mime-type image/png --access-mode signed');
        expect(usage).not.toContain('content guide --content-type-id <n>');
    });

    it('builds scoped subcommand help', () => {
        const usage = buildUsage({ command: 'workspace', subcommand: 'resolve' });

        expect(usage).toContain('WordClaw CLI: workspace resolve');
        expect(usage).toContain('wordclaw workspace resolve [options]');
        expect(usage).toContain('workspace resolve --intent authoring|review|workflow|paid [--search <value>]');
        expect(usage).toContain('wordclaw workspace resolve --intent review');
    });

    it('builds standalone command help without a fake subcommand slot', () => {
        const usage = buildUsage({ command: 'repl' });

        expect(usage).toContain('WordClaw CLI: repl');
        expect(usage).toContain('wordclaw repl [options]');
        expect(usage).not.toContain('wordclaw repl <subcommand> [options]');
    });
});
