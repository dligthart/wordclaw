# WordClaw

<p align="center">
    <picture>
        <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/dligthart/wordclaw/main/doc/images/logos/wordclaw.png">
        <img src="https://raw.githubusercontent.com/dligthart/wordclaw/main/doc/images/logos/wordclaw.png" alt="WordClaw Logo" width="300">
    </picture>
</p>

[![Node.js CI](https://github.com/dligthart/wordclaw/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/dligthart/wordclaw/actions/workflows/test.yml)

**WordClaw** is a safe content runtime for AI agents and human supervisors. It combines structured content contracts, approval-aware workflows, dry-run safety, auditability, and agent-native access patterns so autonomous systems can operate on content without losing governance.

## 🚀 Features

### Core Today

-   **Structured Content**: JSON schema-based content types with runtime validation, version history, and rollback.
-   **Agent-Friendly API**: REST responses include `recommendedNextAction`, `availableActions`, and `actionPriority` to guide automated clients.
-   **REST + MCP Surfaces**: Primary agent access paths with strong content and governance semantics.
-   **Governance by Default**: Dry-run support, approval workflows, audit logs, idempotency, and multi-tenant isolation.
-   **Native Payments**: Built-in L402 offer, purchase, entitlement, and Lightning-gated read flows for machine-native paid access.
-   **Supervisor Control Plane**: Human oversight for content, schemas, approvals, audit, and API key management.

### Optional Modules

-   **Native Vector & RAG**: Built-in pgvector embeddings generation and semantic search for AI agents.

### Compatibility / Experimental

-   **GraphQL**: Available in the current runtime as a compatibility surface.
-   **Incubating Ideas**: AP2, payouts, recommender systems, sandbox showcases, marketplace-oriented demos, and broader agent-economy features are not part of the default supported product path.

## 🛠️ Prerequisites

-   **Node.js**: v20 or higher
-   **Docker**: For running the PostgreSQL database (via `docker-compose`)

## 📦 Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/dligthart/wordclaw.git
    cd wordclaw
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Configure Environment**:
    Copy the example environment file and adjust as needed:
    ```bash
    cp .env.example .env
    ```
    Ensure `.env` contains:
    ```env
    PORT=4000
    DATABASE_URL=postgres://postgres:postgres@localhost:5432/wordclaw
    AUTH_REQUIRED=true
    ALLOW_INSECURE_LOCAL_ADMIN=false
    OPENAI_API_KEY=
    API_KEYS=writer=content:read|content:write|audit:read,reader=content:read|audit:read
    ENABLE_EXPERIMENTAL_REVENUE=false
    ENABLE_EXPERIMENTAL_DELEGATION=false
    ENABLE_EXPERIMENTAL_AGENT_RUNS=false
    AGENT_RUN_WORKER_INTERVAL_MS=1000
    AGENT_RUN_WORKER_BATCH_SIZE=25
    ```
    `OPENAI_API_KEY` is required for semantic search endpoints (`/api/search/semantic`). If unset, semantic search returns a clear disabled response and write-side embedding sync is skipped. `ALLOW_INSECURE_LOCAL_ADMIN` stays `false` by default and should only ever be enabled for local manual development when you intentionally want to bypass API-key auth. `ENABLE_EXPERIMENTAL_REVENUE`, `ENABLE_EXPERIMENTAL_DELEGATION`, and `ENABLE_EXPERIMENTAL_AGENT_RUNS` remain `false` by default and should only be enabled if you explicitly want those incubator surfaces available. When experimental agent runs are enabled, `AGENT_RUN_WORKER_INTERVAL_MS` and `AGENT_RUN_WORKER_BATCH_SIZE` control async sweep cadence and per-sweep run volume.

## 🗄️ Database Setup

WordClaw uses Docker for the database and Drizzle ORM for schema management.

1.  **Start the database**:
    ```bash
    docker-compose up -d
    ```

2.  **Apply Migrations**:
    Push the schema to the database:
    ```bash
    npx drizzle-kit migrate
    ```

## 🏃‍♂️ Usage

### Development Server

Start the API in development mode (with hot-reload):

```bash
npm run dev
```

The server will start at `http://localhost:4000`.

### CLI

WordClaw now includes a repo-native CLI for MCP and REST workflows:

```bash
# Run from source
npx tsx src/cli/index.ts mcp inspect
npx tsx src/cli/index.ts content-types list --limit 10
npx tsx src/cli/index.ts ct ls --limit 10 --raw
npx tsx src/cli/index.ts content create --content-type-id 1 --data-file item.json

# Or build first and run the compiled CLI
npm run build
node dist/cli/index.js mcp smoke
node dist/cli/index.js l402 offers --item 123
```

The CLI is JSON-first so agents can script it reliably, and `--raw` is available when you want only the response body or MCP text. It supports:
- MCP discovery, direct tool calls, prompt reads, resource reads, and smoke testing
- REST content type and content item CRUD
- REST workflow submission and approval decisions
- REST L402 consumption flows for offers, purchase confirmation, entitlements, and paid reads

Use environment variables for REST auth:

```bash
export WORDCLAW_BASE_URL=http://localhost:4000
export WORDCLAW_API_KEY=writer
```

## 🎮 Demos

WordClaw includes core demos plus a clearly separated experimental sandbox in `demos/` and `scripts/`:

1. **Headless React Blog (`demos/demo-blog`)**  
   Core demo.
   A beautiful Vite + React frontend demonstrating how to fetch and join Content Types (Authors & Posts) using the WordClaw REST API.
   - Run the seeder: `node scripts/populate-demo.mjs`
   - Start the blog: `cd demos/demo-blog && npm run dev`

2. **Multi-Tenant Data Isolation (`demos/multi-tenant`)**  
   Core demo.
   A vanilla HTML/JS UI that proves WordClaw's strict Domain-level data isolation. It swaps API keys between "Acme Corp" and "Globex Inc" to fetch segmented data.
   - Run the provisioner: `npx tsx scripts/setup-multi-tenant.ts`
   - Start the UI: `cd demos/multi-tenant && python3 -m http.server 5175`

3. **L402 Agent Payment Demo (`demos/agent-l402-demo.ts`)**  
   Core payments demo.
   An autonomous TypeScript agent that encounters a `402 Payment Required` L402 invoice when trying to publish a Guest Post. It programmatically parses the Macaroon, dummy-pays the Lightning invoice, and retries the request successfully.
   - Run the demo: `npx tsx demos/agent-l402-demo.ts`

4. **MCP Demo Agent (`demos/mcp-demo-agent.ts`)**  
   Core demo.
   A headless MCP client that starts the local WordClaw MCP server over stdio, discovers tools/resources/prompts, and runs a smoke suite across content, workflow, prompts, audit, API key, and webhook features.
   - Inspect the MCP surface: `npx tsx demos/mcp-demo-agent.ts inspect`
   - Run the smoke suite: `npx tsx demos/mcp-demo-agent.ts smoke`
   - Call one tool directly: `npx tsx demos/mcp-demo-agent.ts call list_content_types '{"limit":5}'`

5. **Paid Capability Library (`demos/agent-skills-marketplace`)**  
   Experimental demo aligned to current runtime behavior.
   A frontend showcase for the supported paid-content flow: published capability items, offers, entitlement activation, L402 confirmation, and local execution after unlock. It remains a demo surface, not the main product story.
   - Run the setup script: `npx tsx scripts/setup-skills-marketplace.ts`
   - Start the demo: `cd demos/agent-skills-marketplace && npm run dev`

## 📚 Documentation

For detailed guides on setting up the Supervisor UI, authentication, testing, and system architecture, please refer to the `doc/` directory:

- [Getting Started Guide](doc/tutorials/getting-started.md) — Frontend UI setup, API authentication, testing, and environment setup.
- [Drizzle Migrations Guide](doc/reference/drizzle-migrations.md) — How to generate/apply/push schema migrations safely.
- [Architecture Overview](doc/reference/architecture.md) — System layer breakdown and data models.
- [Features Outline](doc/concepts/features.md) — Content API and Human Supervisor Web Interface capabilities.
- [MCP Integration](doc/guides/mcp-integration.md) — Model Context Protocol implementation details.

WordClaw MCP is available both as a local stdio server (`npm run mcp:start`) and as a remote Streamable HTTP endpoint at `/mcp` when the main HTTP server is running.
- [Feature Proposals (RFCs)](doc/rfc) — Methodology and history of proposed platform features.

### API Documentation

Interactive Swagger/OpenAPI documentation is natively available while running the dev server:

[http://localhost:4000/documentation](http://localhost:4000/documentation)

When experimental agent runs are enabled, the runtime also exposes operational endpoints for the worker:
- `GET /api/agent-runs/metrics`
- `GET /api/agent-runs/worker-status`

## 🤝 Contributing

1.  Fork the repository.
2.  **For major features or architectural changes:** First, submit an RFC (Request for Comments) by copying `doc/rfc/0000-rfc-template.md` and opening a PR to discuss the design.
3.  Create a feature branch.
4.  Commit your changes.
5.  Push to the branch.
6.  Open a Pull Request.

## 📄 License

[MIT](LICENSE)
