# OpenClaw Integration Guide

Connect [OpenClaw](https://docs.openclaw.ai) to WordClaw so autonomous agents can manage content, assets, workflows, and payments through the WordClaw MCP server.

## Prerequisites

- **OpenClaw** installed (`npm install -g openclaw@latest`)
- **WordClaw** running locally or remotely with the database migrated
- On a fresh install, read `system://deployment-status` or `GET /api/deployment-status` first. If no domains are provisioned yet, bootstrap the first one with `POST /api/domains` before asking the agent to author content.

## Quick Start

### 1. Register the MCP Server

This section assumes an OpenClaw build that supports the `mcpServers` block in `~/.openclaw/openclaw.json`. If your current build does not expose MCP registration in that shape yet, use the REST-first fallback later in this guide and upgrade before switching back to MCP.

If you want WordClaw to generate the snippet for you first, run:

```bash
wordclaw provision --agent openclaw --transport stdio
wordclaw provision --agent openclaw --transport http --write
```

Copy the relevant block from [`openclaw.example.json`](./openclaw.example.json) into your `~/.openclaw/openclaw.json`:

**Option A — Local stdio (dev)**

```jsonc
{
  "mcpServers": {
    "wordclaw": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/wordclaw/src/mcp/index.ts"],
      "env": {
        "DATABASE_URL": "postgres://postgres:postgres@localhost:5432/wordclaw",
        "AUTH_REQUIRED": "true",
        "API_KEYS": "writer=content:read|content:write|audit:read"
      }
    }
  }
}
```

**Option B — Remote HTTP (production / shared)**

```jsonc
{
  "mcpServers": {
    "wordclaw": {
      "url": "http://localhost:4000/mcp",
      "headers": { "x-api-key": "writer" }
    }
  }
}
```

### 2. Install the Skill

Copy the [`SKILL.md`](./SKILL.md) to your OpenClaw skills directory:

```bash
mkdir -p ~/.openclaw/skills/wordclaw-cms
cp doc/guides/openclaw-integration/SKILL.md ~/.openclaw/skills/wordclaw-cms/SKILL.md
```

### 3. Verify

Restart OpenClaw (or run `openclaw onboard`) and ask:

> "Discover my WordClaw workspace and pick the best authoring target"

The agent should read the WordClaw discovery resources, call `guide_task` or
`resolve_workspace_target`, and then explain the available domains and content
targets.

## REST-First Fallback

If OpenClaw is not ready for MCP registration yet, bootstrap over REST first:

1. Read `GET /api/capabilities` and `GET /api/deployment-status`.
2. If `domainCount` is `0`, create the first domain with `POST /api/domains`.
3. If you need the supervisor locally, check `checks.ui`; run `npm run dev:all` when the UI is not yet being served from `/ui/`.
4. Register the MCP server once the runtime is provisioned and continue with `guide_task("bootstrap-workspace")` or `guide_task("discover-workspace")`.

## What the Skill Teaches

The `SKILL.md` now centers the runtime's built-in guidance surfaces
(`system://capabilities`, `system://deployment-status`, `system://current-actor`,
`system://workspace-context`, `guide_task`, and `resolve_workspace_target`)
and then maps them into these task playbooks:

| Recipe | Description |
|--------|-------------|
| **Discover Deployment** | Check enabled modules, readiness, and actor expectations |
| **Discover Workspace** | Resolve the active domain, content inventory, and best target |
| **Content Authoring** | Discovery → actor-aware guide → dry-run → write |
| **Workflow Review** | Pending-task inspection → comment → approve/reject |
| **Asset Management** | Metadata discovery first, then REST delivery or upload flow |
| **L402 Paid Content** | MCP discovery, then REST offer → purchase → confirm → entitlement read |
| **Manage Integrations** | API key and webhook lifecycle operations |
| **Verify Provenance** | Actor/entity-scoped audit inspection and follow-up monitoring |

## Use Case Test: Low-Memory Resume Across Sessions

This is the most practical test for whether OpenClaw is using WordClaw well.

### Goal

Verify that OpenClaw can stop and restart with minimal local memory while
recovering the same domain, target, and next action from WordClaw.

### Prompt 1

> "Discover my WordClaw workspace, choose the best authoring target, and return only a compact checkpoint with IDs and the next action."

Expected behavior:

- reads `system://current-actor`
- reads `system://workspace-context` or `system://workspace-target/authoring`
- calls `resolve_workspace_target` or `guide_task`
- falls back to `guide_task { "taskId": "author-content" }` when no usable schema exists yet and returns a schema-bootstrap checkpoint instead of guessing
- returns a compact checkpoint, not a long transcript

### Prompt 2

> "Using only that checkpoint, create or update one draft item, then return a new checkpoint with the content item id and any review task id."

Expected behavior:

- reloads only the required schema or item
- uses dry-run before the real write
- returns stable IDs and next action instead of keeping the whole payload in memory

### Prompt 3

Start a fresh OpenClaw session and provide only the compact checkpoint:

> "Resume this WordClaw task from the checkpoint. Rehydrate state from WordClaw, not from prior conversation memory."

Expected behavior:

- rereads `system://current-actor`
- uses `guide_task`, `system://workspace-target/{intent}`, or filtered workspace resources
- fetches only the referenced content item, review task, or audit delta
- continues from the same domain and target without re-scanning the whole workspace

### Success Criteria

- OpenClaw uses canonical IDs rather than carrying long payloads forward.
- OpenClaw rehydrates from WordClaw resources and tools instead of depending on old chat context.
- The resumed session picks the same domain and work target unless WordClaw state has actually changed.
- Audit or reactive deltas are used for freshness instead of replaying the full history.

For a stricter operator-facing pass/fail runbook, use
`tests/use-cases/openclaw-low-memory-resume.md`.

## Optional: Webhook Bridge

If you want WordClaw to push events to OpenClaw proactively (instead of the agent subscribing via MCP), register a webhook in WordClaw pointing at your OpenClaw Gateway webhook endpoint:

```bash
export WORDCLAW_BASE_URL=http://localhost:4000
export WORDCLAW_API_KEY=writer

wordclaw mcp call create_webhook '{
  "url": "http://127.0.0.1:18789/webhook/wordclaw",
  "events": ["content_item.published", "workflow.review.approved"],
  "secret": "your-shared-secret"
}'
```

## Further Reading

- [WordClaw MCP Integration Guide](../mcp-integration.md)
- [WordClaw CLI Guide](../cli-guide.md)
- [OpenClaw Documentation](https://docs.openclaw.ai)
