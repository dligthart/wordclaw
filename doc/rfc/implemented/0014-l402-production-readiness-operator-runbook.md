# RFC 0014: L402 Production Readiness - Operator Runbook Addendum

**Author:** Codex (AI-assisted)  
**Status:** Implemented  
**Date:** 2026-02-24  
**Related RFCs:** RFC 0003, RFC 0004, RFC 0006

## 1. Summary
This RFC is an operational addendum to RFC 0003. It defines what must be completed to move WordClaw's current L402 implementation from "development-capable" to "production-ready," and explicitly lists the account, wallet, infrastructure, and secret inputs required from the operator.

## 2. Why This Addendum Exists
RFC 0003 already defines the technical target and high-level gap analysis. Since then, the codebase still contains mock-provider behavior and placeholder token logic in the L402 path. This addendum closes the execution gap by turning RFC 0003 into a concrete launch runbook with owner-supplied prerequisites.

## 3. Current State (as of 2026-02-24)
The following remains true in the code:
- `src/services/l402-config.ts` still hard-fails non-mock providers in production unless explicitly overridden.
- `src/interfaces/payment-provider.ts` still exposes `verifyPayment(...): Promise<boolean>` and lacks explicit status/expiry semantics.
- `src/middleware/l402.ts` still issues HMAC-signed placeholder tokens, not real macaroons with caveats.
- Settlement remains synchronous request-time verification, without provider webhook ingestion, replay-safe eventing, or reconciliation worker.
- Payment domain scoping in L402 paths still relies on raw header extraction in parts of the flow.

## 4. Operator Inputs Required (What You Need To Provide)

### 4.1 Mandatory Decisions
- Select production payment backend architecture:
  - Option A (recommended V1): WordClaw -> LNbits -> backend funding source (Alby/Blink/OpenNode/etc.).
  - Option B: WordClaw -> direct LND integration (REST/gRPC + macaroon + TLS cert management).
- Choose testnet-first rollout window and mainnet launch date.
- Decide custody model:
  - Managed/custodial backend wallet.
  - Self-hosted node custody.

