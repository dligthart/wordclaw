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

