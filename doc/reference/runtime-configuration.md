# Runtime Configuration

WordClaw reads its runtime settings from environment variables. Start with the
repo's `.env.example`:

```bash
cp .env.example .env
```

Use this page as the durable reference for what the runtime actually honors.

## Core Runtime

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | HTTP server port |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/wordclaw` | Postgres connection string |
| `AUTH_REQUIRED` | `true` | Requires API-key auth on `/api` routes |
| `ALLOW_INSECURE_LOCAL_ADMIN` | `false` | Local-only escape hatch for manual development without API keys |
| `API_KEYS` | `writer=content:read|content:write|audit:read,reader=content:read|audit:read` | Comma-separated key to scope map |

Notes:

- `AUTH_REQUIRED=false` only relaxes public discovery. Write-capable routes still require a credential unless `ALLOW_INSECURE_LOCAL_ADMIN=true` is also enabled in a non-production environment.
- Fresh installs still need a first domain before content-type or content-item writes will succeed. Check `GET /api/deployment-status` or call `guide_task("bootstrap-workspace")` to see whether bootstrap is still blocked.

## Semantic Search and Embeddings

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | unset | Enables semantic search and published-content embedding sync |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model name |
| `OPENAI_EMBEDDING_MAX_PER_MINUTE` | `30` | Soft request-rate guardrail |
| `OPENAI_EMBEDDING_DAILY_BUDGET` | `2000` | Advisory daily embedding budget |
| `OPENAI_EMBEDDING_RETRIES` | `3` | Retry attempts for embedding requests |
| `OPENAI_EMBEDDING_RETRY_BASE_MS` | `500` | Base retry backoff |

Notes:

- When `OPENAI_API_KEY` is not configured, WordClaw keeps the semantic layer disabled and reports that state in `GET /api/capabilities`, `GET /api/deployment-status`, and content/global `embeddingReadiness`.
- Deployment health exposes live embedding runtime state under `checks.embeddings`.

## Preview and Authoring

| Variable | Default | Purpose |
| --- | --- | --- |
| `PREVIEW_TOKEN_SECRET` | unset | Signing secret for content/global preview tokens |
| `PREVIEW_TOKEN_TTL_SECONDS` | `900` | Default preview-token lifetime |

Notes:

- In production, `PREVIEW_TOKEN_SECRET` must be set. In development, WordClaw can generate an ephemeral secret, but that is not stable across restarts.
- Preview tokens are scoped to one content item or one global and are intended for review/preview loops, not as a general-purpose auth bypass.

## Asset Storage

| Variable | Default | Purpose |
| --- | --- | --- |
| `ASSET_STORAGE_PROVIDER` | `local` | Asset backend: `local` or `s3` |
| `ASSET_STORAGE_ROOT` | `./storage/assets` | Local asset root directory |
| `ASSET_S3_BUCKET` | unset | S3-compatible bucket name |
| `ASSET_S3_REGION` | unset | S3-compatible region |
| `ASSET_S3_ACCESS_KEY_ID` | unset | S3-compatible access key |
| `ASSET_S3_SECRET_ACCESS_KEY` | unset | S3-compatible secret key |
| `ASSET_S3_ENDPOINT` | unset | Optional custom endpoint for S3-compatible providers |
| `ASSET_S3_FORCE_PATH_STYLE` | `false` | Force path-style addressing, useful for MinIO/R2-style setups |
| `ASSET_SIGNED_TTL_SECONDS` | `300` | Default signed-read URL lifetime |
| `ASSET_DIRECT_UPLOAD_TTL_SECONDS` | `900` | Direct-provider upload URL/token lifetime |

Notes:

- If `ASSET_STORAGE_PROVIDER=s3` is configured without the required bucket, region, and credentials, WordClaw falls back to the local provider and reports the fallback through capability and deployment discovery.
- `ASSET_S3_ENDPOINT` and `ASSET_S3_FORCE_PATH_STYLE=true` are useful for S3-compatible providers such as Cloudflare R2 or MinIO.

## Payments

| Variable | Default | Purpose |
| --- | --- | --- |
| `PAYMENT_PROVIDER` | `mock` in development, `lnbits` in production | Payment backend |
| `PAYMENT_PROVIDER_TIMEOUT_MS` | `10000` | Provider request timeout |
| `LNBITS_BASE_URL` | unset | LNBits base URL when `PAYMENT_PROVIDER=lnbits` |
| `LNBITS_ADMIN_KEY` | unset | LNBits admin key when `PAYMENT_PROVIDER=lnbits` |
| `ALLOW_MOCK_PROVIDER_IN_PRODUCTION` | `false` | Controlled testing override for mock provider in production |

Notes:

- In production, the mock provider is blocked unless `ALLOW_MOCK_PROVIDER_IN_PRODUCTION=true` is explicitly set.
- When `PAYMENT_PROVIDER=lnbits`, both `LNBITS_BASE_URL` and `LNBITS_ADMIN_KEY` are required.

## Experimental Modules

| Variable | Default | Purpose |
| --- | --- | --- |
| `ENABLE_EXPERIMENTAL_REVENUE` | `false` | Enables payout and earnings-related surfaces |
| `ENABLE_EXPERIMENTAL_DELEGATION` | `false` | Enables entitlement delegation surfaces |
| `ENABLE_EXPERIMENTAL_AGENT_RUNS` | `false` | Enables autonomous-run APIs and MCP tools |
| `AGENT_RUN_WORKER_INTERVAL_MS` | `1000` | Autonomous-run worker sweep interval |
| `AGENT_RUN_WORKER_BATCH_SIZE` | `25` | Maximum runs processed per sweep |

These flags stay off by default. Treat them as opt-in incubator surfaces rather than part of the default supported runtime.

## Recommended Discovery Flow

After changing configuration, verify the runtime through the discovery surfaces
instead of guessing from logs:

```bash
curl http://localhost:4000/api/capabilities
curl http://localhost:4000/api/deployment-status
```

Useful follow-up docs:

- [Getting Started](../tutorials/getting-started.md)
- [Docker Deployment](../guides/docker-deployment.md)
- [CLI Guide](../guides/cli-guide.md)
- [MCP Integration](../guides/mcp-integration.md)
