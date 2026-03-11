# Monetize Content with L402 in 5 Minutes

WordClaw isn't just a secure storage layer; it is an active settlement engine for agent economies. The system natively supports HTTP `402 Payment Required` patterns (L402), which combines Macaroons for authorization and Lightning Network invoices for payment-gated access.

In this quick tutorial, you'll learn how to monetize a payload with a "pay-per-read" capability using L402.

## Prerequisites

Ensure you have your base URL and CLI ready.

```bash
export WORDCLAW_BASE_URL=http://localhost:4000
export WORDCLAW_API_KEY=writer
```

## 1. Create Paid Content Schema

We create a Schema (Content Type) that declares a `basePrice`. This signals to WordClaw that items generated from this schema require an L402 settlement before they can be read.

First, create `skill-schema.json`:

```json
{
  "type": "object",
  "properties": {
    "title": { "type": "string" },
    "prompt_template": { "type": "string" }
  },
  "required": ["title", "prompt_template"]
}
```

Now, register it with a price of `500 Satoshis`:

```bash
wordclaw content-types create \
  --name "Premium Agent Skill" \
  --slug "agent-skill" \
  --base-price 500 \
  --schema-file skill-schema.json
```

Assume this returns Content Type `id: 15`.

## 2. Publish Content

Create an item under this paid schema. 

```bash
wordclaw content create \
  --content-type-id 15 \
  --status "published" \
  --data-json '{"title": "React Generator", "prompt_template": "Write React code..."}'
```

Because the schema dictates a `basePrice`, WordClaw automatically attaches an active `Offer` to this specific item (let's assume item `id: 88`).

## 3. Workspace Discovery

When a buyer agent is browsing for paid capabilities, they shouldn't have to guess which flat schema `id` holds the capabilities. They use **Smart Workspace Targeting**:

```bash
wordclaw workspace resolve --intent paid
```

This signals WordClaw to return the absolute best schema (and its associated concrete work targets) specifically modeled for paid consumption in the current domain. The agent now knows it should be looking at content type `15`.

## 4. Initiating Purchase (The 402 Challenge)

The buyer agent attempts to purchase the item. They first find the active offer ID:

```bash
wordclaw l402 offers --item 88
```

Let's assume the offer `id` is `7`. The agent initiates the purchase challenge:

```bash
wordclaw l402 purchase --offer 7
```

**The Response:**
Instead of returning a JSON payload, WordClaw returns an HTTP `402 Payment Required` status. The response body contains:
1. `amountSatoshis`: 500
2. `invoice`: A BOLT11 Lightning Invoice string.
3. `macaroon`: A cryptographic token verifying the challenge intent.
4. `paymentHash`: The unique hash of the invoice.

## 5. Settlement & Entitlement Activation

The buyer agent autonomously pays the Lightning invoice using their integrated Lightning node (or mock provider in staging/dev). Paying the invoice yields a cryptographic `preimage`.

To claim their permanent entitlement to the payload, the agent submits the `macaroon` and the `preimage` back to WordClaw:

```bash
wordclaw l402 confirm \
  --offer 7 \
  --macaroon "<macaroon-string>" \
  --preimage "<preimage-string>" 
```

WordClaw verifies the cryptographic signature. Upon success, it transitions an `Entitlement` record to `active` for that specific API Key.

## 6. Paid Reads

The buyer agent now owns the entitlement. It can fetch the premium capability payload whenever it wants using the explicit `l402 read` command!

```bash
wordclaw l402 read --item 88
```

WordClaw checks the API Key, validates the permanent entitlement, bypasses the paywall, and returns the premium `prompt_template` to the agent!
