# RFC 0017: Tenant Boundary and Contract Hardening

**Author:** Codex (Audit)  
**Status:** Proposed  
**Date:** 2026-02-25  

## 1. Summary
This RFC proposes a cross-cutting hardening pass to align runtime behavior with WordClaw's core multi-tenant and agent-safety promises. It introduces mandatory tenant-bounded data access patterns, stronger cross-protocol policy context, and explicit capability-contract tiering for parity and dry-run guarantees.

## 2. Motivation
Recent codebase audit findings identified several gaps between the documented concept and actual runtime behavior:
- Unscoped tenant reads/mutations in specific REST/GraphQL paths.
- Workflow and content-type reference binding that can cross tenant boundaries.
- Policy isolation checks that rely on `resource.domainId`, but adapters often omit that field.
- Documentation claims for parity/dry-run that exceed currently enforced coverage.

These gaps increase isolation risk and make guarantees ambiguous for agents/operators.

## 3. Proposal
Adopt three coordinated workstreams:

1. **Tenant Boundary Hardening**
- Enforce domain scope for all reads/writes on tenant-owned resources.
- Validate foreign-key references (`contentTypeId`, `workflowId`, etc.) against caller domain before insert/update.
- Replace globally unique tenant-owned identifiers with domain-scoped uniqueness where appropriate.

2. **Policy Context Enforcement**
- Require protocol adapters to provide domain-aware resource context (`resource.domainId`) or fail closed for write operations.
- Add end-to-end tests to prove policy-level cross-tenant denials in REST, GraphQL, and MCP request paths.

3. **Capability Contract Governance**
- Define capability tiers:
  - `Tier 1 (Core Contract)`: strict REST/GraphQL/MCP parity + dry-run where applicable.
  - `Tier 2 (Extended Surfaces)`: documented as protocol-specific until promoted.
- Align docs and CI checks to prevent contract drift.

## 4. Technical Design (Architecture)
### 4.1 Tenant-Scoped Access Helpers
Introduce shared repository/query helpers for tenant-owned tables:
- `whereDomain(table.domainId, domainId)`
- `assertDomainOwned(referenceTable, id, domainId)`
- `updateDomainScoped(...)`, `deleteDomainScoped(...)`

All handlers/resolvers/tools should consume these helpers instead of ad-hoc predicates.

### 4.2 Domain-Aware Reference Validation
Before insert/update operations that reference IDs from other entities:
- Validate existence and domain ownership in the same transaction where possible.
- Return deterministic isolation-safe errors (`*_NOT_FOUND` / `TENANT_ISOLATION_VIOLATION`) without leaking foreign-tenant details.

### 4.3 Policy Adapter Contract
Enhance adapter outputs:
- REST: include resource type, id, and `domainId` (resolved or inferred from principal for tenant-owned resources).
- GraphQL/MCP: require equivalent resource-domain context for writes.

For unresolved resources on writes, policy should deny by default (`POLICY_RESOURCE_DOMAIN_UNRESOLVED`).

### 4.4 Capability Tier Manifest
Extend capability governance:
- Keep `src/contracts/capability-matrix.ts` as Tier 1 source of truth.
- Add a capability manifest that classifies endpoints/tools/operations into tiers.
- Add CI checks that:
  - fail if Tier 1 docs and matrix differ,
  - fail if Tier 1 write operations lack declared dry-run support.

### 4.5 Data Model Hardening
Adjust schema constraints for tenant-owned identifiers:
- Move `content_types.slug` from global unique to composite unique `(domain_id, slug)`.
- Revisit other tenant-owned unique identifiers for similar coupling risks.

## 5. Alternatives Considered
- **Patch only individual bugs**: fast but repeats drift; lacks systemic guarantees.
- **Rely only on route-level SQL filters**: leaves policy architecture promise unfulfilled and fragile for new routes.
- **Downgrade docs to current behavior without hardening**: reduces trust in core multi-tenant value proposition.

## 6. Security & Privacy Implications
- Reduces cross-tenant data exposure risk.
- Improves deterministic denial behavior for adversarial cross-domain ID probing.
- Clarifies and constrains safety guarantees exposed to autonomous agents.
- Lowers probability of future regressions via CI-verified contract rules.

## 7. Rollout Plan / Milestones
1. **Phase 1 - Critical isolation fixes**
- Patch identified unscoped REST/GraphQL/workflow paths.
- Add tenant regression tests for each fixed path.

2. **Phase 2 - Policy context hardening**
- Update adapters/wrappers to pass domain-aware resource context.
- Add end-to-end policy deny tests across protocols.

3. **Phase 3 - Capability contract governance**
- Introduce tier manifest and CI drift checks.
- Update docs to explicit tier language.

4. **Phase 4 - Schema and migration hardening**
- Ship domain-scoped uniqueness migrations and error normalization.

5. **Phase 5 - Audit gate**
- Add recurring audit checklist item: tenant bounds, policy context completeness, tier-contract drift.
