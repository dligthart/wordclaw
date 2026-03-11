import { describe, expect, it } from 'vitest';

import { buildUsage } from './help.js';

describe('buildUsage', () => {
    it('builds the root help output', () => {
        const usage = buildUsage();

        expect(usage).toContain('WordClaw CLI');
        expect(usage).toContain('wordclaw <command> [subcommand] [options]');
        expect(usage).toContain('workspace resolve --intent authoring|review|workflow|paid');
        expect(usage).toContain('--config <path>');
        expect(usage).toContain('--format <type>');
    });

    it('builds scoped command help', () => {
        const usage = buildUsage({ command: 'content' });

        expect(usage).toContain('WordClaw CLI: content');
        expect(usage).toContain('wordclaw content <subcommand> [options]');
        expect(usage).toContain('content guide --content-type-id <n>');
        expect(usage).not.toContain('workflow decide --id <n> --decision approved|rejected');
    });

    it('builds scoped subcommand help', () => {
        const usage = buildUsage({ command: 'workspace', subcommand: 'resolve' });

        expect(usage).toContain('WordClaw CLI: workspace resolve');
        expect(usage).toContain('wordclaw workspace resolve [options]');
        expect(usage).toContain('workspace resolve --intent authoring|review|workflow|paid [--search <value>]');
        expect(usage).toContain('wordclaw workspace resolve --intent review');
    });
});
