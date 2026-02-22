#!/bin/bash
set -ex

REPO="dligthart/wordclaw"
echo "Creating milestones and issues for $REPO..."

# Priority 0
echo "Creating Priority 0 Milestone..."
M0="Priority 0: Foundational & Usability"
gh api -X POST repos/$REPO/milestones -f title="$M0" -f description="RFC 0002 (Usability) and RFC 0008 (Policy Parity)"
gh issue create --title "RFC 0002: Agent Usability Improvements" --body "Implement custom Fastify error handlers, native JSON for schema/data fields, and nested REST endpoints with strict protocol error parity as defined in RFC 0002." --milestone "$M0" || echo "Failed issue 2"
gh issue create --title "RFC 0008: Cross-Protocol Policy Parity Framework" --body "Implement centralized PolicyEngine with fail-closed fallback and context geometry for REST, GraphQL, and MCP as defined in RFC 0008." --milestone "$M0" || echo "Failed issue 8"

# Priority 1
echo "Creating Priority 1 Milestone..."
M1="Priority 1: Core Monetization & Safety"
gh api -X POST repos/$REPO/milestones -f title="$M1" -f description="RFC 0003 (Settlement), RFC 0004 (Licensing), and RFC 0007 (Workflow)"
gh issue create --title "RFC 0003: Production Lightning Settlement" --body "Implement IPaymentProvider interface, Macaroon/LSAT Authorization, and asynchronous webhooks with idempotency and reconciliation worker." --milestone "$M1" || echo "Failed issue 3"
gh issue create --title "RFC 0004: Agentic Content Licensing and Entitlements" --body "Implement Offers, License Policies, and Entitlements with Macaroon caveats and atomic metering as defined in RFC 0004." --milestone "$M1" || echo "Failed issue 4"
gh issue create --title "RFC 0007: Policy-Driven Editorial Workflow" --body "Implement workflow definitions, transition policies using JSONLogic, and review tasks with SLA escalation as defined in RFC 0007." --milestone "$M1" || echo "Failed issue 7"

# Priority 2
echo "Creating Priority 2 Milestone..."
M2="Priority 2: Discovery & Outbound Distribution"
gh api -X POST repos/$REPO/milestones -f title="$M2" -f description="RFC 0005 (Distribution) and RFC 0009 (Consumption API)"
gh issue create --title "RFC 0005: Multi-Channel Distribution Orchestrator" --body "Implement PostgreSQL-backed queue (pg-boss or SKIP LOCKED) for distribution plans, adaptors (webhook, RSS, etc.), and entitlement verification." --milestone "$M2" || echo "Failed issue 5"
gh issue create --title "RFC 0009: Content Discovery and Consumption API" --body "Implement catalog indexing with PostgreSQL full-text search, pull subscriptions, and access-aware retrieval." --milestone "$M2" || echo "Failed issue 9"

# Priority 3
echo "Creating Priority 3 Milestone..."
M3="Priority 3: Polish & Backoffice Economics"
gh api -X POST repos/$REPO/milestones -f title="$M3" -f description="RFC 0006 (Payouts) and RFC 0001 (Valuation)"
gh issue create --title "RFC 0006: Revenue Attribution and Agent Payouts" --body "Implement append-only contribution and revenue ledgers, dispute windows, and background Lightning address payout worker." --milestone "$M3" || echo "Failed issue 6"
gh issue create --title "RFC 0001: Blog Valuation Architecture" --body "Implement ValuationEngine with Ahrefs and Stripe adapters, caching, and stale-data fallbacks." --milestone "$M3" || echo "Failed issue 1"

echo "Done!"
