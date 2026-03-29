# LangGraph + WordClaw MCP Starter

This starter shows how to attach a generic LangGraph agent to WordClaw through the existing MCP surface.

It supports two connection modes:

- `stdio`: start the local WordClaw MCP server as a child process
- `http`: attach to a running WordClaw server at `/mcp`

## Why this starter exists

The goal is not to hardcode a second WordClaw SDK. Instead, the agent uses the same MCP discovery path that a real external agent would use:

1. inspect WordClaw
2. discover tools, resources, prompts, actor identity, and workspace context
3. call MCP tools through a small LangGraph wrapper

## Prerequisites

- install repo dependencies with `npm install`
- for `http` mode, run WordClaw first:
  - `docker compose --profile app up --build`
  - or `npm run dev`
- for `run` / `demo` commands, set `OPENAI_API_KEY`
- the `--api-key writer` examples assume the default README config; if your local runtime uses a different key name, substitute that value instead

## Commands

Inspect the MCP surface without an LLM:

```bash
npx tsx demos/langgraph-mcp-starter/index.ts inspect
```

Attach to a running HTTP MCP endpoint:

```bash
npx tsx demos/langgraph-mcp-starter/index.ts inspect \
  --transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer
```

Run a built-in LangGraph walkthrough:

```bash
OPENAI_API_KEY=sk-... \
npx tsx demos/langgraph-mcp-starter/index.ts demo workspace \
  --transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer

OPENAI_API_KEY=sk-... \
npx tsx demos/langgraph-mcp-starter/index.ts demo memory \
  --transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer
```

Run a custom task:

```bash
OPENAI_API_KEY=sk-... \
npx tsx demos/langgraph-mcp-starter/index.ts run \
  --task "Inspect WordClaw and explain the best schema to author against right now." \
  --transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer
```

## Built-in demos

- `workspace`: summarize actor, transports, and current workspace targets
- `authoring`: identify the best schema and propose the next dry-run payload or schema-bootstrap path
- `memory`: inspect whether WordClaw should be used as durable memory, checkpoint storage, and semantic retrieval for the current workspace
- `review`: inspect pending review work and recommend the next action

## Notes

- The agent gets four wrapper tools:
  - `inspect_wordclaw`
  - `call_wordclaw_tool`
  - `read_wordclaw_resource`
  - `get_wordclaw_prompt`
- This keeps the example focused on orchestration while preserving WordClaw's real MCP semantics.
- Use `http` mode when you want the LangGraph agent to attach to an already-running WordClaw server.
- For current WordClaw best practice, the demos should inspect deployment and workspace state first, then use `guide_task("author-content")` when no schema exists yet instead of guessing a write payload from memory.
