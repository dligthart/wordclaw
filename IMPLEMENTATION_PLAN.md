# WordClaw - AI-Native Content Runtime

## Executive Summary

WordClaw should be positioned as an **AI-native content runtime**, not only a headless CMS.
The goal is to give autonomous agents a deterministic, safe, and monetizable way to read, create, update, and distribute structured content.

## Problem

Most CMS platforms optimize for human editors, while agents require:

- Deterministic machine contracts (predictable success + error structures)
- Actionable next-step guidance for autonomous workflows
- Safe execution modes (dry-run, rollback, audit trail)
- Protocol-native interoperability (MCP + API contracts)
- Built-in policy and payment primitives for autonomous commerce

## Improved Product Concept

### Positioning

WordClaw is the **control plane for agent-driven content operations**.

### Who It Serves

- AI product teams orchestrating autonomous content workflows
- Platform teams exposing safe content operations to internal agents
- Multi-channel publishing teams requiring governance and traceability

### Core Value Proposition

- Faster agent integration: predictable contracts and MCP tools
- Safer autonomy: simulation, policy, rollback, and auditability
- Better economics: usage metering and x402/L402-ready paid operations

## Product Principles

- Determinism first: every route/tool should have stable machine contracts
- Safe by default: writes must support dry-run, traceability, and rollback
- Protocol-native: REST, GraphQL, and MCP must expose equivalent capabilities
- Policy-aware: authn/authz, quotas, approvals, and cost controls are first-class
- Agent UX over human UI: optimize payload shape and decision guidance

## Differentiators

- AI-guided response envelope (`recommendedNextAction`, `availableActions`, priority)
- Unified multi-interface surface (REST + GraphQL + MCP)
- Version history + rollback designed for autonomous edits
- Audit logs optimized for supervision and forensic replay
- Roadmap path to paywalled autonomous operations (x402/L402)

## Scope Definition

### In Scope (MVP+)

- Content type + content item lifecycle
- Deterministic route/tool contracts
- Dry-run, rollback, audit logs
- MCP tool/resource/prompt surface
- Basic operator documentation and verification suite

### Out of Scope (Until Product-Market Validation)

- Full WYSIWYG-focused editorial UI
- Complex multi-tenant enterprise IAM
- Heavy media pipeline/asset transformation
- Marketplace ecosystem

## Conceptual Architecture

### Control Plane

- Schema governance (content types)
- Policy enforcement (auth, quotas, approvals)
- Cost/metering rules

### Data Plane

- Content CRUD
- Versioning and rollback
- Audit logs

### Agent Plane

- REST and GraphQL interfaces
- MCP tools/resources/prompts
- Agent guidance metadata

## Delivery Roadmap (Improved)

### Phase 1: Core Runtime Foundation

Objective: reliable data model and CRUD baseline.

Deliverables:

- Type-safe backend runtime and DB integration
- Content types + content items schema
- Baseline REST CRUD

Exit Criteria:

- CRUD passes automated and verification-script checks
- clean migrations and reproducible local setup

### Phase 2: Agent Contract Layer

Objective: deterministic machine contracts and safer request handling.

Deliverables:

- Standard response envelope and structured errors
- Dry-run for write operations
- Rate limiting and remediation semantics

Exit Criteria:

- Contract tests for success/error envelopes
- no ambiguous 500s for common client mistakes

### Phase 3: MCP Runtime Surface

Objective: first-class tool protocol for agent interoperability.

Deliverables:

- MCP tools for content lifecycle
- MCP resources and prompts for guided workflows
- parity checks between REST and MCP capabilities

Exit Criteria:

- MCP tool list and calls verified by automated scripts
- key operations support dry-run + clear errors

### Phase 4: Operational Safety and Governance

Objective: make autonomous edits reversible and auditable.

Deliverables:

- Version history and rollback semantics
- Audit logging for create/update/delete/rollback
- Supervisor-oriented observability endpoints

Exit Criteria:

- rollback success + failure modes covered by tests
- audit events emitted consistently

### Phase 5: Packaging and Adoption Readiness

Objective: make onboarding and deployment reproducible.

Deliverables:

- containerized runtime and migration workflow
- clear docs for setup, test modes, and verification scripts
- licensing and contribution hygiene

Exit Criteria:

- fresh-clone setup succeeds without tribal knowledge
- default test workflow stable in CI and local environments

### Phase 6: x402/L402 Payment Protocol

Objective: enable programmable paid operations for agents.

Deliverables:

- x402/L402 protocol assessment and compatibility design
- `402 Payment Required` middleware for premium routes
- compliant payment provider integration for settlement + receipts

Exit Criteria:

- protected endpoints enforce payment flow deterministically
- payment-failure states return machine-actionable remediation

## Quality and Reliability Strategy

- Contract tests for critical route behavior and error mapping
- Integration smoke tests gated for live-stack environments
- Verification scripts for dry-run, versioning, MCP, and audit behavior
- Build must remain green before merging roadmap increments

## Success Metrics

### Product Metrics

- Time-to-first-agent-operation from fresh clone
- Percentage of agent requests resolved without human intervention
- Failure-to-remediation ratio for non-2xx responses

### Engineering Metrics

- Contract test pass rate
- Migration reproducibility on clean databases
- MCP/REST capability parity coverage

### Business Metrics (Phase 6+)

- Paid-operation conversion rate
- Revenue per automated workflow
- Payment-failure recovery rate

## Key Risks and Mitigations

- Contract drift between REST, GraphQL, and MCP:
  mitigate with parity test matrix and release gates.
- Schema/migration drift:
  mitigate with migration checks on fresh DB in CI.
- Unsafe autonomous writes:
  mitigate with dry-run defaults, approvals, rollback, and audit trails.
- Payment protocol complexity:
  mitigate via provider abstraction and phased x402 rollout.

## Strategic Next Step

Build a **policy and approvals layer** on top of the parity baseline:

- Route/tool-level policy contracts (who/what/when) with deterministic denial reasons
- Approval workflow for high-risk write operations
- Quota and cost-governor hooks to prepare paid/limited autonomous execution
