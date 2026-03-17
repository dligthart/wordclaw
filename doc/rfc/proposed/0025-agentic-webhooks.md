# RFC 0025: Reactive Agentic Webhooks via MCP

**Author:** Codex  
**Status:** Rolling out  
**Date:** 2026-03-12  
**Updated:** 2026-03-17  

## 0. Current Status

As of 2026-03-17, RFC 0025 is actively rolling out and the core reactive MCP runtime is already live on `main`.

Implemented so far:

- remote MCP sessions over Streamable HTTP at `/mcp`
- session-backed SSE delivery for server-pushed MCP notifications
- `subscribe_events` with topic, recipe, and filter support
- filter-aware topic recipes such as `content-publication`, `review-decisions`, and `integration-admin`
- capability and deployment-status discovery for reactive transports, filter fields, topics, and recipes
- `guide_task` reactive follow-up recommendations for the core workflow classes
- verification and demo-agent flows for live reactive subscription testing

Still pending:

- continued topic hardening and recipe refinement for the highest-value runtime events
- broader demo coverage showing full end-to-end reactive agent loops on top of the current transport

## 1. Summary
This RFC proposes extending WordClaw's existing webhook architecture to support **Agentic Webhooks** natively through the Model Context Protocol (MCP). By introducing Server-Sent Events (SSE) or bi-directional streaming over MCP, we can transition AI agents from a costly "polling" loop architecture to a highly efficient, real-time "reactive" architecture. 

## 2. Motivation
WordClaw's current agent interaction model is fundamentally **pull-based** (REST or MCP Tool calls). 
If an autonomous agent is waiting for a human supervisor to approve a drafted blog post, the agent currently must:
1. Wake up on a cron schedule.
2. Call `resolve_workspace_target` or `GET /api/workspace-target`.
3. Check if the state has changed.
4. Go back to sleep if the human hasn't acted.

This polling wastes LLM tokens, incurs unnecessary compute costs, and results in laggy user experiences.
If WordClaw is truly the "control plane for agent-driven content", it needs to support true reactive, event-driven integrations so agents can execute actions immediately upon state changes.

## 3. Proposal
Extend WordClaw's existing event bus (which currently supports standard HTTP POST webhooks) to securely push JSON payloads directly into an active agent's MCP connection.

### 3.1 The MCP Capabilities Extension
We propose adding two new capabilities to the MCP Server contract:

1. **`subscribe_events` (Tool)**
   - Allows an agent to explicitly subscribe to specific system events (e.g., `content_item.updated`, `audit.auth_failure`).
   - The payload specifies the subscription scope, inheriting the same security matrix as the agent's API Key `OperationContext`.

2. **Server-Sent Events (SSE) Transport Upgrade**
   - The current `/mcp` HTTP remote endpoint must upgrade to support long-lived HTTP SSE connections.
   - When a subscribed event fires in the WordClaw runtime, the event bus pushes the payload down the open MCP stream directly into the agent's active memory context.

### 3.2 Example Agent Use Case (Reactive Publishing)
1. **Agent Setup:** The agent authenticates and calls the `subscribe_events` tool, asking to listen for `content_item.approved` events on the `Article` schema.
2. **Human Action:** A supervisor logs into the WordClaw `/ui`, reviews a drafted post, and clicks "Approve". 
3. **Reactive Trigger:** The WordClaw event bus catches the approval and streams the notification payload down the open MCP connection.
4. **Agent Action:** The LLM receives the notification instantly. It triggers a secondary tool to fetch the approved content, converts it to Markdown, and publishes it via an external Twitter API.

## 4. Technical Design

### 4.1 Integration with Current Event Bus
WordClaw already parses core mutations inside the service layer and emits them via the existing webhook delivery service. 
The new `McpStreamManager` would subscribe to this same internal Node.js `EventEmitter`. 

### 4.2 Security Constraints
Agentic Webhooks introduce a risk of data leakage if an agent subscribes to events outside its authorized scope.
- **Strict Policy Engine Integration**: Even if an agent asks to listen to `*` (all events), the `McpStreamManager` must silently filter out events that the agent's API key context does not have the `domainId` or `content:read` scope grants to see.
- **Tenant Isolation**: In multi-domain deployments, SSE streams must be hard-bound to the `domainId` of the authenticated session. 

## 5. Alternatives Considered
- **Forcing Agents to Poll (`GET /api/queue`)**: This is the current state. It is rejected long-term because it scales poorly computationally and financially for LLM agents.
- **External Message Brokers (Kafka / RabbitMQ)**: Rejected because WordClaw must remain lightweight and easy to deploy via a single Docker container. Native SSE is built into Fastify and sufficient for our scale.

## 6. Rollout Plan
1. Validate Fastify SSE support within our current MCP HTTP server stack.
2. Expose the `subscribe_events` tool logic, wired to the `McpStreamManager`.
3. Add a verification script (`verify-mcp-streams.ts`) simulating a reactive agent catching an event.

## 7. Acceptance Criteria
- Agents can call an MCP tool to subscribe to a topic.
- Mutations in the REST API trigger events that successfully travel down an open MCP SSE stream.
- Event payloads strictly obey the authentication scope and `domainId` of the streaming connection.
