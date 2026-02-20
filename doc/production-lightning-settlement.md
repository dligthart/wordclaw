# Production Lightning Network Settlement Plan

Moving the current mock L402 implementation to a production-ready Lightning Network (LN) environment involves upgrading three core components: the **Payment Provider Interface**, the **Macaroon/LSAT Authorization capability**, and the **Database Ledger**.

This document outlines the step-by-step plan for bringing the WordClaw CMS into production on the Lightning Network.

---

## 1. Lightning Service Provider (LSP) Integration

Currently, the `MockPaymentProvider` immediately returns mock invoices and blindly verifies payments. For production, the API must connect to a real Lightning Node or an LSP to generate working `lnbc` invoices and check settlement status on the chain.

### Recommended Providers
- **LNbits**: Excellent for quick MVP integration with webhooks and isolated wallets per supervisor. High reliability through simple REST endpoints.
- **Alby / Strike**: Custodial APIs that simplify handling routing liquidity. 
- **LND (Lightning Network Daemon)**: Self-hosted Node. Provides gRPC streams for real-time invoice settlement notifications, offering complete sovereignty.

### Action Plan
1. Create an `LnbitsPaymentProvider` implementing `PaymentProvider`.
2. Map `createInvoice` to perform a `POST /api/v1/payments` API call, generating a valid invoice string and `paymentHash`.
3. Map `verifyPayment` to query `GET /api/v1/payments/{paymentHash}` to check if the payment settled. 

---

## 2. Cryptographic Macaroons & LSAT Protocol

The mock utilizes simple HMACs mapped into JWT-like base64 payloads to simulate macaroons. In production, L402 dictates the usage of cryptographically sound **Macaroons** accompanied by **Preimages**.

### Why Real Macaroons?
Macaroons allow WordClaw (the issuing server) to attach **Caveats** to the invoice hash. 
For example:
- `time < 2026-12-31T00:00:00Z`
- `route = /api/content-items`
- `method = POST`

The server signs these constraints, handing the Macaroon to the AI Agent. The Agent pays the attached Lightning Invoice, receiving a 32-byte cryptographic **Preimage** from the network.

### Action Plan
1. Introduce the `lsat-js` or `macaroons.js` library into WordClaw.
2. In `l402Middleware`: 
   - Extract the request properties (Path, Price, Time) and bake them as Caveats into a new Macaroon using a secure `L402_SECRET`.
   - Send the constructed Macaroon and real Lightning invoice in the `Www-Authenticate: L402` header back to the client.
3. Upon retry, the server verifies both the Macaroon signature (using the secret) and validates that the attached Client Preimage mathematically hashes to the Invoice's Payment Hash `sha256(preimage) = payment_hash`.

---

## 3. Asynchronous Settlement & Webhooks

Currently, WordClaw blocks the agent's request to poll `verifyPayment` in order to determine if an invoice has been paid. In a production Lightning environment, payments can take between 1 to 15 seconds to route. Relying entirely on a client pulling the API risks timeouts or slow UX.

### Action Plan
1. Expose a webhook endpoint in WordClaw (e.g., `POST /webhooks/lightning/invoice-settled`).
2. When WordClaw requests an invoice from LNbits or Alby, register the webhook URL.
3. Upon successful payment across the Lightning Network, the provider pushes a notification to WordClaw.
4. WordClaw asynchronously updates the `payments` database table `status` to `paid` and stores the `preimage`.
5. *Optional*: Implement Server-Sent Events (SSE) or WebSockets on the frontend UI to instantly flip "PENDING" to "PAID" without requiring manual refreshes by the Supervisor.

---

## 4. Agent Identity & Price Negotiation Policies

The newly implemented Agent details tracking (`actor_id` and `details`) provides a baseline for monitoring who pays what. In production, WordClaw should formalize this trust model.

### Action Plan
1. Expose the base prices of `contentTypes` explicitly via a Discovery/OpenAPI endpoint so Agents know costs upfront without deliberately triggering a 402 HTTP error first.
2. Ensure the `actor_id` mapping tightly integrates with strict API Key enforcement.
3. Implement a refund or credit policy mechanism should an Agent pay for a post but subsequently provide invalid JSON data preventing insertion into the database.
