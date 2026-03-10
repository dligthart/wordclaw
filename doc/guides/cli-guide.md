# WordClaw CLI

The WordClaw CLI is a JSON-first command-line interface for agents and operators. It wraps both of the product's primary agent surfaces:

- `MCP` for local tool discovery or remote MCP attachment
- `REST` for content operations, workflows, and L402 purchase/entitlement flows

Use the CLI when you want a scriptable interface without writing a custom MCP client or hand-rolling HTTP requests.

## Entry Points

Run from source:

```bash
npx tsx src/cli/index.ts --help
```

Run the compiled CLI:

```bash
npm run build
node dist/cli/index.js --help
```

## Environment

REST commands use these environment variables by default:

```bash
export WORDCLAW_BASE_URL=http://localhost:4000
export WORDCLAW_API_KEY=<your-api-key>
```

Use a domain-scoped API key for the tenant you want to operate against.

```bash
node dist/cli/index.js content-types list \
  --base-url http://localhost:4000 \
  --api-key <your-api-key>
```

## Output Model

The CLI prints JSON by default so agents can consume it reliably.

- Successful REST commands return transport metadata plus the API response body.
- Successful MCP commands return the discovered data or parsed tool output.
- Failures return a JSON error object and exit with code `1`.
- Use `--raw` when you want only the response body or MCP text without the CLI envelope.

Example:

```bash
node dist/cli/index.js content-types list --limit 2
```

```json
{
  "transport": "rest",
  "method": "GET",
  "url": "http://localhost:4000/api/content-types?limit=2",
  "status": 200,
  "ok": true,
  "body": {
    "data": [],
    "meta": {}
  }
}
```

Plain output example:

```bash
node dist/cli/index.js mcp prompt workflow-guidance --raw
```

## Supported Command Groups

### MCP

Use MCP commands for local discovery and tool execution:

```bash
node dist/cli/index.js mcp inspect
node dist/cli/index.js mcp call list_content_types --json '{"limit":5}'
node dist/cli/index.js mcp prompt workflow-guidance
node dist/cli/index.js mcp prompt task-guidance --json '{"taskId":"author-content"}'
node dist/cli/index.js mcp resource content://types
node dist/cli/index.js mcp resource system://agent-guidance
node dist/cli/index.js mcp smoke

# Attach to a running remote MCP endpoint instead of spawning stdio
node dist/cli/index.js mcp inspect \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer
```

Supported MCP features:

- tool discovery
- direct tool calls
- prompt retrieval
- resource reads
- end-to-end smoke validation across content, workflow, audit, API key, webhook, and payment-read surfaces

Important transport note:

- WordClaw exposes both `stdio` and remote Streamable HTTP at `/mcp`
- the CLI defaults to local `stdio` transport unless you pass `--mcp-transport http` or `--mcp-url`
- when running in `stdio` mode, the CLI starts its own local MCP child process
- when running in `http` mode, the CLI attaches directly to `/mcp`
- `mcp inspect` now also includes the deployment manifest and current actor snapshot when the MCP server exposes `system://capabilities` and `system://current-actor`

Usability details:

- unknown commands and subcommands return nearest-match suggestions, for example `mcp inspec` suggests `inspect`
- `content-types ls` is a shorthand for `content-types list`
- `content ls` is a shorthand for `content list`
- top-level aliases `ct` and `wf` expand to `content-types` and `workflow`

### Generic REST

Use the generic request command when a dedicated subcommand does not exist yet:

```bash
node dist/cli/index.js rest request GET /content-types
node dist/cli/index.js rest request POST /auth/keys \
  --body-json '{"name":"Example","scopes":["content:read","content:write"]}'
```

Supported flags:

- `--query-json` or `--query-file`
- `--body-json` or `--body-file`

### Capability Manifest

Use the deployment manifest when an agent needs to discover what this WordClaw instance actually supports before choosing a protocol or auth path:

```bash
node dist/cli/index.js capabilities show
node dist/cli/index.js caps show --raw
node dist/cli/index.js capabilities whoami
```

The manifest reports:

- required vs compatibility protocol surfaces
- MCP transport behavior
- auth and domain-context expectations
- reusable actor profiles for API keys, supervisor sessions, local MCP, and public discovery
- enabled core and experimental modules
- the current core capability matrix and dry-run support
- task-oriented routing hints and recommended recipes for common agent jobs

When you need to confirm the active credential before a mutation, use:

