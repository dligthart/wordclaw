# Getting Started

## Current Runtime Status

Before you start, it helps to know which parts of WordClaw are stable versus still rolling out:

- **Shipped core runtime**: structured content, versioning, workflows, audit, L402 offers and entitlements, content-runtime queries, public write lanes, TTL lifecycle archival, and the supervisor control plane.
- **Rolling out**: schema-aware media assets (RFC 0023) and reactive MCP sessions (RFC 0025). Both are already live on `main`, but their docs and optional extensions are still being tightened.
- **Experimental**: AP2, agent-run orchestration, delegation, and broader incubator surfaces remain off by default behind runtime flags.

## Prerequisites

- Node.js 20+
- Docker and Docker Compose (for PostgreSQL)

## Setup

1. **Clone the repository**

   ```bash
   git clone git@github.com:dligthart/wordclaw.git
   cd wordclaw
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Start the database**

   ```bash
   docker compose up -d
   ```

   This starts PostgreSQL 16 on port 5432 with default credentials (`postgres`/`postgres`, database `wordclaw`).

4. **Configure environment**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` as needed. Key variables:

   | Variable        | Default                                         | Description                      |
   |-----------------|--------------------------------------------------|----------------------------------|
   | `PORT`          | `4000`                                           | HTTP server port                 |
   | `DATABASE_URL`  | `postgres://postgres:postgres@localhost:5432/wordclaw` | PostgreSQL connection string     |
   | `AUTH_REQUIRED` | `true`                                           | Require API keys on `/api` routes; setting it to `false` does not make write routes anonymous by itself |
   | `ALLOW_INSECURE_LOCAL_ADMIN` | `false`                            | Local-only escape hatch for development without API keys |
   | `API_KEYS`      | *(see .env.example)*                             | Comma-separated key definitions  |
   | `ENABLE_EXPERIMENTAL_REVENUE` | `false`                           | Enable experimental earnings and payout surfaces |
   | `ENABLE_EXPERIMENTAL_DELEGATION` | `false`                        | Enable experimental entitlement delegation APIs |
   | `ENABLE_EXPERIMENTAL_AGENT_RUNS` | `false`                         | Enable experimental autonomous-run APIs and MCP tools |
   | `AGENT_RUN_WORKER_INTERVAL_MS` | `1000`                          | Sweep interval for experimental autonomous-run execution |
   | `AGENT_RUN_WORKER_BATCH_SIZE` | `25`                             | Maximum runs processed per autonomous-run worker sweep |
   | `ASSET_STORAGE_PROVIDER` | `local`                                   | Asset backend (`local` or `s3`) |
   | `ASSET_STORAGE_ROOT` | `./storage/assets`                             | Local asset storage root |
   | `ASSET_S3_BUCKET` | *(empty)*                                       | S3-compatible bucket name |
   | `ASSET_S3_REGION` | *(empty)*                                       | S3-compatible region |
   | `ASSET_SIGNED_TTL_SECONDS` | `300`                               | Default signed asset access TTL |
   | `ASSET_DIRECT_UPLOAD_TTL_SECONDS` | `900`                        | Direct-provider upload URL/completion TTL |

   `AUTH_REQUIRED=false` only relaxes public discovery. Write-capable requests still need a credential unless `ALLOW_INSECURE_LOCAL_ADMIN=true` is enabled in a non-production environment. Fresh installs also need at least one domain before creating content types or content items; check `GET /api/deployment-status` to confirm bootstrap readiness. That same deployment snapshot now reports `checks.embeddings` for semantic-index health and `checks.ui` for whether the supervisor is already being served from `/ui/` or still expects `npm run dev:all`. `OPENAI_API_KEY` is required for semantic search endpoints (`/api/search/semantic`). `ALLOW_INSECURE_LOCAL_ADMIN` should stay `false` unless you are intentionally running a local-only dev environment without API keys. The three `ENABLE_EXPERIMENTAL_*` flags stay off by default and should only be enabled if you explicitly want those incubator surfaces available. If you enable experimental autonomous runs, the worker interval and batch-size knobs let you tune execution cadence without changing code. Asset storage defaults to the local filesystem; set `ASSET_STORAGE_PROVIDER=s3` plus the corresponding bucket, region, and credentials if you want S3-compatible object storage or direct provider uploads.

5. **Run database migrations**

   ```bash
   npm run db:migrate
   ```

   For full migration workflows (`generate`, `migrate`, `push`) see [drizzle-migrations.md](../reference/drizzle-migrations.md).

