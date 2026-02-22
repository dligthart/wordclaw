# RFC 0003: Production Lightning Network Settlement Plan

**Author:** AI Assistant  
**Status:** Proposed  
**Date:** 2026-02-21  

## 1. Summary
This RFC outlines the roadmap to transition the WordClaw CMS from a mocked L402 micropayment implementation to a production-ready Lightning Network (LN) ecosystem. This upgrade involves implementing a real Lightning Service Provider (LSP), adopting cryptographic Macaroons via the LSAT protocol, establishing asynchronous webhooks for settlement, and formalizing agent identity and pricing policies.

## 2. Dependencies & Graph
*   **Depends on:** RFC 0002 (Usability) — Specifically the decoupled `PricingContext` to assign prices to invoices.
*   **Depended on by:** RFC 0004 (Licensing/Entitlements) — Entitlements are encoded into the L402 Macaroon caveats upon settlement.
*   **Depended on by:** RFC 0006 (Agent Payouts) — Invoices drive gross revenue events in the settlement ledger.

## 3. Motivation
The current `MockPaymentProvider` immediately returns mock invoices and verifies payments blindly without touching a real blockchain. To achieve the project's goal of a fully autonomous, economically viable ecosystem where AI agents pay for resource consumption, WordClaw must integrate with genuine Lightning nodes to generate valid `lnbc` invoices and verify cryptographic preimages on-chain.

## 4. Proposal
The migration to production L402 dictates the upgrade of three core components:
1. **The Generic Payment Provider Interface**: Establishing a rigid boundary interface (`IPaymentProvider`) so WordClaw is fundamentally payment-agnostic. While V1 focuses on connecting to real Lightning Service Providers (LSPs), the architecture guarantees future extensibility to traditional fiat rails (e.g., Stripe, PayPal).
2. **Macaroon/LSAT Authorization**: Replacing simple JWT-like base64 HMAC payloads with cryptographically sound Macaroons containing signed Caveats (constraints).
3. **Database Ledger & Asynchronous Settlement**: Relying on webhooks from the provider rather than aggressive client pulling to verify invoice settlement.

## 5. Technical Design (Architecture)

### 5.1 Generic Payment Provider Interface
WordClaw's ledger operates without strict coupling to Lightning. We define a generalized `IPaymentProvider`:
```typescript
interface IPaymentProvider {
  createInvoice(amount: number, memo: string): Promise<{ invoiceId: string, paymentHash: string, rawPayload: string }>;
  verifyPayment(paymentHash: string): Promise<{ status: 'paid' | 'pending' | 'failed' }>;
}
```
*   `createInvoice`: Executes a `POST /api/v1/payments` to the provider to generate a valid `invoiceId` (e.g., an `lnbc` string for LN, or a Checkout URL reference for fiat) and a unique tracking locator (`paymentHash` or `transactionId`).
*   `verifyPayment`: Queries external APIs to natively check settlement status. This makes integrating Stripe or other fiat mechanisms in V2 a pure adapter implementation without altering downstream entitlement/L402 logic.

### 5.2 Lightning Service Provider (LSP) V1 Implementation
We will implement an `LnbitsPaymentProvider` (or similar) as the default V1 instantiation of the `IPaymentProvider`.

### 4.2 Cryptographic Macaroons & LSAT Protocol
Macaroons allow WordClaw to attach signed **Caveats** to an invoice.
*   **Caveat Examples**: `time < 2026-12-31T00:00:00Z`, `route = /api/content-items`, `method = POST`.
*   **Implementation**: Introduce the `lsat-js` or `macaroons.js` library.
*   **Flow**: The `l402Middleware` extracts request properties, bakes them into a Macaroon with a secure `L402_SECRET`, and returns it alongside the Lightning invoice in the `Www-Authenticate: L402` header. Upon retry, the server verifies the Macaroon signature and the Client Preimage mathematically.

### 5.4 Asynchronous Settlement & Webhooks
Lightning payments can take 1-15 seconds to route. Relying on synchronous client polling risks timeouts.
*   Expose a generic webhook endpoint natively: `POST /webhooks/payments/:providerName/settled`.
*   When WordClaw requests an invoice from the provider, it registers this generic webhook URL.
*   Upon successful payment, the provider pushes a notification to WordClaw.
*   **Idempotency & Replay Window:** Webhook execution requires deterministic checking. We will enforce an explicit `eventId` uniqueness constraint with a 72-hour rolling replay-block window to discard duplicate webhook fires or out-of-order retries.
*   **State Machine Transitions:** Webhooks drive the `payments` state transitions across 4 strict domains: `pending` -> `paid` -> `failed` or `pending` -> `expired`. Out-of-order state transitions (like `failed` returning to `paid`) are rejected at the DB layer.
*   **Reconciliation Worker:** A scheduled background job (`pg-boss`) will execute every 15 minutes to query the provider for any `pending` invoices over 5 minutes old to sweep and reconcile delays or dropped webhooks automatically.

