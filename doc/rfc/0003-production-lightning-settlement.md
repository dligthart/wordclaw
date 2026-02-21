# RFC 0003: Production Lightning Network Settlement Plan

**Author:** AI Assistant  
**Status:** Proposed  
**Date:** 2026-02-21  

## 1. Summary
This RFC outlines the roadmap to transition the WordClaw CMS from a mocked L402 micropayment implementation to a production-ready Lightning Network (LN) ecosystem. This upgrade involves implementing a real Lightning Service Provider (LSP), adopting cryptographic Macaroons via the LSAT protocol, establishing asynchronous webhooks for settlement, and formalizing agent identity and pricing policies.

## 2. Motivation
The current `MockPaymentProvider` immediately returns mock invoices and verifies payments blindly without touching a real blockchain. To achieve the project's goal of a fully autonomous, economically viable ecosystem where AI agents pay for resource consumption, WordClaw must integrate with genuine Lightning nodes to generate valid `lnbc` invoices and verify cryptographic preimages on-chain.

## 3. Proposal
The migration to production L402 dictates the upgrade of three core components:
1. **The Payment Provider Interface**: Connecting to real LSPs (like LNbits, Alby, or LND) instead of mocking responses.
2. **Macaroon/LSAT Authorization**: Replacing simple JWT-like base64 HMAC payloads with cryptographically sound Macaroons containing signed Caveats (constraints).
3. **Database Ledger & Asynchronous Settlement**: Relying on webhooks from the LSP rather than aggressive client pulling to verify invoice settlement.

## 4. Technical Design (Architecture)

### 4.1 Lightning Service Provider (LSP) Integration
We will implement an `LnbitsPaymentProvider` (or similar) that implements the existing `PaymentProvider` interface:
*   `createInvoice`: Executes a `POST /api/v1/payments` to the LSP to generate a valid invoice string and `paymentHash`.
*   `verifyPayment`: Queries `GET /api/v1/payments/{paymentHash}` to check settlement status on the chain.

### 4.2 Cryptographic Macaroons & LSAT Protocol
Macaroons allow WordClaw to attach signed **Caveats** to an invoice.
*   **Caveat Examples**: `time < 2026-12-31T00:00:00Z`, `route = /api/content-items`, `method = POST`.
*   **Implementation**: Introduce the `lsat-js` or `macaroons.js` library.
*   **Flow**: The `l402Middleware` extracts request properties, bakes them into a Macaroon with a secure `L402_SECRET`, and returns it alongside the Lightning invoice in the `Www-Authenticate: L402` header. Upon retry, the server verifies the Macaroon signature and the Client Preimage mathematically.

### 4.3 Asynchronous Settlement & Webhooks
Lightning payments can take 1-15 seconds to route. Relying on synchronous client polling risks timeouts.
*   Expose a webhook endpoint: `POST /webhooks/lightning/invoice-settled`.
*   When WordClaw requests an invoice from the LSP, it registers this webhook URL.
*   Upon successful payment, the provider pushes a notification to WordClaw, which asynchronously updates the `payments` database table `status` to `paid`.

### 4.4 Agent Identity & Price Negotiation Policies
*   Expose the base prices of `contentTypes` explicitly via a Discovery/OpenAPI endpoint so Agents know costs upfront.
*   Implement a refund or credit policy mechanism should an Agent pay for a post but subsequently provide invalid JSON data preventing insertion into the database.

## 5. Alternatives Considered
*   **LND Self-Hosted Nodes**: Provides gRPC streams for real-time invoice settlement notifications, offering complete sovereignty. However, it requires deploying and managing a Bitcoin full node and Lightning channels, which is significantly more complex than integrating a custodial REST API like LNbits for the initial production launch.

## 6. Security & Privacy Implications
*   The `L402_SECRET` used to sign Macaroons must be robustly secured.
*   Webhooks receiving settlement confirmations from the LSP must validate cryptographic signatures (e.g., HMAC) to prevent malicious actors from spoofing "paid" statuses to steal resources.

## 7. Rollout Plan / Milestones
1.  **Phase 1**: Integrate `lsat-js`/`macaroons.js` and securely sign/verify Caveats internally, continuing to use the Mock Provider.
2.  **Phase 2**: Implement the `LnbitsPaymentProvider` and test with real (testnet/mainnet) Lightning wallets.
3.  **Phase 3**: Expose the webhook receiver and switch the database status updates from synchronous polling to asynchronous push notifications.
4.  **Phase 4**: Publish the OpenAPI discovery endpoint for upfront pricing.
