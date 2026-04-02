# Live Review Queue Test Report

Date: 2026-04-02
Target: `https://kb.lightheart.tech`
Tenant: `Lightheart` (`domainId=7`)

## Outcome

Result: `succeeded`

- workflow id `1` created for content type `10`
- transition id `1` attached to form `5` draft generation config
- draft generation job `6` completed successfully
- generated content item `13` appeared in the review queue
- review task `1` was approved successfully

## Notes

This confirms the review-queue handoff works when `draftGeneration.postGenerationWorkflowTransitionId` is configured.

The current live runtime still does not emit the new form-scoped post-review notification event yet. That requires deployment of the local patch.

## Artifacts

- [form.before.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260402T061443Z-draft-review-queue/form.before.json)
- [workflow.create.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260402T061443Z-draft-review-queue/workflow.create.response.json)
- [workflow.transition.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260402T061443Z-draft-review-queue/workflow.transition.response.json)
- [form.after-update.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260402T061443Z-draft-review-queue/form.after-update.response.json)
- [public-submission.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260402T061443Z-draft-review-queue/public-submission.response.json)
- [job-6.final.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260402T061443Z-draft-review-queue/job-6.final.response.json)
- [review-tasks.after-submit.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260402T061443Z-draft-review-queue/review-tasks.after-submit.json)
- [review-task.approve.response.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260402T061443Z-draft-review-queue/review-task.approve.response.json)
- [generated-content-item.after-approval.json](/Users/daveligthart/GitHub/wordclaw/output/live-tests/20260402T061443Z-draft-review-queue/generated-content-item.after-approval.json)