6. **Start the server**

   ```bash
   # Development (hot-reload)
   npm run dev

   # Production
   npm run build && npm start
   ```

7. **Verify it works**

   ```bash
   curl http://localhost:4000/health
   ```

## Container Setup

If you want a one-command runtime instead of a source checkout, use the production Docker image:

```bash
docker compose --profile app up --build
```

This now builds the app image locally, runs migrations on startup by default, and serves WordClaw on `http://localhost:4000`.

Once the `Publish Container Image` workflow has run on GitHub, you can also pull the published image directly:

```bash
docker run --rm -p 4000:4000 \
  -e DATABASE_URL=postgres://postgres:postgres@host.docker.internal:5432/wordclaw \
  -e AUTH_REQUIRED=true \
  -e API_KEYS=writer=content:read|content:write|audit:read \
  ghcr.io/dligthart/wordclaw:main
```

Set `RUN_DB_MIGRATIONS=false` if you need to manage migrations separately from the container startup.

## Start the Local MCP Server

For AI agent integration over local stdio:

```bash
npm run mcp:start
```

For attachable remote MCP clients, use the main HTTP server and connect to:

```text
http://localhost:4000/mcp
```

If you want the API and supervisor UI together for local operator work, run:

```bash
npm run dev:all
```

## Use the CLI

The repo also ships with a JSON-first CLI for MCP and REST automation:

```bash
# Source mode
npx tsx src/cli/index.ts mcp inspect
npx tsx src/cli/index.ts mcp inspect --mcp-transport http --api-key writer
npx tsx src/cli/index.ts provision --agent claude-code --transport http --scope project
npx tsx src/cli/index.ts provision --agent cursor --transport stdio --scope project --write
npx tsx src/cli/index.ts capabilities show
npx tsx src/cli/index.ts capabilities status
npx tsx src/cli/index.ts capabilities whoami
npx tsx src/cli/index.ts workspace guide
npx tsx src/cli/index.ts content guide --content-type-id 1
npx tsx src/cli/index.ts integrations guide
npx tsx src/cli/index.ts audit guide --entity-type content_item --entity-id 123
npx tsx src/cli/index.ts workflow guide
npx tsx src/cli/index.ts l402 guide --item 123
npx tsx src/cli/index.ts repl
npx tsx src/cli/index.ts content-types list --limit 10
npx tsx src/cli/index.ts content list --content-type-id 1 --field-name title --field-op contains --field-value agent
npx tsx src/cli/index.ts content project --content-type-id 1 --group-by status --metric count
npx tsx src/cli/index.ts assets list --limit 10
npx tsx src/cli/index.ts assets create --content-file ./hero.png --mime-type image/png --access-mode signed
npx tsx src/cli/index.ts ct ls --limit 10 --raw

# Built mode
npm run build
node dist/cli/index.js content list --limit 10
node dist/cli/index.js content list --limit 10 --cursor <nextCursor>
```

Recommended environment variables:

```bash
export WORDCLAW_BASE_URL=http://localhost:4000
export WORDCLAW_API_KEY=writer
```

Use `node dist/cli/index.js --help` (or `npx tsx src/cli/index.ts --help`) to see the available command groups for capability discovery, MCP, REST, audit/provenance, workflows, and L402. The CLI also supports shorthand aliases like `caps`, `ct ls`, and `content ls`, typo suggestions for unknown commands, and `--raw` output when you want only the response body or MCP text.

After `npm run build`, you can also install the CLI as a local global binary:

```bash
npm install -g .
wordclaw --help
wordclaw content guide --help
```

To avoid repeating `--base-url`, `--api-key`, or MCP transport flags, create `.wordclaw.json` in the repo or `~/.wordclaw.json`:

```json
{
  "baseUrl": "http://localhost:4000",
  "apiKey": "writer",
  "mcpTransport": "http",
  "mcpUrl": "http://localhost:4000/mcp",
  "format": "yaml"
}
```

For repeatable multi-step automation, you can also run a JSON script:

```json
{
  "steps": [
    { "args": ["capabilities", "show"] },
    { "args": ["workspace", "guide", "--intent", "authoring"] },
    { "args": ["content", "guide", "--content-type-id", "1"] }
  ]
}
```

```bash
wordclaw script run --file workflow.json
```

For interactive exploration with the same config and auth flags, use:

```bash
wordclaw repl
```

For MCP commands, the CLI defaults to local `stdio` transport. Use `--mcp-transport http` or `--mcp-url http://localhost:4000/mcp` when you want it to attach to the running remote MCP endpoint instead.