### 5.4 Invoice Expiry & Exhausing Retries
*   Generated `lnbc` invoices expire in 60 minutes. 
*   If an Agent attempts to query the settled status after 60min, the system intercepts the `INVOICE_EXPIRED` provider payload, automatically fails the legacy invoice, and mints an entirely fresh L402 Challenge to return to the agent with remediation text `"Your previous invoice expired; please pay the new invoice."`
*   No on-chain refund mechanisms are supported. If an agent fails to deliver valid POST payloads after paying, WordClaw retains the funds, aligning with standard API pre-pay patterns.

## 6. Alternatives Considered
*   **Fiat-First (Stripe):** Building Stripe L402 first. Discarded because agent-to-agent economies heavily favor permissionless micro-transactions (often under $0.50), where fiat credit card processing fees are structurally preventative. Starting with Lightning provides the correct atomic unit economics, while our `IPaymentProvider` abstraction ensures fiat can be securely enabled in V2.
*   **NWC (Nostr Wallet Connect) / Alby Hub:** Direct, agent-to-agent programmable connections. Very strong candidate for future implementation. For V1, LNbits provides a cleaner, proven REST gateway to act as WordClaw's custodial wallet.
*   **LND Self-Hosted Nodes**: Provides gRPC streams for real-time invoice settlement notifications, offering complete sovereignty. However, it requires deploying and managing a Bitcoin full node and Lightning channels, which is significantly more complex than integrating a custodial REST API like LNbits for the initial production launch.

## 7. Security & Privacy Implications
*   **Macaroon Trust:** The `L402_SECRET` used to sign Macaroons must be robustly secured.
*   **Webhook Spoofing:** Webhooks receiving settlement confirmations from the LSP **MUST** validate HMAC cryptographic signatures (`X-LNbits-Signature` or equivalent) matched against the pre-shared secret. Replay protection is enforced by asserting that the `paymentHash` exists in the local `payments` table and its status is `pending` prior to marking it `paid`.
*   **Secret Rotation:** Both `L402_SECRET` and Webhook HMAC keys require strict dual-key overlap strategies to support rotation. WordClaw will evaluate against `[CURRENT_KEY, PREVIOUS_KEY]` during active rolling periods to prevent downtime.
*   **Testnet Isolation:** A strict testnet-first boundary utilizing signet/testnet infrastructure must be deployed and monitored for 30 days prior to executing mainnet liquidity.

## 8. Rollout Plan / Milestones
1.  **Phase 1**: Integrate `lsat-js`/`macaroons.js` and securely sign/verify Caveats internally, continuing to use the Mock Provider.
2.  **Phase 2**: Define Testnet deployment architecture and establish base operational metrics (invoice creation rate, webhook latency).
3.  **Phase 3**: Implement the `LnbitsPaymentProvider`, testnet hooks, and the Reconciliation Worker.
4.  **Phase 4**: Hard-enforce HMAC signature spoofing protection on the Async webhook. Integrate auto-expiration recreation.
5.  **Phase 5**: Graduate to Mainnet and publish OpenAPI price discovery endpoints.

## 9. Production Gap Analysis (as of 2026-02-22)

A comprehensive audit of the current codebase against this RFC identifies the following gaps between the working MVP skeleton and a production-ready system.

### 9.1 Current State

The L402 protocol flow works end-to-end in development: a `402` challenge is issued with a macaroon+invoice, the client pays and retries with `Authorization: L402 <token>:<preimage>`, and the payment status is tracked in the database (`pending` → `paid` → `consumed`). All components use mock/placeholder implementations.

### 9.2 Gap Details

#### Gap 1: Real Lightning Payment Provider (§5.2)

**Current:** `src/services/mock-payment-provider.ts` generates fake `lnbc_mock_*` invoices and accepts a hardcoded preimage (`mock_preimage_12345`). The config in `src/services/l402-config.ts` actively throws in production unless `PAYMENT_PROVIDER=mock` is set.

**Required:** A real `PaymentProvider` implementation (LNbits recommended for V1). The existing `PaymentProvider` interface (`src/interfaces/payment-provider.ts`) must be extended:
*   `createInvoice` must return an **expiry timestamp**.
*   `verifyPayment` should return a **status object** (`paid`/`pending`/`expired`/`failed`), not just a boolean.
*   Add `getInvoiceStatus(hash)` method for the reconciliation worker.
*   Add webhook registration callback so the provider can push settlement notifications.

