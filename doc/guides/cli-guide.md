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

Install the compiled binary for global use:

```bash
npm run build
npm install -g .
wordclaw --help
wordclaw content guide --help
wordclaw workspace resolve --help
```

## Environment

REST commands use these environment variables by default:

```bash
export WORDCLAW_BASE_URL=http://localhost:4000
export WORDCLAW_API_KEY=<your-api-key>
```

## Config File

The CLI loads defaults from:

1. `--config <path>` or `WORDCLAW_CONFIG`
2. `./.wordclaw.json`
3. `~/.wordclaw.json`

Example:

```json
{
  "baseUrl": "http://localhost:4000",
  "apiKey": "writer",
  "mcpTransport": "http",
  "mcpUrl": "http://localhost:4000/mcp",
  "format": "yaml",
  "raw": false
}
```

Flags still override config values.

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
- Use `--format yaml` when you want structured output optimized for human reading.

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

Scoped help examples:

```bash
wordclaw --help
wordclaw content --help
wordclaw content guide --help
wordclaw workspace resolve --help
wordclaw --help-all
wordclaw script run --help
wordclaw repl --help
```

## Interactive Mode

Use the REPL when you want to explore the deployment without retyping shared flags like `--base-url`, `--api-key`, or `--mcp-transport`.

```bash
wordclaw repl
```

Inside the REPL:

- enter normal CLI commands without the `wordclaw` prefix
- use `help` to print the REPL command summary
- use `context` to show the inherited runtime flags for the current session
- use `exit` or `quit` to leave

Examples:

```text
wordclaw> capabilities show
wordclaw> workspace guide --intent review --limit 5
wordclaw> mcp inspect --mcp-transport http --mcp-url http://localhost:4000/mcp
wordclaw> exit
```

## Script Mode

Use script mode when you want to run a repeatable sequence of CLI commands from one JSON file:

```json
{
  "continueOnError": false,
  "steps": [
    { "name": "deployment", "args": ["capabilities", "show"] },
    { "name": "identity", "args": ["capabilities", "whoami"] },
    { "name": "review-target", "args": ["workspace", "resolve", "--intent", "review"] }
  ]
}
```

Run it with:

```bash
wordclaw script run --file workflow.json
```

Notes:

- each step uses the same base URL, API key, config file, and MCP transport settings as the parent CLI invocation
- each step is executed sequentially
- the output is a single structured summary with per-step `stdout`, `stderr`, parsed JSON payloads, and exit codes
- use `--continue-on-error` to keep running after a failed step

## Supported Command Groups

### MCP

Use MCP commands for local discovery and tool execution:

```bash
node dist/cli/index.js mcp inspect
node dist/cli/index.js mcp call list_content_types --json '{"limit":5}'
node dist/cli/index.js mcp prompt workflow-guidance
node dist/cli/index.js mcp prompt task-guidance --json '{"taskId":"author-content"}'
node dist/cli/index.js mcp call guide_task --json '{"taskId":"discover-deployment"}'
node dist/cli/index.js mcp call guide_task --json '{"taskId":"discover-workspace"}'
node dist/cli/index.js mcp call guide_task --json '{"taskId":"manage-integrations"}'
node dist/cli/index.js mcp call guide_task --json '{"taskId":"verify-provenance","entityType":"content_item","entityId":123}'
node dist/cli/index.js mcp resource content://types
node dist/cli/index.js mcp resource system://deployment-status
node dist/cli/index.js mcp resource system://workspace-context
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
- `mcp inspect` now also includes the deployment manifest, deployment status, current actor snapshot, and workspace context when the MCP server exposes `system://capabilities`, `system://deployment-status`, `system://current-actor`, and `system://workspace-context`
- `mcp call guide_task ...` returns live, actor-aware guidance from MCP for deployment discovery, workspace targeting, authoring, review, integrations, provenance checks, and paid-content flows

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

### Workspace Guidance

Use the workspace guide when an agent needs to discover which schemas are actually available in the current domain before choosing an authoring or review target:

```bash
node dist/cli/index.js workspace guide
node dist/cli/index.js workspace guide --intent review --limit 5
node dist/cli/index.js workspace guide --intent authoring --search article
node dist/cli/index.js workspace resolve --intent review
node dist/cli/index.js workspace resolve --intent authoring --search article
```

The guide combines:

- the current actor snapshot from `/api/identity`
- the authenticated workspace inventory from `/api/workspace-context`

The result tells you:

- which domain the current actor is bound to
- which domains are selectable for the current actor profile
- which content models exist in the current domain
- which models already have content, active workflows, pending review tasks, or active type-level paid offers
- which grouped authoring, workflow, review, and paid-content targets are the best next candidates
- how to narrow the workspace view by `intent`, `search`, and `limit` when the agent already knows the task class
- which concrete `content guide`, `content list`, and `workflow active` commands to run next
- which single resolved target includes the next concrete work target, such as a review task, workflow, authoring schema, or paid content item

When the agent already knows the task class and only needs the resolved target for that intent, use:

```bash
node dist/cli/index.js workspace resolve --intent review
node dist/cli/index.js workspace resolve --intent authoring --search article
```

`workspace resolve` now returns both:

- the best schema target for the chosen intent
- `workTarget`, which points at the next concrete unit of work inside that schema

The resolver now prioritizes the strongest actionable candidate across the active workspace. For example, an actionable review task in one schema outranks a busier schema if that busier backlog is blocked for the current actor.

Depending on the intent, `workTarget.kind` can be:

- `content-type`
- `review-task`
- `workflow`
- `paid-content-item`

### Integration Guidance

Use the integrations guide when an agent needs to manage API keys or outbound webhooks without manually discovering the relevant REST endpoints:

```bash
node dist/cli/index.js integrations guide
```

The guide combines:

- the current actor snapshot from `/api/identity`
- current API key inventory from `/api/auth/keys`
- current webhook inventory from `/api/webhooks`

The result tells you:

- whether the current actor can manage integration resources
- how many active/revoked API keys already exist
- how many active/inactive webhooks are registered
- which concrete REST commands to run next for key creation, rotation, and webhook registration

### Audit and Provenance Guidance

Use the audit guide when an agent needs to prove who changed something, inspect recent actions by a specific actor, or trace a content/workflow mutation back through the audit trail:

```bash
node dist/cli/index.js audit list --entity-type content_item --entity-id 345 --limit 10
node dist/cli/index.js audit guide --entity-type content_item --entity-id 345
node dist/cli/index.js audit guide --actor-id api_key:12 --actor-type api_key --limit 20
```

The guide combines:

- the current actor snapshot from `/api/identity`
- the filtered audit trail from `/api/audit-logs`

The result tells you:

- whether the current actor can inspect audit records
- which actor profile and scopes are expected for provenance work
- which filters are currently applied
- which recent audit records already match those filters
- which concrete CLI commands to run next

### Capability Manifest

Use the deployment manifest when an agent needs to discover what this WordClaw instance actually supports before choosing a protocol or auth path:

```bash
node dist/cli/index.js capabilities show
node dist/cli/index.js capabilities status
node dist/cli/index.js caps show --raw
node dist/cli/index.js capabilities whoami
```

The manifest reports:

- required vs compatibility protocol surfaces
- live deployment readiness across database, REST, MCP, and enabled background workers
- MCP transport behavior
- auth and domain-context expectations
- reusable actor profiles for API keys, supervisor sessions, local MCP, and public discovery
- enabled core and experimental modules
- the current core capability matrix and dry-run support
- task-oriented routing hints and recommended recipes for common agent jobs
- a workspace-context discovery path for domains and content-model targeting after authentication
- a dedicated provenance-verification recipe with audit-scope expectations

When you need to confirm the active credential before a mutation, use:

```bash
node dist/cli/index.js capabilities whoami
node dist/cli/index.js mcp whoami
```

When you need to confirm the deployment is healthy enough to act against, use:

```bash
node dist/cli/index.js capabilities status
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
node dist/cli/index.js content list --content-type-id 12 --limit 20 --cursor <nextCursor>
node dist/cli/index.js content guide --content-type-id 12
node dist/cli/index.js content ls --status draft --raw
node dist/cli/index.js content get --id 345
node dist/cli/index.js content create --content-type-id 12 --data-file item.json
node dist/cli/index.js content update --id 345 --data-json '{"title":"Updated"}'
node dist/cli/index.js content versions --id 345
node dist/cli/index.js content rollback --id 345 --version 2 --dry-run
node dist/cli/index.js content delete --id 345
```

Supported features:

- actor-aware authoring guidance for a target content schema
- filtered list views
- cursor pagination via `--cursor` for large result sets
- item reads
- create and update mutations
- version history
- rollback
- delete
- dry-run mode where the REST API supports it

`content guide` is the quickest way for an agent to prepare a write. It combines:

- the current actor snapshot from `/api/identity`
- the selected content type schema from `/api/content-types/:id`
- the active workflow, if any, from `/api/content-types/:id/workflows/active`

The guide tells you:

- whether the current actor can write against this schema
- which top-level fields are required
- an example draft payload shape
- whether an active review workflow exists
- the recommended dry-run, create, and submit-for-review commands

### Workflow and Review

```bash
node dist/cli/index.js workflow active --content-type-id 12
node dist/cli/index.js workflow guide
node dist/cli/index.js workflow guide --task 88
node dist/cli/index.js workflow submit --id 345 --transition 9 --assignee editor-1
node dist/cli/index.js workflow tasks
node dist/cli/index.js workflow decide --id 88 --decision approved
```

Supported features:

- inspect the active workflow for a content type
- generate an actor-aware guide for pending review tasks
- submit a content item for review
- list pending review tasks
- approve or reject review tasks

`workflow guide` includes the current actor snapshot, supported review actor profiles, required scopes, assignment refs, and per-task decision readiness. Prefer canonical actor IDs from `capabilities whoami` or `mcp whoami` when setting `--assignee`; the runtime now accepts both canonical actor IDs and legacy key-id strings for review decisions.

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
