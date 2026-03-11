# Conceptual Deep Dive: Workspace Target Resolution

One of WordClaw's most powerful capabilities for autonomous systems is the concept of `Workspace Target Resolution`. It removes the fragility associated with generic "GET all items and guess" programming loops, replacing it with an intent-based heuristic payload.

## The Problem With Flat API Discovery

Traditional headless CMS layouts expose endpoints like `/api/content-types`. To find out what shape to author against, an agent typically has to download the entire array of schemas across all models, iterate through them looking for keywords (e.g., finding the word "article"), and then select an arbitrary ID. 

This breaks when:
1.  A tenant has 50 different schemas, many unmaintained.
2.  The schema named "Article" is currently archived or read-only.
3.  The agent script is trying to find a high-priority "review task", not just a general content schema.

## Resolution By Intent

WordClaw solves this with intent-based targeting.

Instead of asking "What schemas exist?", the agent asks "I have a specific `intent`; tell me exactly where to start working."

### Intents

The `GET /api/workspace-target?intent=<intent>` endpoint natively understands four distinct work heuristics:

-   `authoring`: The agent wants to create new payload objects. WordClaw identifies the most active, non-archived schema in the domain.
-   `review`: The agent has the `workflow:approve` scope. WordClaw identifies the singular schema carrying the highest density of unresolved review tasks.
-   `workflow`: The agent wants to study active transition rules. WordClaw finds schemas that have deeply nested policy configurations.
-   `paid`: The agent has a Lightning Wallet and expects an L402 challenge. WordClaw identifies premium capabilities or content items with attached `Offers` explicitly requiring payment validation.

## The Smart Targeting Heuristic

When `workspace resolve --intent review` is executed, WordClaw ranks the schemas:

1.  **Count pending tasks**: It counts all active review tasks matching the `intent`.
2.  **Filter by Actor Scopes**: If a schema has 10 pending reviews, but the current API Key snapshot is missing `workflow:approve`, that schema is aggressively down-ranked or excluded.
3.  **Return actionable payload**: The resulting response doesn't just return a schema ID. It returns a `workTarget` object pointing directly at the most heavily clogged, actor-accessible unit of work.

By providing this contextual, actor-aware targeting layer natively within the REST and MCP endpoints, WordClaw drastically shortens the reasoning loop for complex AI agents executing within real-world business systems.
