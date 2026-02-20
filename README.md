# WordClaw

[![Node.js CI](https://github.com/dligthart/wordclaw/actions/workflows/test.yml/badge.svg)](https://github.com/dligthart/wordclaw/actions/workflows/test.yml)

**WordClaw** is an AI-first Headless CMS designed to bridge the gap between human content creation and AI agent consumption. It features standardized API responses with action guidance, a built-in Model Context Protocol (MCP) server, and robust safety features like dry-run modes.

## 🚀 Features

-   **AI-Friendly API**: REST endpoints return `recommendedNextAction`, `availableActions`, and `actionPriority` to guide agents.
-   **Dry-run Mode**: Simulate `POST`, `PUT`, and `DELETE` operations with `?mode=dry_run` to validate actions without side effects.
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
    AUTH_REQUIRED=false
    API_KEYS=writer=content:read|content:write|audit:read,reader=content:read|audit:read
    ```

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

## 📚 Documentation

For detailed guides on setting up the Supervisor UI, authentication, testing, and system architecture, please refer to the `doc/` directory:

- [Getting Started Guide](doc/getting-started.md) — Frontend UI setup, API authentication, testing, and environment setup.
- [Architecture Overview](doc/architecture.md) — System layer breakdown and data models.
- [Features Outline](doc/features.md) — Content API and Human Supervisor Web Interface capabilities.
- [MCP Integration](doc/mcp-integration.md) — Model Context Protocol implementation details.

### API Documentation

Interactive Swagger/OpenAPI documentation is natively available while running the dev server:

[http://localhost:4000/documentation](http://localhost:4000/documentation)

## 🤝 Contributing

1.  Fork the repository.
2.  Create a feature branch.
3.  Commit your changes.
4.  Push to the branch.
5.  Open a Pull Request.

## 📄 License

[MIT](LICENSE)
