# Proposal Portal Demo

This demo shows a realistic intake-to-approval-to-delivery flow on top of the local WordClaw runtime:

- a client creates a demo-local account
- the client submits a project brief through a web form
- WordClaw creates the intake item and queues draft generation
- the generated proposal waits for human approval in the supervisor
- after approval, the client signs in and sees the published proposal in their account

The demo is intentionally part of the main repo instead of a separate product. It uses the local WordClaw runtime, a demo tenant, the built-in jobs worker, and the supervisor approval queue.

## What It Provisions

The seed script creates or updates:

- domain: `proposal-portal.demo.local`
- content types:
  - `demo-proposal-account`
  - `demo-proposal-brief`
  - `demo-proposal`
- workforce agent: `demo-proposal-writer`
- form: `demo-proposal-intake`
- workflow transition from `draft` to `published`
- tenant-scoped reviewer login for the supervisor
- a fresh admin API key for the demo portal server
- `demos/demo-proposal-portal/.env.local`

By default, the demo uses the deterministic draft worker so the feature can run in any local checkout.

If you want provider-backed generation instead, seed with:

```bash
DEMO_PROPOSAL_PROVIDER=openai OPENAI_API_KEY=... npm run demo:seed-proposal-portal
```

## Run It

Before seeding, make sure the local Postgres instance used by WordClaw is reachable via the repo `.env`.

1. Start the local WordClaw runtime and jobs worker:

   ```bash
   npm run dev
   ```

2. Seed the demo tenant and local demo env:

   ```bash
   npm run demo:seed-proposal-portal
   ```

3. Start the demo portal:

   ```bash
   npm run demo:proposal-portal
   ```

4. Open the portal:

   ```text
   http://localhost:4318
   ```

5. Create a client account, submit a project brief, then open the reviewer link shown in the demo UI.

6. Sign in to the local WordClaw supervisor and approve the proposal request.

7. Return to the portal and refresh. The proposal now appears in the client account.

## Reviewer Credentials

The seed script creates a tenant-scoped reviewer for local testing:

- email: `reviewer@proposal-demo.local`
- password: `WordClawDemo!2026`

Those credentials are written to `.env.local` and surfaced in the demo UI so the approval step is easy to test locally.

## Why the Portal Has Its Own Login

WordClaw currently provides operator and supervisor auth, not end-user customer accounts.

This demo adds a thin app-side session layer and stores demo account records inside the seeded tenant so the portal can:

- associate requests with a customer email
- query generated proposals for that customer
- hide proposals until the latest human review decision is approved

That means the demo is honest about the current product boundary:

- WordClaw owns intake, draft generation, workflow tasks, and published proposal content
- the demo app owns the customer-facing account/session layer

## Demo Notes

- The demo server reads review-task status directly from the local WordClaw database so it can decide whether a generated proposal should be visible to the customer.
- The customer portal never exposes the raw admin API key to the browser.
- Re-running the seed script refreshes the demo config and writes a new admin key to `.env.local`.
