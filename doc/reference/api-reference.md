# API Reference

<script setup>
import SwaggerUI from '../.vitepress/components/SwaggerUI.vue'
</script>

This document covers WordClaw's primary HTTP surface: the REST API. MCP is the primary agent-native companion surface; see [mcp-integration.md](../guides/mcp-integration). GraphQL remains available at `/graphql` as a compatibility layer. Experimental revenue, payout, delegation, and agent-run endpoints are intentionally hidden from the default API reference unless an operator explicitly enables those incubator modules in runtime configuration.

For deployment-level discovery before authentication, use `GET /api/capabilities` plus `GET /api/deployment-status`. The manifest reports the current protocol contract, enabled modules, auth/domain expectations, reusable actor profiles, dry-run coverage, and task-oriented agent recipes in one machine-readable document. The status snapshot adds live readiness for the database, REST/MCP availability, and any enabled background worker surfaces. For authenticated preflight checks, use `GET /api/identity` plus `GET /api/workspace-context` to confirm the current actor, active domain, and available content-model targets before mutating runtime state. The workspace snapshot now includes grouped target recommendations for authoring, workflow, review, and paid-content flows.

The fastest task-oriented preflight sequence is:

1. `GET /api/capabilities`
2. `GET /api/deployment-status`
3. `GET /api/identity`
4. `GET /api/workspace-context`
   - supports `intent`, `search`, and `limit` when the agent already knows whether it wants authoring, review, workflow, or paid-content targets
5. Use the matching CLI helper:
   - `workspace guide`
   - `content guide --content-type-id <id>`
   - `workflow guide`
   - `integrations guide`
   - `audit guide --entity-type <type> --entity-id <id>`
   - `l402 guide --item <id>`

<SwaggerUI />
