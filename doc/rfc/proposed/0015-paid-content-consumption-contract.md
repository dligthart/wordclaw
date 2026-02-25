# RFC 0015: Paid Content Consumption Contract

**Author:** AI Assistant  
**Status:** Proposed  
**Date:** 2026-02-25  
**Depends on:** RFC 0003, RFC 0004, RFC 0011  
**Related:** RFC 0006, RFC 0009

## 1. Summary

This RFC defines the practical contract for paid content consumption in WordClaw.
It removes ambiguity between:
- pay-per-request L402 gates, and
- offer/entitlement based content licensing.

The contract standardizes:
- how a purchase is completed,
- when an entitlement becomes usable,
- how reads are metered,
- how multi-tenant domain boundaries are enforced,
- and that payment-token consumption does not revoke valid entitlement access.

## 2. Motivation

Current implementation contains the building blocks (L402, offers, entitlements, access events), but consumption semantics are not fully specified as one deterministic product flow.

In practice, operators and agent clients need a strict answer to:
1. How does an agent buy access?
2. How is payment confirmation completed?
3. What proves access for later reads?
4. What happens when reads are exhausted or entitlement expires?
5. What is the fallback behavior when no offer exists?

Without this contract, integrations risk protocol drift and inconsistent buyer behavior.

## 3. Scope

This RFC specifies buyer-side paid consumption for content reads.

In scope:
- offer discovery and purchase completion
- entitlement activation and read metering
- consumption decision rules on read endpoints
- error codes and remediation for buyer clients
- strict tenant isolation in all paid-consumption paths

Out of scope:
- catalog/search feed design (RFC 0009)
- payout splitting details (RFC 0006)
- distribution channel orchestration (RFC 0005)

## 4. Contract Model

### 4.1 Core Objects

1. `Offer`: sellable product for `scopeType` in `item`, `type`, `subscription`.
2. `LicensePolicy`: immutable constraints (`maxReads`, `expiresAt`, `allowedChannels`, etc).
3. `Entitlement`: buyer access grant bound to one `agentProfileId` and one purchase payment hash.
4. `Payment`: invoice lifecycle (`pending`, `paid`, `consumed`, `expired`, `failed`).
5. `AccessEvent`: append-only log for each entitlement read decision.

### 4.2 Canonical Read Rule

For `GET /api/content-items/:id`:

1. Find active offers for the item scope (item, then type, then subscription in same domain).
2. If at least one active offer exists, read access is entitlement-based.
3. If no active offer exists, legacy L402 pay-per-request behavior applies using `content_types.basePrice`.

This makes offer-based licensing authoritative whenever offers exist.

### 4.3 Entitlement Selection Rule

When a read is entitlement-based:

1. If `x-entitlement-id` is provided, use it and validate ownership/scope.
2. If header is absent and exactly one eligible entitlement exists, auto-select it.
3. If multiple eligible entitlements exist, return `409 ENTITLEMENT_AMBIGUOUS` with candidate IDs.
4. If no eligible entitlement exists, return purchase challenge guidance.

## 5. Purchase and Consumption Flow

### 5.1 Discovery

Client discovers purchasable offers via:

`GET /api/content-items/:id/offers`

### 5.2 Purchase Initiation

Client starts purchase:

`POST /api/offers/:id/purchase`

Behavior:
- Creates `payments` row (`pending`).
- Creates `entitlements` row with status `pending_payment`.
- Returns `402` challenge (`WWW-Authenticate: L402 ...`) plus `paymentHash` and `entitlementId`.

### 5.3 Purchase Confirmation

Client confirms payment with L402 credentials:

`POST /api/offers/:id/purchase/confirm`

Request:
- `Authorization: L402 <macaroon>:<preimage>`
- Optional `x-payment-hash` if multiple pending purchases for same offer.

Behavior:
1. Verify macaroon caveats (method/path/domain/price/expiry).
2. Verify preimage at provider.
3. Transition payment `pending -> paid`.
4. Transition entitlement `pending_payment -> active`.
5. Return entitlement summary (`id`, `remainingReads`, `expiresAt`, `status`).

### 5.4 Consumption

Client consumes content:

`GET /api/content-items/:id`

If entitlement-based:
1. Resolve entitlement via selection rule.
2. Atomically decrement `remainingReads` if finite.
3. Record `access_events` granted/denied decision.
4. Return content on success.
5. Return deterministic denial when exhausted/expired/revoked.
6. A payment record transitioning to `consumed` MUST NOT by itself revoke access while entitlement remains `active` and within limits.

If legacy L402 fallback:
- Keep current middleware challenge/verify/consume flow.

## 6. State Machines

### 6.1 Payment State

Allowed transitions:

- `pending -> paid`
- `pending -> expired`
- `pending -> failed`
- `paid -> consumed`

