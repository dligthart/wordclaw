# Live Feature Test Report: Intake and Draft Generation

Date: 2026-04-01
Target: `https://kb.lightheart.tech`
Tenant: `Lightheart` (`domainId=7`)
Runtime version: `1.47.0`

## Goal

Validate the live intake-to-draft path on production, including:

- tenant-scoped OpenAI provider provisioning
- workforce agent provisioning for proposal drafting
- public form submission
- background draft-generation job execution
- generated draft retrieval

## Summary

Result: partial pass.

- Passed: live runtime discovery, jobs worker health, content-type creation, form creation, public submission, draft job queueing, draft job execution, generated draft retrieval.
- Blocked: OpenAI provider provisioning and workforce agent provisioning both fail with `INTERNAL_SERVER_ERROR` because the production database is missing the tenant-scoped tables used by those features.
- Product behavior confirmed: the public client does not receive the generated draft synchronously. The submission response returns the intake item plus `draftGenerationJobId`. Consumers must poll `GET /api/jobs/:id` or use notification hooks.

## Blocking Findings

### OpenAI provider provisioning

Attempted:

- `PUT /api/ai/providers/openai`

Observed:

- `500 INTERNAL_SERVER_ERROR`
- SQL failure references missing `ai_provider_configs`

Evidence:

- [`openai-provider.put.response.json`](/Users/daveligthart/GitHub/wordclaw/output/live-tests/2026-04-01-intake-draft/openai-provider.put.response.json)

Request context from live response:

- requestId: `4ba4a120-c553-4d64-8340-9d41cac64372`

### Workforce agent provisioning

Attempted:

- `GET /api/workforce/agents`
- `POST /api/workforce/agents`

Observed:

- `500 INTERNAL_SERVER_ERROR`
- SQL failure references missing `workforce_agents`

Evidence:

- [`workforce-agent.create.response.json`](/Users/daveligthart/GitHub/wordclaw/output/live-tests/2026-04-01-intake-draft/workforce-agent.create.response.json)

Request context from live response:

- requestId: `b438224d-736d-4d29-9be2-e3544a7ea53e`

## Executed Live Path

Because OpenAI/workforce provisioning is blocked on the production schema, the end-to-end runtime test was executed with the built-in deterministic provider to validate the rest of the intake and job pipeline.

### 1. Runtime and worker health

- Runtime metadata returned `version=1.47.0`
- Jobs worker reported `started=true`
- Worker interval: `30000ms`

Evidence:

- [`runtime.response.json`](/Users/daveligthart/GitHub/wordclaw/output/live-tests/2026-04-01-intake-draft/runtime.response.json)
- [`worker-status.json`](/Users/daveligthart/GitHub/wordclaw/output/live-tests/2026-04-01-intake-draft/worker-status.json)

### 2. Created target content type

Created:

- content type id `4`
- slug `proposal-draft-live-20260401`

Evidence:

- [`proposal-draft-content-type.response.json`](/Users/daveligthart/GitHub/wordclaw/output/live-tests/2026-04-01-intake-draft/proposal-draft-content-type.response.json)

### 3. Created intake content type

Created:

- content type id `5`
- slug `proposal-request-live-20260401`

Evidence:

- [`proposal-request-content-type.response.json`](/Users/daveligthart/GitHub/wordclaw/output/live-tests/2026-04-01-intake-draft/proposal-request-content-type.response.json)

### 4. Created public intake form

Created:

- form id `1`
- slug `proposal-intake-live-20260401`
- draft generation provider: `deterministic`
- agent soul: `software-development-proposal-writer`
- target content type id: `4`

Field mapping used:

- `company -> company`
- `requirements -> brief`
- `requestedTimeline -> requestedTimeline`

Defaults used:

- `title = "Live test proposal draft"`
- `summary = "Deterministic live-test summary generated from intake mapping."`

Evidence:

- [`proposal-intake-form.json`](/Users/daveligthart/GitHub/wordclaw/output/live-tests/2026-04-01-intake-draft/proposal-intake-form.json)
- [`proposal-intake-form.response.json`](/Users/daveligthart/GitHub/wordclaw/output/live-tests/2026-04-01-intake-draft/proposal-intake-form.response.json)
- [`public-form.response.json`](/Users/daveligthart/GitHub/wordclaw/output/live-tests/2026-04-01-intake-draft/public-form.response.json)

### 5. Submitted public intake payload

Submitted payload:

- company: `Lightheart Holding`
- requestedTimeline: `6 weeks`
- budget: `EUR 20k-35k`
- requirements: software-development proposal brief

Submission result:

- intake content item id `4`
- status `draft`
- draft generation job id `1`
- success message returned to client

Evidence:

- [`proposal-intake-submission.json`](/Users/daveligthart/GitHub/wordclaw/output/live-tests/2026-04-01-intake-draft/proposal-intake-submission.json)
- [`public-submission.response.json`](/Users/daveligthart/GitHub/wordclaw/output/live-tests/2026-04-01-intake-draft/public-submission.response.json)
- [`intake-content-item-4.response.json`](/Users/daveligthart/GitHub/wordclaw/output/live-tests/2026-04-01-intake-draft/intake-content-item-4.response.json)

### 6. Background draft-generation job completed

Job result:

- job id `1`
- status `succeeded`
- strategy `schema_overlap_defaults_v1`
- provider `deterministic`
- generated content item id `5`

Evidence:

- [`job-1.response.json`](/Users/daveligthart/GitHub/wordclaw/output/live-tests/2026-04-01-intake-draft/job-1.response.json)
- [`job-1.after-wait.response.json`](/Users/daveligthart/GitHub/wordclaw/output/live-tests/2026-04-01-intake-draft/job-1.after-wait.response.json)
- [`worker-status.after-wait.json`](/Users/daveligthart/GitHub/wordclaw/output/live-tests/2026-04-01-intake-draft/worker-status.after-wait.json)

### 7. Generated draft retrieved

Generated content item:

- content item id `5`
- content type id `4`
- status `draft`

Generated data:

```json
{
  "title": "Live test proposal draft",
  "summary": "Deterministic live-test summary generated from intake mapping.",
  "company": "Lightheart Holding",
  "brief": "Create a concise software development proposal for a tenant-scoped AI content platform with supervisor UI, intake forms, and provider-backed drafting.",
  "requestedTimeline": "6 weeks"
}
```

Evidence:

- [`generated-content-item-5.response.json`](/Users/daveligthart/GitHub/wordclaw/output/live-tests/2026-04-01-intake-draft/generated-content-item-5.response.json)

## What This Proves

- The live public intake lane is working.
- Intake submissions are stored correctly.
- Draft-generation jobs are being enqueued and executed by the background worker.
- Generated draft content items are being created successfully.
- The current live client contract is asynchronous: submit first, then poll job status or consume notification events.

## What Is Still Broken

- Tenant-scoped external provider provisioning is not usable on production.
- Workforce-agent provisioning is not usable on production.
- The requested OpenAI-backed proposal flow cannot complete until the production database has the `ai_provider_configs` and `workforce_agents` tables.

## Production Artifacts Created During This Test

- content type `4` `proposal-draft-live-20260401`
- content type `5` `proposal-request-live-20260401`
- form `1` `proposal-intake-live-20260401`
- intake content item `4`
- generated content item `5`
- job `1`

No cleanup was performed so the evidence remains inspectable on the live tenant.
