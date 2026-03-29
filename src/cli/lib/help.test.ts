import { describe, expect, it } from 'vitest';

import { buildUsage } from './help.js';

describe('buildUsage', () => {
    it('builds the root help output', () => {
        const usage = buildUsage();

        expect(usage).toContain('WordClaw CLI');
        expect(usage).toContain('wordclaw <command> [subcommand] [options]');
        expect(usage).toContain('repl');
        expect(usage).toContain('provision --agent openclaw|codex|claude-code|cursor [--transport stdio|http] [--scope project|user|local] [--name <value>] [--config-path <path>] [--write]');
        expect(usage).toContain('script run --file <path> [--continue-on-error]');
        expect(usage).toContain('mcp openai-tools');
        expect(usage).toContain('workspace resolve --intent authoring|review|workflow|paid');
        expect(usage).toContain('schema generate --out <path> [--package-name <value>] [--content-type-slugs <csv>]');
        expect(usage).toContain('forms create --name <value> --slug <value> --content-type-id <n>');
        expect(usage).toContain('jobs worker-status');
        expect(usage).toContain('content-types create --name <value> --slug <value> [--kind collection|singleton] [--description <value>] [--schema-json <json>|--schema-file <path>|--schema-manifest-json <json>|--schema-manifest-file <path>]');
        expect(usage).toContain('globals get --slug <value> [--published] [--locale <value>] [--fallback-locale <value>]');
        expect(usage).toContain('globals preview-token --slug <value> [--published] [--locale <value>] [--fallback-locale <value>] [--ttl-seconds <n>]');
        expect(usage).toContain('globals update --slug <value> [--status <value>] [--data-json <json>|--data-file <path>] [--dry-run]');
        expect(usage).toContain('content used-by --id <n>');
        expect(usage).toContain('assets used-by --id <n>');
        expect(usage).toContain('assets create [--filename <value>] [--original-filename <value>] --mime-type <value>');
        expect(usage).toContain('--config <path>');
        expect(usage).toContain('--format <type>');
        expect(usage).toContain('asset -> assets');
        expect(usage).toContain('interactive -> repl');
    });

    it('builds standalone provision help without a fake subcommand slot', () => {
        const usage = buildUsage({ command: 'provision' });

        expect(usage).toContain('WordClaw CLI: provision');
        expect(usage).toContain('wordclaw provision [options]');
        expect(usage).toContain('wordclaw provision --agent claude-code --transport http --scope project --write');
        expect(usage).not.toContain('wordclaw provision <subcommand> [options]');
    });

    it('builds scoped command help', () => {
        const usage = buildUsage({ command: 'content' });

        expect(usage).toContain('WordClaw CLI: content');
        expect(usage).toContain('wordclaw content <subcommand> [options]');
        expect(usage).toContain('content guide --content-type-id <n>');
        expect(usage).toContain('content project --content-type-id <n> --group-by <value>');
        expect(usage).toContain('content list [--content-type-id <n>] [--status <value>] [--q <value>] [--published] [--locale <value>] [--fallback-locale <value>] [--created-after <iso>] [--created-before <iso>] [--field-name <value>] [--field-op eq|contains|gte|lte] [--field-value <value>] [--sort-field <value>]');
        expect(usage).toContain('content used-by --id <n>');
        expect(usage).toContain('content preview-token --id <n> [--published] [--locale <value>] [--fallback-locale <value>] [--ttl-seconds <n>]');
        expect(usage).not.toContain('workflow decide --id <n> --decision approved|rejected');
    });

    it('builds scoped assets command help', () => {
        const usage = buildUsage({ command: 'assets' });

        expect(usage).toContain('WordClaw CLI: assets');
        expect(usage).toContain('wordclaw assets <subcommand> [options]');
        expect(usage).toContain('assets list [--q <value>] [--access-mode public|signed|entitled]');
        expect(usage).toContain('assets used-by --id <n>');
        expect(usage).toContain('wordclaw assets create --content-file ./hero.png --mime-type image/png --access-mode signed');
        expect(usage).not.toContain('content guide --content-type-id <n>');
    });

    it('builds scoped schema help', () => {
        const usage = buildUsage({ command: 'schema' });

        expect(usage).toContain('WordClaw CLI: schema');
        expect(usage).toContain('wordclaw schema <subcommand> [options]');
        expect(usage).toContain('schema generate --out <path> [--package-name <value>] [--content-type-slugs <csv>]');
        expect(usage).toContain('wordclaw schema generate --out ./generated/wordclaw');
    });

    it('builds scoped forms help', () => {
        const usage = buildUsage({ command: 'forms' });

        expect(usage).toContain('WordClaw CLI: forms');
        expect(usage).toContain('wordclaw forms <subcommand> [options]');
        expect(usage).toContain('forms submit --slug <value> --domain-id <n> [--data-json <json>|--data-file <path>]');
        expect(usage).toContain('wordclaw forms public --slug contact --domain-id 1');
    });

    it('builds scoped jobs help', () => {
        const usage = buildUsage({ command: 'jobs' });

        expect(usage).toContain('WordClaw CLI: jobs');
        expect(usage).toContain('wordclaw jobs <subcommand> [options]');
        expect(usage).toContain('jobs create --kind content_status_transition|outbound_webhook');
        expect(usage).toContain('wordclaw jobs schedule-status --id 88 --status published --run-at 2026-04-01T09:00:00Z');
    });

    it('builds scoped content-types help with manifest flags', () => {
        const usage = buildUsage({ command: 'content-types' });

        expect(usage).toContain('WordClaw CLI: content-types');
        expect(usage).toContain('wordclaw content-types <subcommand> [options]');
        expect(usage).toContain('--schema-manifest-json <json>|--schema-manifest-file <path>');
        expect(usage).toContain('wordclaw content-types create --name LandingPage --slug landing-page --schema-manifest-file landing-page.manifest.json');
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
