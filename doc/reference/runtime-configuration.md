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
| `JWT_SECRET` | unset | Supervisor-session JWT signing secret |
| `COOKIE_SECRET` | unset | Supervisor-session cookie signing secret |
| `SETUP_TOKEN` | unset | Optional one-time token required by `/api/supervisors/setup-initial` in production |
| `CORS_ALLOWED_ORIGINS` | unset | Comma-separated allowlist for cross-origin browser access |
| `RATE_LIMIT_MAX` | `100` | Default per-bucket request limit inside the active rate-limit window |
| `SUPERVISOR_RATE_LIMIT_MAX` | `500` | Higher per-session request limit for authenticated supervisor traffic |
| `RATE_LIMIT_TIME_WINDOW` | `1 minute` | Shared Fastify rate-limit window |

Notes:

- `AUTH_REQUIRED=false` only relaxes public discovery. Write-capable routes still require a credential unless `ALLOW_INSECURE_LOCAL_ADMIN=true` is also enabled in a non-production environment.
- In production, both `JWT_SECRET` and `COOKIE_SECRET` are strictly required.
- In production, set `SETUP_TOKEN` before calling `POST /api/supervisors/setup-initial`. After the first supervisor exists, create additional platform or tenant-scoped supervisors through `POST /api/supervisors`.
- Cross-origin browser access is disabled by default. Same-origin supervisor/API traffic does not need CORS headers; add `CORS_ALLOWED_ORIGINS` only when you intentionally support trusted external browser origins.
- Rate limiting is actor-aware rather than shared by IP alone. API keys and supervisor sessions each receive their own bucket, with `SUPERVISOR_RATE_LIMIT_MAX` providing a higher default allowance for authenticated first-party operator traffic.
- Fresh installs still need a first domain before content-type or content-item writes will succeed. Check `GET /api/deployment-status`, `wordclaw capabilities status`, or call `guide_task("bootstrap-workspace")` to see whether bootstrap is still blocked, then bootstrap with `wordclaw domains create`, MCP `create_domain`, or REST `POST /api/domains`.

## Semantic Search and Embeddings

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | unset | Enables semantic search and published-content embedding sync |
| `OPENAI_DRAFT_GENERATION_MODEL` | `gpt-4o` | Runtime fallback OpenAI model for tenant-scoped draft-generation jobs when neither the tenant config nor the form overrides the model |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model name |
| `OPENAI_EMBEDDING_MAX_PER_MINUTE` | `30` | Soft request-rate guardrail |
| `OPENAI_EMBEDDING_DAILY_BUDGET` | `2000` | Advisory daily embedding budget |
| `OPENAI_EMBEDDING_RETRIES` | `3` | Retry attempts for embedding requests |
| `OPENAI_EMBEDDING_RETRY_BASE_MS` | `500` | Base retry backoff |

Notes:

