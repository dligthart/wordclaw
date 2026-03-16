# WordClaw Roadmap

WordClaw is evolving from a headless CMS into a secure governance runtime for AI agents. This roadmap tracks our progress, separates stable product features from incubating ideas, and provides clarity on where the ecosystem is heading.

## 🚀 Flagship Releases

We promote one major flagship feature per minor version release to ensure stability and focus.

### v0.3: Schema-Aware Media Assets (Current)
* **Goal**: Make media files a first-class part of the core runtime instead of pushing agents toward ad hoc external URLs.
* **Status**: Rolling out. Local storage, schema-level asset references, multipart upload, signed and entitlement-gated delivery, MCP/CLI asset tooling, and restore/purge lifecycle are live on `main`. Remaining work is focused on remote object-storage providers and supervisor UI asset controls.
* **Documentation**: See [RFC 0023](/doc/rfc/proposed/0023-media-asset-storage.md).

### v0.2: Production-Ready L402 Flows (Shipped)
* **Goal**: Provide an end-to-end, secure payment path for machine-to-machine transactions.
* **Status**: Shipped. Agents can now natively purchase and redeem Lightning network macaroons (L402) for premium content access.
* **Documentation**: See [L402 Protocol](/doc/concepts/l402-protocol.md).

### v0.1: Context-Aware Headless CMS (Shipped)
* **Goal**: Establish the core structured content models, validation schemas, and API primitives.
* **Status**: Shipped. Core entity framework, domains, API Key scopes, role management, schema-aware content references, field-aware content queries, grouped content projections, public write lanes, and TTL lifecycle archival for session-like content are stable.

---

## 📅 Near-Term Priorities

These features are currently in active development or polishing phases for upcoming minor releases.

### 1. Vector RAG Simplification
- **Status**: Rolling out.
- **Description**: Making native `pgvector` semantic search easier to enable. We now auto-detect `OPENAI_API_KEY` on startup, automatically generating embeddings for published content without requiring complex external pipeline deployments.

### 2. Extensibility and Plugins (RFC 0022)
- **Status**: Proposed.
- **Description**: Designing a Strapi-style plugin architecture to allow the community to extend the Express/Fastify API boundaries and MCP toolsets without continuously forking the core runtime.

### 3. API Polish and Error Schemas
- **Status**: In progress.
- **Description**: Standardizing error payloads across both GraphQL and REST, ensuring AI agents receive consistent, actionable `recommendedNextAction` directives when validations fail.

### 4. Remote Asset Providers & Operator UX (RFC 0023)
- **Status**: In progress.
- **Description**: The core asset runtime is now live. The remaining rollout work is expanding beyond the local provider (`S3`/`R2`-style adapters) and exposing asset lifecycle controls in the supervisor UI so operators do not need the CLI for day-to-day asset management.

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

> **Note to Contributors**: We recommend building tools and integrations against the Tier 1 Feature constraints defined in the [Features Concept Guide](/doc/concepts/features.md) rather than relying on experimental modules.
