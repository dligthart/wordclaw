# RFC 0013: Agent Sandbox Showcase — Demonstrating WordClaw's Differentiators

**Author:** Claude (AI-assisted)
**Status:** Implemented
**Date:** 2026-02-24
**Related Issues:** #99, #100, #101

## 1. Summary

The Agent Sandbox currently covers only 9 of 39 REST endpoints with single-request templates that fail to demonstrate what makes WordClaw unique. This RFC proposes redesigning the sandbox into a **guided scenario engine** with multi-step walkthroughs that showcase WordClaw's six core differentiators: AI-friendly error remediation, L402 Lightning payment gating, policy-driven editorial workflows, tri-protocol parity (REST/GraphQL/MCP), multi-domain tenant isolation, and semantic RAG search via pgvector.

## 2. Motivation

WordClaw positions itself as the "database layer for the Agentic Web" — an AI-first headless CMS that goes far beyond CRUD. However, the current Agent Sandbox tells none of that story:

- **Low coverage**: 9 templates cover content types, content items, a single L402 stub, and audit logs. Workflows, semantic search, API key management, review tasks, GraphQL, MCP, and policy evaluation are entirely absent.
- **No multi-step flows**: Real agent interactions are multi-step (create type → create item → trigger workflow → approve → publish → search). Isolated requests hide the platform's value.
- **No error scenario storytelling**: WordClaw's structured error remediation (`code`, `remediation`, `meta.recommendedNextAction`) is a key differentiator, yet only one template intentionally triggers an error.
- **No protocol comparison**: Tri-protocol parity is a headline feature, but the sandbox only speaks REST.

A redesigned sandbox converts evaluators, developers, and AI agents from "API testers" into participants in guided product tours that communicate *why* WordClaw exists.

## 3. Proposal

### 3.1 Scenario-Based Architecture

Replace the flat template dropdown with a **Scenario Runner** — a sidebar of guided, multi-step scenarios grouped by differentiator. Each scenario contains an ordered list of steps. Selecting a scenario loads the first step; completing it advances to the next.

```
┌─────────────────────────────────────────────────────────────────┐
│ Agent Sandbox                                                    │
├──────────────┬───────────────────────┬──────────────────────────┤
│  Scenarios   │   Request Panel       │   Response Panel          │
│              │                       │                           │
│ ▸ Quick Start│  Step 2 of 5:         │   { status: 201, ... }    │
│   AI Errors  │  "Create a blog post" │                           │
│   L402 Pay   │                       │   ✓ Step 1 complete       │
│   Workflows  │  [POST] /api/content  │   ● Step 2 in progress   │
│   Protocols  │  { body... }          │   ○ Step 3 pending        │
│   RAG Search │                       │   ○ Step 4 pending        │
│   Multi-Dom  │  [Send Request]       │   ○ Step 5 pending        │
│   Keys/Auth  │                       │                           │
└──────────────┴───────────────────────┴──────────────────────────┘
```

Each step includes:
- **Narration**: A short explanation of what this step demonstrates and why it matters.
- **Pre-filled request**: Method, endpoint, headers, and body auto-populated.
- **Dynamic binding**: Later steps can reference IDs returned by earlier steps (e.g., `contentTypeId` from step 1 feeds into step 2).
- **Expected outcome hint**: A badge showing the expected HTTP status (e.g., `expects 201`, `expects 402`, `expects 422`).

The existing free-form request builder remains available as an "Advanced" tab for power users.

### 3.2 Proposed Scenarios

#### Scenario 1: Quick Start — Content Lifecycle (existing, enhanced)
Demonstrates basic CRUD and shows the audit trail.

| Step | Action | Demonstrates |
|------|--------|-------------|
| 1 | `POST /api/content-types` — Create "Blog Post" type | Schema-driven content modeling |
| 2 | `POST /api/content-items` — Create valid blog post | JSON-schema validated content creation |
| 3 | `GET /api/content-items/:id` — Read back the item | Structured response format |
| 4 | `PUT /api/content-items/:id` — Update the post | Versioning (response shows incremented `version`) |
| 5 | `GET /api/audit-logs?entityType=content_item` — View audit trail | Full provenance tracking |

#### Scenario 2: AI-Friendly Error Remediation
Demonstrates WordClaw's structured error responses that help agents self-correct.

| Step | Action | Demonstrates |
|------|--------|-------------|
| 1 | `POST /api/content-items` — Missing required field | `SCHEMA_VALIDATION_ERROR` with `remediation` and `recommendedNextAction` |
| 2 | `POST /api/content-items` — Invalid `contentTypeId` | `CONTENT_TYPE_NOT_FOUND` with remediation suggesting list endpoint |
| 3 | `POST /api/content-items?mode=dry_run` — Dry-run validation | Validate without side effects — shows agents can "test before committing" |
| 4 | `POST /api/content-items` — Corrected payload | Success after following remediation advice |

