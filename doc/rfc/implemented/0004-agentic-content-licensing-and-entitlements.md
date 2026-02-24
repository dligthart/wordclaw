# RFC 0004: Agentic Content Licensing and Entitlements

**Author:** AI Assistant  
**Status:** Implemented  
**Date:** 2026-02-21  

## 1. Summary
This RFC proposes a first-class licensing and entitlement system so agents can monetize content distribution and consumption, not only content creation. It introduces versioned paid offers, machine-readable license terms, entitlement issuance via Macaroon caveats, and policy checks on read/export routes. 

It also formally establishes the **Unified Agent Identity Model**, linking API keys to Agent Profiles bridging purchasing, distribution, and payouts.

## 2. Dependencies & Graph
*   **Depends on:** RFC 0003 (Production Lightning Settlement) — Entitlements are paid via LN invoices.
*   **Depended on by:** RFC 0005 (Distribution Orchestrator) — Distribution targets must pass entitlement checks.
*   **Depended on by:** RFC 0006 (Revenue Payouts) — Purchases fund the agent revenue ledger.

## 3. Motivation
WordClaw currently supports L402 around content-item write paths, but there is no productized concept of "what is being sold" when content is distributed to downstream buyers. For agentic monetization, agents need predictable offers, cryptographically verifiable access rights, transferrable entitlements, and atomic usage tracking.

## 4. Proposal
Introduce a licensing domain with four core artifacts:
1. **Offer**: A sellable package tied to content scope (single item, type, collection, or `subscription`).
2. **License Policy (Immutable)**: Terms like allowed channels, usage window, and read limits. Append-only to ensure buyer terms never change post-purchase.
3. **Entitlement**: The granted right to access/export content. Belongs to an `agentProfileId`.
4. **Access Proof**: Encoded directly into RFC 0003's L402 Macaroons as an `entitlementId` caveat.

## 5. Technical Design (Architecture)

### 5.1 Unified Agent Identity Model
To support multi-agent economies, all system identities roll up to an `AgentProfile`:
*   `api_keys` (from Phase 7.0) map 1:1 to an `agent_profile` in the database.
*   An `agent_profile` holds an `agentProfileId`, `payoutAddress` (RFC 0006), and is the owner of Entitlements (RFC 0004).

### 5.2 Data Model Additions
*   `agent_profiles`
    *   `id`, `api_key_id`, `payoutAddress`
*   `offers`
    *   `id`, `slug`, `name`, `scopeType` (`item`, `type`, `subscription`), `scopeRef` (Nullable for subscriptions), `priceSats`, `active`
*   `license_policies` (Append-Only)
    *   `id`, `offerId`, `version`, `maxReads` (Default: `Infinity`), `expiresAt` (Default: `Infinity`), `allowedChannels` (Default: `[]`), `allowRedistribution`, `termsJson`
*   `entitlements`
    *   `id`, `offerId`, `policyId`, `policyVersion`, `agentProfileId`, `paymentHash` (Unique Constraint), `status`, `expiresAt`, `remainingReads`, `delegatedFrom` (FK to parent entitlement)
*   `access_events`
    *   `id`, `entitlementId`, `resourcePath`, `action`, `granted`, `reason`, `createdAt`

### 5.3 API / Protocol
*   **Discovery:** `GET /api/content-items/:id/offers` allows agents to discover relevant purchasing options without mass-scanning all offers.
*   **REST/GraphQL/MCP:** APIs to list offers and trigger `purchaseOffer` (returns L402 Challenge).
*   **Transfer/Delegation:** Add `POST /api/entitlements/:id/delegate` to temporarily grant subset access to a subordinate agent (vital for Orchestrators in RFC 0005). Delegated entitlements carry strict subsets (fractional `remainingReads`, shorter expiry) and are independently revocable. Delegation chains are restricted to a depth of 1 at the DB layer to prevent cyclic abuse. If a parent entitlement is revoked or expires, all of its child delegated entitlements are immediately cascade-invalidated.
*   **Atomic Metering:** Decrementing `remainingReads` must use atomic SQL: `UPDATE entitlements SET remainingReads = remainingReads - 1 WHERE remainingReads > 0 RETURNING *`.
*   **Policy Version Pinning:** Entitlement evaluations in the access routes strict-check against the pinned `policyVersion` tied to the purchase event. This guarantees reproducible evaluations even if the `license_policies` table introduces a newer version for future buyers.
*   **Events Retention:** A cron job will aggregate and purge raw `access_events` older than 30 days into daily metric rollups.

## 6. Alternatives Considered
*   **Reuse only API scopes:** Too coarse. Scopes authorize broad capabilities, not item-level commercial rights.
*   **Invoice-only model without entitlements:** Cannot prove durable buyer rights across distributed, asynchronous workflows.
*   **External commerce only:** Drastically reduces predictability, control, and protocol parity across REST/GraphQL/MCP surfaces.

## 7. Security & Privacy Implications
*   **Macaroon Caveats**: By storing `entitlementId` as an L402 caveat, we reuse RFC 0003's cryptographic validation, preventing token sharing between mismatched API Keys.
*   **Revocation**: `entitlements.status = 'revoked'` immediately halts access, providing a kill switch for disputed payments or TOS violations. Consistent enforcement across all protocols (REST/GraphQL/MCP) is mandatory.
*   **Access Events**: Storage of access events must explicitly avoid recording raw sensitive HTTP request headers to prevent leaking auth material.

## 8. Rollout Plan / Milestones
1.  **Phase 1**: Implement the Unified Identity (`agent_profiles` mapping).
2.  **Phase 2**: Introduce core tables (`offers`, `license_policies`, `entitlements`).
3.  **Phase 3**: Mint L402 Macaroons with `entitlementId` caveats upon settlement.
4.  **Phase 4**: Enforce API read/export routes using atomic decrements.
5.  **Phase 5**: Add aggregation workers for `access_events` retention.

