# WordClaw

<p align="center">
    <picture>
        <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/dligthart/wordclaw/main/doc/images/logos/wordclaw.png">
        <img src="https://raw.githubusercontent.com/dligthart/wordclaw/main/doc/images/logos/wordclaw.png" alt="WordClaw Logo" width="300">
    </picture>
</p>

[![Node.js CI](https://github.com/dligthart/wordclaw/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/dligthart/wordclaw/actions/workflows/test.yml)

**WordClaw** is a safe content runtime for AI agents and human supervisors. It combines structured content contracts, schema-aware media assets, approval-aware workflows, dry-run safety, auditability, and agent-native access patterns so autonomous systems can operate on content without losing governance.

For a look ahead at what is in active development versus what is experimental, check out the [ROADMAP](ROADMAP.md).

## 🚀 Features

### Core Today

-   **Structured Content**: JSON schema-based content types with runtime validation, singleton/global modeling, field-level localization, working-copy versus published reads, version history, and rollback.
-   **Content Runtime Queries**: Schema-aware field filters, grouped projections for leaderboard and analytics-style reads, public write lanes for bounded player/session input, and TTL lifecycle archival for ephemeral content.
-   **Authoring-State Reads and Preview**: Read the current working copy by default, force the latest published snapshot with `draft=false`, and issue short-lived preview tokens for one content item or global at a time.
-   **Reverse-Reference Visibility**: Inspect which content items currently or historically reference a content item or asset before deleting, purging, or restructuring it.
-   **Schema-Aware Media Assets**: First-class asset records with schema-level references, derivative variants, multipart and direct-provider uploads, local or S3-compatible storage backends, public/signed/entitled delivery modes, and safe restore/purge lifecycle controls.
-   **Agent-Friendly API**: REST responses include `recommendedNextAction`, `availableActions`, and `actionPriority` to guide automated clients.
-   **REST + Reactive MCP Surfaces**: Primary agent access paths with strong content and governance semantics, including remote MCP subscriptions for pushed runtime events.
-   **Governance by Default**: Dry-run support, approval workflows, audit logs, idempotency, and multi-tenant isolation.
-   **Native Payments**: Built-in L402 offer, purchase, entitlement, and Lightning-gated read flows for machine-native paid access.
-   **Supervisor Control Plane**: Human oversight for content, globals, schemas, assets, approvals, audit, payments, API key management, and preview-aware review loops.

### Optional Modules

-   **Native Vector & RAG**: Built-in pgvector embeddings generation and semantic search for AI agents. See the [Native Vector RAG Guide](doc/guides/native-vector-rag.md) for details.

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
    ASSET_STORAGE_PROVIDER=local
    ASSET_STORAGE_ROOT=./storage/assets
    ASSET_S3_BUCKET=
    ASSET_S3_REGION=
    ASSET_S3_ACCESS_KEY_ID=
    ASSET_S3_SECRET_ACCESS_KEY=
    ASSET_S3_ENDPOINT=
    ASSET_S3_FORCE_PATH_STYLE=false
    ASSET_SIGNED_TTL_SECONDS=300
    ASSET_DIRECT_UPLOAD_TTL_SECONDS=900
    PREVIEW_TOKEN_SECRET=change-me
    PREVIEW_TOKEN_TTL_SECONDS=900
    PAYMENT_PROVIDER=lnbits
    LNBITS_BASE_URL=
    LNBITS_ADMIN_KEY=
    ```
    `OPENAI_API_KEY` is optional but highly recommended. Supplying it automatically enables native Vector RAG (embeddings and semantic search). `AUTH_REQUIRED=false` only relaxes public discovery; write routes still need a credential unless `ALLOW_INSECURE_LOCAL_ADMIN=true` is enabled in a non-production environment. Fresh installs also need a first domain before content-type or content-item writes will succeed. Check `GET /api/deployment-status` to confirm bootstrap readiness and use `POST /api/domains` when `domainCount` is `0`. `ALLOW_INSECURE_LOCAL_ADMIN` stays `false` by default and should only ever be enabled for local manual development when you intentionally want to bypass API-key auth.

    Asset storage defaults to `local`. To use a remote object store, set `ASSET_STORAGE_PROVIDER=s3` plus the bucket, region, and credentials shown above. `ASSET_S3_ENDPOINT` and `ASSET_S3_FORCE_PATH_STYLE=true` support S3-compatible providers such as Cloudflare R2, MinIO, or self-hosted gateways. If `s3` is configured without the required settings, WordClaw falls back to the local provider and reports the fallback through `GET /api/capabilities` and `GET /api/deployment-status`. `ASSET_DIRECT_UPLOAD_TTL_SECONDS` controls how long a provider-issued upload URL and completion token remain valid.

    Preview tokens are signed and stateless. Set `PREVIEW_TOKEN_SECRET` in every shared or production environment so preview issuance and verification stay stable across restarts. `PREVIEW_TOKEN_TTL_SECONDS` controls the default preview lifetime, bounded to 60-3600 seconds.
    
    ### L402 / Lightning Provisioning
    By default, WordClaw uses a mocked Lightning network locally. If you run WordClaw in `NODE_ENV=production`, it requires a real Lightning backend. To provision a self-hosted Lightning node, set `PAYMENT_PROVIDER=lnbits` and configure the `LNBITS_BASE_URL` (e.g. `https://your-lnbits-domain.com`) and your `LNBITS_ADMIN_KEY`.

## 🗄️ Database Setup

WordClaw uses Docker for the database and Drizzle ORM for schema management.

1.  **Start the database**:
    ```bash
    docker-compose up -d
    ```

2.  **Apply Migrations**:
    Push the schema to the database:
   ```bash
   npm run db:migrate
   ```

## 🐳 Container Deployment

WordClaw now ships with a production Docker image definition and a GHCR publish workflow.

### Run locally with Docker Compose

Start PostgreSQL and the API runtime together:

```bash
docker compose --profile app up --build
```

The `app` service now builds the production image, runs database migrations on startup by default, and serves the API on `http://localhost:4000`.

### Run the published GHCR image

The `Publish Container Image` workflow publishes:
- `ghcr.io/dligthart/wordclaw:main` on pushes to `main`
- `ghcr.io/dligthart/wordclaw:vX.Y.Z` on version tags
- `ghcr.io/dligthart/wordclaw:latest` from the default branch

Example:

```bash
docker run --rm -p 4000:4000 \
  -e DATABASE_URL=postgres://postgres:postgres@host.docker.internal:5432/wordclaw \
  -e AUTH_REQUIRED=true \
  -e API_KEYS=writer=content:read|content:write|audit:read \
  ghcr.io/dligthart/wordclaw:main
```

Set `RUN_DB_MIGRATIONS=false` if you want to handle schema changes separately.

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
npx tsx src/cli/index.ts mcp inspect --mcp-transport http --api-key writer
npx tsx src/cli/index.ts capabilities status
npx tsx src/cli/index.ts l402 guide --item 123
npx tsx src/cli/index.ts workflow guide
npx tsx src/cli/index.ts content guide --content-type-id 1
npx tsx src/cli/index.ts workspace guide
npx tsx src/cli/index.ts workspace guide --intent review --limit 5
npx tsx src/cli/index.ts repl
npx tsx src/cli/index.ts script run --file workflow.json
npx tsx src/cli/index.ts integrations guide
npx tsx src/cli/index.ts audit guide --entity-type content_item --entity-id 123
npx tsx src/cli/index.ts content-types list --limit 10
npx tsx src/cli/index.ts globals list
npx tsx src/cli/index.ts globals get --slug site-settings --published
npx tsx src/cli/index.ts ct ls --limit 10 --raw
npx tsx src/cli/index.ts content create --content-type-id 1 --data-file item.json
npx tsx src/cli/index.ts content get --id 123 --published --locale nl
npx tsx src/cli/index.ts content used-by --id 123
npx tsx src/cli/index.ts content preview-token --id 123
npx tsx src/cli/index.ts globals preview-token --slug site-settings
npx tsx src/cli/index.ts content project --content-type-id 1 --group-by category --metric count
npx tsx src/cli/index.ts content list --content-type-id 1 --include-archived
npx tsx src/cli/index.ts assets list --access-mode public --limit 10
npx tsx src/cli/index.ts assets used-by --id 44
npx tsx src/cli/index.ts assets create --content-file ./hero.png --mime-type image/png --access-mode signed

# Or build first and run the compiled CLI
npm run build
node dist/cli/index.js mcp smoke
node dist/cli/index.js l402 offers --item 123
node dist/cli/index.js assets access --id 44 --ttl-seconds 120

# Or install the compiled binary locally
npm run build
npm install -g .
wordclaw --help
wordclaw content guide --help
```

The CLI is JSON-first so agents can script it reliably, and `--raw` is available when you want only the response body or MCP text. It supports:
- MCP discovery, direct tool calls, prompt reads, resource reads, and smoke testing
- remote MCP subscriptions for reactive workflows via `subscribe_events`
- REST content type, global, and content item CRUD
- locale-aware reads plus `--published` access to the latest published snapshot for content items and globals
- preview-token issuance for scoped content item and global preview flows
- reverse-reference inspection for content items and assets
- schema-aware field queries, grouped content projections, and TTL lifecycle handling for session-like content
- public write tokens plus bounded public content writes for session-like actors
- REST asset upload, derivative variant creation/listing, direct-provider upload issuance/completion, metadata inspection, signed-access issuance, offer lookup, restore/purge lifecycle operations, and storage-provider discovery
- actor-aware content authoring guidance for a target schema
- actor-aware integration guidance for API keys and webhooks
- actor-aware provenance guidance for audit-trail inspection
- REST workflow submission and approval decisions
- actor-aware workflow review guidance for pending tasks
- REST L402 consumption flows for offers, purchase confirmation, entitlements, and paid reads
- structured output in `json` or `yaml` via `--format`
- interactive exploration via `repl`
- scriptable batch execution via `script run --file workflow.json`

MCP commands default to local `stdio`. Use `--mcp-transport http` or `--mcp-url http://localhost:4000/mcp` to attach the CLI directly to the running remote MCP endpoint instead.

Use environment variables for REST auth:

```bash
export WORDCLAW_BASE_URL=http://localhost:4000
export WORDCLAW_API_KEY=writer
```

You can also keep CLI defaults in `.wordclaw.json` in the current directory or `~/.wordclaw.json`:

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

Override the discovered config file with `--config /path/to/file.json` or `WORDCLAW_CONFIG=/path/to/file.json`.

For multi-step automation without writing a wrapper script, use a JSON command file:

```json
{
  "continueOnError": false,
  "steps": [
    { "name": "discover", "args": ["capabilities", "show"] },
    { "name": "whoami", "args": ["capabilities", "whoami"] },
    { "name": "authoring-target", "args": ["workspace", "resolve", "--intent", "authoring"] }
  ]
}
```

Run it with:

```bash
wordclaw script run --file workflow.json
```

For iterative manual exploration without retyping your flags, use:

```bash
wordclaw repl
```

### Agent Guidance & Workspaces

WordClaw APIs are natively self-describing. Instead of guessing API schemas from a flat list, agents can ask the runtime for guidance:

* **Deployment Discovery**: Use `GET /api/capabilities`, `GET /api/deployment-status`, or `mcp inspect`. The manifest reports live readiness, task-oriented routing hints, actor profiles, bootstrap blockers, effective auth posture, and vector-RAG readiness so agents can choose the correct credential and surface.
* **Identity & Context**: After authentication, use `GET /api/identity`, `GET /api/workspace-context`, `system://current-actor`, or `node dist/cli/index.js workspace guide` to confirm the actor, active domain, and available content models before mutating state.
* **Smart Targeting**: The workspace snapshot groups the best targets for authoring, workflow review, and paid consumption. Use `GET /api/workspace-target?intent=review` or `node dist/cli/index.js workspace resolve --intent review` to resolve the strongest schema-plus-work-target candidate across the active workspace for a task.
* **Live CLI Guidance**: Ask the CLI for generated, actor-aware guidance sequences:
  * Workflow reviews: `node dist/cli/index.js workflow guide`
  * Audit provenance: `node dist/cli/index.js audit guide --entity-type content_item --entity-id 123`
* **Live MCP Guidance**: Use MCP tools and resources for targeted recommendations natively within your LLM context:
  * `system://workspace-context/review/5` (Resources)
  * `resolve_workspace_target` (Tools)
  * `guide_task` (Tools): e.g., `{"taskId":"discover-workspace","intent":"review"}`

If deployment discovery reports `domainCount: 0`, bootstrap the first domain before content writes:

```bash
curl -X POST http://localhost:4000/api/domains \
  -H "x-api-key: writer" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Local Development",
    "hostname": "local.development"
  }'
```

## 🎮 Demos

WordClaw includes core demos plus a clearly separated experimental sandbox in `demos/` and `scripts/`:

1. **Headless React Blog (`demos/demo-blog`)**  
   Core demo.
   A beautiful Vite + React frontend demonstrating how to fetch and join Content Types (Authors & Posts) using the WordClaw REST API.
   - Run the seeder: `npm run demo:seed-blog`
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

5. **LangGraph MCP Starter (`demos/langgraph-mcp-starter`)**  
   Core adoption demo.
   A minimal LangGraph agent that connects to WordClaw through MCP, inspects the runtime first, and then acts through generic wrapper tools instead of a custom SDK.
   - Inspect over stdio: `npx tsx demos/langgraph-mcp-starter/index.ts inspect`
   - Inspect a running MCP endpoint: `npx tsx demos/langgraph-mcp-starter/index.ts inspect --transport http --mcp-url http://localhost:4000/mcp --api-key writer`
   - Run a LangGraph walkthrough: `OPENAI_API_KEY=sk-... npx tsx demos/langgraph-mcp-starter/index.ts demo workspace --transport http --mcp-url http://localhost:4000/mcp --api-key writer`

6. **Paid Capability Library (`demos/agent-skills-marketplace`)**  
   Experimental demo aligned to current runtime behavior.
   A frontend showcase for the supported paid-content flow: published capability items, offers, entitlement activation, L402 confirmation, and local execution after unlock. It remains a demo surface, not the main product story.
   - Run the setup script: `npx tsx scripts/setup-skills-marketplace.ts`
   - Start the demo: `cd demos/agent-skills-marketplace && npm run dev`

7. **Coinbase AgentKit L402 Demo (`demos/agentkit-l402-client.ts`)**  
   Core payments demo.
   An autonomous LangChain agent running via Coinbase AgentKit. Features a custom `ActionProvider` that bridges the LLM to Lightning to autonomously pay an L402 invoice upon receiving a `402 Payment Required` response.
   - **Note:** This demo does *not* require a Coinbase Developer Platform (CDP) API key because we supply a custom ActionProvider in place of the default CDP EVM wallets. It also uses WordClaw's local mocked Lightning preimage.
   - Run the demo: `export OPENAI_API_KEY="sk-..." && npx tsx demos/agentkit-l402-client.ts`

## 📚 Documentation

For detailed guides on setting up the Supervisor UI, authentication, testing, and system architecture, please refer to the `doc/` directory:

- [Getting Started Guide](doc/tutorials/getting-started.md) — Frontend UI setup, API authentication, testing, and environment setup.
- [Drizzle Migrations Guide](doc/reference/drizzle-migrations.md) — How to generate/apply/push schema migrations safely.
- [Architecture Overview](doc/reference/architecture.md) — System layer breakdown and data models.
- [Features Outline](doc/concepts/features.md) — Content API and Human Supervisor Web Interface capabilities.
- [LangGraph MCP Starter](doc/guides/langgraph-mcp-starter.md) — Fastest path to attach a LangGraph agent to WordClaw through MCP.
- [MCP Integration](doc/guides/mcp-integration.md) — Model Context Protocol implementation details.

WordClaw MCP is available both as a local stdio server (`npm run mcp:start`) and as a remote Streamable HTTP endpoint at `/mcp` when the main HTTP server is running.
The MCP surface exposes rich guidance paths so connected agents can discover operations without parsing massive manifests:
* **Resources:** `system://agent-guidance`, `system://deployment-status`, `system://workspace-context`, `system://workspace-target/<intent>`
* **Prompts:** `task-guidance`
* **Tools:** `guide_task`, `resolve_workspace_target`, `project_content_items`
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
