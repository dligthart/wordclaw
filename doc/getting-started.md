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
   npx drizzle-kit push
   ```

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

## Explore the API

- **Swagger UI**: http://localhost:4000/documentation
- **GraphiQL**: http://localhost:4000/graphql

## Running Tests

```bash
# Unit and contract tests
npm test

# Integration tests (requires running server)
RUN_INTEGRATION=1 npm test
```
