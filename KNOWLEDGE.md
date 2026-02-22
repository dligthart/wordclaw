# System Knowledge & Collaborative Way of Working

This document is a living record of the core operational guidelines, systemic knowledge, and agent-human interaction preferences for developing and maintaining the WordClaw platform.

## 1. Way of Working (Agent Workflows)

*   **Autonomous Execution:** The AI assistant operates with high autonomy. Once a goal or issue is outlined, the agent should implement the solution, verify it, run terminal tasks, commit it, and push it, *without* incessantly pausing to ask the human for explicit permission at every micro-step.
*   **GitHub Issue Integration:** All substantive work must be tracked via the issue tracker (`gh issue`). When fixing bugs, the agent automatically appends a comment summarizing the technical solution and closes the issue contextually.
*   **Documentation-First Architecture (RFCs):** Large-scale systemic decisions are formalized inside the `doc/rfc/` boundary as Markdown RFCs prior to implementation. These living documents guide all backend modifications (such as L402, UI Hardening, or Policy Parity).
*   **Test-Driven Validation:** We rely on custom verification scripts (e.g., `verify-api.ts`, `verify-dry-run.ts`) locally before considering a feature "done".
*   **Atomic Commits:** Commits pushed to `origin/main` must carry context-heavy descriptive messages identifying exactly what was altered.

## 2. Core Domain Knowledge

WordClaw is an AI-first Headless CMS designed for agentic interaction, combining dynamic content schemas with strictly enforced policies and Lightning Network micropayments.

### Stack
*   **Backend Interface:** Node.js (TypeScript), Fastify (REST), Mercurius (GraphQL), Model Context Protocol (MCP).
*   **Persistence Layer:** Drizzle ORM (currently modeling SQLite schemas).
*   **Frontend UI:** SvelteKit 5, utilizing global `$state` runes for reactive properties.

### Architectural Pillars
*   **Protocol Parity:** All CRUD capabilities are mapped symmetrically backward and forward across REST, GraphQL, and MCP tool boundaries. We never deploy a feature exclusive to one transport protocol.
*   **Policy Engine & Geometry:** Security constraints are unified in `src/services/policy.ts`. REST headers, GraphQL contexts, and MCP JSON-RPC signatures are flattened into a universal `OperationContext`. This engine enforces scope roles (`content:write`, `audit:read`) identically regardless of the origin.
*   **The L402 Protocol:** Handled transparently via the `l402Middleware`. Agents requesting paid operations (e.g., posting content) receive a `402 Payment Required` challenge bundling a Macaroon and a Lightning invoice. The system supports dynamic pricing parameters (`x-proposed-price`) allowing agent haggling. Paid tokens are cached, monitored per-session, and marked as `consumed` to prevent replay attacks.
*   **Dry-Run Mode:** Operations natively support a `dryRun` flag. The system simulates full execution blocks (schema checks, authentication verifications) and fails or succeeds safely without applying mutations to the database.

### The Supervisor UI
*   Served under `/ui`, functioning as a decoupled SvelteKit dashboard providing human oversight.
*   **Safety Primitives:** We avoid native `<button>` `alert()` commands and structural errors. Unified Svelte Contexts (`ui/src/lib/ui-feedback.svelte.ts`) supply non-intrusive `<Toast />` popups for API responses and require `<ConfirmDialog />` gates for any destructive action (e.g., API key revocation).
*   **JSON Serialization:** Payload items frequently serialize deeply nested stringified JSON strings. We use custom `formatJson` recursive unwrapping functions inside the Svelte UI before piping the strings to human users.
*   **Responsive Flow:** The data layout implements widespread scalable `<DataTable />` views that flexibly scale down for mobile-drawer inspection.

### Active Evolution & Roadmap
*   **RFC 0011 (Multi-Domain Support):** WordClaw is currently migrating from a flat single-tenant deployment to a robust multi-domain partition structure. Soon, `AgentProfiles`, `ContentTypes`, and `Webhooks` will adhere strictly to low-level `domainId` Drizzle query filters to guarantee strict cross-tenant data isolation.
