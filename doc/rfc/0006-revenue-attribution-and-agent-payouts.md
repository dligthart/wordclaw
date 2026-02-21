# RFC 0006: Revenue Attribution and Agent Payouts

**Author:** AI Assistant  
**Status:** Proposed  
**Date:** 2026-02-21  

## 1. Summary
This RFC proposes a revenue attribution and payout system that links monetized content events to agent contributions, computes split allocations, and executes payout instructions through settlement providers.

## 2. Motivation
Agentic monetization is incomplete without fair attribution and payout. WordClaw tracks payments, but does not yet answer:
* which agent(s) generated value,
* how revenue should be split for collaborative outputs,
* when and how balances are settled.

For autonomous multi-agent systems, transparent and deterministic payout logic is a usability requirement, not a reporting nice-to-have.

## 3. Proposal
Introduce a revenue accounting domain with three layers:
1. **Attribution Signals**: Contribution records from creation/edit/review/distribution actions.
2. **Revenue Ledger**: Immutable accounting events linking gross revenue to allocation rules.
3. **Payout Engine**: Batched settlements to configured agent wallets/accounts with reconciliation states.

Allocation models supported initially:
* Fixed split by role (author/editor/distributor)
* Weighted split by contribution score
* Override policies per offer/channel

## 4. Technical Design (Architecture)

### Data Model Additions
* `agent_profiles`
  * `id`, `principalRef`, `displayName`, `payoutMethod`, `payoutAddress`, `active`
* `contribution_events`
  * `id`, `contentItemId`, `agentProfileId`, `role`, `weight`, `contextJson`, `createdAt`
* `revenue_events`
  * `id`, `sourceType` (`offer_purchase`, `distribution_sale`, `subscription_usage`), `sourceRef`, `grossSats`, `feeSats`, `netSats`, `createdAt`
* `revenue_allocations`
  * `id`, `revenueEventId`, `agentProfileId`, `amountSats`, `ruleRef`, `status`
* `payout_batches`
  * `id`, `periodStart`, `periodEnd`, `status`, `createdAt`
* `payout_transfers`
  * `id`, `batchId`, `agentProfileId`, `amountSats`, `providerRef`, `status`, `settledAt`

### Core Services
* `AttributionService`: resolves contribution set per monetized event.
* `AllocationService`: applies rule set and writes immutable allocations.
* `PayoutService`: groups payable balances and calls settlement provider adapters.

### API / Protocol
* REST:
  * `GET /api/revenue/events`
  * `GET /api/revenue/allocations`
  * `POST /api/payouts/run`
* GraphQL:
  * `revenueEvents`, `revenueAllocations`, `runPayoutBatch`
* MCP:
  * `list_revenue_events`, `list_revenue_allocations`, `run_payout_batch`

### Operator/Agent Usability
* Deterministic remediation codes for payout failures (`PAYOUT_DESTINATION_INVALID`, `SETTLEMENT_PROVIDER_UNAVAILABLE`).
* Explainable allocation payloads showing rule path and weights.
* Cursor pagination on all ledger endpoints.

## 5. Alternatives Considered
* **Single-wallet treasury with no attribution**: Simple but unusable for multi-agent economics.
* **Off-platform accounting only**: Loses traceability between content actions and revenue outcomes.
* **Fully dynamic AI-determined splits**: Hard to audit and dispute; deterministic policy is safer for first release.

## 6. Security & Privacy Implications
* Payout credentials and destinations are sensitive financial data and must be encrypted and access-controlled.
* Ledger entries should be append-only to preserve auditability.
* Payout execution must be idempotent and replay-safe.
* Role-based scopes should separate `revenue:read` and `payout:write`.

## 7. Rollout Plan / Milestones
1. **Phase 1**: Add revenue/attribution schema and immutable ledger write path.
2. **Phase 2**: Implement allocation rules and explainable allocation responses.
3. **Phase 3**: Add payout batch runner with provider adapters and reconciliation statuses.
4. **Phase 4**: Expose UI dashboards for agent earnings and payout history.
5. **Phase 5**: Add alerts for payout failures and parity tests across REST/GraphQL/MCP.

## 8. Review Comments (AI Assistant)

*   **Crucial for Multi-Agent Economies**: This solves the hardest part of autonomous collaboration—making sure everyone actually gets paid fairly. Appending it to an immutable ledger is the only correct way to do this.
*   **Computation Isolation**: Given the potential volume of `revenue_allocations` when many small L402 micropayments stream in, the `PayoutService` needs to be heavily decoupled from the API request thread via a cron or worker to prevent CPU starvation.
*   **Weight Clarification**: The concept of a contribution `weight` is structurally sound, but we'll need a very strict definition of how that is calculated. Is the Supervisor UI deciding the weight? Is it automated by content-edit diff size? I recommend we default to simple Fixed Splits in V1 before letting agents negotiate weights.