No other transitions are allowed.

Payment `consumed` means the invoice token lifecycle is complete, not that purchased content rights are invalid.

### 6.2 Entitlement State

`entitlements.status` values:

- `pending_payment`
- `active`
- `exhausted`
- `expired`
- `revoked`

Allowed transitions:

- `pending_payment -> active` (payment verified)
- `pending_payment -> expired` (invoice expired)
- `pending_payment -> revoked` (manual cancel)
- `active -> exhausted` (remaining reads reaches zero)
- `active -> expired` (expiresAt reached)
- `active -> revoked` (manual/admin action)

`exhausted`, `expired`, and `revoked` are terminal.

### 6.3 Durable Access Semantics

1. Entitlement is the source of truth for continued access after purchase.
2. Payment status is accounting/token lifecycle metadata; it is not an entitlement revocation signal.
3. If entitlement is `active` and constraints pass (`remainingReads`, `expiresAt`), access must be granted even when the linked payment is `consumed`.
4. Access is denied only by entitlement state/constraints (or policy), not by payment terminality alone.

## 7. API Changes

### 7.1 New Endpoints

1. `POST /api/offers/:id/purchase/confirm`
2. `GET /api/entitlements/me`
3. `GET /api/entitlements/:id`

### 7.2 Existing Endpoint Changes

1. `POST /api/offers/:id/purchase`
- Must return `paymentHash` and `entitlementId`.
- Must create entitlement as `pending_payment` (not `active`).

2. `GET /api/content-items/:id`
- Must enforce offer-first entitlement logic when active offers exist.
- Must support `x-entitlement-id`.

### 7.3 Error Codes

Standardize:

- `ENTITLEMENT_NOT_FOUND`
- `ENTITLEMENT_NOT_ACTIVE`
- `ENTITLEMENT_EXPIRED`
- `ENTITLEMENT_EXHAUSTED`
- `ENTITLEMENT_AMBIGUOUS`
- `OFFER_REQUIRED`
- `PAYMENT_CONFIRMATION_REQUIRED`
- `PAYMENT_VERIFICATION_FAILED`

All errors must include `remediation`.

## 8. Data Model Changes

1. Update `entitlements.status` semantics to include `pending_payment` and `exhausted`.
2. Add index:
- `(domain_id, agent_profile_id, status, expires_at)` on `entitlements`.
3. Add optional `activated_at` and `terminated_at` timestamps on `entitlements`.
4. Keep `payment_hash` unique per entitlement.

## 9. Multi-Tenancy Requirements

Hard requirements:

1. Domain ID is derived from authenticated principal context, not raw client headers.
2. Every lookup in purchase/confirm/consume paths is domain-scoped.
3. Macaroon caveats include domain; mismatched domain fails verification.
4. Entitlement delegation cannot cross domain boundaries.
5. Revenue attribution for purchases must write to the same domain as the entitlement.

## 10. Revenue Attribution Coupling

When purchase payment transitions to `paid`:

1. Create `revenue_events` with `sourceType='offer_purchase'`.
2. Allocate revenue using contribution signals.
3. Do not create additional revenue events on each entitlement read to avoid double counting.

Legacy pay-per-request fallback reads may optionally write `sourceType='metered_read'` to treasury, but this is explicitly separate from offer purchase attribution.

## 11. Security and Abuse Controls

1. Confirm route verifies method/path/domain caveats in macaroon.
2. Reject token replay across endpoints or domains.
3. Enforce atomic decrement for finite reads to prevent race overspend.
4. Log denied access decisions in `access_events`.
5. Use idempotency keys for purchase confirmation retries.

## 12. Rollout Plan

### Phase 1: Contract and Schema
- Add entitlement statuses and indexes.
- Add endpoint contracts and response schemas.

### Phase 2: Purchase Confirmation
- Implement `/offers/:id/purchase/confirm`.
- Migrate purchase init to `pending_payment`.

### Phase 3: Consumption Enforcement
- Implement offer-first logic on `GET /content-items/:id`.
- Add entitlement selection and ambiguity handling.

### Phase 4: Compatibility and Cleanup
- Keep legacy L402 fallback only when no active offers exist.
- Add migration warnings and telemetry for fallback usage.

## 13. Acceptance Criteria

1. Agent can complete purchase with a deterministic two-step flow: `purchase` then `purchase/confirm`.
2. Entitlement only becomes active after payment verification.
3. Read requests decrement reads exactly once under concurrency.
4. Exhausted/expired/revoked entitlements produce deterministic, actionable errors.
5. Cross-domain token or entitlement use is rejected.
6. Offer purchase creates revenue events once, not per read.
7. Content remains accessible to the purchasing agent while entitlement is valid, even after payment status becomes `consumed`.
