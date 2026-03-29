type HelpScope = {
    command?: string;
    subcommand?: string;
};

const USAGE_LINES = [
    'repl',
    'provision --agent openclaw|codex|claude-code|cursor [--transport stdio|http] [--scope project|user|local] [--name <value>] [--config-path <path>] [--write]',
    'script run --file <path> [--continue-on-error]',
    'mcp inspect',
    'mcp whoami',
    'mcp call <tool> [--json <object>|--file <path>]',
    'mcp prompt <prompt> [--json <object>|--file <path>]',
    'mcp resource <uri>',
    'mcp openai-tools',
    'mcp smoke',
    'capabilities show',
    'capabilities status',
    'capabilities whoami',
    'workspace guide [--intent all|authoring|review|workflow|paid] [--search <value>] [--limit <n>]',
    'workspace resolve --intent authoring|review|workflow|paid [--search <value>]',
    'audit list [--actor-id <value>] [--actor-type <value>] [--entity-type <value>] [--entity-id <n>] [--action <value>] [--limit <n>] [--cursor <value>]',
    'audit guide [--actor-id <value>] [--actor-type <value>] [--entity-type <value>] [--entity-id <n>] [--action <value>] [--limit <n>]',
    'rest request <method> <path> [--query-json <object>] [--body-json <object>|--body-file <path>]',
    'schema generate --out <path> [--package-name <value>] [--content-type-slugs <csv>]',
    'integrations guide',
    'forms list',
    'forms get --id <n>',
    'forms public --slug <value> --domain-id <n>',
    'forms create --name <value> --slug <value> --content-type-id <n> [--description <value>] [--fields-json <json>|--fields-file <path>] [--default-data-json <json>|--default-data-file <path>] [--active true|false] [--public-read true|false] [--submission-status <value>] [--workflow-transition-id <n>] [--require-payment true|false] [--webhook-url <value>] [--webhook-secret <value>] [--success-message <value>]',
    'forms update --id <n> [--name <value>] [--slug <value>] [--content-type-id <n>] [--fields-json <json>|--fields-file <path>] [--default-data-json <json>|--default-data-file <path>] [--active true|false] [--public-read true|false] [--submission-status <value>] [--workflow-transition-id <n>|null] [--require-payment true|false] [--webhook-url <value>] [--webhook-secret <value>] [--success-message <value>]',
    'forms delete --id <n>',
    'forms submit --slug <value> --domain-id <n> [--data-json <json>|--data-file <path>]',
    'jobs list [--status queued|running|succeeded|failed|cancelled] [--kind content_status_transition|outbound_webhook] [--limit <n>] [--offset <n>]',
    'jobs get --id <n>',
    'jobs worker-status',
    'jobs create --kind content_status_transition|outbound_webhook [--payload-json <json>|--payload-file <path>] [--queue <value>] [--run-at <iso>] [--max-attempts <n>]',
    'jobs cancel --id <n>',
    'jobs schedule-status --id <n> --status <value> --run-at <iso> [--max-attempts <n>]',
    'content-types list [--limit <n>] [--offset <n>] [--include-stats]',
    'content-types get --id <n>',
    'content-types create --name <value> --slug <value> [--kind collection|singleton] [--description <value>] [--schema-json <json>|--schema-file <path>|--schema-manifest-json <json>|--schema-manifest-file <path>] [--base-price <n>] [--dry-run]',
    'content-types update --id <n> [--name <value>] [--slug <value>] [--kind collection|singleton] [--description <value>] [--schema-json <json>|--schema-file <path>|--schema-manifest-json <json>|--schema-manifest-file <path>] [--base-price <n>] [--dry-run]',
    'content-types delete --id <n> [--dry-run]',
    'globals list [--published] [--locale <value>] [--fallback-locale <value>]',
    'globals get --slug <value> [--published] [--locale <value>] [--fallback-locale <value>]',
    'globals preview-token --slug <value> [--published] [--locale <value>] [--fallback-locale <value>] [--ttl-seconds <n>]',
    'globals update --slug <value> [--status <value>] [--data-json <json>|--data-file <path>] [--dry-run]',
    'content list [--content-type-id <n>] [--status <value>] [--q <value>] [--published] [--locale <value>] [--fallback-locale <value>] [--created-after <iso>] [--created-before <iso>] [--field-name <value>] [--field-op eq|contains|gte|lte] [--field-value <value>] [--sort-field <value>] [--sort-by updatedAt|createdAt|version] [--sort-dir asc|desc] [--include-archived] [--limit <n>] [--offset <n>] [--cursor <value>]',
    'content project --content-type-id <n> --group-by <value> [--status <value>] [--created-after <iso>] [--created-before <iso>] [--field-name <value>] [--field-op eq|contains|gte|lte] [--field-value <value>] [--metric count|sum|avg|min|max] [--metric-field <value>] [--order-by value|group] [--order-dir asc|desc] [--include-archived] [--limit <n>]',
    'content guide --content-type-id <n>',
    'content get --id <n> [--published] [--locale <value>] [--fallback-locale <value>]',
    'content used-by --id <n>',
    'content preview-token --id <n> [--published] [--locale <value>] [--fallback-locale <value>] [--ttl-seconds <n>]',
    'content create --content-type-id <n> [--status <value>] [--data-json <json>|--data-file <path>] [--dry-run]',
    'content update --id <n> [--content-type-id <n>] [--status <value>] [--data-json <json>|--data-file <path>] [--dry-run]',
    'content versions --id <n>',
    'content rollback --id <n> --version <n> [--dry-run]',
    'content delete --id <n> [--dry-run]',
    'assets list [--q <value>] [--access-mode public|signed|entitled] [--status active|deleted] [--source-asset-id <n>] [--limit <n>] [--offset <n>] [--cursor <value>]',
    'assets get --id <n>',
    'assets used-by --id <n>',
    'assets create [--filename <value>] [--original-filename <value>] --mime-type <value> [--content-file <path>|--content-base64 <value>|--content-base64-file <path>] [--access-mode public|signed|entitled] [--metadata-json <json>|--metadata-file <path>] [--entitlement-scope-json <json>|--entitlement-scope-file <path>] [--source-asset-id <n> --variant-key <value> [--transform-spec-json <json>|--transform-spec-file <path>]]',
    'assets offers --id <n>',
    'assets access --id <n> [--ttl-seconds <n>]',
    'assets delete --id <n>',
    'assets restore --id <n>',
    'assets purge --id <n>',
    'workflow active --content-type-id <n>',
    'workflow guide [--task <n>]',
    'workflow submit --id <n> --transition <n> [--assignee <value>]',
    'workflow tasks',
    'workflow decide --id <n> --decision approved|rejected',
    'l402 offers --item <n>',
    'l402 guide --item <n> [--offer <n>]',
    'l402 purchase --offer <n> [--payment-method lightning]',
    'l402 confirm --offer <n> --macaroon <value> --preimage <value> [--payment-hash <hash>]',
    'l402 entitlements',
    'l402 entitlement --id <n>',
    'l402 read --item <n> [--entitlement-id <n>]',
] as const;

