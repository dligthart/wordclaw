# Codex Integration Guide

Connect [Codex](https://developers.openai.com/codex) to WordClaw so Codex can
manage content, assets, workflows, and paid-content flows through the WordClaw
MCP server.

## Prerequisites

- **Codex** app, CLI, or IDE extension installed
- **WordClaw** running locally or remotely with the database migrated
- On a fresh install, read `system://deployment-status` or `GET /api/deployment-status` first. If no domains are provisioned yet, bootstrap the first one with `POST /api/domains` before asking Codex to author content.

## Quick Start

### 1. Register the MCP Server

Merge one of the example server blocks from `doc/guides/codex-integration/codex.example.toml`
into your `~/.codex/config.toml`.

**Option A: Local stdio (dev)**

```toml
[mcp_servers.wordclaw_stdio]
command = "npx"
args = ["tsx", "src/mcp/index.ts"]
cwd = "/absolute/path/to/wordclaw"
env = { DATABASE_URL = "postgres://postgres:postgres@localhost:5432/wordclaw", AUTH_REQUIRED = "true", API_KEYS = "writer=content:read|content:write|audit:read" }
required = true
startup_timeout_sec = 20.0
```

**Option B: Remote HTTP (production or shared)**

```toml
[mcp_servers.wordclaw_remote]
url = "http://localhost:4000/mcp"
env_http_headers = { "x-api-key" = "WORDCLAW_API_KEY" }
required = true
startup_timeout_sec = 20.0
```

Then export the API key before starting Codex:

```bash
export WORDCLAW_API_KEY=writer
```

Restart Codex after changing `~/.codex/config.toml`.

### 2. Use the Skill

This repository already includes a repo-scoped Codex skill at:

```text
.agents/skills/wordclaw-cms/SKILL.md
```

If you run Codex inside this repository, no extra install step is required.
Codex will discover repo skills from `.agents/skills`.

If you want the skill available outside this repository, copy the whole skill
folder into your user skill directory:

```bash
mkdir -p ~/.agents/skills
cp -R .agents/skills/wordclaw-cms ~/.agents/skills/
```

### 3. Verify

Restart Codex and ask:

> "Discover my WordClaw workspace and pick the best authoring target"

The agent should read the WordClaw discovery resources, call `guide_task` or
`resolve_workspace_target`, and then explain the available domains and content
targets.

If you want to force explicit use of the skill, mention `$wordclaw-cms` in the
prompt.

## What the Skill Teaches

The skill centers the runtime's built-in guidance surfaces
(`system://capabilities`, `system://deployment-status`, `system://current-actor`,
`system://workspace-context`, `guide_task`, and `resolve_workspace_target`)
and maps them into these task playbooks:

| Recipe | Description |
|--------|-------------|
| **Discover Deployment** | Check enabled modules, readiness, and actor expectations |
| **Discover Workspace** | Resolve the active domain, content inventory, and best target |
| **Content Authoring** | Discovery -> actor-aware guide -> dry-run -> write |
| **Workflow Review** | Pending-task inspection -> comment -> approve or reject |
| **Asset Management** | Metadata discovery first, then REST delivery or upload flow |
| **L402 Paid Content** | MCP discovery, then REST offer -> purchase -> confirm -> entitlement read |
| **Manage Integrations** | API key and webhook lifecycle operations |
| **Verify Provenance** | Actor- and entity-scoped audit inspection and follow-up monitoring |

## Use Case Test: Low-Memory Resume Across Sessions

This is the most practical test for whether Codex is using WordClaw well.

### Goal

Verify that Codex can stop and restart with minimal local memory while
recovering the same domain, target, and next action from WordClaw.

### Prompt 1

> "Discover my WordClaw workspace, choose the best authoring target, and return only a compact checkpoint with IDs and the next action."

Expected behavior:

- reads `system://current-actor`
- reads `system://workspace-context` or `system://workspace-target/authoring`
- calls `resolve_workspace_target` or `guide_task`
- returns a compact checkpoint, not a long transcript

### Prompt 2

> "Using only that checkpoint, create or update one draft item, then return a new checkpoint with the content item id and any review task id."

Expected behavior:

- reloads only the required schema or item
- uses dry-run before the real write
- returns stable IDs and next action instead of keeping the whole payload in memory

### Prompt 3

Start a fresh Codex session and provide only the compact checkpoint:

> "Resume this WordClaw task from the checkpoint. Rehydrate state from WordClaw, not from prior conversation memory."

Expected behavior:

- rereads `system://current-actor`
- uses `guide_task`, `system://workspace-target/{intent}`, or filtered workspace resources
- fetches only the referenced content item, review task, or audit delta
- continues from the same domain and target without re-scanning the whole workspace

### Success Criteria

- Codex uses canonical IDs rather than carrying long payloads forward.
- Codex rehydrates from WordClaw resources and tools instead of depending on old chat context.
- The resumed session picks the same domain and work target unless WordClaw state has actually changed.
- Audit or reactive deltas are used for freshness instead of replaying the full history.

For a stricter operator-facing pass or fail runbook, use
`tests/use-cases/openclaw-low-memory-resume.md`.

## Further Reading

- [WordClaw MCP Integration Guide](../mcp-integration.md)
- [OpenClaw Integration Guide](../openclaw-integration/README.md)
- [Codex Skills](https://developers.openai.com/codex/skills)
- [Codex MCP Configuration](https://developers.openai.com/codex/config-reference)
