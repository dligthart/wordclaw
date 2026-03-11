# API Reference

<script setup>
import SwaggerUI from '../.vitepress/components/SwaggerUI.vue'
</script>

This document covers WordClaw's primary HTTP surface: the REST API. MCP is the primary agent-native companion surface; see [mcp-integration.md](../guides/mcp-integration). GraphQL remains available at `/graphql` as a compatibility layer. Experimental revenue, payout, delegation, and agent-run endpoints are intentionally hidden from the default API reference unless an operator explicitly enables those incubator modules in runtime configuration.

For deployment-level discovery before authentication, use `GET /api/capabilities`. It reports the current protocol contract, enabled modules, auth/domain expectations, reusable actor profiles, dry-run coverage, and task-oriented agent recipes in one machine-readable manifest. For authenticated preflight checks, use `GET /api/identity` to confirm the current actor, domain, and scope set before mutating runtime state.

The fastest task-oriented preflight sequence is:

1. `GET /api/capabilities`
2. `GET /api/identity`
3. Use the matching CLI helper:
   - `content guide --content-type-id <id>`
   - `workflow guide`
   - `integrations guide`
   - `l402 guide --item <id>`

<SwaggerUI />
