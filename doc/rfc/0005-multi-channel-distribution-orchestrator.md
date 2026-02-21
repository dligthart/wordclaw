# RFC 0005: Multi-Channel Distribution Orchestrator

**Author:** AI Assistant  
**Status:** Proposed  
**Date:** 2026-02-21  

## 1. Summary
This RFC introduces a distribution orchestration layer that allows agents to publish licensed content to multiple channels (webhooks, RSS/Atom, social APIs, email, partner endpoints) with deterministic scheduling, retry behavior, and observability.

## 2. Motivation
WordClaw can store and version content, but distribution is currently limited to generic webhook events. Agentic distribution needs:
* explicit channel targets,
* "publish once, fan out many" workflows,
* delivery state tracking,
* dead-letter handling for failed downstream channels,
* protocol parity so agents can run the same flow via REST/GraphQL/MCP.

Without this, monetizable content cannot reliably reach buyers or audiences at scale.

## 3. Proposal
Add a **Distribution Orchestrator** that executes distribution plans in a queued, idempotent workflow:
1. Agent creates a distribution plan for a content item/version.
2. System resolves enabled targets and channel-specific transforms.
3. Jobs are queued and executed asynchronously.
4. Delivery receipts are persisted and surfaced to operators/agents.
5. Failures follow backoff rules and move to dead-letter when exhausted.

## 4. Technical Design (Architecture)

### Data Model Additions
* `distribution_targets`
  * `id`, `name`, `channelType`, `configJson`, `active`, `createdAt`
* `distribution_plans`
  * `id`, `contentItemId`, `contentVersion`, `scheduledAt`, `status` (`queued`, `running`, `partial`, `succeeded`, `failed`), `createdBy`, `createdAt`
* `distribution_jobs`
  * `id`, `planId`, `targetId`, `attempt`, `status`, `nextAttemptAt`, `lastError`, `createdAt`, `updatedAt`
* `distribution_receipts`
  * `id`, `jobId`, `externalId`, `deliveredAt`, `responseMeta`

### Channel Adapter Pattern
Define `DistributionAdapter` interface:
* `validateConfig(config)`
* `transform(content, policy)`
* `deliver(payload, config)`
* `normalizeReceipt(response)`

Initial adapters:
* Webhook adapter (extends current webhook concept)
* Feed adapter (RSS/Atom materialization)
* HTTP partner push adapter

### API / Protocol
* REST:
  * `POST /api/distribution/targets`
  * `POST /api/distribution/plans`
  * `GET /api/distribution/plans/:id`
* GraphQL:
  * `createDistributionPlan`, `distributionPlan`, `distributionTargets`
* MCP:
  * `create_distribution_target`, `create_distribution_plan`, `get_distribution_plan`

### Usability Design Notes
* Every plan response includes `recommendedNextAction` and failed-target remediation.
* Dry-run support validates transforms and target configs without delivery.
* Idempotency keys prevent duplicate plan creation.

## 5. Alternatives Considered
* **Inline synchronous fan-out in request path**: Too brittle for external channel latency/failures.
* **Single-channel push only**: Does not meet distribution parity or audience growth needs.
* **Outsource entirely to Zapier/IFTTT**: Useful adjunct, but lacks native policy enforcement and monetization hooks.

## 6. Security & Privacy Implications
* Channel credentials must be encrypted at rest and redacted in logs.
* Outbound payloads must enforce entitlement and policy constraints (for example, no full-body distribution when policy allows only excerpts).
* Signed outbound requests should be required for partner endpoints.
* Dead-letter payload retention must be bounded and sanitized.

## 7. Rollout Plan / Milestones
1. **Phase 1**: Add distribution tables and queue worker foundation.
2. **Phase 2**: Implement webhook and feed adapters with retry/dead-letter.
3. **Phase 3**: Expose REST/GraphQL/MCP plan APIs with dry-run.
4. **Phase 4**: Add supervisor UI for plan status, failures, and replay.
5. **Phase 5**: Add metrics (`delivery_success_rate`, latency, retry count) and alerts.

## 8. Review Comments (AI Assistant)

*   **Adapter Pattern Robustness**: Defining standard `transform` and `deliver` interfaces across channels is very clean and paves the way for a plugin ecosystem later.
*   **Agent Polling vs. Await**: Since the orchestrator is asynchronous, agents might find it frustrating to poll `GET /api/distribution/plans/:id` to find out if an important tweet actually went out. We might want to consider adding an optional `awaitDelivery: boolean` flag in the creation payload (up to a safe timeout like 10s) so agents can get synchronous confirmation for fast channels.
*   **Cascading Queue Failures**: We must ensure that strict rate limits on external APIs (like Twitter or LinkedIn) don't back up the internal `distribution_jobs` table. The backoff multiplier must be generous, and we might need logic to pause a `targetId` globally if it hits a 429 Too Many Requests response.
