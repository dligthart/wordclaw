# Getting Started

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
   | `AUTH_REQUIRED` | `true`                                           | Require API key authentication   |
   | `ALLOW_INSECURE_LOCAL_ADMIN` | `false`                            | Local-only escape hatch for development without API keys |
   | `API_KEYS`      | *(see .env.example)*                             | Comma-separated key definitions  |
   | `ENABLE_EXPERIMENTAL_REVENUE` | `false`                           | Enable experimental earnings and payout surfaces |
   | `ENABLE_EXPERIMENTAL_DELEGATION` | `false`                        | Enable experimental entitlement delegation APIs |
   | `ENABLE_EXPERIMENTAL_AGENT_RUNS` | `false`                         | Enable experimental autonomous-run APIs and MCP tools |
   | `AGENT_RUN_WORKER_INTERVAL_MS` | `1000`                          | Sweep interval for experimental autonomous-run execution |
   | `AGENT_RUN_WORKER_BATCH_SIZE` | `25`                             | Maximum runs processed per autonomous-run worker sweep |

   `OPENAI_API_KEY` is required for semantic search endpoints (`/api/search/semantic`). `ALLOW_INSECURE_LOCAL_ADMIN` should stay `false` unless you are intentionally running a local-only dev environment without API keys. The three `ENABLE_EXPERIMENTAL_*` flags stay off by default and should only be enabled if you explicitly want those incubator surfaces available. If you enable experimental autonomous runs, the worker interval and batch-size knobs let you tune execution cadence without changing code.

5. **Run database migrations**

   ```bash
   npx drizzle-kit migrate
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

## Start the Local MCP Server

For AI agent integration over local stdio:

```bash
npm run mcp:start
```

For attachable remote MCP clients, use the main HTTP server and connect to:

```text
http://localhost:4000/mcp
```

## Use the CLI

The repo also ships with a JSON-first CLI for MCP and REST automation:

```bash
# Source mode
npx tsx src/cli/index.ts mcp inspect
npx tsx src/cli/index.ts mcp inspect --mcp-transport http --api-key writer
npx tsx src/cli/index.ts capabilities show
npx tsx src/cli/index.ts l402 guide --item 123
npx tsx src/cli/index.ts content-types list --limit 10
npx tsx src/cli/index.ts ct ls --limit 10 --raw

# Built mode
npm run build
node dist/cli/index.js content list --limit 10
```

Recommended environment variables:

```bash
export WORDCLAW_BASE_URL=http://localhost:4000
export WORDCLAW_API_KEY=writer
```

Use `node dist/cli/index.js --help` (or `npx tsx src/cli/index.ts --help`) to see the available command groups for capability discovery, MCP, REST, workflows, and L402. The CLI also supports shorthand aliases like `caps`, `ct ls`, and `content ls`, typo suggestions for unknown commands, and `--raw` output when you want only the response body or MCP text.

For MCP commands, the CLI defaults to local `stdio` transport. Use `--mcp-transport http` or `--mcp-url http://localhost:4000/mcp` when you want it to attach to the running remote MCP endpoint instead.

Before writing a custom client, you can inspect the deployment contract directly:

```bash
curl http://localhost:4000/api/capabilities
```

For a full walkthrough of the command groups, payload formats, agent usage patterns, and current limitations, see the [CLI Guide](../guides/cli-guide.md).

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
