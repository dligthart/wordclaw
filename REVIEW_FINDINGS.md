# Review Findings Handoff

Date: 2026-02-19
Reviewer: Codex
Scope: Complete repository review (API, DB schema/migrations, GraphQL, MCP, verification scripts, docs)

## Validation Snapshot

- `npm run build`: PASS
- `npm test`: PASS (smoke/integration tests via vitest)
- Notes: This codebase appears pre-commit and largely untracked in git; findings focus on production-risk behavior and integration gaps.

## Findings (Ordered by Severity)

### 1) [High] DB migration history is behind runtime schema ✅ RESOLVED

- Evidence:
  - Runtime schema includes `content_items.version`, `content_item_versions`, and `audit_logs` in `src/db/schema.ts:26`, `src/db/schema.ts:31`, `src/db/schema.ts:40`.
  - Runtime code uses these entities in `src/api/routes.ts:465`, `src/api/routes.ts:703`, and `src/mcp/server.ts:333`, `src/mcp/server.ts:523`.
  - Migration journal only contains two migrations in `drizzle/meta/_journal.json:4`.
  - Existing SQL migration `drizzle/0001_third_photon.sql:1` does not create `content_item_versions`, `audit_logs`, or `content_items.version`.
- Impact:
  - Fresh environments migrated from `drizzle/` will fail at runtime when endpoints/tools touch missing tables/columns.
  - Agent handoff risk is high because DB state may differ by machine.
- Resolution:
  - Generated migration `drizzle/0002_lucky_santa_claus.sql` that creates `audit_logs`, `content_item_versions`, fixes `content_type_id` column type, and adds `version` column.

### 2) [Medium] `PUT /api/content-types/:id` accepts empty body, then triggers server error ✅ RESOLVED

- Evidence:
  - Request body schema allows all optional fields in `src/api/routes.ts:139`.
  - Update call uses `.set(data)` in `src/api/routes.ts:187`.
  - Drizzle throws on empty update payload (`No values to set`), which currently bubbles to global error handling (`src/api/error-handler.ts:6`).
- Impact:
  - Client can send `{}` and receive a 500 instead of a deterministic 4xx validation error.
  - Breaks API predictability for agents.
- Resolution:
  - Added empty-body guard on both `PUT /content-types/:id` and `PUT /content-items/:id` that returns `400` with `EMPTY_UPDATE_BODY` code and remediation text.

### 3) [Medium] Rollback to a missing version maps to generic 500 ✅ RESOLVED

- Evidence:
  - Missing target version throws `new Error('TARGET_VERSION_NOT_FOUND')` in `src/api/routes.ts:578`.
  - No explicit catch/mapping in route; global handler returns generic 500 in `src/api/error-handler.ts:6`.
- Impact:
  - Expected domain error (invalid version) is surfaced as internal server error, reducing reliability for automated clients.
- Resolution:
  - Wrapped rollback handler in try/catch; `TARGET_VERSION_NOT_FOUND` now returns `404` with `AIErrorResponse` shape and remediation text.

### 4) [Medium] Foreign key column is modeled as `serial` instead of `integer` ✅ RESOLVED

- Evidence:
  - `contentTypeId` is defined as `serial('content_type_id')` in `src/db/schema.ts:23`.
  - SQL migration mirrors this with `"content_type_id" serial NOT NULL` in `drizzle/0001_third_photon.sql:3`.
- Impact:
  - FK column semantics are incorrect (`serial` implies auto-sequence identity behavior).
  - Increases risk of accidental inserts/sequence coupling and schema confusion.
- Resolution:
  - Changed to `integer('content_type_id').notNull().references(...)` in schema. Migration `0002` alters the column type.

### 5) [Medium] Runtime defaults and docs/scripts are inconsistent ✅ RESOLVED

- Evidence:
  - API default port is `3000` in `src/index.ts:67`.
  - README and verification scripts assume `4000` in `README.md:38`, `README.md:67`, `verify-api.ts:5`, `verify-graphql.ts:2`, `verify-audit.ts:2`.
  - README asks for `cp .env.example .env` in `README.md:34`, but `.env.example` is missing.
- Impact:
  - New contributors and automation scripts fail or appear flaky without manual environment correction.
- Resolution:
  - Default port changed to `4000` in `src/index.ts`.
  - Created `.env.example` with documented defaults.
  - Updated README instructions.

### 6) [Low] No automated test suite is configured ✅ RESOLVED

- Evidence:
  - `package.json:11` contains placeholder test script that always exits non-zero.
- Impact:
  - No CI guardrails against regressions in route contracts, migrations, and MCP tools.
- Resolution:
  - Added vitest as dev dependency.
  - Created `src/__tests__/api.smoke.test.ts` covering CRUD, dry-run, rollback (including new error cases), and audit logs.
  - Updated `npm test` to run `vitest run --reporter verbose`.

### 7) [Low] License metadata/docs mismatch and missing license file ✅ RESOLVED

- Evidence:
  - `package.json:19` license is `ISC`.
  - README states MIT in `README.md:103`, and `LICENSE` file is missing.
- Impact:
  - Ambiguous legal terms for contributors/users.
- Resolution:
  - Changed `package.json` license to `MIT`.
  - Created `LICENSE` file with MIT license text.

## Suggested Verification After Fixes

- Run `npm run build`.
- Run migration on a clean DB and verify startup.
- Run core scripts: `verify-api.ts`, `verify-dry-run.ts`, `verify-versioning.ts`, `verify-audit.ts`, `verify-mcp.ts`, `verify-mcp-advanced.ts`.
- Run `npm test` for automated smoke tests.
- Confirm docs commands work exactly as written from a fresh clone.
