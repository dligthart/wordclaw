# RFC 0008: Cross-Protocol Policy Parity Framework

**Author:** AI Assistant  
**Status:** Proposed  
**Date:** 2026-02-21  

## 1. Summary
This RFC proposes a centralized policy engine and parity framework to guarantee that authentication, authorization, monetization, and workflow rules behave identically across REST, GraphQL, and MCP.

## 2. Dependencies & Graph
*   **Depends on:** Phase 7.0 (API Keys / Scopes) — Identity Resolution.
*   **Depends on:** RFC 0004 (Entitlements) — Monetization gate resolution.
*   **Depends on:** RFC 0007 (Workflow) — Workflow transition rule evaluation.
*   **Depended on by:** All Future Systems — Acts as the foundational enforcement mesh across properties.

## 3. Motivation
WordClaw already enforces capability parity (feature availability) across protocols, but policy parity is still vulnerable to drift. Historical issues showed route-level differences where one protocol enforced a rule and another did not. For agent reliability, policy outcomes must be transport-independent.

## 4. Proposal
Add a policy layer that evaluates every operation through a shared decision function:
* input: principal, operation, resource context, environment
* output: allow/deny/challenge + machine-readable remediation

Policy domains included in v1:
1. Auth scope enforcement
2. Workflow transition permissions
3. Monetization gates (L402/entitlements)
4. Rate/usage limits

## 5. Technical Design (Architecture)

### 5.1 Core Components
* `PolicyEngine`
  * `evaluate(operationContext): PolicyDecision`
* `PolicyAdapters`
  * REST adapter, GraphQL adapter, MCP adapter
* `PolicyDecision`
  * `{ outcome: 'allow' | 'deny' | 'challenge', code, remediation, metadata, policyVersion }`

### 5.2 Context Geometry
Protocol-specific adapters parse inputs into standard context geometries:
```typescript
interface OperationContext {
  principal: { agentProfileId: string; scopes: string[]; roles: string[] };
  operation: string;  // aligned with capabilityMatrix IDs (e.g., 'item.publish')
  resource: { type: string; id?: string; contentTypeId?: string };
  environment: { protocol: 'rest' | 'graphql' | 'mcp'; timestamp: Date };
}
```

### 5.3 Policy Registry and Execution Constraints
Define operation IDs aligned with `capabilityMatrix` and add `policyMatrix`:
* Structure: In-memory static schema combined with high-frequency database cache overrides (e.g., updated rate limits).
* Performance bounds: Entire evaluation pipeline must resolve in `< 5ms`.
* Resolution Hierarchy ("Restrictive wins"): `deny` > `challenge` > `allow`. If any domain explicitly denies, the operation folds.
* required scopes
* monetization mode
* workflow constraints
* throttling profile

### 5.4 Validation and Tooling
* Add policy parity tests similar to capability parity tests.
* Add a dry-run policy endpoint/tool:
  * REST: `POST /api/policy/evaluate`
  * GraphQL: `policyEvaluate`
  * MCP: `evaluate_policy`

### 5.5 Migration Strategy
* Wrap existing `authorizeApiRequest` and route guards behind `PolicyEngine`.
* Remove protocol-specific status mapping forks where possible.

## 6. Alternatives Considered
* **Protocol-local guards only**: Fast to implement, but repeatedly drifts.
* **Strict API gateway only**: Cannot fully express resource-level/workflow-level checks.
* **Manual parity reviews**: Too expensive and error-prone for ongoing evolution.

## 7. Security & Privacy Implications
* Centralized policy evaluation reduces inconsistent authorization surfaces.
* **Traceability:** Emit structured `PolicyDecisionLogs` tracking `operationContext` and `evaluatedRules` duration for diagnostics. Redact authorization/API tokens securely before logging. Expose decisions selectively to endpoint `GET /api/policy/decisions?principal=me`.
* Policy config changes should be versioned incrementally and stamped onto decisions for replicable auditing (`policyVersion`).

## 8. Rollout Plan / Milestones
1. **Phase 1**: Define `policyMatrix` schema, `OperationContext`, and test matrix.
2. **Phase 2**: Implement `PolicyEngine` memory-store and REST adapter wrapper.
3. **Phase 3**: Integrate GraphQL and MCP wrap-around evaluation adapters.
4. **Phase 4**: Add policy parity tests in CI and live simulation/dry-run points.
5. **Phase 5**: Wire specific `PolicyDecisionLogs` streaming directly into Phase 4 infrastructure.