const EXAMPLES: Record<string, string[]> = {
    root: [
        'wordclaw repl',
        'wordclaw provision --agent claude-code --transport http --scope project --write',
        'wordclaw capabilities show',
        'wordclaw workspace guide --intent review --limit 5',
        'wordclaw content guide --content-type-id 12',
        'wordclaw schema generate --out ./generated/wordclaw',
        'wordclaw forms list',
        'wordclaw jobs worker-status',
        'wordclaw mcp inspect --mcp-transport http --mcp-url http://localhost:4000/mcp --api-key writer',
        'wordclaw script run --file workflow.json',
    ],
    'script': [
        'wordclaw script run --file workflow.json',
    ],
    'repl': [
        'wordclaw repl',
    ],
    'provision': [
        'wordclaw provision --agent claude-code --transport http --scope project --write',
        'wordclaw provision --agent cursor --transport stdio --scope project',
        'wordclaw provision --agent codex --transport http --raw',
    ],
    'mcp': [
        'wordclaw mcp inspect',
        'wordclaw mcp openai-tools --raw',
        'wordclaw mcp call guide_task --json \'{"taskId":"discover-workspace","intent":"review"}\'',
    ],
    'workspace': [
        'wordclaw workspace guide --intent authoring --search article',
        'wordclaw workspace resolve --intent review',
    ],
    'schema': [
        'wordclaw schema generate --out ./generated/wordclaw',
        'wordclaw schema generate --out ./generated/wordclaw --content-type-slugs article,site-settings',
    ],
    'forms': [
        'wordclaw forms create --name Contact --slug contact --content-type-id 12 --fields-file contact-form.fields.json',
        'wordclaw forms public --slug contact --domain-id 1',
        'wordclaw forms submit --slug contact --domain-id 1 --data-file submission.json',
    ],
    'jobs': [
        'wordclaw jobs worker-status',
        'wordclaw jobs create --kind outbound_webhook --payload-file webhook-job.json',
        'wordclaw jobs schedule-status --id 88 --status published --run-at 2026-04-01T09:00:00Z',
    ],
    'content': [
        'wordclaw content guide --content-type-id 12',
        'wordclaw content used-by --id 88',
        'wordclaw content create --content-type-id 12 --data-file item.json --dry-run',
        'wordclaw content preview-token --id 88',
        'wordclaw content project --content-type-id 12 --group-by characterClass --metric avg --metric-field score',
    ],
    'content-types': [
        'wordclaw content-types create --name Article --slug article --schema-file article.schema.json',
        'wordclaw content-types create --name LandingPage --slug landing-page --schema-manifest-file landing-page.manifest.json',
        'wordclaw content-types update --id 12 --schema-manifest-json \'{"fields":[{"name":"title","type":"text","required":true}]}\'',
    ],
    'globals': [
        'wordclaw globals list',
        'wordclaw globals get --slug site-settings --locale nl',
        'wordclaw globals preview-token --slug site-settings --locale nl',
        'wordclaw globals update --slug site-settings --data-file settings.json --dry-run',
    ],
    'assets': [
        'wordclaw assets list --access-mode public --limit 10',
        'wordclaw assets used-by --id 44',
        'wordclaw assets create --content-file ./hero.png --mime-type image/png --access-mode signed',
        'wordclaw assets create --content-file ./hero@2x.webp --mime-type image/webp --source-asset-id 44 --variant-key hero-webp --transform-spec-json \'{"format":"webp","width":1600}\'',
        'wordclaw assets access --id 44 --ttl-seconds 120',
    ],
    'workflow': [
        'wordclaw workflow guide',
        'wordclaw workflow decide --id 88 --decision approved',
    ],
    'l402': [
        'wordclaw l402 guide --item 123',
        'wordclaw l402 offers --item 123',
    ],
    'content guide': [
        'wordclaw content guide --content-type-id 12',
    ],
    'workspace resolve': [
        'wordclaw workspace resolve --intent review',
    ],
};

