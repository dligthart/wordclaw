# RFC 0006: Revenue Attribution and Agent Payouts

**Author:** AI Assistant  
**Status:** Implemented  
**Date:** 2026-02-21  

## 1. Summary
This RFC proposes a revenue attribution and payout system linking monetized content events to specific AI agent contributions, computing split allocations, and executing Lightning Address payouts through settlement providers. 

## 2. Dependencies & Graph
*   **Depends on:** Phase 7.0 (API Keys) — Maps API Keys to the `agent_profiles` ledger.
*   **Depends on:** RFC 0003 (Settlement) & RFC 0004 (Offers) — Sourcing gross revenue events (`sourceType: 'offer_purchase'`).
*   **Depends on:** RFC 0005 (Distribution) — Sourcing revenue from downstream distribution channels.

## 3. Motivation
Agent monetization requires automated, fair attribution. Without mapping which agent wrote, edited, or distributed a piece of content, gross revenue cannot be trustlessly divided. Autonomous multi-agent workflows require deterministic payout logic, dispute windows, and transparent reconciliation.

## 4. Proposal
Introduce an accounting domain with three immutable layers:
1.  **Attribution Signals**: Logs contributions linked to `agent_profiles`.
2.  **Revenue Ledger**: Immutable events dividing gross transaction revenue into allocations based on fixed role weights.
3.  **Payout Engine**: Background worker batching allocations to Lightning Addresses over a minimum threshold.

## 5. Technical Design (Architecture)

### 5.1 Data Model
*   `agent_profiles` (Extends canonical schema from RFC 0004)
    *   Adds `displayName`
*   `contribution_events` (`id`, `contentItemId`, `agentProfileId`, `role`, `weight`)
*   `revenue_events` (`id`, `sourceType`, `sourceRef`, `grossSats`, `feeSats`, `netSats`)
*   `revenue_allocations` (`id`, `revenueEventId`, `agentProfileId`, `amountSats`)
*   `allocation_status_events` (`id`, `allocationId`, `status` [pending, disputed, cleared], `createdAt`) - Immutable ledger replacing mutating status.
*   `payout_batches` (`id`, `periodStart`, `periodEnd`, `status`)
*   `payout_transfers` (`id`, `batchId`, `agentProfileId`, `amountSats`, `status`)

### 5.2 Allocation & Dispute Flow
*   When RFC 0004's Offer is purchased, a `revenue_event` is logged.
*   The system looks up `contribution_events` and utilizes a **Fixed Split by Role** model (e.g., Author 70%, Editor 10%, Distributor 20%). Dynamic AI negotiation is deferred to V2.
*   **Rounding:** All fractional satoshi splits strictly round *down* via `Math.floor`. Any leftover remainder sats from rounding are systematically credited to the `Author` role allocation to prevent leakages.
*   **Dispute Window:** Allocations sit in a `pending` state for a strict **7-day time window**, allowing Supervisors to mark them as `DISPUTED` via the UI with an audit trail, effectively pausing the payout.
*   **Auto-Clear Protocol:** If an allocation remains in `disputed` status for more than 14 days with no manual override or escalation, an automated job will override and push the status forward to `cleared` to prevent stuck distributions indefinitely.

### 5.3 Execution Engine (Isolation)
*   Creating ledgers for thousands of micro-transactions is computationally heavy. `PayoutService` runs fully decoupled in a background worker context to prevent freezing the Fastify HTTP loop.
*   **Thresholds & Formats**: Payouts map strictly to Lightning Addresses (`agent@lnprovider.com`). To avoid wasting capital on routing fees, `payout_transfers` only execute when an agent's cleared balance exceeds a configurable minimum threshold (e.g., 500 sats). 
*   **Idempotency & Retry**: The Payout engine will map the `payout_transfers.id` directly into the Lightning Provider's idempotency-key header to prevent double payments on retry.
*   **Reconciliation Failure**: Unreachable providers will automatically retry failed payouts up to 3 times. On permanent failure, the ledger re-credits the agent's balance, notifies the supervisor dashboard, and exposes a `PAYOUT_FAILED_PERMANENT` status on the agent earnings endpoint with actionable remediation guidance.

### 5.4 Agent Real-Time Visibility
*   Add `GET /api/agents/me/earnings` (and tools `get_my_earnings`) so agents can autonomously query their pending balances and cleared histories, ensuring they can make programmatic decisions about continuing to provide services.
*   **Taxation**: Data models aggregate YTD totals by `agent_profile` to prepare the platform for eventual 1099/VAT export requirements.

## 6. Alternatives Considered
*   **Single-wallet treasury with no attribution**: Simple but unusable for multi-agent economics.
*   **Off-platform accounting only**: Loses traceability between content actions and revenue outcomes.
*   **Fully dynamic AI-determined splits**: Hard to audit and dispute; deterministic policy is safer for first release.

## 7. Security & Privacy Implications
*   **Encrypted Credentials**: Payout destination variables must be encrypted at rest and access-controlled.
*   **Append-Only Ledger**: Entries (`revenue_events`, `revenue_allocations`) must be append-only with no UPDATE/DELETE capabilities to preserve strict auditability.
*   **Idempotency**: Payout execution must be retry-safe leveraging provider deduplication keys.
*   **Scopes**: Introduce explicit `revenue:read` and `payout:write` RBAC role scopes.

## 8. Rollout Plan / Milestones
1.  **Phase 1**: Expand `agent_profiles` table mapped to Phase 7.0 API Keys.
2.  **Phase 2**: Add immutable revenue and allocation ledgers. Implement Fixed Split configuration.
3.  **Phase 3**: Add Supervisor UI for viewing balances and disputing allocations.
4.  **Phase 4**: Implement Payout Worker for Lightning Addresses with minimum thresholds and automatic retries.
5.  **Phase 5**: Expose `/api/agents/me/earnings` to MCP for autonomous querying.

