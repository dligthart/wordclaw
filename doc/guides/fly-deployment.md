# Deploying WordClaw to Fly.io

This guide covers deploying WordClaw to [Fly.io](https://fly.io) using the published GHCR image with Fly Managed Postgres.

## Prerequisites

- [Fly CLI](https://fly.io/docs/flyctl/install/) installed
- Authenticated: `fly auth login`

## 1. Create the App

```bash
fly apps create your-app-name
```

## 2. Provision Postgres

### New cluster

```bash
fly mpg create --name your-app-db --region ams
fly mpg attach your-app-db --app your-app-name
```

### Existing cluster

```bash
fly mpg attach <cluster-id> --app your-app-name
# Interactive prompt: select user and database
```

`fly mpg attach` automatically sets the `DATABASE_URL` secret on your app.

> **Note:** Use `fly mpg` (Managed Postgres), not the legacy `fly postgres` commands. WordClaw migrations automatically enable the `pgvector` extension.

## 3. Set Required Secrets

WordClaw enforces strict production guards. The server will not start without these core secrets:

```bash
fly secrets set \
  API_KEYS="admin=admin|content:read|content:write|audit:read,reader=content:read|audit:read" \
  PREVIEW_TOKEN_SECRET="$(openssl rand -hex 32)" \
  JWT_SECRET="$(openssl rand -hex 32)" \
  COOKIE_SECRET="$(openssl rand -hex 32)" \
  --app your-app-name
```

By default, production starts in a non-Lightning posture when `PAYMENT_PROVIDER` is unset. If you want L402-protected payment flows, enable them explicitly:

```bash
fly secrets set \
  L402_SECRET="$(openssl rand -hex 32)" \
  PAYMENT_PROVIDER=mock \
  ALLOW_MOCK_PROVIDER_IN_PRODUCTION=true \
  --app your-app-name
```

**Optional — enable semantic search:**

```bash
fly secrets set OPENAI_API_KEY="sk-..." --app your-app-name
```

### Secret Reference

| Secret | Purpose | Required | How to generate |
|--------|---------|----------|-----------------|
| `DATABASE_URL` | Postgres connection | Yes | Auto-set by `fly mpg attach` |
| `API_KEYS` | API key → scope map | Yes | `key=scope1\|scope2,key2=scope3` |
| `PREVIEW_TOKEN_SECRET` | Signs preview tokens | Yes | `openssl rand -hex 32` |
| `JWT_SECRET` | Signs JWT auth tokens | Yes | `openssl rand -hex 32` |
| `COOKIE_SECRET` | Signs session cookies | Yes | `openssl rand -hex 32` |
| `L402_SECRET` | Signs L402 macaroons | When using `mock` or `lnbits` payments | `openssl rand -hex 32` |
| `PAYMENT_PROVIDER` | Payment backend | No | Leave unset for `disabled`, or set `mock` / `lnbits` |
| `ALLOW_MOCK_PROVIDER_IN_PRODUCTION` | Permit mock payments | When using `mock` | `true` |
| `OPENAI_API_KEY` | Embeddings for vector RAG | No | Your OpenAI key |
| `LNBITS_BASE_URL` | LNbits server URL | When using `lnbits` | Your LNbits URL |
| `LNBITS_ADMIN_KEY` | LNbits admin key | When using `lnbits` | Your LNbits key |

> **Gotcha:** If any required secret is missing, the server fails fast at startup and Fly will keep restarting it. `fly logs` will show the aggregated validation error. Set the full secret set before the first deploy to avoid iterative crash-fix cycles.

## 4. Create `fly.toml`

```toml
app = "your-app-name"
primary_region = "ams"

[build]
  image = "ghcr.io/dligthart/wordclaw:latest"

[env]
  PORT = "4000"
  AUTH_REQUIRED = "true"
  RUN_DB_MIGRATIONS = "true"
  ASSET_STORAGE_PROVIDER = "local"

[http_service]
  internal_port = 4000
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 1
  processes = ["app"]

[[vm]]
  memory = "1gb"
  cpu_kind = "shared"
  cpus = 1
```

## 5. Deploy

```bash
fly deploy
```

Database migrations run automatically on startup (`RUN_DB_MIGRATIONS=true`).

## 6. Verify

```bash
# Health — should return {"status":"ok"} (or {"status":"degraded"} on startup trouble)
curl -sf https://your-app-name.fly.dev/health | jq .

# Deployment status — check domainCount and module readiness
curl -sf https://your-app-name.fly.dev/api/deployment-status | jq .

# Capabilities — check enabled features
curl -sf https://your-app-name.fly.dev/api/capabilities | jq .
```

## 7. Bootstrap a Domain

If `deployment-status` shows `domainCount: 0`, create the first domain:

```bash
curl -X POST https://your-app-name.fly.dev/api/domains \
  -H "Content-Type: application/json" \
  -H "x-api-key: admin" \
  -d '{"name": "Production", "hostname": "your-domain.com"}'
```

Or via CLI:

```bash
npx tsx src/cli/index.ts domains create --name "Production" --hostname your-domain.com
```

If you want the domain and its first admin API key together, use `POST /api/onboard` instead of `POST /api/domains`.

## 8. Custom Domain (Optional)

Add a CNAME record in your DNS provider pointing to `your-app-name.fly.dev`, then:

```bash
fly certs create your-domain.com --app your-app-name
```

## Known Limitations

- **Swagger UI** is disabled by default in production. Set `ENABLE_DOCS=true` if you want `/documentation` exposed on Fly.
- **Supervisor UI** is included in the published GHCR image and is served from `/ui`.
- **`auto_stop_machines = "stop"`** means cold starts take ~2–3s when waking from idle. Set to `"off"` for always-on.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Crash loop on deploy | Missing production secret | Check `fly logs` for the specific error, set the missing secret |
| `PAYMENT_PROVIDER=lnbits` error | LNBits was selected without the required provider secrets | Set `LNBITS_BASE_URL` and `LNBITS_ADMIN_KEY`, or unset `PAYMENT_PROVIDER` to start with payments disabled |
| `/documentation` returns 404 | Swagger UI stays off by default in production | Set `ENABLE_DOCS=true` and redeploy |
| `domainCount: 0` | No domain bootstrapped | Create one via REST or CLI (see step 7) |
| Proxy error: not listening on 0.0.0.0 | Transient during crash loops | Fix the underlying crash; WordClaw binds to `0.0.0.0` by default |
