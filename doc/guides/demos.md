# Demos

This page is the catalog for the runnable demo surfaces in `demos/`.

## Core Runtime Demos

### Demo Blog

Frontend demo for structured blog content over the WordClaw REST API, including a singleton global for site settings and published-snapshot reads.

```bash
npm run demo:seed-blog
cd demos/demo-blog
npm install
npm run dev
```

See `demos/demo-blog/README.md` for demo-specific setup.

### Multi-Tenant Isolation

Minimal UI proving domain isolation with different API keys. The setup now generates `demos/multi-tenant/tenant-config.js` instead of baking secrets into the HTML file.

```bash
npx tsx scripts/setup-multi-tenant.ts
cd demos/multi-tenant
python3 -m http.server 5175
```

### MCP Demo Agent

Headless MCP client for inspection, bootstrap/discovery visibility, semantic-search calls, and reactive smoke testing.

```bash
npx tsx demos/mcp-demo-agent.ts inspect
npx tsx demos/mcp-demo-agent.ts smoke
npx tsx demos/mcp-demo-agent.ts call list_content_types '{"limit":5}'
npx tsx demos/mcp-demo-agent.ts call guide_task '{"taskId":"author-content"}'
npx tsx demos/mcp-demo-agent.ts call search_semantic_knowledge '{"query":"approval workflow","limit":3}'
```

### LangGraph MCP Starter

Minimal LangGraph agent that attaches through MCP and now includes schema-bootstrap and durable-memory walkthroughs.

```bash
npx tsx demos/langgraph-mcp-starter/index.ts inspect
npx tsx demos/langgraph-mcp-starter/index.ts inspect --transport http --mcp-url http://localhost:4000/mcp --api-key writer
OPENAI_API_KEY=sk-... npx tsx demos/langgraph-mcp-starter/index.ts demo workspace --transport http --mcp-url http://localhost:4000/mcp --api-key writer
OPENAI_API_KEY=sk-... npx tsx demos/langgraph-mcp-starter/index.ts demo memory --transport http --mcp-url http://localhost:4000/mcp --api-key writer
```

See `demos/langgraph-mcp-starter/README.md` for walkthroughs.

## Payments and Paid Content Demos

### L402 Agent Demo

Autonomous TypeScript agent that encounters an L402 challenge and retries after payment.

```bash
npx tsx demos/agent-l402-demo.ts
```

### Coinbase AgentKit L402 Client

LangChain + AgentKit demo using a custom payment action provider.

```bash
OPENAI_API_KEY=sk-... npx tsx demos/agentkit-l402-client.ts
```

### Paid Capability Library

Frontend showcase for paid-capability content using workspace-target discovery, published reads, offers, entitlements, and local execution after unlock.

```bash
npx tsx scripts/setup-skills-marketplace.ts
cd demos/agent-skills-marketplace
npm install
npm run dev
```

See `demos/agent-skills-marketplace/README.md` for details.

## Standalone Frontend / Product Demos

### Adventure Game

Interactive text-adventure demo built on WordClaw-backed content flows. It now auto-bootstraps a local demo API key when one is not already configured.

See `demos/demo-adventure-game/README.md` for the current run flow and requirements.

### Lightheart Site

Standalone marketing-site feasibility demo based on Lightheart-style content patterns, updated to reflect current WordClaw globals, localization, forms, jobs, and preview capabilities.

See `demos/demo-lightheart-site/README.md` for the current run flow and constraints.

## Related Operational Example

The webhook bridge example lives in:

```bash
npx tsx demos/vercel-deploy-webhook.ts
```

For the supported deployment flow around that example, see the
[Vercel Deploy Webhook Guide](./vercel-deploy-webhook.md).
