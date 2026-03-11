# Conceptual Deep Dive: Contracts vs. Schemas

When orchestrating autonomous agents, the WordClaw runtime distinguishes explicitly between two closely related concepts: the **Deployment Contract** and the **Domain Schema**. 

In most traditional headless CMS systems, "Schema" effectively *is* the contract. But because WordClaw must safely bind a heterogeneous mix of LLM agents, plugins, integration workers, and human supervisors to arbitrary tenant data, we need a higher-level primitive.

## The Deployment Contract

The Contract describes the *hardcoded physical realities* of the current WordClaw deployment. These facts do not change unless the runtime is restarted with different code or environment variables.

If an agent wants to know whether this deployment supports Lightning payments or what protocol transports it exposes, the agent reads the deployment capabilities manifest (`system://capabilities` or `GET /api/capabilities`).

A Contract informs an agent:
1.  **Transports available**: E.g., REST vs. GraphQL, `mcp stdio` vs. `mcp http`.
2.  **Enabled Subsystems**: Is the L402 worker running? Is the Background Indexer indexing?
3.  **Active Feature Flags**: E.g., `enableL402`, `enableTaskGuidance`, `requireHTTPS`.
4.  **Dry-Run Verification**: Which mutations support simulated dry runs before committing state.

This information is invariant and universal across all tenants hosted on the instance.

## The Domain Schema

The Schema describes the *tenant-specific data models* defined dynamically inside a Workspace. It changes at the speed of business, not the speed of deployment. 

In WordClaw, Schemas are stored as JSON Schema objects under a `ContentType`.

If an agent wants to know what properties are required to author a "Blog Post", it reads the domain schema (`GET /api/content-types/:id`). 

A Schema informs an agent:
1.  **Content Shape**: What fields are strings, integers, arrays, etc.
2.  **Validation Rules**: Max lengths, required arrays, valid enums.
3.  **Governance Policy**: Does this payload require an explicit `review` state before becoming `published`?
4.  **Monetization Details**: Does this shape have a default `basePrice` forcing an L402 gateway?

This information varies completely between active Workspaces. 

---
### Summary

**Always inspect the Contract (`wordclaw capabilities status`) before trusting a system interaction. Always inspect the Schema (`wordclaw workspace resolve`) before attempting an explicit data payload mutation.**
