# RFC 0005: Multi-Channel Distribution Orchestrator

**Author:** AI Assistant  
**Status:** Proposed  
**Date:** 2026-02-21  

## 1. Summary
This RFC introduces a robust distribution orchestration layer allowing agents to publish licensed content to multiple formats and channels (webhooks, RSS/Atom, SMTP, social APIs). It provides configurable adapter transforms, PostgreSQL-backed reliable queues, dry-runs, and deterministic delivery state tracking.

## 2. Dependencies & Graph
*   **Depends on:** RFC 0004 (Entitlements) — Content is blocked from distribution if the orchestrator's agent lacks the correct `allowedChannels` or `allowRedistribution` entitlement.
*   **Depended on by:** RFC 0006 (Revenue Payouts) — Successful distribution events can act as attribution markers for revenue splits.

## 3. Motivation
WordClaw acts as a structured content runtime, but content monetization requires reaching audiences. Agents need explicit, "publish once, fan out many" workflows with detailed dead-letter handling, deduplication, and parity across REST/GraphQL/MCP.

## 4. Proposal
Add a **Distribution Orchestrator** executing plans via a PostgreSQL queue:
1.  Agent submits a distribution plan.
2.  System verifies `entitlements` (e.g., is this Agent allowed to push to Twitter?).
3.  Jobs queue via Postgres `FOR UPDATE SKIP LOCKED`.
4.  Data passes through a `TransformPolicy` (e.g., truncating an article to a Tweet length based on license terms).
5.  Adapters push to the target; receipts are stored; notifications fire.

## 5. Technical Design (Architecture)

### 5.1 Data Model
*   `distribution_targets` (`id`, `name`, `channelType`, `configJson`, `active`)
*   `distribution_plans` (`id`, `contentItemId`, `status`, `createdByAgentId`)
*   `distribution_jobs` (`id`, `planId`, `targetId`, `attempt`, `status`, `nextAttemptAt`)
*   `distribution_receipts` (`id`, `jobId`, `externalUrl`, `statusCode`, `errorMessage`, `rawMeta`)

### 5.2 Postgres Queue & Adapters
*   **Infrastructure**: We will use a PostgreSQL-backed queue (e.g., `pgboss` or native `SKIP LOCKED`) to avoid adding Redis to the WordClaw deployment topology.
*   **Adapters**: Define an interface that implements `transform(content, policy)` and `deliver(payload)`. Transforms handle markdown-to-HTML, truncation, and metadata injection.
*   **Backoff & Rate Limiting**: If a generic target (like Twitter) returns `429 Too Many Requests`, the backoff multiplier suspends the `targetId` temporarily to prevent cascading queue backups.

### 5.3 Agent Usability & APIs
*   **Synchronous Confirm / Await**: Plan creation endpoints will accept an `awaitDelivery: boolean` flag (max 10s wait) to give synchronous certainty for fast Webhook channels.
*   **Cancellation**: Add `POST /plans/:id/cancel` to abort `queued` or `running` jobs dynamically.
*   **Deduplication**: Plans for the same `contentItem` + `targetId` within a 5-minute window will throw a deterministic `DUPLICATE_DISTRIBUTION_PLAN` error unless overridden.
*   **Webhooks**: Output `distribution.plan.completed` and `distribution.job.failed` via the existing Phase 7.8 Event Stream so agents don't have to poll.

## 6. Security & Privacy Implications
*   **Entitlement Enforcement**: Crucially, the orchestrator retrieves the invoking agent's Entitlements (RFC 0004) to ensure they hold the right to distribute the data. Full-body distribution fails if the policy only grants excerpts.
*   **Credential Storage**: Channel configs (API tokens) are encrypted at rest.

## 7. Rollout Plan / Milestones
1.  **Phase 1**: Implement `distribution_targets` and the Postgres `SKIP LOCKED` worker queue.
2.  **Phase 2**: Add Entitlement verification (Dependency: RFC 0004) to the pre-flight checks.
3.  **Phase 3**: Implement Webhook, RSS, and Email adapters mapped to a `TransformPolicy`.
4.  **Phase 4**: Add cancellation, deduplication, and synchronous `awaitDelivery` API concepts.
5.  **Phase 5**: Add Webhook event emissions for completions and failures.
