# WordClaw

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

### API Authentication (Optional but recommended)

When `AUTH_REQUIRED=true`, include an API key on `/api` requests:

```bash
curl -H "x-api-key: writer" http://localhost:4000/api/content-types
```

You can also use bearer auth:

```bash
curl -H "Authorization: Bearer writer" http://localhost:4000/api/content-types
```

### API Documentation

Interactive Swagger/OpenAPI documentation is available at:

[http://localhost:4000/documentation](http://localhost:4000/documentation)

## ✅ Verification & Testing

We include utility scripts to verify the API functionality and safety features.

### Run Full API Verification
Tests all CRUD operations against the live database.

```bash
npx tsx verify-api.ts
```

### Run Dry-run Verification
Tests that `?mode=dry_run` returns successful simulations without modifying the database.

```bash
npx tsx verify-dry-run.ts
```

### Run Integration Smoke Tests
By default, `npm test` skips integration smoke tests unless explicitly enabled.

```bash
RUN_INTEGRATION=1 npm test
```

### Capability Parity Contract
Cross-protocol capability parity is documented in `CAPABILITY_PARITY.md` and validated in the default test run.

## 🤝 Contributing

1.  Fork the repository.
2.  Create a feature branch.
3.  Commit your changes.
4.  Push to the branch.
5.  Open a Pull Request.

## 📄 License

[MIT](LICENSE)
