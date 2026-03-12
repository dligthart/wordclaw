# LangGraph MCP Starter

WordClaw already exposes a rich MCP surface. This guide shows the shortest path to connect a LangGraph agent to that surface without building a custom SDK.

The starter lives at [demos/langgraph-mcp-starter/index.ts](/Users/daveligthart/GitHub/wordclaw/demos/langgraph-mcp-starter/index.ts) and uses the same `WordClawMcpClient` that powers the repo-native CLI.

## What the starter does

The agent does not assume WordClaw-specific knowledge up front. It first discovers the runtime through MCP and then acts through a small set of generic wrappers:

- `inspect_wordclaw`
- `call_wordclaw_tool`
- `read_wordclaw_resource`
- `get_wordclaw_prompt`

This keeps the example framework-friendly while preserving the current product direction:

- REST + MCP first
- actor-aware discovery
- schema-first content authoring
- approval-aware workflow operations

## Quickstart

Start WordClaw locally:

```bash
docker compose --profile app up --build
```

These examples use the `writer` API key from the default README setup. If your local runtime uses a different key name, substitute that value instead.

Inspect the running MCP surface:

```bash
npx tsx demos/langgraph-mcp-starter/index.ts inspect \
  --transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer
```

Run the built-in workspace walkthrough:

```bash
OPENAI_API_KEY=sk-... \
npx tsx demos/langgraph-mcp-starter/index.ts demo workspace \
  --transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer
```

Run a custom task:

```bash
OPENAI_API_KEY=sk-... \
npx tsx demos/langgraph-mcp-starter/index.ts run \
  --task "Inspect WordClaw and explain the next safe authoring action." \
  --transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer
```

## Transport choices

### `stdio`

Use `stdio` when you want the demo to spawn the local MCP server itself:

```bash
npx tsx demos/langgraph-mcp-starter/index.ts inspect
```

This is the lowest-friction option for local exploration from the repo root.

### `http`

Use `http` when WordClaw is already running and you want the agent to attach to it remotely:

```bash
npx tsx demos/langgraph-mcp-starter/index.ts inspect \
  --transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer
```

This is the better fit for external agents, deployed runtimes, and framework demos.

## Suggested first tasks

- `demo workspace`
  - inspect the active actor and workspace context
  - summarize which schema is best for authoring or review
- `demo authoring`
  - inspect the current authoring target
  - propose a safe `create_content_item` payload
- `demo review`
  - inspect review work
  - summarize the next review action without mutating state

## Why this matters

This starter makes WordClaw easier to adopt because it gives agent builders a familiar framework path:

- deploy the runtime with Docker
- attach a LangGraph agent through MCP
- let the agent discover tools and workspace context at runtime

That is a much clearer trial path than asking users to read the full source tree first.
