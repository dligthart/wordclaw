# RFC 0021: Core Product Focus and Feature Pruning

**Author:** Codex  
**Status:** Proposed  
**Date:** 2026-03-06  

## 1. Summary
This RFC proposes a product focus reset for WordClaw. The project should narrow around its strongest concept: a headless content runtime for AI agents and human supervisors, with strict safety, structured content contracts, and optional machine-native monetization.

The recommendation is to strengthen the core and actively prune adjacent bets that dilute the concept: mandatory tri-protocol parity, AP2-forward marketing, revenue-routing and payout mechanics, broad autonomous-run ambitions, and speculative roadmap branches such as distribution, recommender, and blog-valuation systems.

## 2. Motivation
WordClaw already has a compelling core idea:
- structured content types and items,
- validation and versioning,
- agent-friendly remediation metadata,
- dry-run safety,
- tenant isolation and policy enforcement,
- approval workflow,
- MCP support,
- optional L402 monetization.

That core is coherent and differentiated. The rest of the repo increasingly pulls it in several different directions at once:

1. **Protocol breadth creates a large maintenance tax**
- REST, GraphQL, and MCP parity is enforced as a product rule.
- The duplicated surface spans large files:
  - `src/api/routes.ts`
  - `src/graphql/resolvers.ts`
  - `src/mcp/server.ts`
- Every new feature now inherits a three-surface implementation burden before product fit is proven.

2. **The product story is broader than the runtime reality**
- README positions WordClaw as an AI-first CMS.
- The product-market-fit analysis already recommends doubling down on MCP and keeping the API footprint lean.
- At the same time, README and demos advertise AP2-driven marketplace behavior while the runtime explicitly rejects non-Lightning payment methods.

3. **Economic and orchestration features now compete with the CMS concept**
- The schema includes contribution tracking, revenue allocation, payout batching, entitlement delegation, and autonomous run state.
- Those features push WordClaw toward becoming a marketplace, accounting system, and agent orchestration platform instead of a sharp agent-ready content system.

4. **The supervisor surface risks becoming a second product**
- WordClaw should expose a control plane, not become a full operator suite plus experimentation environment plus payment operations console.
- The current repo structure and docs suggest that UI and demo boundaries are still blurred.

Without pruning, WordClaw risks becoming impressive but unclear: a technically rich project with several partially overlapping product identities and no single obvious wedge.

## 3. Proposal
Re-center WordClaw around one product statement:

**WordClaw is the safe content runtime for AI agents.**

That means agents can discover, validate, simulate, read, write, and route content changes inside a strongly governed system. Human supervisors retain visibility and approval control. Optional monetization may exist, but it must remain subordinate to the content-runtime concept.

### 3.1 Keep and Strengthen
These areas are aligned and should become the default product:

- Structured content types and content items
- Version history and rollback
- Agent-friendly REST responses with remediation metadata
- MCP as the primary agent-native surface
- Dry-run and policy evaluation flows
- Tenant isolation and auditability
- Review workflow and approval gates
- Semantic search and embeddings as an optional but aligned agent capability
- A minimal supervisor UI for oversight, not for primary authoring
- L402 as the only supported payment rail unless and until another rail is production-ready

### 3.2 Demote or Remove From the Core Product
The following should be removed from the default product scope or explicitly downgraded to experimental status.

1. **Mandatory GraphQL parity**
- Stop requiring every capability to ship across REST, GraphQL, and MCP.
- New features should target REST and MCP first.
- GraphQL should be frozen as compatibility surface or removed later if usage is low.

2. **AP2 as a near-term product commitment**
- Remove AP2 from top-level positioning, demos, and “current capabilities” language until it is a real runtime path.
- Keep AP2 only as an incubating RFC, not as current product narrative.

3. **Revenue attribution, payout batching, and agent earnings as core platform behavior**
- Move revenue-split accounting and payout operations out of the default WordClaw runtime.
- If retained, they should become an optional extension package, not part of the core CMS identity.

4. **Advanced entitlement mechanics not required for the primary use case**
- Reduce the default monetization contract to simple offer purchase plus entitlement enforcement.
- Defer or remove delegation, broad subscription abstractions, and redistribution-oriented policy surface until real demand exists.

5. **Autonomous-run framework as a product pillar**
- Do not expand autonomous content-ops runs into a major platform direction yet.
- Keep only the minimum automation needed to support workflow and internal operational loops.

6. **Speculative product branches as active roadmap signals**
- Reclassify the following RFCs as incubating ideas rather than near-term roadmap:
  - blog valuation,
  - multi-channel distribution orchestration,
  - internal recommender engine,
  - AP2 expansion,
  - broad autonomous content ops.

7. **Non-core supervisor pages**
- The supervisor should focus on:
  - content,
  - schemas,
  - approvals,
  - audit,
  - agent keys.
- Payment operations consoles, readiness dashboards, and sandbox/demo experiences should move to docs or experimental surfaces unless they are essential to daily operator control.

### 3.3 Product Tiers
WordClaw should explicitly label features in three tiers.

