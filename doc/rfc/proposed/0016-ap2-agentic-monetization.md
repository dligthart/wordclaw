# RFC 0016: AP2 (Agent Payments Protocol) for Agentic Monetization

**Author:** AI Assistant  
**Status:** Proposed  
**Date:** 2026-02-25  
**Depends on:** RFC 0003, RFC 0004, RFC 0011, RFC 0015  
**Related:** RFC 0006, RFC 0009

## 1. Summary
This RFC adds AP2 (Agent Payments Protocol) as a second payment rail for Wordclaw monetization, alongside Lightning.

The goal is to keep one product contract for paid content consumption and earnings attribution, while allowing settlement through either:
- Lightning (existing), or
- AP2 mandates and AP2-connected rails (fiat, stablecoin, bank transfer, card), when available.

This RFC does not replace existing entitlement logic. It extends payment and payout pathways while preserving RFC 0015 access semantics and RFC 0011 tenant isolation.

## 2. Motivation
Lightning-first monetization works, but is insufficient for all buyers and operators. Many integrations need:
- policy-bound autonomous spending authorization,
- stronger cross-platform interoperability,
- and non-Lightning settlement options without rewriting core entitlement and revenue logic.

AP2 introduces signed mandates that provide explicit proof of user/agent intent and spending boundaries. This enables broader adoption while maintaining deterministic auditability.

## 3. Scope
In scope:
- AP2 mandate verification and lifecycle tracking.
- AP2 checkout for offer purchases.
- Async AP2 settlement confirmation and reconciliation.
- Routing cleared payouts through `ap2` where configured.
- Domain-scoped AP2 behavior aligned with RFC 0011.
- Compatibility with RFC 0015 durable entitlement access (payment token terminality must not revoke valid access).

Out of scope:
- Replacing offers/licensing model from RFC 0004.
- Replacing Lightning support.
- Introducing dynamic/negotiated attribution logic (still governed by RFC 0006 policy).

## 4. Proposal
Wordclaw keeps one purchase and entitlement contract, but allows the payment rail to vary.

### 4.1 Canonical Purchase Flow (AP2 variant)
1. Client starts purchase via `POST /api/offers/:id/purchase` with `paymentMethod=ap2`.
2. Server creates:
- `payments` row in `pending`,
- `entitlements` row in `pending_payment` (RFC 0015),
- AP2 checkout challenge payload (including `paymentHash` and domain-bound scope).
3. Client submits AP2 mandate at `POST /api/ap2/checkout`.
4. Server verifies mandate signature, scope, amount ceiling, expiry, nonce, and domain binding.
5. AP2 provider confirms settlement asynchronously via webhook.
6. Webhook transitions:
- `payments`: `pending -> paid`,
- `entitlements`: `pending_payment -> active`.
7. Content reads follow RFC 0015 entitlement rules.
8. `payments` moving to `consumed` does not revoke access while entitlement remains active and within limits.

### 4.2 Data Model / Schema Changes
1. `agent_profiles`
- Add AP2 identity fields: `ap2Identifier`, `ap2PublicKey`, `ap2KeyVersion`, `ap2Enabled`.

2. `payments`
- Add rail fields: `paymentMethod` (`lightning` | `ap2`), `providerRef`, `currency`, `amountMinor`.
- Keep existing state machine from RFC 0015.

3. `ap2_mandates` (new append-only ledger)
- `id`, `domainId`, `agentProfileId`, `paymentId`, `mandateDigest`, `signature`, `keyId`, `currency`, `maxAmountMinor`, `usedAmountMinor`, `nonce`, `scopeJson`, `status`, `expiresAt`, `createdAt`.

4. `ap2_settlement_events` (new append-only webhook event table)
- `id`, `domainId`, `providerEventId`, `paymentId`, `eventType`, `payloadHash`, `receivedAt`.
- `providerEventId` must be unique for replay protection.

5. `payout_transfers`
- Extend `settlementMethod` enum to include `ap2` in addition to `lightning`.

All AP2 tables and lookups are mandatory `domainId` scoped.

### 4.3 API / Interface Additions
1. `POST /api/ap2/mandates/verify`
- Verifies mandate cryptography and normalized scope.
- Idempotent by `mandateDigest`.

2. `POST /api/ap2/checkout`
- Binds verified mandate to a `paymentHash`/`paymentId`.
- Returns standardized pending settlement response.

