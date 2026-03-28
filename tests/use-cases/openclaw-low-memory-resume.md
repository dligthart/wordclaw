# OpenClaw Low-Memory Resume Evaluation

This manual evaluation checks whether OpenClaw uses **WordClaw as the durable
state layer** instead of carrying large chat memory across sessions.

Use it when validating the `wordclaw-cms` skill or any OpenClaw workflow that
should survive a cold restart with only a compact checkpoint.

## Why This Test Exists

The desired operating model is:

- WordClaw stores current truth, actor scope, entity IDs, and audit history.
- OpenClaw keeps only a compact checkpoint and rehydrates state from WordClaw.

If the agent needs old transcript context to continue correctly, it is not
using WordClaw efficiently.

## Preconditions

- WordClaw is running and reachable.
- OpenClaw is configured with the WordClaw MCP server.
- The current actor can discover the workspace and write at least one draft.
- There is at least one suitable authoring target in the active domain.
- Start Prompt 1 in a clean OpenClaw session.

## Evidence To Capture

Capture these artifacts while running the test:

- the agent response for each prompt
- the compact checkpoint returned after Prompt 1 and Prompt 2
- the content item ID created or updated during Prompt 2
- any review task ID returned during Prompt 2
- the domain and target the agent chose before and after the cold restart
- the WordClaw resources and tools the agent visibly used, if OpenClaw exposes them

## Compact Checkpoint Contract

The exact field names can vary, but the checkpoint should stay close to this
shape and should contain only stable identifiers plus the next action:

```json
{
  "intent": "authoring",
  "domainId": 1,
  "actorId": "api_key:12",
  "contentTypeId": 42,
  "contentItemId": 314,
  "reviewTaskId": null,
  "offerId": null,
  "entitlementId": null,
  "lastAuditCursor": "<cursor-or-null>",
  "nextAction": "resume-draft-validation"
}
```

Good checkpoints are small and durable. They do not include full schema JSON,
full content bodies, repeated workspace listings, or long reasoning traces.

## Prompt 1: Discover And Checkpoint

Run this in a fresh OpenClaw session:

> Discover my WordClaw workspace, choose the best authoring target, and return only a compact checkpoint with IDs and the next action.

Expected WordClaw usage:

- `system://current-actor`
- `system://workspace-context` or `system://workspace-target/authoring`
- `resolve_workspace_target` or `guide_task`

Pass if:

- the agent identifies a concrete domain and authoring target
- the response returns a compact checkpoint rather than a long narrative dump
- the checkpoint includes stable IDs and a next action
- the agent does not copy large schema or workspace payloads into memory

Fail if:

- the agent starts writing before discovery
- the response is mostly raw workspace inventory instead of a checkpoint
- the chosen target cannot be traced back to WordClaw discovery

## Prompt 2: Write From Checkpoint

In the same session, provide only the checkpoint from Prompt 1 and run:

> Using only that checkpoint, create or update one draft item, then return a new checkpoint with the content item id and any review task id.

Expected WordClaw usage:

- `guide_task { "taskId": "author-content" }` or equivalent target resolution
- only the schema or content item needed for the write
- dry-run before the real write when supported

Pass if:

- the agent reloads only the required schema or entity
- one draft item is created or updated successfully
- the returned checkpoint now contains `contentItemId`
- the response still stays compact and keeps only next-step state

Fail if:

- the agent repeats full discovery with no checkpoint reuse
- the agent keeps the full draft body or schema dump as the new checkpoint
- the write ignores dry-run or validation support when available

## Prompt 3: Cold-Start Resume

Start a new OpenClaw session. Do not provide any earlier transcript text. Give
only the checkpoint from Prompt 2 and run:

> Resume this WordClaw task from the checkpoint. Rehydrate state from WordClaw, not from prior conversation memory.

Expected WordClaw usage:

- `system://current-actor`
- `system://workspace-target/{intent}` or filtered `system://workspace-context/{intent}/{limit}`
- `guide_task`
- `get_content_item`, `get_audit_logs`, or the smallest equivalent reads needed to resume

Pass if:

- the agent resumes in the same domain unless WordClaw state actually changed
- the same content item or review task is recovered from IDs in the checkpoint
- the agent fetches only the referenced entities or audit delta
- the agent continues with the same next action without needing old chat memory

Fail if:

- the agent asks for the earlier conversation to be pasted back in
- the agent picks a different domain or target without evidence of a state change
- the agent performs a full workspace rescan when a narrow target lookup would do

## Efficiency Signals

These are the specific behaviors you want to see because they make OpenClaw
more memory efficient and more consistent across sessions:

- `guide_task` is used instead of a hand-built plan when the task ID exists.
- `system://workspace-target/{intent}` is preferred on resume over full workspace scans.
- Canonical IDs are carried forward instead of payload snapshots.
- `get_audit_logs` or event subscriptions are used for freshness and deltas.
- Paid-content flows keep only `offerId`, `entitlementId`, and `paymentHash` when still needed.

## Hard Failure Signals

Mark the run as failed if any of these happen:

- the resumed session depends on prior chat memory to identify the work item
- the checkpoint contains large content payloads or schema dumps
- the agent cannot explain which WordClaw target it resumed against
- the resumed session changes scope across domains or actors without evidence

## Scoring Rubric

Score each category from `0` to `2`:

- `Discovery discipline`: `0` guessed, `1` partial discovery, `2` correct discovery before action
- `Checkpoint quality`: `0` bloated, `1` mixed payload and IDs, `2` compact durable IDs only
- `Write efficiency`: `0` broad reloads, `1` some unnecessary reads, `2` only required reads
- `Cold-start consistency`: `0` cannot resume, `1` resumes with drift, `2` resumes same scope and target
- `Freshness handling`: `0` transcript replay, `1` partial refresh, `2` audit delta or subscriptions

Interpretation:

- `9-10`: strong fit for production-style low-memory operation
- `7-8`: workable, but still carrying avoidable state
- `5-6`: inconsistent resume behavior
- `0-4`: not using WordClaw as the durable context layer

## Operator Notes Template

Use this short template to record a run:

```text
Run date:
OpenClaw version:
WordClaw base URL:
Actor:
Chosen domain:
Chosen target:
Prompt 1 result:
Prompt 2 result:
Prompt 3 result:
Score:
Observed failure signals:
Observed efficiency signals:
```
