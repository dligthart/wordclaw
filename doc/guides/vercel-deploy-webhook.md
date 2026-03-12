# Vercel Deploy Webhook Example

This example shows how to trigger a Vercel deploy when WordClaw publishes content.

The important detail is that WordClaw emits **signed audit webhooks**, not a separate publish-only webhook type. For deploy automation, filter for `content_item` create/update events whose audit details indicate `status: "published"`.

The runnable receiver lives at [vercel-deploy-webhook.ts](/Users/daveligthart/GitHub/wordclaw/demos/vercel-deploy-webhook.ts).

## What this example handles

- verifies `x-wordclaw-signature` with the shared webhook secret
- accepts `content_item.create` and `content_item.update`
- triggers only when the audit details resolve to `status: "published"`
- supports workflow-driven publishes because approved review transitions now emit a matching `content_item` update audit event

## Prerequisites

- a running WordClaw deployment
- a public HTTPS endpoint for the receiver
  - WordClaw rejects `localhost`, `.local`, and non-HTTPS webhook URLs by design
  - for local development, use a tunnel such as Cloudflare Tunnel or ngrok
- a Vercel deploy hook URL

## Run the receiver locally

Dry-run mode lets you verify the webhook flow before calling Vercel:

```bash
WORDCLAW_WEBHOOK_SECRET=demo-secret \
DRY_RUN=true \
npx tsx demos/vercel-deploy-webhook.ts
```

By default the receiver listens on:

```text
http://127.0.0.1:4177/wordclaw/publish
```

Set `PORT` or `WEBHOOK_PATH` if you need a different listener shape.

## Register the webhook in WordClaw

Use the REST CLI to register a webhook that listens for content-item mutations:

```bash
wordclaw rest request POST /webhooks \
  --body-json '{
    "url":"https://your-public-endpoint.example/wordclaw/publish",
    "events":["content_item.create","content_item.update"],
    "secret":"demo-secret"
  }'
```

You can confirm registration with:

```bash
wordclaw integrations guide
wordclaw rest request GET /webhooks
```

## Turn on real Vercel deploys

Once the dry-run flow looks correct, provide the Vercel deploy hook:

```bash
WORDCLAW_WEBHOOK_SECRET=demo-secret \
VERCEL_DEPLOY_HOOK_URL=https://api.vercel.com/v1/integrations/deploy/...
npx tsx demos/vercel-deploy-webhook.ts
```

When a matching publish event arrives, the receiver forwards a small JSON payload to Vercel and returns `202 Accepted`.

## Event shape to watch

The receiver filters on this combination:

- `entityType === "content_item"`
- `action === "create"` or `action === "update"`
- parsed `details.status === "published"`

That covers:

- direct publish on create
- direct publish on update
- workflow approval paths that transition an item to `published`

## Why this example matters

This is the shortest path from WordClaw governance to a real deployment action:

- WordClaw owns content structure, review, and policy
- a simple signed webhook turns publish events into downstream site deploys
- Vercel remains an external rendering target, not the source of truth