3. `POST /api/webhooks/payments/ap2/settled`
- Validates provider signature.
- Applies strict payment state transition checks.
- Idempotent by provider event ID.

4. `GET /api/ap2/mandates/:id`
- Read-only audit endpoint for supervisors and authorized agents.

5. Existing endpoint extension:
- `POST /api/offers/:id/purchase` accepts `paymentMethod`.

### 4.4 State Machines
1. Payment states remain RFC 0015 canonical:
- `pending -> paid`
- `pending -> failed`
- `pending -> expired`
- `paid -> consumed`

2. AP2 mandate states:
- `verified`
- `partially_used`
- `exhausted`
- `expired`
- `revoked`

3. Illegal transitions are rejected at DB/service layer.

### 4.5 Multi-Tenancy and Identity Invariants
1. `domainId` comes from authenticated principal context, not from raw client header.
2. Mandate payload must include tenant-bound scope; verification fails on mismatch.
3. `payment`, `entitlement`, `mandate`, `revenue_event`, and `payout_transfer` for a transaction must share one domain.
4. Cross-domain delegation or payout routing is forbidden.

### 4.6 Revenue and Payout Coupling
1. On AP2 settlement (`pending -> paid`), create `revenue_events` with canonical purchase semantics (same accounting contract as Lightning purchases).
2. Allocation/dispute lifecycle stays RFC 0006-compatible.
3. `PayoutService` routes cleared balances by transfer method:
- `lightning`: current flow,
- `ap2`: AP2 provider adapter.

## 5. Alternatives Considered
1. Lightning only:
- Lowest complexity, but excludes many agent ecosystems and enterprise buyers.

2. Provider-specific fiat integrations without AP2:
- Can process payments, but loses portable mandate semantics and consistent A2A authorization model.

3. AP2 only (remove Lightning):
- High migration risk and unnecessary churn; dual rail is safer.

## 6. Security & Privacy Implications
1. Cryptographic verification:
- Mandates must be verified against registered AP2 keys with key version awareness.

2. Replay protection:
- Require unique nonce plus `providerEventId` idempotency checks.

3. Spend guardrails:
- Enforce atomic `usedAmountMinor <= maxAmountMinor` before purchase confirmation.

4. Webhook trust:
- Provider webhook signatures are mandatory.

5. Privacy minimization:
- Persist mandate digests and normalized claims; avoid storing unnecessary raw PII.

6. Key rotation:
- Support dual-key validation window (`current`, `previous`) for safe rotation.

## 7. Rollout Plan / Milestones
1. Phase 1: Schema and interfaces
- Add AP2 fields/tables, enums, and domain-scoped indexes.

2. Phase 2: Mandate verification and checkout
- Implement verify + checkout endpoints and idempotency.

3. Phase 3: Settlement and entitlement activation
- Implement AP2 webhook pipeline + reconciliation worker for stale pending payments.

4. Phase 4: Payout routing
- Extend payout worker adapter with `ap2` transfer path.

5. Phase 5: Surface and docs
- Expose AP2 status in supervisor and MCP surfaces.
- Publish integration contract examples.

## 8. Public APIs and Types to Lock In
1. `PaymentMethod = "lightning" | "ap2"`.
2. `Ap2MandateStatus = "verified" | "partially_used" | "exhausted" | "expired" | "revoked"`.
3. `POST /api/offers/:id/purchase` request includes optional `paymentMethod`.
4. `POST /api/ap2/checkout` request includes `paymentHash` and mandate payload/signature.
5. AP2 webhook payload contract includes stable `providerEventId`.

## 9. Test Cases and Scenarios
1. Happy path:
- Valid AP2 mandate settles payment and activates entitlement.

2. Replay defense:
- Duplicate mandate nonce or webhook event is rejected idempotently.

3. Domain mismatch:
- Mandate signed for one domain cannot settle payment in another domain.

4. Spending ceiling:
- Checkout fails when cumulative mandate usage would exceed limit.

5. Durable access:
- Content remains accessible for active entitlement even after payment record reaches `consumed`.

6. Payout routing:
- Cleared allocations route by configured settlement method (`lightning` or `ap2`) without double pay.

## 10. Acceptance Criteria
1. AP2 can fund offer purchases without changing entitlement contract semantics.
2. Tenant isolation invariants are enforced for all AP2 paths.
3. Payment and mandate state transitions are deterministic and auditable.
4. Revenue allocation and payout flows remain RFC 0006-compatible.
5. Supervisors can inspect AP2 mandate and settlement evidence for disputes.
