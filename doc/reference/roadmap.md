# WordClaw Roadmap

WordClaw is evolving from a headless CMS into a secure governance runtime for AI agents. This roadmap tracks our progress, separates stable product features from incubating ideas, and provides clarity on where the ecosystem is heading.

## 🚀 Flagship Releases

We promote one major flagship feature per minor version release to ensure stability and focus.

### v0.4: Reactive MCP Sessions (Current)
* **Goal**: Let long-lived agents subscribe to runtime events instead of polling for content, workflow, and integration changes.
* **Status**: Rolling out. Remote MCP sessions, reactive topic subscriptions, filter-aware recipes, task guidance follow-up recommendations, and discovery/status exposure are live on `main`. Remaining work is focused on hardening the reactive contract around the most valuable topics and demos, not inventing a second event system.
* **Documentation**: See [RFC 0025](../rfc/proposed/0025-agentic-webhooks.md).

### v0.3: Schema-Aware Media Assets (Shipped)
* **Goal**: Make media files a first-class part of the core runtime instead of pushing agents toward ad hoc external URLs.
* **Status**: Shipped. Local and S3-compatible storage, schema-level asset references, derivative variants, multipart and direct-provider upload flows, signed and entitlement-gated delivery, MCP/CLI tooling, supervisor asset controls, and restore/purge lifecycle are live on `main`.
* **Documentation**: See [RFC 0023](../rfc/proposed/0023-media-asset-storage.md).

### v0.2: Production-Ready L402 Flows (Shipped)
* **Goal**: Provide an end-to-end, secure payment path for machine-to-machine transactions.
* **Status**: Shipped. Agents can now natively purchase and redeem Lightning network macaroons (L402) for premium content access.
* **Documentation**: See [L402 Protocol](../concepts/l402-protocol.md).

### v0.1: Context-Aware Headless CMS (Shipped)
* **Goal**: Establish the core structured content models, validation schemas, and API primitives.
* **Status**: Shipped. Core entity framework, domains, API Key scopes, role management, schema-aware content references, field-aware content queries, grouped content projections, public write lanes, and TTL lifecycle archival for session-like content are stable.

---

## 📅 Near-Term Priorities

These features are currently in active development or polishing phases for upcoming minor releases.

### 1. Vector RAG Simplification
- **Status**: Rolling out.
- **Description**: Making native `pgvector` semantic search easier to enable. We now auto-detect `OPENAI_API_KEY` on startup, automatically generating embeddings for published content without requiring complex external pipeline deployments.

### 2. Additional Asset Providers (Optional follow-up)
- **Status**: On demand.
- **Description**: RFC 0023 is effectively shipped for the supported product path. Additional object-storage adapters beyond the current local and S3-compatible providers are now a demand-driven extension, not a core product gap.

### 3. Extensibility and Plugins (RFC 0022)
- **Status**: Proposed.
- **Description**: Designing a Strapi-style plugin architecture to allow the community to extend the Express/Fastify API boundaries and MCP toolsets without continuously forking the core runtime.

### 4. API Polish and Error Schemas
- **Status**: In progress.
- **Description**: Standardizing error payloads across both GraphQL and REST, ensuring AI agents receive consistent, actionable `recommendedNextAction` directives when validations fail.

### 5. Performance & Scalability (RFC 0024)
- **Status**: Proposed.
- **Description**: Establishing caching layers (Redis) for Agent capabilities/search, defining horizontal node scaling strategies, and targeting 100 concurrent agent runs at under 200ms latency.

---

## 🧪 Incubating / Experimental

These features are turned **OFF** by default in production. They represent longer-term architectural bets and agentic economy experiments. They may change drastically or be removed based on feedback.

### AP2 Agentic Monetization (RFC 0016)
Testing advanced revenue splitting between model providers, system operators, and original content authors based on LLM consumption traces.

### Internal Agentic Content Recommender
Exploring whether autonomous background agents can effectively curate and tag content relationships better than manual human curation.

### Delegation and Worker Sandboxes
Testing secure boundaries for executing third-party or multi-step agent workflows via queued `AgentRuns`.

> **Note to Contributors**: We recommend building tools and integrations against the Tier 1 Feature constraints defined in the [Features Concept Guide](../concepts/features.md) rather than relying on experimental modules.
