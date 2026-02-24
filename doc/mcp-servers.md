# Available Remote MCP Servers

This is a curated list of high-quality remote MCP (Model Context Protocol) servers available for future integration into WordClaw's MCP architecture, sourced from [mcpservers.org](https://mcpservers.org/remote-mcp-servers).

These servers provide diverse capabilities and could act as powerful targets for Supervisor Agents or specialized WordClaw workflows. Note that these are OAuth-gated or authenticated endpoints:

- **GitHub Copilot**: `https://api.githubcopilot.com/.well-known/oauth-authorization-server`
- **Notion**: `https://mcp.notion.com/.well-known/oauth-authorization-server`
- **Cloudflare**: `https://mcp.cloudflare.com/.well-known/oauth-authorization-server`
- **Sentry**: `https://mcp.sentry.dev/.well-known/oauth-authorization-server`
- **Linear**: `https://mcp.linear.app/.well-known/oauth-authorization-server`
- **Figma**: `https://mcp.figma.com/.well-known/oauth-authorization-server`
- **Intercom**: `https://mcp.intercom.com/.well-known/oauth-authorization-server`
- **Neon Tech**: `https://mcp.neon.tech/.well-known/oauth-authorization-server`
- **Supabase**: `https://mcp.supabase.com/.well-known/oauth-authorization-server`
- **PayPal**: `https://mcp.paypal.com/.well-known/oauth-authorization-server`
- **Square**: `https://mcp.squareup.com/.well-known/oauth-authorization-server`
- **Ahrefs**: `https://api.ahrefs.com/.well-known/oauth-authorization-server`
- **Asana**: `https://mcp.asana.com/.well-known/oauth-authorization-server`
- **Atlassian**: `https://mcp.atlassian.com/.well-known/oauth-authorization-server`
- **Wix**: `https://mcp.wix.com/.well-known/oauth-authorization-server`
- **Webflow**: `https://mcp.webflow.com/.well-known/oauth-authorization-server`
- **Globalping**: `https://mcp.globalping.dev/.well-known/oauth-authorization-server`

## Potential Use Cases for WordClaw
- **Ahrefs**: Could be directly integrated into the proposed `0001-blog-valuation-architecture.md` for SEO metric gathering.
- **Linear / Asana / Atlassian**: Could be used for syncing editorial workflows and tasks out of WordClaw into external issue trackers.
- **Sentry / Cloudflare**: Could be integrated into audit logs and system health monitoring for administrators.
- **Neon / Supabase**: Could be utilized for distributed database management or backups natively from the agent context.
- **Notion / Figma / Webflow**: Great for cross-publishing content natively through our upcoming Multi-Channel Distribution Orchestrator (`0005-multi-channel-distribution-orchestrator.md`).
