# Live Feature Test Report: OpenAI Intake and Draft Generation Rerun

Date: 2026-04-01
Target: `https://kb.lightheart.tech`
Tenant: `Lightheart` (`domainId=7`)
Runtime version: `1.47.1`

## Goal

Rerun the live intake and draft-generation feature test after the tenant AI migration fix was deployed, covering:

- tenant-scoped OpenAI provider provisioning
- tenant-scoped workforce agent provisioning
- public intake form submission
- background OpenAI draft generation
- retrieval of the generated proposal draft

## Outcome

Result: pass, with one important compatibility caveat.

- Passed: provider provisioning, workforce agent creation, form creation, public submission, background OpenAI draft generation, generated draft retrieval.
- Remaining product issue: the current OpenAI path only works when the target content-type schema already matches OpenAI's stricter structured-output JSON schema subset.

## Provisioning Checks

### OpenAI provider provisioning

Succeeded.

- provider id `1`
- provider `openai`
- default model `gpt-4.1-mini`

Evidence:

- [openai-provider.put.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T191848Z-intake-draft-rerun/openai-provider.put.response.json)
- [ai-providers.after.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T191848Z-intake-draft-rerun/ai-providers.after.json)

### Workforce agent provisioning

Succeeded.

- workforce agent id `1`
- slug `proposal-writer-live-20260401t191848z`
- SOUL `software-development-proposal-writer`
- provider `openai`
- model `gpt-4.1-mini`

Evidence:

- [workforce-agent.create.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T191848Z-intake-draft-rerun/workforce-agent.create.json)
- [workforce-agent.create.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T191848Z-intake-draft-rerun/workforce-agent.create.response.json)
- [workforce-agents.after.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T191848Z-intake-draft-rerun/workforce-agents.after.json)

## OpenAI Draft-Generation Passes

### Pass 1: raw WordClaw schema

Form:

- form id `2`
- slug `proposal-intake-openai-live-20260401t192152z`

Job:

- job id `2`
- final status `failed`

Failure:

- OpenAI rejected the schema because `additionalProperties` was not supplied as `false`.

Exact live error:

- `400 Invalid schema for response_format ... 'additionalProperties' is required to be supplied and to be false.`

Evidence:

- [proposal-intake-form.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T191848Z-intake-draft-rerun/proposal-intake-form.response.json)
- [public-submission.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T191848Z-intake-draft-rerun/public-submission.response.json)
- [job-2.final.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T191848Z-intake-draft-rerun/job-2.final.response.json)

### Pass 2: `additionalProperties: false` only

Form:

- form id `3`
- slug `proposal-intake-openai-strict-live-20260401t192410z`

Job:

- job id `3`
- final status `failed`

Failure:

- OpenAI rejected the schema because every property must also be included in `required`.

Exact live error:

- `400 Invalid schema for response_format ... 'required' is required to be supplied and to be an array including every key in properties. Missing 'company'.`

Evidence:

- [proposal-intake-strict-form.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T191848Z-intake-draft-rerun/proposal-intake-strict-form.response.json)
- [public-submission-strict.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T191848Z-intake-draft-rerun/public-submission-strict.response.json)
- [job-3.final.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T191848Z-intake-draft-rerun/job-3.final.response.json)

### Pass 3: OpenAI-compatible schema subset

Target schema shape:

- `additionalProperties: false`
- every declared property listed in `required`

Form:

- form id `4`
- slug `proposal-intake-openai-compatible-live-20260401t192530z`

Job:

- job id `4`
- final status `succeeded`
- strategy `openai_structured_outputs_v1`
- response id `resp_07c24a43782711320169cd713d7640819889d2a2f2346ba44e`

Generated content:

- intake content item id `8`
- generated proposal draft item id `9`

Generated draft payload:

```json
{
  "title": "Software development proposal draft",
  "brief": "Draft a concise software development proposal for a tenant-scoped AI content platform with supervisor UI, public intake forms, and provider-backed draft generation.",
  "summary": "This proposal outlines the development of a tenant-scoped AI content platform tailored for Lightheart Holding. The platform will feature a supervisor user interface for management oversight, publicly accessible intake forms for content submissions, and integration with AI providers to support draft generation. The project aims to deliver a scalable, user-friendly solution within a 6-week timeline and a budget range of EUR 20,000 to 35,000.",
  "proposalOutline": "1. Project Initiation: Define detailed requirements and project milestones with Lightheart Holding.\\n2. System Architecture Design: Develop a scalable multi-tenant architecture ensuring data isolation per tenant.\\n3. Supervisor User Interface Development: Build a robust UI for supervisors to manage tenants and content workflows.\\n4. Public Intake Forms: Implement accessible, secure web forms for public content submissions.\\n5. AI Provider Integration: Integrate with selected AI services to enable automated draft generation.\\n6. Testing and Quality Assurance: Conduct thorough functional, security, and performance testing.\\n7. Deployment and Training: Deploy the platform and provide training and documentation.\\n8. Support and Maintenance Planning: Establish post-launch support protocols.",
  "company": "Lightheart Holding",
  "requestedTimeline": "6 weeks"
}
```

Evidence:

- [proposal-intake-compatible-form.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T191848Z-intake-draft-rerun/proposal-intake-compatible-form.response.json)
- [public-submission-compatible.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T191848Z-intake-draft-rerun/public-submission-compatible.response.json)
- [job-4.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T191848Z-intake-draft-rerun/job-4.response.json)
- [generated-content-item-9.compatible.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T191848Z-intake-draft-rerun/generated-content-item-9.compatible.response.json)
- [intake-content-item-8.compatible.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T191848Z-intake-draft-rerun/intake-content-item-8.compatible.response.json)

## Client Contract Observed Live

The public submission endpoint is still asynchronous.

The client receives:

- `contentItemId` for the intake submission
- `draftGenerationJobId` for the background job
- `successMessage`

The client does not receive the generated draft inline from `POST /api/public/forms/:slug/submissions`.

To obtain the final draft, the client must:

- poll `GET /api/jobs/:id`, or
- consume a notification mechanism such as form webhooks

## Conclusion

The original production blocker is fixed: tenant-scoped OpenAI provider provisioning and workforce-agent provisioning now work live on `kb.lightheart.tech`.

The remaining issue is narrower and reproducible:

- the current OpenAI draft-generation implementation passes the target content-type schema directly to OpenAI structured outputs
- OpenAI enforces a stricter JSON schema subset than WordClaw currently requires
- because of that, valid WordClaw content-type schemas can still fail at runtime unless they already match OpenAI's subset

In practice, the OpenAI path is live and working today when the target schema uses:

- `additionalProperties: false`
- every property listed in `required`

## Production Artifacts Created During This Rerun

- AI provider config `1` for `openai`
- workforce agent `1` `proposal-writer-live-20260401t191848z`
- content type `6` `proposal-draft-openai-live-20260401t192152z`
- content type `7` `proposal-request-openai-live-20260401t192152z`
- form `2` `proposal-intake-openai-live-20260401t192152z`
- job `2` failed
- content type `8` `proposal-draft-openai-strict-live-20260401t192410z`
- form `3` `proposal-intake-openai-strict-live-20260401t192410z`
- job `3` failed
- content type `9` `proposal-draft-openai-compatible-live-20260401t192530z`
- form `4` `proposal-intake-openai-compatible-live-20260401t192530z`
- intake content item `8`
- generated content item `9`
- job `4` succeeded

No cleanup was performed so the evidence remains inspectable on the live tenant.