const COMMANDS_WITHOUT_SUBCOMMANDS = new Set(['repl', 'provision']);

function matchesScope(line: string, scope: HelpScope) {
    if (!scope.command) {
        return true;
    }

    if (scope.subcommand) {
        return line.startsWith(`${scope.command} ${scope.subcommand} `)
            || line === `${scope.command} ${scope.subcommand}`;
    }

    return line.startsWith(`${scope.command} `);
}

function titleForScope(scope: HelpScope) {
    if (scope.command && scope.subcommand) {
        return `WordClaw CLI: ${scope.command} ${scope.subcommand}`;
    }
    if (scope.command) {
        return `WordClaw CLI: ${scope.command}`;
    }
    return 'WordClaw CLI';
}

function scopeKey(scope: HelpScope) {
    if (scope.command && scope.subcommand) {
        return `${scope.command} ${scope.subcommand}`;
    }
    return scope.command ?? 'root';
}

export function buildUsage(scope: HelpScope = {}) {
    const matchingLines = USAGE_LINES.filter((line) => matchesScope(line, scope));
    const examples = EXAMPLES[scopeKey(scope)] ?? EXAMPLES[scope.command ?? 'root'] ?? EXAMPLES.root;
    const usagePrefix = scope.command
        ? scope.subcommand
            ? `wordclaw ${scope.command} ${scope.subcommand}`
            : `wordclaw ${scope.command}`
        : 'wordclaw';
    const expectsSubcommand = scope.command
        ? !scope.subcommand && !COMMANDS_WITHOUT_SUBCOMMANDS.has(scope.command)
        : false;

    return `${titleForScope(scope)}

Usage:
  ${usagePrefix}${expectsSubcommand ? ' <subcommand> [options]' : !scope.command ? ' <command> [subcommand] [options]' : ' [options]'}

Commands:
${matchingLines.map((line) => `  ${line}`).join('\n')}

Examples:
${examples.map((line) => `  ${line}`).join('\n')}

Aliases:
  caps -> capabilities
  ct -> content-types
  asset -> assets
  wf -> workflow
  interactive -> repl
  content-types ls -> content-types list
  content ls -> content list
  assets ls -> assets list

Global options:
  --raw               Print plain body/text without the CLI envelope when possible
  --help, -h          Show help for the current command or subcommand
  --help-all          Show the full command reference
  --config <path>     Load CLI defaults from a JSON config file
  --format <type>     Structured output format: json or yaml
  --base-url <url>    Override WORDCLAW_BASE_URL for REST commands
  --api-key <key>     Override WORDCLAW_API_KEY for REST commands
  --mcp-transport     MCP transport for mcp commands: stdio or http
  --mcp-url <url>     Remote MCP endpoint. Defaults to <base-url>/mcp for HTTP mode
  --file <path>       File path for script-run and JSON/file-driven commands

Config:
  The CLI loads .wordclaw.json from the current working directory by default,
  then falls back to ~/.wordclaw.json. Use --config <path> or WORDCLAW_CONFIG
  to point at a specific file.

Environment:
  WORDCLAW_BASE_URL       Default: http://localhost:4000
  WORDCLAW_API_KEY        API key used for REST requests
  WORDCLAW_MCP_URL        Remote MCP endpoint for mcp commands
  WORDCLAW_MCP_TRANSPORT  Default MCP transport override for mcp commands
  WORDCLAW_CONFIG         Explicit path to a CLI JSON config file
`;
}
