# API Reference

<script setup>
import SwaggerUI from '../.vitepress/components/SwaggerUI.vue'
</script>

This document covers WordClaw's primary HTTP surface: the REST API. MCP is the primary agent-native companion surface; see [mcp-integration.md](../guides/mcp-integration). GraphQL remains available at `/graphql` as a compatibility layer. Experimental revenue, payout, and delegation endpoints are intentionally hidden from the default API reference unless an operator explicitly enables those modules in runtime configuration.

<SwaggerUI />
