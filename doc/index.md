---
layout: home
hero:
  name: "WordClaw"
  text: "Documentation"
  tagline: Safe content runtime for AI agents and human supervisors
  actions:
    - theme: brand
      text: Get Started
      link: /tutorials/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/dligthart/wordclaw
features:
  - title: REST + MCP First
    details: Primary agent surfaces with remote MCP attachment, dry-run support, and policy-aware mutations.
  - title: Capability Manifest
    details: Discover enabled modules, actor profiles, transports, and task recipes before an agent starts mutating state.
  - title: Governed Content Ops
    details: Structured content, singleton globals, localized reads, publication-state awareness, preview loops, reusable forms, background jobs, approval workflows, audit trails, idempotency, and tenant isolation in one runtime.
  - title: Guided Agent Workflows
    details: Use CLI and MCP guidance paths for schema bootstrap, content authoring, workflow review, integration setup, provenance verification, and paid-content consumption.
---

## Quick Paths

- [Run WordClaw locally](/tutorials/getting-started) to start the API, database, supervisor UI, and MCP surface.
- [Use WordClaw as durable memory and RAG for Claude Code and OpenClaw](/guides/claude-openclaw-memory-rag) when you want agent memory outside the chat transcript.
- [Review runtime configuration](/reference/runtime-configuration) before changing auth, embeddings, asset storage, previews, or payments.
- [Check the roadmap](/reference/roadmap) for current product direction and release focus.
- [Connect an external agent with MCP](/guides/mcp-integration) to inspect tools, resources, prompts, actor identity, and workspace context.
- [See runnable demos](/guides/demos) for example frontends, agent clients, and paid-content flows.
- [Start with the LangGraph MCP starter](/guides/langgraph-mcp-starter) to attach a LangGraph agent without writing a custom SDK.

## Adoption Paths

### Deploy the runtime

Use the local Docker path when you want the fastest trial loop:

```bash
docker compose --profile app up --build
```

That gives you:

- REST API on `http://localhost:4000/api`
- Swagger docs on `http://localhost:4000/documentation`
- MCP endpoint on `http://localhost:4000/mcp`

If `GET /api/deployment-status` reports `domainCount: 0`, bootstrap the first domain before authoring:

```bash
npx tsx src/cli/index.ts domains create \
  --name "Local Development" \
  --hostname local.development
```

### Explore from the CLI

```bash
npx tsx src/cli/index.ts capabilities status
npx tsx src/cli/index.ts mcp call guide_task --json '{"taskId":"discover-deployment"}'
npx tsx src/cli/index.ts domains list
npx tsx src/cli/index.ts mcp inspect --mcp-transport http --api-key writer
npx tsx src/cli/index.ts workspace guide
npx tsx src/cli/index.ts content guide
```

### Explore from LangGraph

```bash
npx tsx demos/langgraph-mcp-starter/index.ts inspect --transport http --mcp-url http://localhost:4000/mcp --api-key writer
```