- When `OPENAI_API_KEY` is not configured, WordClaw keeps the semantic layer disabled and reports that state in `GET /api/capabilities`, `GET /api/deployment-status`, and content/global embedding fields such as `embeddingStatus`, `embeddingErrorCode`, and `embeddingReadiness`.
- Reusable forms now support two draft-generation modes: the deterministic mapping path, and an explicit provider-backed path. Forms can still carry a direct `agentSoul`, but the preferred shape is `draftGeneration.workforceAgentId` so a tenant-managed workforce agent supplies the SOUL and provider/model defaults.
- Provider-backed draft generation is tenant-scoped. Each tenant provisions its own provider credentials through `PUT /api/ai/providers/:provider`, `GET /api/ai/providers`, or MCP `configure_ai_provider` / `list_ai_provider_configs`, where `:provider` is currently `openai`, `anthropic`, or `gemini`.
- Tenant supervisors can provision reusable workforce agents through `POST /api/workforce/agents` or MCP `create_workforce_agent`. Each workforce agent carries a stable slug, a bounded purpose, a customizable SOUL, and provider/model defaults that future form submissions inherit.
- The supervisor Forms workspace at `/ui/forms` now exposes first-class draft-generation controls, so operators can bind a form to a target content type, a workforce agent or direct SOUL/provider override, field-map JSON, and post-generation workflow routing without hand-authoring the REST payload.
- If a form or workforce agent opts into `openai`, `anthropic`, or `gemini` without a tenant-scoped provider config, the queued draft-generation job fails with a clear provisioning error instead of silently falling back.
- `OPENAI_DRAFT_GENERATION_MODEL` is only the runtime fallback for OpenAI. Anthropic and Gemini require either a tenant default model or an explicit `provider.model` on the workforce agent or form config.
- Multimodal draft generation is intentionally image-only in the current runtime. Image assets referenced by form submissions can be inlined into OpenAI, Anthropic, and Gemini requests; non-image assets remain outside the draft-generation prompt path for now.
- `GET /api/capabilities`, `GET /api/deployment-status`, and the deployment guide expose draft-generation provisioning as tenant-managed instead of inferring readiness from a process-global AI-provider key.
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
| `PAYMENT_PROVIDER` | `mock` in development, `disabled` in production | Payment backend |
| `PAYMENT_PROVIDER_TIMEOUT_MS` | `10000` | Provider request timeout |
| `L402_SECRET` | unset | Signing secret for L402 macaroons |
| `LNBITS_BASE_URL` | unset | LNBits base URL when `PAYMENT_PROVIDER=lnbits` |
| `LNBITS_ADMIN_KEY` | unset | LNBits admin key when `PAYMENT_PROVIDER=lnbits` |
| `ALLOW_MOCK_PROVIDER_IN_PRODUCTION` | `false` | Controlled testing override for mock provider in production |

Notes:

- In production, `L402_SECRET` is required only when `PAYMENT_PROVIDER=lnbits` or `PAYMENT_PROVIDER=mock`.
- In production, the mock provider is blocked unless `ALLOW_MOCK_PROVIDER_IN_PRODUCTION=true` is explicitly set.
- When `PAYMENT_PROVIDER=lnbits`, both `LNBITS_BASE_URL` and `LNBITS_ADMIN_KEY` are required.
- When `PAYMENT_PROVIDER` is unset in production, WordClaw defaults to `disabled`, which allows the runtime to boot while returning deterministic `PAYMENT_PROVIDER_UNAVAILABLE` errors for L402-protected flows.

## Documentation Surfaces

| Variable | Default | Purpose |
| --- | --- | --- |
| `ENABLE_DOCS` | `false` in production, `true` otherwise | Enables the Swagger UI at `/documentation` |
| `ENABLE_GRAPHIQL` | `false` in production, `true` otherwise | Enables GraphiQL |
| `WORDCLAW_BUILD_VERSION` | unset | Optional authenticated override for the runtime version exposed by `GET /api/runtime` |
| `WORDCLAW_BUILD_COMMIT_SHA` | unset | Optional authenticated commit SHA exposed by `GET /api/runtime` |
| `WORDCLAW_BUILD_TIME` | unset | Optional authenticated build timestamp exposed by `GET /api/runtime` |

Notes:

- Production deployments return `404` for `/documentation` unless `ENABLE_DOCS=true`.
- The published GHCR image includes built supervisor UI assets at `/ui`. Source-checkout API runs still require `npm --prefix ui run build` when you want the Fastify process to serve the UI directly.
- `GET /api/runtime` is authenticated on purpose. Use it when operators need to confirm the exact live build without adding version metadata to the public discovery manifest.

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
wordclaw capabilities status
```

If the readiness snapshot reports `domainCount: 0`, bootstrap the first domain before content writes with `wordclaw domains create --name <value> --hostname <value>`, MCP `create_domain`, or REST `POST /api/domains`.

Useful follow-up docs:

- [Getting Started](../tutorials/getting-started.md)
- [Docker Deployment](../guides/docker-deployment.md)
- [CLI Guide](../guides/cli-guide.md)
- [MCP Integration](../guides/mcp-integration.md)
