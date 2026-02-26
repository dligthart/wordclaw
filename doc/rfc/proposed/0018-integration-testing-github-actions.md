# RFC 0018: Integration Testing via GitHub Actions

**Author:** DLIGTHART
**Status:** Proposed
**Date:** 2026-02-25

## 1. Summary
This RFC proposes the implementation of an integration testing suite for the WordClaw project, configured to run automatically on GitHub Actions. The suite will test the actual fastify API endpoints against a real PostgreSQL database with `pgvector`, ensuring that core functionalities such as API routing, database migrations, and database queries work seamlessly together in an automated pipeline.

## 2. Motivation
Currently, WordClaw relies primarily on testing via Vitest, which is great for fast execution of tests. However, we do not have a standard methodology or CI pipeline for running full integration tests against real infrastructure (a real database). 
By introducing integration tests that run in an automated CI pipeline on GitHub Actions:
- We prevent integration regressions before code is merged.
- We validate interactions with the database, including complex `pgvector` usage inside realistic edge cases.
- We ensure the production deployment expectations (schema version) closely mimic our test environment.

## 3. Proposal
We will introduce a new test script specifically for integration tests, leveraging the existing `vitest` dependency alongside `@fastify/inject` to simulate HTTP requests against our Fastify Application. 
To provide a realistic environment, our GitHub Actions workflow will spin up a temporary PostgreSQL service container (using a `pgvector` enhanced image).

**Workflow Diagram:**
```mermaid
sequenceDiagram
    participant PR as Pull Request / Push
    participant GA as GitHub Actions Runner
    participant DB as Postgres Service Container (pgvector)
    participant Test as Integration Tests (Vitest)
    
    PR->>GA: Trigger (push/pull_request event)
    GA->>DB: Start postgres service
    GA->>GA: Checkout code & Install deps
    GA->>Test: Run `npm run test:integration`
    Test->>DB: Apply Drizzle DB Migrations
    Test->>DB: Run tests (fastify.inject -> DB query)
    Test-->>GA: Return test status
    GA-->>PR: Report Success/Failure
```

## 4. Technical Design (Architecture)

### Testing Dependencies
- Use the existing `vitest` framework for executing and asserting tests.
- Use `@fastify/inject` for firing API requests against the initialized, yet unlistened, Fastify server.
- Add a new script `test:integration` to `package.json` that will execute integration specific files (e.g. `*.integration.test.ts` or mapping to a `tests/integration` folder).

### GitHub Actions Workflow
Create a new file `.github/workflows/integration-tests.yml`:
- Trigger: `push` on main and `pull_request` on all branches.
- Jobs:
  - `integration-test`:
    - Services: `postgres`, using `pgvector/pgvector:pg16` image.
    - Env vars: `DATABASE_URL` pointing to the service container (`postgres://user:pass@localhost:5432/wordclaw_test`).
    - Steps:
      - Checkout code.
      - Setup Node.js.
      - Run `npm ci` / `npm install`.
      - Wait for Postgres service to become fully healthy.
      - Apply DB schema (e.g., `npx drizzle-kit push` or executing a specific migration script).
      - Run `npm run test:integration`.

### Test File Structure
Integration tests should exist in a dedicated `tests/integration/` folder (or side-by-side using the `.integration.test.ts` extension). 
They will systematically test:
- Database schema applications.
- Complex content retrieval routes requiring RAG or vector similarity.
- Content Management CRUD workflows.
- MCP Server Tool Operations.

## 5. Alternatives Considered
- **E2E Testing (Playwright/Cypress)**: Writing End-to-End tests against the entire system including the VitePress docs or a frontend CLI. While valuable, E2E testing is significantly heavier. We need middle-layer integration testing to assure API stability before investing deeply in E2E GUI testing.
- **Using Testcontainers**: Relying on `testcontainers-node` inside the test script itself. This is a very viable alternative because it allows devs to run `npm run test:integration` locally and automatically have a dockerized postgres spin up. For this proposal, GitHub CI Service Containers present a simpler initial setup in GitHub Actions, though Testcontainers remains a good option for future local developer ergonomics.

## 6. Security & Privacy Implications
The CI workflow will run in a disposable runner, using a fresh mock database instance. No production data is used. JWT secrets and keys required during testing will be mock strings. There are no direct implications for production security.

## 7. Rollout Plan / Milestones
*   **Milestone 1**: Finalize the RFC and setup `vitest` configuration to distinguish between integration unit testing. Create an initial scaffolding integration test.
*   **Milestone 2**: Add `.github/workflows/integration-tests.yml` and configure the Postgres `pgvector` service container.
*   **Milestone 3**: Create comprehensive integration scenarios testing Data Models, Fastify Server logic, and database vector search. Integrate this CI check as a requirement before feature merges.