#### Gap 2: Cryptographic Macaroons (§4.2)

**Current:** `src/middleware/l402.ts` uses a simple HMAC-signed base64 payload as a "macaroon placeholder." It embeds only `{ hash, exp }`.

**Required:** Real Macaroons via `macaroons.js` (already installed but unused). Without caveats binding tokens to specific routes and methods, tokens are trivially replayable across different endpoints — a client paying for a `POST` can reuse the token on a `DELETE`.

#### Gap 3: Asynchronous Settlement Webhooks (§5.4)

**Current:** Payment verification in `src/middleware/l402.ts` is synchronous — the middleware calls `provider.verifyPayment()` inline during the HTTP request. This works for mocks but fails for real Lightning where routing takes 1–15 seconds.

**Required:**
*   `POST /webhooks/payments/:providerName/settled` endpoint.
*   HMAC signature validation on incoming webhooks (anti-spoofing).
*   `eventId` uniqueness constraint with 72-hour replay window.
*   State machine enforcement at the DB level.

#### Gap 4: Invoice Expiry and Recreation (§5.4)

**Current:** The HMAC token has a 1-hour expiry, but there is no handling for expired Lightning invoices. If a client returns with a valid token but the underlying invoice expired, the system has no path to issue a replacement.

**Required:** Detect `INVOICE_EXPIRED` status, auto-fail the expired payment record, mint a fresh L402 challenge with a new invoice, and return remediation text.

#### Gap 5: Reconciliation Worker (§5.4)

**Current:** Nothing exists. If a webhook is dropped or delayed, `pending` payments stay pending forever.

**Required:** A scheduled background job (every 15 minutes) that queries the provider for stale `pending` invoices and updates their status.

#### Gap 6: Payment State Machine

**Current:** Status updates in `src/services/l402-config.ts` are unguarded. Any status can transition to any other status.

**Required:** Enforce valid transitions only:
```
pending → paid → consumed
pending → expired
pending → failed
```

#### Gap 7: Domain-Scoped Pricing (Multi-Tenant)

**Current:** The pricing function in `src/services/l402-config.ts` queries `contentTypes` and `contentItems` without domain filtering, allowing cross-tenant pricing leakage.

**Required:** Pass `domainId` into `getPrice()` and scope all content type/item lookups.

#### Gap 8: L402 domainId Header Spoofing

**Current:** The `domainId` used for payment records derives from the raw `x-wordclaw-domain` header rather than from the authenticated principal.

**Required:** Derive `domainId` exclusively from the authenticated principal to prevent spoofing.

### 9.3 Adjacent Systems Required for Viable Economics

| System | RFC | Status | Dependency |
|--------|-----|--------|------------|
| Agent Profiles | 0004 | Not implemented | Links API keys to payout addresses for revenue attribution |
| Offers & Licensing | 0004 | Not implemented | Defines what is being sold (item, subscription, bundle) |
| Entitlements | 0004 | Not implemented | Proves durable buyer access rights beyond one-shot consumption |
| Revenue Ledger | 0006 | Not implemented | Tracks gross revenue per payment for payout accounting |
| Agent Payouts | 0006 | Not implemented | Distributes earnings to content creators via Lightning Address |

### 9.4 Prioritized Implementation Order

| Priority | Work Item | Effort | Blocks |
|----------|-----------|--------|--------|
| **P0** | Real `PaymentProvider` (LNbits) | Medium | Everything else |
| **P0** | Extend `PaymentProvider` interface (expiry, status enum) | Small | Provider impl |
| **P0** | Settlement webhook endpoint + HMAC validation | Medium | Async payments |
| **P0** | Payment state machine (DB constraints) | Small | Data integrity |
| **P1** | Cryptographic Macaroons (replace HMAC tokens) | Medium | Security |
| **P1** | Invoice expiry detection + auto-recreation | Small | UX |
| **P1** | Reconciliation worker | Medium | Reliability |
| **P1** | Domain-scoped pricing + fix header spoofing | Small | Multi-tenant |
| **P2** | Agent Profiles + Offers (RFC 0004) | Large | Monetization model |
| **P2** | Revenue ledger + Payouts (RFC 0006) | Large | Creator economics |
| **P3** | Testnet soak (30 days per §7) | Time | Mainnet launch |

**P0** = minimum to accept a single real Lightning payment. **P1** = production-grade. **P2** = viable marketplace. **P3** = mainnet graduation gate.

