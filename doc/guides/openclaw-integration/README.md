# OpenClaw Integration Guide

Connect [OpenClaw](https://docs.openclaw.ai) to WordClaw so autonomous agents can manage content, assets, workflows, and payments through the WordClaw MCP server.

## Prerequisites

- **OpenClaw** installed (`npm install -g openclaw@latest`)
- **WordClaw** running locally or remotely with the database migrated

## Quick Start

### 1. Register the MCP Server

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

> "List my WordClaw content types"

The agent should call `list_content_types` through the MCP server and return results.

## What the Skill Teaches

The `SKILL.md` encodes six workflow recipes:

| Recipe | Description |
|--------|-------------|
| **Content Authoring** | Discovery → dry-run → write → subscribe |
| **Workflow Review** | Target resolution → task inspection → approve/reject |
| **Asset Management** | Upload, derivatives, signed access |
| **L402 Paid Content** | 402 challenge → pay → retry with token |
| **Reactive Subscriptions** | Event-driven sync instead of polling |
| **Content Projections** | Grouped analytics and leaderboard queries |

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
