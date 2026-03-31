# RFC 0024: Performance & Scalability for Agentic Workloads

- **Status**: Proposed
- **Author**: DLIGTHART
- **Created**: 2026-03-12
- **Updated**: 2026-03-31

## 0. Current Status

As of 2026-03-31, RFC 0024 remains proposed. Some protective runtime work has landed, but the main scalability architecture in this RFC is still open.

Already true on `main`:

- actor-aware rate limiting reduces cross-actor contention between supervisor sessions and API credentials
- background jobs, worker-status reporting, and deployment discovery make deferred work and readiness more observable
- the runtime is increasingly explicit about capability, health, and workload posture through `/api/capabilities` and `/api/deployment-status`

Still pending from this RFC:

- shared Redis-backed caching
- formal read-replica routing
- horizontal worker locking strategy for clustered deployments
- published load-test benchmarks and latency SLO reporting

## 1. Summary

As WordClaw transitions into a primary ecosystem for agentic content operations, the system profile changes radically. Instead of predictable human click-paths, WordClaw must sustain spikes of concurrent agent activity such as dry-runs, semantic searches, capability polling over MCP, and aggressive workflow evaluations.

While PostgreSQL and `pgvector` provide a solid, ACID-compliant foundation, direct database hits for every agent read operation will eventually create a bottleneck. This RFC outlines the architectural next steps for ensuring WordClaw can scale horizontally and sustain high-throughput agent traffic while preserving sub-200ms latency.

## 2. Motivation

Agents are "loud" consumers. A single autonomous task might require:
1. Fetching the capabilities manifest (`system://capabilities`).
2. Resolving workspace targets (`workspace resolve`).
3. Running 5-10 semantic searches for context mapping.
4. Firing 3 different policy dry-runs to validate mutation legality.

When multiplied across 100 concurrent agents, a standard Node.js + Postgres architecture will thrash. To maintain WordClaw's positioning as an enterprise-grade agentic CMS, we must establish explicit caching layers, scaling patterns, and published performance benchmarks.

## 3. Proposal

### 3.1. Dedicated Caching Layer (Redis)

We propose introducing Redis as an optional but highly recommended caching layer for environments experiencing high agent traffic. 

**Key Cache Targets:**
- **Capabilities Manifests**: The MCP capabilities and workspace structure rarely change minute-by-minute but are requested by every agent upon connection. These will be heavily cached and invalidated only upon Content Type changes or Policy configuration updates.
- **Semantic Search Results**: The `/api/search/semantic` endpoint is computationally expensive. We will cache the returned embeddings for frequent identical or conceptually similar searches (using a semantic similarity threshold before bypassing the cache).
- **Policy Decision Cache**: Frequently evaluated stateless authorization policies (e.g., "Can role X access domain Y?") should hit the cache before invoking the full AST evaluation engine.

### 3.2. Horizontal Scaling Guidance

WordClaw is inherently designed to be stateless at the API tier, but we must formalize and document how integrators should scale the platform.

**Stateless Node Tier**:
- Documentation will be added explicitly guiding users on how to run multiple WordClaw instances behind a Reverse Proxy (Nginx, Traefik) or orchestrator (Kubernetes ReplicaSets).
- Background workers (like the `pgvector` Embedding Generator and Payment Reconciliation sweeps) will utilize Redis-backed locking mechanisms to prevent duplicate execution across horizontal node clusters.

**PostgreSQL Read Replicas**:
- Agent-heavy workloads are inherently read-heavy (90% reads / 10% mutations). 
- We will provide configuration adapters to explicitly route read traffic (like MCP `GET` calls and semantic searches) to a pool of Read Replicas, preserving the Primary instance exclusively for ACID transactions (`POST/PATCH` mutations).

### 3.3. Benchmarking and SLAs

To build trust within the developer ecosystem, "performant" is no longer enough. We must publish concrete numbers.

**Initial Benchmark Target:**
> *WordClaw handles 100 concurrent agent API dry-runs and capability requests with < 200ms p95 latency on standard hardware.*

**Implementation:**
- Integrate localized load-testing (e.g., using `k6` or `Artillery`) into our CI pipeline.
- Publish these benchmark metrics directly in our release notes and documentation so adopters have clear operational baselines.

## 4. Drawbacks

- **Operational Complexity**: Introducing Redis adds another piece of infrastructure for self-hosters to manage. (Mitigation: Redis remains strictly optional; in its absence, the system gracefully falls back to direct Postgres reads or basic in-memory LRU caching).
- **Cache Invalidation**: Distributed cache invalidation is notoriously difficult and could lead to agents acting on stale policy definitions.

## 5. Alternatives

- **In-Memory LRU Only**: Continue using purely in-memory Node.js caches. *Issue*: This does not share state across horizontally scaled Node instances, leading to cache misses and redundant DB hits across the cluster.
- **GraphQL Field Caching**: Rely on GraphQL query caching. *Issue*: This ignores the REST and direct MCP transport layers that AI agents prefer.

## 6. Adoption Strategy

1. **Phase 1**: Implement basic in-memory caching behind feature flags for immediate relief.
2. **Phase 2**: Merge Redis adapter support (RFC approved). Add clustering support for background workers to allow safe horizontal scaling.
3. **Phase 3**: Publish load testing scripts and the first official benchmark report asserting the "100 concurrent agents under 200ms" guarantee.