Recommended agent preflight sequence:

```bash
# 1. Discover the deployment contract
curl http://localhost:4000/api/capabilities

# 2. Confirm the deployment is healthy enough to use
curl http://localhost:4000/api/deployment-status
node dist/cli/index.js capabilities status

# 3. Confirm the current actor before mutating state
node dist/cli/index.js capabilities whoami

# 4. Inspect the authenticated workspace before choosing a target schema
curl -H "x-api-key: <key>" http://localhost:4000/api/workspace-context
curl -H "x-api-key: <key>" "http://localhost:4000/api/workspace-context?intent=review&limit=5"
curl -H "x-api-key: <key>" "http://localhost:4000/api/workspace-target?intent=review"
node dist/cli/index.js workspace guide
node dist/cli/index.js workspace guide --intent authoring --search article
node dist/cli/index.js workspace resolve --intent review

# 5. Ask for task-specific guidance
node dist/cli/index.js content guide --content-type-id 1
node dist/cli/index.js audit guide --entity-type content_item --entity-id 123
node dist/cli/index.js workflow guide
node dist/cli/index.js integrations guide
node dist/cli/index.js l402 guide --item 123
```

Before writing a custom client, you can inspect the deployment contract directly:

```bash
curl http://localhost:4000/api/capabilities
```

For a full walkthrough of the command groups, payload formats, agent usage patterns, and current limitations, see the [CLI Guide](../guides/cli-guide.md).

For remote MCP clients, the same deployment guidance is also available in-band:

- `system://capabilities`
- `system://deployment-status`
- `system://current-actor`
- `system://workspace-context`
- `system://workspace-target/review`
- `system://agent-guidance`
- `task-guidance`
- `guide_task` with `{"taskId":"discover-deployment"}`
- `guide_task` with `{"taskId":"discover-workspace"}`
- `resolve_workspace_target` with `{"intent":"review"}`

`/api/workspace-target`, `system://workspace-target/<intent>`, and `workspace resolve --intent <intent>` now return both the best schema candidate and `workTarget`, which points at the next concrete unit of work inside that schema.

## Supervisor Web Interface

WordClaw includes a built-in Human Supervisor Web Interface built with SvelteKit for managing content models, approvals, payments, L402 readiness, API keys, and audit review. Experimental pages remain available, but they stay hidden by default so the main operator workflow stays focused on supported control-plane surfaces.

To run the frontend locally:
1. Ensure the WordClaw backend is running (`npm run dev` in the root folder).
2. Start the SvelteKit development server:
   ```bash
   cd ui
   npm run dev
   ```
3. Navigate to `http://localhost:5173` to access the Supervisor UI.

> **Note:** In production, the SvelteKit app is compiled statically (`cd ui && npm run build`) and natively served by the Fastify backend at `http://localhost:4000/ui`.

**Initial Login (Bootstrapping):**
Because WordClaw does not ship with default credentials, you must create your first supervisor account via the API. Send a POST request to your local server once it is running:

```bash
curl -X POST http://localhost:4000/api/supervisors/setup-initial \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@wordclaw.local", "password":"password123"}'
```

*(Note: this endpoint will only work if zero supervisor accounts exist.)*

## API Authentication

When `AUTH_REQUIRED=true` (in your `.env`), include an API key on `/api` requests:

```bash
# via custom header
curl -H "x-api-key: writer" http://localhost:4000/api/content-types

# or via Bearer auth
curl -H "Authorization: Bearer writer" http://localhost:4000/api/content-types
```

## Running Tests & Verification

We include utility scripts to verify the API functionality and safety features natively within the environment.

### Run Full API Verification
Tests all CRUD operations against the live database using standard `fetch`.

```bash
npx tsx verify-api.ts
```

### Run Dry-run Verification
Tests that `?mode=dry_run` returns successful simulations without modifying the database whatsoever.

```bash
npx tsx verify-dry-run.ts
```

### Unit & Contract Tests
Use Vitest to run the unit and contract testing suite.

```bash
# Unit and contract tests
npm test

# Integration tests (requires running server)
RUN_INTEGRATION=1 npm test
```

### Capability Parity Contract
Core capability coverage is documented in [mcp-integration.md](../guides/mcp-integration.md) and validated in the default `npm test` run. REST and MCP are the required core surfaces; GraphQL is checked when a capability explicitly declares compatibility coverage. Incubator APIs such as agent runs are tested separately and are not part of the default parity matrix.