**Narration**: "Unlike traditional CMSes that return opaque 400 errors, WordClaw tells your agent exactly what went wrong and how to fix it — enabling autonomous self-correction loops."

#### Scenario 3: L402 Lightning Payment Flow
Demonstrates machine-to-machine payment gating via Lightning Network.

| Step | Action | Demonstrates |
|------|--------|-------------|
| 1 | `POST /api/content-types` — Create "Guest Post" type with L402 policy | Content type with payment requirement |
| 2 | `POST /api/content-items` — Attempt without payment | HTTP `402 Payment Required` with Lightning invoice in `WWW-Authenticate` header |
| 3 | `GET /api/payments` — Show pending invoice | Payment ledger tracking |
| 4 | *(Narration-only step)* — Explain Macaroon token settlement | How agents would settle and retry with `Authorization: L402 <macaroon>:<preimage>` |

**Narration**: "WordClaw is the first CMS with native L402 support — agents can pay-per-action with Bitcoin Lightning, enabling autonomous content marketplaces."

#### Scenario 4: Policy-Driven Editorial Workflow
Demonstrates the full content approval pipeline.

| Step | Action | Demonstrates |
|------|--------|-------------|
| 1 | `GET /api/workflows` — List available workflows | Workflow discovery |
| 2 | `POST /api/content-items` — Create item as `draft` | Content enters workflow |
| 3 | `POST /api/content-items/:id/transition` — Submit for review | State machine transition (draft → review) |
| 4 | `GET /api/review-tasks` — View pending review task | Human-in-the-loop approval queue |
| 5 | `POST /api/review-tasks/:id/decide` — Approve the task | Decision moves content to `published` |
| 6 | `GET /api/content-items/:id` — Verify published state | End-to-end workflow completion |

**Narration**: "WordClaw enforces editorial governance — AI agents propose, humans approve. The policy engine ensures no content goes live without the right sign-offs."

#### Scenario 5: Tri-Protocol Parity
Demonstrates the same operation across REST, GraphQL, and MCP.

| Step | Action | Demonstrates |
|------|--------|-------------|
| 1 | `POST /api/content-items` — Create item via REST | REST interface |
| 2 | `POST /api/graphql` — Query the same item via GraphQL | GraphQL parity |
| 3 | *(Narration)* — Show equivalent MCP tool call JSON | MCP parity for AI tool-use |
| 4 | `GET /api/content-items/:id` — Confirm identical data across protocols | Data consistency guarantee |

**Narration**: "Whether your agent speaks REST, GraphQL, or MCP tool-use — WordClaw responds identically. One runtime, three protocols, zero translation layers."

#### Scenario 6: Semantic Search & RAG
Demonstrates vector-powered content discovery.

| Step | Action | Demonstrates |
|------|--------|-------------|
| 1 | `POST /api/content-items` — Create 2-3 items with varied content | Seed searchable content |
| 2 | `GET /api/search/semantic?q=...` — Natural language query | pgvector cosine similarity search |
| 3 | `GET /api/search/semantic?q=...&threshold=0.8` — Narrow results with threshold | Precision control for RAG pipelines |

**Narration**: "WordClaw embeds content automatically on publish. Agents can semantically search your entire content library — no external vector DB required."

#### Scenario 7: Multi-Domain Tenant Isolation
Demonstrates cross-domain data separation.

| Step | Action | Demonstrates |
|------|--------|-------------|
| 1 | `POST /api/content-items` with `x-wordclaw-domain: 1` — Create item in Domain A | Domain-scoped creation |
| 2 | `GET /api/content-items` with `x-wordclaw-domain: 2` — Query Domain B | Item from step 1 is invisible |
| 3 | `GET /api/content-items` with `x-wordclaw-domain: 1` — Query Domain A | Item is visible only in its domain |

**Narration**: "Every operation in WordClaw is domain-scoped. A single deployment can power multiple brands, publications, or tenants with complete data isolation."

#### Scenario 8: Agent Key Management
Demonstrates API credential lifecycle.

| Step | Action | Demonstrates |
|------|--------|-------------|
| 1 | `POST /api/auth/keys` — Create scoped API key | Fine-grained agent credentialing |
| 2 | `GET /api/auth/keys` — List all keys (prefix only) | Secret never re-exposed |
| 3 | `PUT /api/auth/keys/:id` — Rotate key | Zero-downtime secret rotation |
| 4 | `DELETE /api/auth/keys/:id` — Revoke key | Instant access termination |

## 4. Technical Design (Architecture)

