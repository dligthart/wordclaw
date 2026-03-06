# WordClaw: Product-Market Fit & Feature Analysis

## 1. Executive Summary & Product-Market Fit (PMF)

**Product-Market Fit Strategy:** 
WordClaw is positioned in an underserved, high-growth niche: **safe content infrastructure for AI operations**. While traditional headless CMS platforms (like Contentful, Sanity, or Strapi) are designed around human-centric workflows (rich text editors, visual page builders), WordClaw is fundamentally designed for **autonomous AI agents operating under supervision**.

Its PMF is extremely strong for development teams building agentic workflows because it natively solves the three biggest hurdles AI agents face when interacting with external systems:
1. **Discoverability & Formatting:** Strict JSON schema enforcement, native MCP (Model Context Protocol) integration, and `remediation` metadata embedded in errors.
2. **Safety & Oversight:** Dry-run support, strict policy isolation (Multi-tenant constraints), and a human-in-the-loop Supervisor UI.
3. **Optional Monetization:** Native L402 Lightning integration can gate paid access without making the core product depend on marketplace, payout, or AP2 complexity.

## 2. Market Differentiation & Core Features

WordClaw's core feature set aligns tightly with its "AI-first" value proposition:

*   **REST + MCP Agent Surfaces:** WordClaw's strongest agent story comes from pairing a clear REST contract with a native MCP surface. GraphQL can remain available, but it should not define the default product promise.
*   **AI-Targeted UX (Developer Ergonomics):** Returning `remediation`, `availableActions`, and `actionPriority` metadata directly in the JSON response gives LLMs deterministic pathways to self-correct (e.g., if a schema validation fails, the API tells the agent exactly how to fix the JSON payload).
*   **Optional L402 Module:** Lightning-gated reads and purchases can be enabled when operators need machine-native paid access, without turning the core product into a payments suite.
*   **Multi-Domain (Tenant) Isolation:** Critical for enterprise adoption where an agency might host multiple bespoke environments for different fine-tuned agent deployments.

## 3. Feature Creep Analysis & Technical Debt Risks

Because WordClaw straddles several complex domains—Content Management, Authorization (Policy Engine), Distributed Systems (Webhooks/Events), and an optional Lightning payment module—it is highly susceptible to **feature creep**.

Here are the primary areas where feature creep threatens the project's core focus:

### Risk A: The Supervisor UI Bloat
*   **Current State:** The Supervisor UI (`/ui`) is currently an "oversight" and telemetry dashboard (Audit logs, Schema Management, Key revoking).
*   **Creep Risk:** Attempting to build a fully-featured WYSIWYG rich-text content editor. 
*   **Mitigation:** WordClaw's competitive advantage is being a *Headless CMS for Agents*, not humans. The UI should remain strictly as an administrative control plane. Human users should only interact with content for approval, rollback, or debugging—not necessarily primary authoring.

### Risk B: Overexpanding the Optional L402 Module
*   **Current State:** L402 is used as an optional gate for specific paid routes and offer flows.
*   **Creep Risk:** Trying to extend the payment module into fiat conversions, subscription billing, or multi-party revenue accounting.
*   **Mitigation:** Keep the L402 middleware focused on deterministic request gating and settlement verification. Offload wallet management, fiat-on-ramps, and routing complexity to external Lightning providers.

### Risk C: Policy Engine & ABAC Bloat
*   **Current State:** Scope-based permissions (`content:read`, `admin`) combined with `domainId` isolation.
*   **Creep Risk:** Expanding the `PolicyEngine` into a full Attribute-Based Access Control (ABAC) system (e.g., "Agents can only edit posts published on Tuesdays by Actor Y").
*   **Mitigation:** Resist adding complex conditional logic parsers to the authorization pipeline. If complex business logic is needed, encourage users to leverage the Webhook architecture rather than overloading the core fastify preHandler.

## 4. Strategic Recommendations

1.  **Double Down on REST + MCP:** WordClaw's clearest product story is a strong REST contract paired with an MCP surface for agent tooling. Prioritize those two surfaces over expanding GraphQL-first behavior.
2.  **Lean into the "Dry-Run" Narrative:** Emphasize the `?mode=dry_run` and `policyEvaluate` tools in marketing. The biggest fear enterprises have regarding autonomous AI is unintended destructive mutations. WordClaw's ability to safely simulate transactions before database execution is a killer feature.
3.  **Strictly Bound the Value Proposition:** WordClaw is a safe content runtime and supervisor control plane for AI agents. It should not try to be a user-facing frontend CMS, a marketplace suite, or a full Lightning infrastructure product. Keep the API footprint lean, the TypeScript validations strict, and the remediation messages explicit.
