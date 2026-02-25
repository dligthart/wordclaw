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
   | `AUTH_REQUIRED` | `false`                                          | Require API key authentication   |
   | `API_KEYS`      | *(see .env.example)*                             | Comma-separated key definitions  |

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

## Start the MCP Server

For AI agent integration over stdio:

```bash
npm run mcp:start
```

## Supervisor Web Interface

WordClaw includes a built-in Human Supervisor Web Interface built with SvelteKit for managing content models, agent API keys, and reviewing audit logs/content approvals.

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
Cross-protocol capability parity is documented in [mcp-integration.md](../guides/mcp-integration.md) and validated in the default `npm test` run to ensure REST, GraphQL, and MCP tools remain synced.
