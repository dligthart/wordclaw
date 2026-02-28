# RFC 0020: Autonomous Content Ops Agent

**Author:** Codex  
**Status:** Proposed  
**Date:** 2026-02-28  

## 1. Summary
This RFC proposes a first-class autonomous content operations agent that can continuously run editorial and growth loops inside WordClaw: triage drafts, apply safe updates, submit for review, and execute post-publish actions.  

The goal is to turn WordClaw from “APIs agents call manually” into a supervised, policy-safe execution system where agents can operate on goals, not only individual CRUD calls.

## 2. Motivation
WordClaw already provides the core primitives:
- policy and tenant isolation,
- workflow and review gates,
- monetization and entitlement rails,
- audit logging and protocol parity.

What is missing is a native operations layer that composes those primitives into repeatable autonomous runs. Without that layer:
- operators manually stitch logic across many API calls,
- failure recovery is inconsistent,
- agent behavior is hard to compare and optimize,
- supervisor oversight happens after-the-fact instead of during execution.

## 3. Proposal
Introduce an **Autonomous Content Ops Agent runtime** with:

1. **Goal-driven runs**
- Agent executes named goals (e.g., “clear review backlog”, “improve conversion on paid items”, “publish ready drafts”).

2. **Plan -> action graph**
- Each run compiles to explicit actions against existing APIs (content, workflow, offers, distribution).

3. **Guardrailed execution**
- Policy checks, tenant bounds, and workflow constraints enforced before every mutation.

4. **Supervisor control plane**
- Approve/pause/cancel runs, inspect action trace, and replay failed steps.

5. **Protocol parity**
- Run lifecycle and status available through REST, GraphQL, and MCP.

## 4. Technical Design (Architecture)
### 4.1 Core Runtime Model
Add run-level entities:
- `agent_run_definitions` (goal template + strategy config),
- `agent_runs` (execution instance + status),
- `agent_run_steps` (deterministic action log with request/response snapshots),
- `agent_run_checkpoints` (resume markers and rollback hints).

All entities are tenant-scoped and auditable.

### 4.2 Execution State Machine
`queued -> planning -> waiting_approval -> running -> succeeded | failed | cancelled`

Step-level statuses:
`pending -> executing -> succeeded | failed | skipped`

Runs support resume from checkpoint after transient failures.

### 4.3 Capability Composition
Initial built-in run types:
- **Review Backlog Manager**: detect draft items, submit via workflow, notify assignees.
- **Quality Refiner**: apply policy-safe content updates and rerun schema checks.
- **Monetization Operator**: detect monetizable items and propose/create offers (behind approval policy).

Each step maps to existing APIs and writes deterministic machine-readable outcomes.

### 4.4 Safety and Governance
- Mandatory dry-run planning mode before first execution.
- Optional human approval for high-risk step categories (publish/delete/pricing changes).
- Idempotency keys per step to prevent duplicate side effects.
- Tenant boundary enforced at plan time and step execution time.

### 4.5 Protocol Surfaces
Add parity endpoints/operations/tools:
- REST:
  - `POST /api/agent-runs`
  - `GET /api/agent-runs`
  - `GET /api/agent-runs/:id`
  - `POST /api/agent-runs/:id/control` (`approve|pause|resume|cancel`)
- GraphQL:
  - `createAgentRun`, `agentRuns`, `agentRun`, `controlAgentRun`
- MCP:
  - `create_agent_run`, `list_agent_runs`, `get_agent_run`, `control_agent_run`

### 4.6 Observability
- Per-run metrics: completion rate, mean time to complete, failure classes, policy-denied step count.
- Per-goal metrics: business outcomes (review queue reduction, publish throughput, offer conversion lift).
- Full traceability via audit-linked run step IDs.

## 5. Alternatives Considered
- **External orchestrator only**: rejected; weak integration with policy/workflow and poor tenant guarantees.
- **Cron-based scripts per use case**: rejected; not reusable, low observability, high drift risk.
- **Pure supervisor manual ops**: rejected; does not realize agentic automation value proposition.

## 6. Security & Privacy Implications
- Strict tenant scoping on run planning, candidate selection, and step execution.
- Fail-closed policy decisions for mutations.
- Approval gates for privileged operations.
- Sensitive payload redaction in step logs where needed.
- Scoped API keys for run execution identity with minimal permissions.

## 7. Rollout Plan / Milestones
1. **Phase 1: Runtime skeleton**
- Schema + run state machine + basic run CRUD/control.

2. **Phase 2: First run type**
- Implement Review Backlog Manager with dry-run and approval gates.

3. **Phase 3: Protocol parity**
- Add GraphQL/MCP surfaces and parity tests.

4. **Phase 4: Monetization coupling**
- Add monetization-aware run modules and supervisor policy controls.

5. **Phase 5: Hardening**
- Reliability, checkpoint recovery, and production telemetry thresholds.

## 8. Acceptance Criteria
- Operators can start, inspect, and control autonomous runs in all three protocols.
- Every step is policy-checked, tenant-scoped, and audit-linked.
- Failed runs are resumable from checkpoints.
- At least one built-in run type demonstrates measurable operational improvement.
- Parity and isolation tests pass in CI for run lifecycle APIs.
