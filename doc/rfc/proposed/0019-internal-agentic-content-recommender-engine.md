# RFC 0019: Internal Agentic Content Recommender Engine

**Author:** Codex  
**Status:** Proposed  
**Date:** 2026-02-28  

## 1. Summary
This RFC proposes an internal recommender engine that helps agents choose the next best content items to read, update, distribute, or monetize inside WordClaw. The engine is tenant-scoped, policy-aware, and exposed with parity across REST, GraphQL, and MCP.

The core goal is to keep recommendations aligned with the agentic product concept: deterministic machine-usable outputs, explicit rationale, safe execution boundaries, and direct integration with monetization and workflow signals.

## 2. Motivation
WordClaw already has strong building blocks (content schemas, semantic search, workflow, entitlement licensing, payments, and policy context), but agents still need manual orchestration logic to decide what to do next.

Without a built-in recommender layer:
- Agents repeat expensive broad queries before acting.
- Priority handling is inconsistent across clients.
- Monetizable opportunities (eligible offers, expiring entitlements, high-value drafts) are discovered late.
- Supervisors lack a single place to tune recommendation behavior.

An internal engine turns existing signals into ranked, action-oriented recommendations that agents can execute safely.

## 3. Scope
In scope:
- Content recommendation ranking and serving for agent workflows.
- Policy/tenant enforcement in retrieval and scoring.
- Explainable recommendation metadata for machine execution.
- Protocol parity for recommendation read APIs.
- Feedback capture to improve ranking quality.

Out of scope:
- External personalization SDKs.
- Cross-tenant collaborative filtering.
- Black-box model hosting outside WordClaw control plane.

## 4. Proposal
Introduce a recommendation subsystem with four principles:

1. **Agent-First Outputs**  
Each recommendation includes `reasonCodes`, `scoreBreakdown`, and `recommendedNextAction`.

2. **Safety by Construction**  
Candidates are filtered through domain and policy constraints before ranking.

3. **Monetization-Aware Prioritization**  
Scoring includes offer/entitlement/payment context so agent effort maps to revenue outcomes.

4. **Closed Feedback Loop**  
Agent interactions (opened, executed, ignored, successful outcome) are logged as training signals.

## 5. Technical Design (Architecture)
### 5.1 Data Model
Add new tenant-scoped tables:
- `recommendation_profiles`  
  Stores domain-level weights and strategy settings (freshness, relevance, workflow urgency, revenue weight).
- `recommendation_events`  
  Immutable feedback events from agents/supervisors (`impression`, `opened`, `executed`, `dismissed`, `converted`).
- `recommendation_snapshots` (optional optimization)  
  Materialized candidate pools with TTL for fast serving.

All tables include `domain_id`, timestamps, and auditability metadata.

### 5.2 Ranking Pipeline
Pipeline stages:
1. Candidate retrieval from `content_items` (+ `content_types`, workflow states, offer/entitlement/payment context).
2. Hard filters:
   - domain isolation,
   - policy eligibility for current principal,
   - lifecycle eligibility (e.g., non-deleted, valid status).
3. Scoring:
   - semantic relevance (reuse existing embedding/search stack),
   - freshness/recency,
   - workflow urgency (e.g., pending review),
   - monetization potential (active offers, consumption likelihood, entitlement health),
   - historical feedback quality.
4. Response shaping with reason codes and next actions.

### 5.3 Protocol Surfaces (Parity)
Add Tier-1 capability surfaces:
- REST:
  - `GET /api/recommendations/content`
  - `POST /api/recommendations/feedback`
- GraphQL:
  - `recommendedContent(...)`
  - `recordRecommendationFeedback(...)`
- MCP:
  - `get_recommended_content`
  - `record_recommendation_feedback`

Responses must follow existing AI-friendly contracts (`meta.recommendedNextAction`, deterministic error codes, dry-run where mutation semantics apply).

### 5.4 Agentic Concept Coupling
Recommendations should be executable in one or two follow-up calls:
- Example: recommend draft item `X` with action `submit_for_review`.
- Example: recommend item `Y` with high revenue score and action `create_offer`.
- Example: recommend item `Z` for distribution and action `create_distribution_plan` (when RFC 0005 capabilities are present).

This preserves WordClaw's "agent plans -> deterministic API actions" model.

### 5.5 Supervisor Controls
Provide supervisor controls for:
- per-domain weighting profiles,
- emergency disable/kill switch,
- recommendation quality telemetry (CTR, execution rate, conversion rate),
- drift and abuse visibility.

## 6. Alternatives Considered
- **Client-side recommendation logic only**: rejected due to duplicated logic and inconsistent behavior.
- **External recommender SaaS**: rejected due to tenant isolation, explainability, and policy coupling risks.
- **Pure semantic-search ranking**: rejected because it ignores workflow and monetization priorities.

## 7. Security & Privacy Implications
- Enforce strict domain-scoped retrieval and logging.
- Apply policy checks before returning any recommendation candidate.
- Prevent feedback poisoning via scoped auth and rate limits.
- Keep recommendation explanations non-sensitive (no cross-tenant leakage in reason codes).
- Respect entitlement/paywall boundaries when suggesting actions on licensed content.

## 8. Rollout Plan / Milestones
1. **Phase 1: Foundations**
- Schema + repository layer for profiles/events.
- Initial ranking service with deterministic scoring.

2. **Phase 2: Read Surfaces**
- Add REST/GraphQL/MCP recommendation read endpoints.
- Add parity tests and tenant isolation tests.

3. **Phase 3: Feedback Loop**
- Add feedback write surfaces and ingestion pipeline.
- Add supervisor telemetry dashboard.

4. **Phase 4: Monetization & Workflow Optimization**
- Tight coupling with offer/entitlement and workflow urgency signals.
- Validate lift in execution and conversion metrics.

## 9. Acceptance Criteria
- Recommendation APIs are available across REST, GraphQL, and MCP with parity tests.
- No cross-tenant candidate leakage under integration tests.
- Recommendation payloads include machine-usable rationale and next-action guidance.
- Feedback events are stored and observable per domain.
- Supervisor can tune and disable recommendation behavior per domain.
