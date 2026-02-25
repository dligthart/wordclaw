# WordClaw

<p align="center">
    <picture>
        <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/dligthart/wordclaw/main/doc/images/logos/wordclaw.png">
        <img src="https://raw.githubusercontent.com/dligthart/wordclaw/main/doc/images/logos/wordclaw.png" alt="WordClaw Logo" width="300">
    </picture>
</p>

[![Node.js CI](https://github.com/dligthart/wordclaw/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/dligthart/wordclaw/actions/workflows/test.yml)

**WordClaw** is an AI-first Headless CMS designed to bridge the gap between human content creation and AI agent consumption. It features standardized API responses with action guidance, a built-in Model Context Protocol (MCP) server, and robust safety features like dry-run modes.

## 🚀 Features

-   **AI-Friendly API**: REST endpoints return `recommendedNextAction`, `availableActions`, and `actionPriority` to guide agents.
-   **Native Vector & RAG**: Built-in pgvector embeddings generation and semantic search for AI agents.
-   **Agentic Monetization (L402)**: Micropayment gates using Lightning invoices.
-   **Multi-Tenant Data Isolation**: Secure domain-level data segregation across all APIs.
-   **Runtime Content Validation**: Content item payloads are validated against content-type JSON schema at runtime.
-   **Policy-Aware API Auth**: Optional API key auth with deterministic scope errors for agent remediation.
-   **Protocol Parity**: REST, GraphQL, and MCP capabilities are mapped and enforced via automated parity tests.
-   **Structured Content**: Flexible JSON schema-based content types.
-   **Developer Ready**: Built with Fastify, TypeScript, and Drizzle ORM.
-   **Database Agnostic**: Supports PostgreSQL (production) and others via Drizzle.

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
    ```
    `OPENAI_API_KEY` is required for semantic search endpoints (`/api/search/semantic`). If unset, semantic search returns a clear disabled response and write-side embedding sync is skipped.

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

WordClaw comes with several built-in interactive demos located in the `demos/` and `scripts/` directories to showcase its capabilities:

1. **Headless React Blog (`demos/demo-blog`)**
   A beautiful Vite + React frontend demonstrating how to fetch and join Content Types (Authors & Posts) using the WordClaw REST API.
   - Run the seeder: `node scripts/populate-demo.mjs`
   - Start the blog: `cd demos/demo-blog && npm run dev`

2. **Multi-Tenant Data Isolation (`demos/multi-tenant`)**
   A vanilla HTML/JS UI that proves WordClaw's strict Domain-level data isolation. It swaps API keys between "Acme Corp" and "Globex Inc" to fetch segmented data.
   - Run the provisioner: `npx tsx scripts/setup-multi-tenant.ts`
   - Start the UI: `cd demos/multi-tenant && python3 -m http.server 5175`

3. **L402 Agent Payment Demo (`demos/agent-l402-demo.ts`)**
   An autonomous TypeScript agent that encounters a `402 Payment Required` L402 invoice when trying to publish a Guest Post. It programmatically parses the Macaroon, dummy-pays the Lightning invoice, and retries the request successfully.
   - Run the demo: `npx tsx demos/agent-l402-demo.ts`

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