### 4.1 Scenario Data Model

Scenarios are defined as a TypeScript array of objects, co-located with the sandbox page:

```typescript
type ScenarioStep = {
  title: string;
  narration: string;          // Markdown-rendered explanation
  method: HttpMethod;
  endpoint: string;           // Supports {{variable}} interpolation
  body?: Record<string, any>; // Template with {{variable}} refs
  headers?: Record<string, string>;
  expectedStatus?: number;
  captureFromResponse?: {     // Extract values for later steps
    [varName: string]: string; // JSONPath-like accessor e.g. "data.id"
  };
  narrativeOnly?: boolean;    // Step with no request, just explanation
};

type Scenario = {
  id: string;
  title: string;
  icon: string;               // Hero icon name
  tagline: string;            // One-line summary for sidebar
  differentiator: string;     // Category label
  steps: ScenarioStep[];
};
```

### 4.2 Scenario Runner State

The runner tracks execution state per-scenario:

```typescript
let activeScenario = $state<Scenario | null>(null);
let currentStepIndex = $state(0);
let stepResults = $state<Map<number, { status: number; data: any; elapsed: number }>>(new Map());
let capturedVars = $state<Map<string, any>>(new Map());
```

When a step completes:
1. Response is stored in `stepResults`.
2. Any `captureFromResponse` values are extracted and stored in `capturedVars`.
3. `currentStepIndex` advances.
4. Next step's endpoint/body are interpolated using `capturedVars`.

### 4.3 UI Components

| Component | Responsibility |
|-----------|---------------|
| `ScenarioSidebar.svelte` | Lists scenarios grouped by differentiator, shows progress (completed steps / total) |
| `StepTimeline.svelte` | Vertical timeline in response panel showing step status (✓ complete, ● active, ○ pending) |
| `NarrationBlock.svelte` | Renders step narration as styled markdown callout above the request panel |
| `StatusBadge.svelte` | Shows expected vs actual HTTP status comparison |

### 4.4 Backward Compatibility

The existing free-form request builder is preserved as an **"Advanced" tab** alongside the new "Guided Scenarios" tab. The template dropdown remains functional within the Advanced tab for users who prefer the current UX.

### 4.5 Data Flow

```
User selects scenario
  → Load step[0], interpolate {{vars}} from capturedVars
  → User clicks "Send Request"
  → executeRequest() runs (existing function, unchanged)
  → On response: capture variables, record result, advance step
  → Repeat until all steps complete
  → Show completion summary with key takeaways
```

## 5. Alternatives Considered

| Alternative | Why Discarded |
|-------------|---------------|
| **Auto-play scenarios** (run all steps automatically) | Removes learning moment; users should see each request/response to understand the flow |
| **Separate demo app** outside the Supervisor UI | Fragments the experience; the sandbox is already the natural home for exploration |
| **Video walkthroughs instead of interactive scenarios** | Non-interactive; agents can't consume videos; doesn't prove the API actually works |
| **Jupyter-notebook style** with inline code cells | Over-engineered for this use case; the request/response paradigm is well-understood |

## 6. Security & Privacy Implications

- **No new API surface**: The sandbox uses existing API endpoints. No new backend routes are introduced.
- **Domain isolation preserved**: Scenarios that demonstrate multi-domain use the existing `x-wordclaw-domain` header mechanism.
- **API key scenarios**: Created keys during sandbox demos are real. The narration should warn users to revoke demo keys after exploration.
- **L402 scenarios**: If Lightning is not configured, the L402 scenario should gracefully degrade with a narration explaining the expected behavior and showing a mock 402 response.

## 7. Rollout Plan / Milestones

### Phase 1: Scenario Engine (Core)
- Implement `ScenarioStep` / `Scenario` type system and runner state
- Build `ScenarioSidebar`, `StepTimeline`, and `NarrationBlock` components
- Migrate existing free-form builder to "Advanced" tab
- Implement variable capture and interpolation between steps

### Phase 2: Initial Scenarios (High-Impact)
- Scenario 1: Quick Start (enhanced from existing templates)
- Scenario 2: AI-Friendly Error Remediation
- Scenario 4: Policy-Driven Editorial Workflow
- Scenario 6: Semantic Search & RAG

### Phase 3: Full Differentiator Coverage
- Scenario 3: L402 Lightning Payment Flow
- Scenario 5: Tri-Protocol Parity
- Scenario 7: Multi-Domain Tenant Isolation
- Scenario 8: Agent Key Management

### Phase 4: Polish
- Completion summary screen with "what you just saw" recap
- Scenario progress persistence in `localStorage`
- "Reset scenario" and "replay step" controls
- Shareable scenario URLs (deep-link to specific scenario + step)
