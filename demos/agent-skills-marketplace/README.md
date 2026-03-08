# Paid Capability Library Demo

This demo shows the current supported WordClaw paid-content flow:

- published content items as capability payloads
- attached offers and license policies
- L402 purchase challenges
- entitlement activation
- paid reads followed by local execution in a sandbox

It intentionally no longer tells the old AP2 or revenue-routing marketplace story.

## Run It

1. Start the backend:

   ```bash
   npm run dev
   ```

2. Seed the demo domain, content, and offers:

   ```bash
   npx tsx scripts/setup-skills-marketplace.ts
   ```

   Copy the printed API key.

3. Create a local `.env` in this folder:

   ```bash
   VITE_WORDCLAW_URL=http://localhost:4000/api
   VITE_WORDCLAW_API_KEY=<paste-key-here>
   ```

4. Start the demo:

   ```bash
   npm install
   npm run dev
   ```

5. Open the local Vite URL.

## What To Look For

- `Library` shows published capability content items.
- Each paid item exposes its current offer and price.
- `Start purchase` triggers the real `POST /api/offers/:id/purchase` L402 challenge.
- `Simulate Lightning payment` confirms the purchase, activates the entitlement, and opens the content using the entitlement-backed read path.
- `Run in sandbox` renders the unlocked prompt template locally without pretending WordClaw is a marketplace or payout engine.
