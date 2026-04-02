# Live Feature Test Report: OpenAI Intake and Draft Generation Rerun 2

Date: 2026-04-02
Target: `https://kb.lightheart.tech`
Tenant: `Lightheart` (`domainId=7`)
Runtime version: `1.47.2`

## Goal

Rerun the live intake and draft-generation feature test against the current production build, using the previously failing target schema shape:

- tenant-scoped OpenAI provider provisioning
- tenant-scoped workforce agent provisioning
- public intake form submission
- background OpenAI draft generation
- retrieval of the generated proposal draft

## Outcome

Result: `succeeded`.

This rerun passed using a target content-type schema that:

- keeps `company` and `requestedTimeline` optional
- does not declare `additionalProperties: false`

That is the same shape that previously failed live before the server-side OpenAI schema normalization fix.

Key live outputs:

- provider config id `1` for `openai`
- workforce agent id `2` slug `proposal-writer-live-20260401224742`
- form id `5` slug `proposal-intake-live-20260401224742`
- intake content item id `10`
- draft job id `5`
- generated content item id `11`
- strategy `openai_structured_outputs_v1`
- response id `resp_00b48e7cbf2dd1000169cda0a52e2c8199b441c8ef5a4a62f7`

## Generated Draft Payload

```json
{
  "title": "Software development proposal draft",
  "brief": "Draft a concise software development proposal for a tenant-scoped AI content platform with supervisor UI, public intake forms, and provider-backed draft generation.",
  "summary": "This proposal outlines a development plan for an AI-driven content platform tailored for individual tenants, featuring a supervisor interface for oversight, public intake forms for user submissions, and integrated provider-backed AI draft generation. The solution aims to streamline content creation workflows within a 6-week delivery timeline and a budget between EUR 20,000 and 35,000.",
  "proposalOutline": "1. Project Initialization and Requirements Refinement: Confirm scope and tenant-specific configurations.\n2. Architecture Design: Develop multi-tenant AI content platform architecture ensuring data isolation and scalability.\n3. Supervisor UI Development: Build an intuitive interface for supervisors to manage tenant content and workflows.\n4. Public Intake Forms Implementation: Create customizable forms to capture user input securely.\n5. Provider-Backed Draft Generation Integration: Integrate AI draft generation services to assist content creation.\n6. Testing and Quality Assurance: Conduct thorough functional and performance testing.\n7. Deployment and Documentation: Deploy the platform and provide comprehensive user and administrator documentation.\n8. Support and Iteration: Offer post-launch support and plan for incremental improvements.",
  "company": "Lightheart Holding",
  "requestedTimeline": "6 weeks"
}
```

## Artifacts

- [runtime.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T224742Z-intake-draft-rerun-2/runtime.response.json)
- [deployment-status.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T224742Z-intake-draft-rerun-2/deployment-status.response.json)
- [openai-provider.put.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T224742Z-intake-draft-rerun-2/openai-provider.put.response.json)
- [workforce-agent.create.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T224742Z-intake-draft-rerun-2/workforce-agent.create.response.json)
- [proposal-draft-content-type.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T224742Z-intake-draft-rerun-2/proposal-draft-content-type.response.json)
- [proposal-request-content-type.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T224742Z-intake-draft-rerun-2/proposal-request-content-type.response.json)
- [proposal-intake-form.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T224742Z-intake-draft-rerun-2/proposal-intake-form.response.json)
- [public-submission.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T224742Z-intake-draft-rerun-2/public-submission.response.json)
- [job-5.final.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T224742Z-intake-draft-rerun-2/job-5.final.response.json)
- [intake-content-item-10.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T224742Z-intake-draft-rerun-2/intake-content-item-10.response.json)
- [generated-content-item-11.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260401T224742Z-intake-draft-rerun-2/generated-content-item-11.response.json)
