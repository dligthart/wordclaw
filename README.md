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
-   **Supervisor Control Plane**: Human oversight for content, schemas, approvals, audit, and agent-key management.

### Optional Modules

-   **Native Vector & RAG**: Built-in pgvector embeddings generation and semantic search for AI agents.
-   **L402 Monetization**: Lightning-gated offer and entitlement flows for machine-native paid access.

### Compatibility / Experimental

-   **GraphQL**: Available in the current runtime as a compatibility surface.
-   **Incubating Ideas**: AP2, payouts, marketplace-oriented demos, and broader agent-economy features are not part of the default supported product path.

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
    OPENAI_API_KEY=
    API_KEYS=writer=content:read|content:write|audit:read,reader=content:read|audit:read
    ENABLE_EXPERIMENTAL_REVENUE=false
    ENABLE_EXPERIMENTAL_DELEGATION=false
    ```
    `OPENAI_API_KEY` is required for semantic search endpoints (`/api/search/semantic`). If unset, semantic search returns a clear disabled response and write-side embedding sync is skipped. `ENABLE_EXPERIMENTAL_REVENUE` and `ENABLE_EXPERIMENTAL_DELEGATION` remain `false` by default and should only be enabled if you explicitly want those incubator surfaces available.

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
   Optional module demo.
   An autonomous TypeScript agent that encounters a `402 Payment Required` L402 invoice when trying to publish a Guest Post. It programmatically parses the Macaroon, dummy-pays the Lightning invoice, and retries the request successfully.
   - Run the demo: `npx tsx demos/agent-l402-demo.ts`

4. **Marketplace Sandbox (`demos/agent-skills-marketplace`)**  
   Experimental / incubating demo.
   An isolated sandbox for marketplace-style ideas, including AP2-adjacent revenue-routing concepts. It sits outside the default supported WordClaw product path and should not shape the main operator story.
   - Run the setup script: `npx tsx scripts/setup-skills-marketplace.ts`
   - Start the marketplace: `cd demos/agent-skills-marketplace && npm run dev`

## 📚 Documentation

For detailed guides on setting up the Supervisor UI, authentication, testing, and system architecture, please refer to the `doc/` directory:

- [Getting Started Guide](doc/tutorials/getting-started.md) — Frontend UI setup, API authentication, testing, and environment setup.
- [Drizzle Migrations Guide](doc/reference/drizzle-migrations.md) — How to generate/apply/push schema migrations safely.
- [Architecture Overview](doc/reference/architecture.md) — System layer breakdown and data models.
- [Features Outline](doc/concepts/features.md) — Content API and Human Supervisor Web Interface capabilities.
- [MCP Integration](doc/guides/mcp-integration.md) — Model Context Protocol implementation details.
- [Feature Proposals (RFCs)](doc/rfc) — Methodology and history of proposed platform features.

### API Documentation

Interactive Swagger/OpenAPI documentation is natively available while running the dev server:

[http://localhost:4000/documentation](http://localhost:4000/documentation)

## 🤝 Contributing

1.  Fork the repository.
2.  **For major features or architectural changes:** First, submit an RFC (Request for Comments) by copying `doc/rfc/0000-rfc-template.md` and opening a PR to discuss the design.
3.  Create a feature branch.
4.  Commit your changes.
5.  Push to the branch.
6.  Open a Pull Request.

## 📄 License

[MIT](LICENSE)