| Tier | Meaning | Included Areas |
| --- | --- | --- |
| **Tier 1: Core** | Default product, actively maintained, documented first | content modeling, validation, versioning, workflow, audit, policy, tenant isolation, REST, MCP, dry-run, minimal supervisor, optional L402 |
| **Tier 2: Optional Modules** | Supported extensions with clear boundaries | semantic search, selected monetization add-ons |
| **Tier 3: Incubator** | Not promised, not marketed as core, may be removed | GraphQL parity expansion, AP2, payouts, distribution, recommender, autonomous-run platformization |

### 3.4 Documentation Rule
Top-level docs must distinguish:
- **supported today**
- **optional module**
- **experimental / RFC only**

README, landing pages, and demo descriptions must stop presenting RFC-stage or disabled capabilities as if they are part of the current product.

## 4. Technical Design (Architecture)
This proposal changes boundaries more than algorithms.

### 4.1 Runtime Boundaries
Reorganize the backend into explicit capability domains:

- `core-content`
  - content types
  - content items
  - versioning
  - rollback
  - audit
- `core-governance`
  - auth
  - policy
  - dry-run
  - tenant isolation
  - workflow and approvals
- `core-agent-surface`
  - REST contract
  - MCP tools/resources/prompts
- `optional-search`
  - embeddings
  - semantic search
- `optional-monetization-l402`
  - L402 challenge and settlement
  - offers and entitlements
- `incubator`
  - GraphQL parity layer
  - payouts
  - AP2
  - autonomous runs
  - other speculative systems

### 4.2 Protocol Strategy
Adopt this protocol policy:

- **Tier 1 required:** REST and MCP
- **Tier 2 optional:** GraphQL

The parity contract should be rewritten accordingly:
- REST and MCP remain contract-critical.
- GraphQL becomes best-effort unless explicitly promoted back into Tier 1.

### 4.3 Monetization Simplification
Retain only the simplest monetization flow inside core-adjacent scope:

1. define offer
2. challenge with L402
3. confirm payment
4. activate entitlement
5. consume entitlement on read

Defer or remove:
- AP2 settlement paths,
- revenue allocation ledgers,
- payout batching and transfer orchestration,
- earnings dashboards,
- entitlement delegation,
- redistribution-oriented license complexity that depends on future distribution features.

### 4.4 Supervisor UI Scope
The built-in UI should act as an operator control plane, not a second platform.

Keep:
- dashboard,
- content browser,
- schema manager,
- approvals,
- audit logs,
- key management.

Move out of the default UI:
- sandbox/demo experiences,
- payment operations pages,
- L402 readiness setup flows,
- experimental feature consoles.

### 4.5 Repo and Docs Hygiene
To support the product reset:

- stop shipping generated or demo-only assets as if they are core product surfaces,
- replace placeholder UI documentation with actual operator documentation,
- mark experimental RFCs and demos clearly,
- ensure “implemented” means production-supported, not merely coded.

## 5. Alternatives Considered
- **Keep the current all-in-one direction**
  - Rejected because it compounds maintenance cost and weakens the product story.

- **Remove monetization entirely**
  - Rejected because L402 is still a meaningful differentiator when kept narrow.

- **Double down on the marketplace vision**
  - Rejected because it pulls WordClaw away from CMS/runtime clarity and into payment-network, settlement, and payouts complexity.

- **Keep tri-protocol parity as a hard rule**
  - Rejected because MCP already serves the strongest agent-native use case, while GraphQL adds significant duplicate implementation cost.

## 6. Security & Privacy Implications
This RFC reduces risk by shrinking the default attack surface:

- fewer payment and settlement paths,
- fewer privileged supervisor operations,
- fewer protocol surfaces that must stay behaviorally identical,
- fewer long-lived financial records in the default runtime,
- less ambiguity about which features are safe for production use.

The core safety model remains:
- fail-closed auth and policy checks,
- tenant-scoped access,
- dry-run before mutation where supported,
- auditable state changes,
- human approval for high-risk workflow transitions.

## 7. Rollout Plan / Milestones
1. **Phase 1: Product labeling reset**
- Update docs to distinguish core, optional, and experimental.
- Remove AP2 and other incubator items from top-level feature claims.

2. **Phase 2: Protocol reset**
- Change parity contracts so REST and MCP are the only mandatory surfaces for new capabilities.
- Freeze GraphQL expansion.

3. **Phase 3: Monetization pruning**
- Mark payout, earnings, delegation, and advanced licensing APIs as deprecated or experimental.
- Keep only L402 offer/entitlement basics in the supported path.

4. **Phase 4: Supervisor boundary cleanup**
- Move sandbox and payment/readiness pages out of the default operator UI or into an experimental section.

5. **Phase 5: Runtime extraction and deletion**
- Split code into capability modules.
- Remove unused incubator paths after a deprecation window and usage check.

## 8. Acceptance Criteria
- WordClaw can be described in one sentence without mentioning marketplaces, payouts, or speculative finance rails.
- README and docs clearly separate supported features from RFC-stage ideas.
- New core capabilities are required only on REST and MCP.
- The default supervisor UI is limited to operator oversight and governance.
- AP2, payouts, and speculative orchestration features are no longer marketed as part of the current product.
- The supported monetization path is limited to L402-backed offer and entitlement flows.
- The roadmap is visibly narrower and more aligned with the AI-first CMS concept.
