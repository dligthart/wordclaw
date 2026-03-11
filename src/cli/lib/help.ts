type HelpScope = {
    command?: string;
    subcommand?: string;
};

const USAGE_LINES = [
    'mcp inspect',
    'mcp whoami',
    'mcp call <tool> [--json <object>|--file <path>]',
    'mcp prompt <prompt> [--json <object>|--file <path>]',
    'mcp resource <uri>',
    'mcp smoke',
    'capabilities show',
    'capabilities status',
    'capabilities whoami',
    'workspace guide [--intent all|authoring|review|workflow|paid] [--search <value>] [--limit <n>]',
    'workspace resolve --intent authoring|review|workflow|paid [--search <value>]',
    'audit list [--actor-id <value>] [--actor-type <value>] [--entity-type <value>] [--entity-id <n>] [--action <value>] [--limit <n>] [--cursor <value>]',
    'audit guide [--actor-id <value>] [--actor-type <value>] [--entity-type <value>] [--entity-id <n>] [--action <value>] [--limit <n>]',
    'rest request <method> <path> [--query-json <object>] [--body-json <object>|--body-file <path>]',
    'integrations guide',
    'content-types list [--limit <n>] [--offset <n>] [--include-stats]',
    'content-types get --id <n>',
    'content-types create --name <value> --slug <value> [--description <value>] [--schema-json <json>|--schema-file <path>] [--base-price <n>] [--dry-run]',
    'content-types update --id <n> [--name <value>] [--slug <value>] [--description <value>] [--schema-json <json>|--schema-file <path>] [--base-price <n>] [--dry-run]',
    'content-types delete --id <n> [--dry-run]',
    'content list [--content-type-id <n>] [--status <value>] [--q <value>] [--created-after <iso>] [--created-before <iso>] [--sort-by updatedAt|createdAt|version] [--sort-dir asc|desc] [--limit <n>] [--offset <n>]',
    'content guide --content-type-id <n>',
    'content get --id <n>',
    'content create --content-type-id <n> [--status <value>] [--data-json <json>|--data-file <path>] [--dry-run]',
    'content update --id <n> [--content-type-id <n>] [--status <value>] [--data-json <json>|--data-file <path>] [--dry-run]',
    'content versions --id <n>',
    'content rollback --id <n> --version <n> [--dry-run]',
    'content delete --id <n> [--dry-run]',
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
        'wordclaw capabilities show',
        'wordclaw workspace guide --intent review --limit 5',
        'wordclaw content guide --content-type-id 12',
        'wordclaw mcp inspect --mcp-transport http --mcp-url http://localhost:4000/mcp --api-key writer',
    ],
    'mcp': [
        'wordclaw mcp inspect',
        'wordclaw mcp call guide_task --json \'{"taskId":"discover-workspace","intent":"review"}\'',
    ],
    'workspace': [
        'wordclaw workspace guide --intent authoring --search article',
        'wordclaw workspace resolve --intent review',
    ],
    'content': [
        'wordclaw content guide --content-type-id 12',
        'wordclaw content create --content-type-id 12 --data-file item.json --dry-run',
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

    return `${titleForScope(scope)}

Usage:
  ${usagePrefix}${scope.command && !scope.subcommand ? ' <subcommand> [options]' : !scope.command ? ' <command> [subcommand] [options]' : ' [options]'}

Commands:
${matchingLines.map((line) => `  ${line}`).join('\n')}

Examples:
${examples.map((line) => `  ${line}`).join('\n')}

Aliases:
  caps -> capabilities
  ct -> content-types
  wf -> workflow
  content-types ls -> content-types list
  content ls -> content list

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