### 4.2 Accounts You Must Create
- Public DNS domain(s) for WordClaw API and payment callbacks.
- TLS certificate management (Let's Encrypt or managed certificate service).
- Lightning backend account(s), depending on architecture:
  - If using LNbits: LNbits instance + backend funding source account.
  - If using managed provider: provider account, API credentials, webhook config access.
  - If using self-hosted LND: node host and operational access (TLS cert + macaroon permissions).
- Secrets manager account/project (for production secret storage and rotation).
- Monitoring/alerting stack account (for payment and webhook SLO alerts).

### 4.3 Wallet and Treasury Inputs
- Treasury wallet funded with startup sats for operational liquidity and channel fees.
- Inbound liquidity plan to reliably receive payments (channels, liquidity marketplace, or LSP support).
- Outbound liquidity plan for settlement and service costs.
- Minimum/maximum invoice amount policy and emergency circuit-breaker thresholds.

### 4.4 Compliance and Finance Inputs
- Jurisdiction and tax treatment for Lightning receipts.
- Custody policy (who controls private keys, who can move funds).
- Incident contacts for payment outages and dispute handling.
- Accounting export requirements for payments and entitlements.

## 5. Production Requirements (Technical)

### 5.1 Protocol Correctness
- Replace HMAC placeholder token with real macaroon handling and caveat checks.
- Bind authorization caveats to route, method, tenant, amount, and expiry.
- Enforce strict L402 credential shape (`<macaroons>:<preimage>`) and TLS-only transport.

### 5.2 Payment Provider Contract Upgrade
- Extend provider interface to include:
  - `createInvoice(...): { paymentRequest, hash, expiresAt, providerInvoiceId }`
  - `verifyPayment(...)` returning explicit state (`pending|paid|expired|failed`)
  - `getInvoiceStatus(hash)` for reconciliation
  - optional provider webhook registration metadata
- Implement at least one real provider adapter (LNbits gateway or direct LND).

### 5.3 Settlement Model
- Add webhook endpoint for payment settlement callbacks.
- Validate webhook signature and enforce replay protection (`eventId` uniqueness window).
- Add reconciliation worker for stale pending payments.
- Enforce payment state machine transitions:
  - `pending -> paid -> consumed`
  - `pending -> expired`
  - `pending -> failed`

### 5.4 Tenant Safety
- Derive `domainId` from authenticated principal in all L402 write paths.
- Scope all pricing and payment lookups by tenant.
- Add tests for cross-tenant spoof attempts against L402 endpoints.

### 5.5 Reliability and Operations
- Add metrics:
  - invoice_create_success_rate
  - challenge_to_paid_latency
  - webhook_verify_fail_rate
  - reconciliation_corrections_total
  - pending_over_15m_count
- Add alerts:
  - pending invoices above threshold
  - webhook signature failures
  - provider API failure spikes
  - payment state transition violations
- Add runbooks:
  - provider outage fallback
  - secret rotation
  - replay event flood handling
  - stuck pending cleanup

## 6. Recommended Deployment Sequence

### Phase A - Control Plane Prep (Operator-owned)
- Create required accounts, domain, TLS, secret manager, and monitoring projects.
- Stand up LNbits or LND environment in testnet.
- Fund wallet and validate inbound/outbound liquidity.

### Phase B - Code and Schema Hardening
- Land provider contract changes and real adapter.
- Land webhook ingestion, state machine constraints, and reconciliation worker.
- Land macaroon caveat enforcement and tenant derivation fixes.

### Phase C - Testnet Soak
- Minimum 30-day testnet soak with synthetic invoice load.
- Capture SLOs and incident reports.
- Run key rotation drill and webhook replay drill.

### Phase D - Mainnet Graduation
- Gradual percentage rollout of L402-enforced routes.
- Freeze new feature work during first launch window.
- Publish post-launch metrics and rollback criteria.

## 7. Acceptance Criteria (Launch Gate)
- Zero mock provider usage in production environment.
- 100% of payment records tied to authenticated tenant identity (no raw-header trust).
- Webhook settlement + reconciliation both active and tested.
- Explicit `expired` and `failed` payment states exercised in integration tests.
- Macaroon caveat validation enforced for method/route/tenant/expiry.
- On-call runbook tested by a live fire-drill.

## 8. Owner Checklist (Actionable)
- [ ] Pick architecture option (LNbits gateway or direct LND).
- [ ] Create provider account(s) and obtain API credentials.
- [ ] Provision funded wallet and inbound liquidity.
- [ ] Provide production domain and TLS certs.
- [ ] Provide webhook public endpoint + shared signing secret.
- [ ] Provide secrets manager path and rotation policy.
- [ ] Approve testnet soak window and mainnet launch date.
- [ ] Approve monitoring/alerting destination and on-call contacts.

## 9. References
- RFC 0003: `doc/rfc/implemented/0003-production-lightning-settlement.md`
- L402 overview: https://docs.lightning.engineering/the-lightning-network/l402/l402
- L402 protocol specification: https://docs.lightning.engineering/the-lightning-network/l402/protocol-specification
- Aperture (L402 proxy) production notes: https://docs.lightning.engineering/lightning-network-tools/aperture/get-aperture
- LND invoice streaming: https://api.lightning.community/api/lnd/lightning/subscribe-invoices/index.html
- LND invoice lookup: https://api.lightning.community/api/lnd/lightning/lookup-invoice/index.html
- BOLT 11 payment encoding (expiry/default semantics): https://raw.githubusercontent.com/lightning/bolts/master/11-payment-encoding.md
- LNbits admin setup: https://docs.lnbits.org/guide/admin_ui.html
- LNbits installation flow: https://docs.lnbits.org/guide/installation.html
- LNbits backend wallets and required env vars: https://docs.lnbits.org/guide/wallets.html
- Lightning liquidity requirements: https://docs.lightning.engineering/the-lightning-network/liquidity/how-to-get-inbound-capacity-on-the-lightning-network
- Merchant liquidity guidance: https://docs.lightning.engineering/the-lightning-network/liquidity/liquidity-management-for-lightning-merchants