```bash
node dist/cli/index.js capabilities whoami
node dist/cli/index.js mcp whoami
```

### Content Types

```bash
node dist/cli/index.js content-types list --limit 10 --include-stats
node dist/cli/index.js ct ls --limit 10 --raw
node dist/cli/index.js content-types get --id 12
node dist/cli/index.js content-types create \
  --name "Article" \
  --slug article \
  --schema-file schema.json
node dist/cli/index.js content-types update --id 12 --description "Updated description"
node dist/cli/index.js content-types delete --id 12 --dry-run
```

Supported features:

- list content types
- get one content type
- create content types
- update content types
- delete content types
- create paid content types with `--base-price`
- dry-run mode for create, update, and delete

### Content Items

```bash
node dist/cli/index.js content list --content-type-id 12 --status draft --limit 20
node dist/cli/index.js content ls --status draft --raw
node dist/cli/index.js content get --id 345
node dist/cli/index.js content create --content-type-id 12 --data-file item.json
node dist/cli/index.js content update --id 345 --data-json '{"title":"Updated"}'
node dist/cli/index.js content versions --id 345
node dist/cli/index.js content rollback --id 345 --version 2 --dry-run
node dist/cli/index.js content delete --id 345
```

Supported features:

- filtered list views
- item reads
- create and update mutations
- version history
- rollback
- delete
- dry-run mode where the REST API supports it

### Workflow and Review

```bash
node dist/cli/index.js workflow active --content-type-id 12
node dist/cli/index.js workflow submit --id 345 --transition 9 --assignee editor-1
node dist/cli/index.js workflow tasks
node dist/cli/index.js workflow decide --id 88 --decision approved
```

Supported features:

- inspect the active workflow for a content type
- submit a content item for review
- list pending review tasks
- approve or reject review tasks

### L402 and Paid Content

Use REST-based commands for L402 and entitlement flows:

```bash
node dist/cli/index.js l402 guide --item 345
node dist/cli/index.js l402 offers --item 345
node dist/cli/index.js l402 purchase --offer 7
node dist/cli/index.js l402 confirm --offer 7 --macaroon <macaroon> --preimage <preimage>
node dist/cli/index.js l402 entitlements
node dist/cli/index.js l402 entitlement --id 21
node dist/cli/index.js l402 read --item 345 --entitlement-id 21
```

Supported features:

- generate a task-oriented paid-content plan from the current live offers
- include the current actor snapshot and a readiness assessment for the paid-content task
- list item offers
- start a purchase flow
- confirm settlement with `Authorization: L402 <macaroon>:<preimage>`
- list entitlements owned by the current API key
- inspect a specific entitlement
- perform paid reads with an entitlement header

If no API key is configured, `l402 guide` falls back to a generic blocked plan instead of failing immediately. That still shows the required purchase/confirm/read sequence, attempts to explain which actor is missing, and tells the agent what auth is required.

## Input Patterns

For structured payloads, use either inline JSON or a file.

Inline:

```bash
node dist/cli/index.js content create \
  --content-type-id 12 \
  --data-json '{"title":"CLI Draft","body":"Created from JSON"}'
```

From file:

```bash
node dist/cli/index.js content create \
  --content-type-id 12 \
  --data-file ./payloads/article.json
```

The same pattern applies to:

- `--schema-json` / `--schema-file`
- `--body-json` / `--body-file`
- `--query-json` / `--query-file`
- MCP `--json` / `--file`

## Agent Usage Guidance

The CLI is suitable for agents when you want:

- deterministic JSON output
- narrow command contracts instead of raw HTTP
- easy shell execution from automation systems
- one surface for both MCP and REST-backed workflows

Recommended agent pattern:

1. Use `mcp inspect` or `mcp smoke` to discover and validate the local MCP surface.
2. Use dedicated REST commands for content and workflow operations.
3. Use `l402` commands for paid access and entitlement-aware reads.
4. Fall back to `rest request` for endpoints that do not yet have a dedicated command.

## Current Limitations

- Use `--mcp-transport http` or `--mcp-url` when you want the CLI to attach to a running remote MCP endpoint instead of spawning a local stdio process.
- L402 purchase confirmation depends on a live offer, a valid invoice challenge, and payment-provider state in the target environment.

## Related Docs

- [Getting Started](../tutorials/getting-started.md)
- [MCP Integration](./mcp-integration.md)
- [API Reference](../reference/api-reference.md)
- [L402 Protocol](../concepts/l402-protocol.md)
