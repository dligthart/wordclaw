# WordClaw

<p align="center">
    <picture>
        <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/dligthart/wordclaw/main/doc/images/logos/wordclaw.png">
        <img src="https://raw.githubusercontent.com/dligthart/wordclaw/main/doc/images/logos/wordclaw.png" alt="WordClaw Logo" width="300">
    </picture>
</p>

[![Node.js CI](https://github.com/dligthart/wordclaw/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/dligthart/wordclaw/actions/workflows/test.yml)

WordClaw is a safe content runtime for AI agents and human supervisors.

It combines structured content contracts, review-aware workflows, dry-run safety, auditability, paid-content flows, and agent-native REST/MCP access so autonomous systems can work with content without losing governance.

For active product direction, see the [roadmap](doc/reference/roadmap.md) and [RFC index](doc/rfc/index.md).

## What It Includes

- Structured content with JSON Schema validation, globals, localization, versioning, rollback, and published-vs-working-copy reads.
- Governance primitives such as workflows, dry-run mutation paths, audit logs, idempotency, and tenant isolation.
- Schema-aware assets, reusable forms, background jobs, preview tokens, and reverse-reference inspection.
- REST-first and MCP-first agent surfaces, plus a supervisor UI for oversight.
- Optional semantic search via pgvector and embeddings when `OPENAI_API_KEY` is configured.

For the fuller capability breakdown, see [Features](doc/concepts/features.md).

## Quick Start

```bash
git clone https://github.com/dligthart/wordclaw.git
cd wordclaw
npm install
cp .env.example .env
docker compose up -d
npm run db:migrate
npm run dev:all
```

That gives you:

- API: `http://localhost:4000/api`
- Swagger/OpenAPI docs: `http://localhost:4000/documentation`
- MCP endpoint: `http://localhost:4000/mcp`
- Supervisor UI (dev): `http://localhost:5173/ui/`

Verify the runtime:

```bash
curl http://localhost:4000/health
curl http://localhost:4000/api/deployment-status
```

If `deployment-status` reports `domainCount: 0`, bootstrap the first domain before creating content types or content items:

```bash
curl -X POST http://localhost:4000/api/domains \
  -H "Content-Type: application/json" \
  -d '{"name":"Local Development","hostname":"local.development"}'
```

The step-by-step version lives in [Getting Started](doc/tutorials/getting-started.md).

## First Commands

```bash
npx tsx src/cli/index.ts mcp inspect --mcp-transport http --api-key writer
npx tsx src/cli/index.ts workspace guide
npx tsx src/cli/index.ts content guide
npx tsx src/cli/index.ts content guide --content-type-id 1
```

Use `content guide` without `--content-type-id` when you need to bootstrap a new schema first. It now returns starter guidance for agent memory, task-log, and checkpoint-style content models.

Live verification helpers now live under `scripts/verification/` and are exposed as `npm run verify:*` commands.

## Documentation

### Start Here

- [Getting Started](doc/tutorials/getting-started.md)
- [Runtime Configuration](doc/reference/runtime-configuration.md)
- [Docker Deployment](doc/guides/docker-deployment.md)

### Agent and Operator Surfaces

- [CLI Guide](doc/guides/cli-guide.md)
- [Claude/OpenClaw Memory + RAG](doc/guides/claude-openclaw-memory-rag.md)
- [MCP Integration](doc/guides/mcp-integration.md)
- [API Reference](doc/reference/api-reference.md)
- [LangGraph MCP Starter](doc/guides/langgraph-mcp-starter.md)

### Product and Architecture

- [Features](doc/concepts/features.md)
- [Roadmap](doc/reference/roadmap.md)
- [Architecture](doc/reference/architecture.md)
- [Data Model](doc/reference/data-model.md)
- [Native Vector RAG Guide](doc/guides/native-vector-rag.md)

### Examples and History

- [Demos](doc/guides/demos.md)
- [RFC Index](doc/rfc/index.md)

## Contributing

1. Fork the repository.
2. For major features or architecture changes, start with an RFC in `doc/rfc/`.
3. Create a feature branch.
4. Commit your changes.
5. Open a pull request.

## License

[MIT](LICENSE)
