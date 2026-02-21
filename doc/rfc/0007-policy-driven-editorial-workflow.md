# RFC 0007: Policy-Driven Editorial Workflow and Approval Gates

**Author:** AI Assistant  
**Status:** Proposed  
**Date:** 2026-02-21  

## 1. Summary
This RFC proposes a first-class editorial workflow engine that replaces ad hoc status updates with explicit state transitions, approval policies, reviewer assignments, and decision history.

## 2. Dependencies & Graph
*   **Depends on:** Phase 7.0 (API Keys) — For `requiredRoles` enforcement and `assignee` resolution mapped to the Unified Agent Identity Model.
*   **Depends on:** Phase 4 (Audit Logging) — For emitting structured audit artifacts on state transitions.
*   **Depended on by:** RFC 0008 (Policy Parity) — Workflow transition permissions act as a core policy domain within the parity framework.

## 3. Motivation
WordClaw supports content status and a Supervisor Approval Queue UI, but approvals are currently inferred from generic item statuses (for example `draft` and `pending_approval`) without a formal workflow model. For agentic publishing, core governance needs:
* deterministic transition rules,
* role-based approval gates,
* reviewer accountability,
* auditable decision artifacts,
* protocol-consistent behavior across REST/GraphQL/MCP.

Without this, publication quality and compliance rely on conventions instead of enforceable policy.

## 4. Proposal
Introduce a workflow subsystem with:
1. **Workflow Definitions**: Named state machines per content type.
2. **Transition Policies**: Allowed `from -> to` edges requiring a matched subset of `requiredRoles` and optional `conditionJson`.
3. **Review Tasks**: Assignments and SLA tracking for human/agent reviewers.
4. **Decision Records**: Structured approve/reject/escalate outcomes with reason codes.

Content publication becomes a policy action (`submit_for_review`, `approve`, `reject`, `publish`) rather than a raw `status` mutation. The workflow engine strictly **drives** the existing item `status` field; direct mutations to `status` are rejected with `WORKFLOW_TRANSITION_FORBIDDEN` if an active workflow definition exists. If no workflow exists for a `contentType`, the legacy direct-status mutation behavior applies as a backward-compatible fallback.

## 5. Technical Design (Architecture)

### 5.1 Data Model Additions
* `workflow_definitions`
  * `id`, `name`, `contentTypeId`, `active`, `version`, `createdAt`
* `workflow_transitions`
  * `id`, `workflowDefinitionId`, `fromState`, `toState`, `requiredRoles` (String Array), `conditionJson`
* `review_tasks`
  * `id`, `contentItemId`, `state`, `assignee`, `dueAt`, `status`, `version`, `createdAt`, `updatedAt`
* `review_decisions`
  * `id`, `reviewTaskId`, `decision` (`approve`, `reject`, `escalate`), `reasonCode`, `notes`, `decidedBy`, `decidedAt`

### 5.2 API / Protocol
* REST
  * `POST /api/workflows`
  * `POST /api/content-items/:id/submit`
  * `POST /api/review-tasks/:id/decide`
  * `GET /api/review-tasks`
* GraphQL
  * `createWorkflow`, `submitContentItem`, `decideReviewTask`, `reviewTasks`
* MCP
  * `create_workflow`, `submit_content_item`, `decide_review_task`, `list_review_tasks`

### 5.3 Enforcement & Conditions
* Reject direct invalid state updates with deterministic codes (`WORKFLOW_TRANSITION_FORBIDDEN`, `REVIEW_REQUIRED`).
* `conditionJson` parsing: Standardized structural rules evaluated against the item data before transition using a strict JSONLogic subset. Unrecognized operators are explicitly rejected at workflow creation time to guarantee safe execution.
* **Task Assignment & Escalation:** V1 implements explicit manual assignment passed during the `submit_content_item` mutation. If a review task misses its SLA (`dueAt`), the system automatically escalates the decision tier or reassigns it to the default platform supervisor queue to enforce SLA velocity.
* **Optimistic Locking:** Decision submissions (`POST /api/review-tasks/:id/decide`) must provide an expected `version` integer to prevent double-approve race conditions during concurrent admin reviews.
* Emit structured audit details including workflow version and decision metadata.
* Support dry-run transition simulation for agents before mutation.

## 6. Alternatives Considered
* **Keep status-only model**: Too ambiguous for reliable policy enforcement.
* **UI-only approval logic**: Bypassable from API clients.
* **Hardcoded global workflow**: Insufficient flexibility across content types and organizations.

## 7. Security & Privacy Implications
* Decision actions must enforce role/scoped authorization leveraging the Phase 7.0 structures.
* Review notes may contain sensitive information and should be access-controlled (e.g., reviewers only).
* Transition policies should be immutable/versioned to preserve audit integrity.

## 8. Rollout Plan / Milestones
1. **Phase 1**: Add workflow schema and transition validator service.
2. **Phase 2**: Route all publish-path updates through workflow actions. Build legacy `status` fallback mechanism.
3. **Phase 3**: Expose REST/GraphQL/MCP workflow APIs and dry-run checks.
4. **Phase 4**: Upgrade Approval Queue UI to task/decision model with SLA indicators.
5. **Phase 5**: Add contract tests for invalid transitions and role-gated decisions.
6. **Future**: Provide graceful migration scripts mapping existing active content in legacy `draft` to mapped states when a new workflow policy is activated for that `contentType`.
