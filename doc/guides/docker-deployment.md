# Docker Deployment

Use this guide when you want to run WordClaw through containers instead of a
source checkout.

## Local Compose Stack

The fastest full-stack path is:

```bash
docker compose --profile app up --build
```

This starts PostgreSQL plus the production API container and serves WordClaw on:

- `http://localhost:4000/api`
- `http://localhost:4000/mcp`
- `http://localhost:4000/ui`

If you also set `ENABLE_DOCS=true`, the Swagger UI is available at `http://localhost:4000/documentation`.

By default, the container runs database migrations on startup.

## Published GHCR Image

The GitHub publish workflow pushes:

- `ghcr.io/dligthart/wordclaw:main`
- `ghcr.io/dligthart/wordclaw:latest` from the default branch
- `ghcr.io/dligthart/wordclaw:vX.Y.Z` for version tags

Example:

```bash
docker run --rm -p 4000:4000 \
  -e DATABASE_URL=postgres://postgres:postgres@host.docker.internal:5432/wordclaw \
  -e AUTH_REQUIRED=true \
  -e API_KEYS=writer=content:read|content:write|audit:read \
  ghcr.io/dligthart/wordclaw:main
```

## Migration Control

Set this when you want to manage schema changes outside container startup:

```bash
RUN_DB_MIGRATIONS=false
```

## Production Notes

- Review [Runtime Configuration](../reference/runtime-configuration.md) before deploying shared environments.
- Production startup validation now fails fast with one combined error when required env vars are missing instead of surfacing them through multiple crash loops.
- The minimum production secret set is:
  - `JWT_SECRET`
  - `COOKIE_SECRET`
- Payment-provider requirements depend on your production choice:
  - leaving `PAYMENT_PROVIDER` unset keeps Lightning disabled in production so the runtime can start without LNBits
  - `PAYMENT_PROVIDER=lnbits` requires both `LNBITS_BASE_URL` and `LNBITS_ADMIN_KEY`
  - `PAYMENT_PROVIDER=lnbits` or `PAYMENT_PROVIDER=mock` also require `L402_SECRET`
  - `PAYMENT_PROVIDER=mock` is only allowed for controlled testing and also requires `ALLOW_MOCK_PROVIDER_IN_PRODUCTION=true`
- After startup, check `GET /api/deployment-status` or `wordclaw capabilities status`. If the runtime reports `domainCount: 0`, bootstrap the first domain before trying to create content types or content items with `wordclaw domains create --name <value> --hostname <value>`, MCP `create_domain`, or REST `POST /api/domains`.
- If you want semantic search, set `OPENAI_API_KEY` before startup.
- If you need stable preview links across restarts, set `PREVIEW_TOKEN_SECRET`.
- `GET /documentation` is disabled in production unless `ENABLE_DOCS=true`.
- The published GHCR image now includes the built supervisor UI at `/ui`. Source-checkout API runs still need `npm --prefix ui run build` if you want the Fastify process to serve UI assets directly.

## Next Steps

- [Getting Started](../tutorials/getting-started.md)
- [MCP Integration](./mcp-integration.md)
- [API Reference](../reference/api-reference.md)
