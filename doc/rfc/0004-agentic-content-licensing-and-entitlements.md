# RFC 0004: Agentic Content Licensing and Entitlements

**Author:** AI Assistant  
**Status:** Proposed  
**Date:** 2026-02-21  

## 1. Summary
This RFC proposes a first-class licensing and entitlement system so agents can monetize content distribution and consumption, not only content creation. It introduces paid offers, machine-readable license terms, entitlement issuance, and policy checks on read/export routes.

## 2. Motivation
WordClaw currently supports L402 around content-item write paths, but there is no productized concept of "what is being sold" when content is distributed to downstream buyers, bots, channels, or partner systems. For agentic monetization, agents need:
* predictable offers and pricing metadata,
* cryptographically verifiable access rights,
* a durable entitlement ledger,
* deterministic remediation when access is denied.

Without this layer, revenue can be collected for writes but not tied to distributable rights, making monetization and distribution workflows incomplete.

## 3. Proposal
Introduce a licensing domain with four core artifacts:
1. **Offer**: A sellable package tied to content scope (single item, type, collection, or feed).
2. **License Policy**: Terms like allowed channels, usage window, read limits, and redistribution constraints.
3. **Entitlement**: The granted right to access/export content after successful settlement.
4. **Access Proof**: A token or signed claim that can be presented by agents across REST/GraphQL/MCP contexts.

L402 remains a settlement mechanism, but settlement now mints a concrete entitlement tied to an offer and policy.

## 4. Technical Design (Architecture)

### Data Model Additions
* `offers`
  * `id`, `slug`, `name`, `scopeType`, `scopeRef`, `priceSats`, `active`, `createdAt`
* `license_policies`
  * `id`, `offerId`, `maxReads`, `expiresAt`, `allowedChannels`, `allowRedistribution`, `termsJson`
* `entitlements`
  * `id`, `offerId`, `buyerPrincipal`, `status` (`active`, `expired`, `revoked`), `grantedAt`, `expiresAt`, `remainingReads`
* `access_events`
  * `id`, `entitlementId`, `resourcePath`, `action`, `granted`, `reason`, `createdAt`

### API / Protocol
* REST
  * `POST /api/offers`
  * `GET /api/offers`
  * `POST /api/offers/:id/purchase` (L402 challenge + entitlement issuance)
  * `GET /api/entitlements`
* GraphQL
  * `offers`, `entitlements`, `purchaseOffer`
* MCP
  * `create_offer`, `list_offers`, `purchase_offer`, `list_entitlements`

### Enforcement
* Add an entitlement middleware/service check for monetized read/export endpoints.
* Deduct usage (`remainingReads`) when policy is metered.
* Return AI-friendly denial payloads (`ENTITLEMENT_MISSING`, `ENTITLEMENT_EXPIRED`, `ENTITLEMENT_EXHAUSTED`) with remediation.

## 5. Alternatives Considered
* **Reuse only API scopes**: Too coarse. Scopes authorize capabilities, not commercial rights.
* **Invoice-only model without entitlements**: Cannot prove durable buyer rights across distribution workflows.
* **External commerce only**: Reduces control and parity across REST/GraphQL/MCP.

## 6. Security & Privacy Implications
* Entitlement tokens must be signed and short-lived when bearer-style.
* Access checks must be server-side authoritative; client claims are advisory only.
* Access events should avoid storing raw sensitive request headers.
* Revocation and expiry must be enforced consistently across protocols.

## 7. Rollout Plan / Milestones
1. **Phase 1**: Introduce `offers`, `license_policies`, `entitlements`, `access_events` tables and internal services.
2. **Phase 2**: Add purchase and entitlement APIs in REST/GraphQL/MCP.
3. **Phase 3**: Enforce entitlements on selected monetized read/export paths.
4. **Phase 4**: Add UI for offer management and buyer entitlement visibility.
5. **Phase 5**: Add parity and contract tests for entitlement denial/remediation semantics.

## 8. Review Comments (AI Assistant)

*   **Excellent Domain Separation**: The distinction between the settlement protocol layer (L402) and a durable commercial rights object (Entitlement) is a fantastic architectural decision. It prevents the API gateway from being clustered with business logic.
*   **Bearer Token Security**: For the `Access Proof`, we must be careful about token sharing. If an agent buys an entitlement and receives a bearer token, what prevents them from sharing it? We should ensure the `buyerPrincipal` is strictly validated against the API key/Agent making the read request.
*   **Revocation**: We should explicitly account for the ability to revoke entitlements programmatically (e.g., if a Lightning payment is disputed, or a channel detects abuse).
