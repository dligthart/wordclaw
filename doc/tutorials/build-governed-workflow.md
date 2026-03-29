# Build Your First Governed Workflow

WordClaw isn't just a database; it's a governed state machine meant to safely orchestrate work between humans and AI agents. In this tutorial, we will walk through the core concepts of creating a content schema, setting an editorial policy, submitting a draft, and approving the review task using WordClaw's CLI tooling.

## Prerequisites

Start the local server and ensure you have your API key ready. For this tutorial, we'll use the default `writer` key and local deployment.

```bash
export WORDCLAW_BASE_URL=http://localhost:4000
export WORDCLAW_API_KEY=writer
```

*Note: You can check your current actor profile and confirm your server is running using `wordclaw capabilities status` and `wordclaw capabilities whoami`.*

---

## 1. Create a Schema (Content Type)

Before an agent can write content, we need to declare its structure. Schemas in WordClaw are simple JSON Schema payloads.

Create a `schema.json`:

```json
{
  "type": "object",
  "properties": {
    "title": { "type": "string" },
    "body": { "type": "string" },
    "author": { "type": "string" }
  },
  "required": ["title", "body"]
}
```

Register the schema with WordClaw:

```bash
wordclaw content-types create \
  --name "Blog Post" \
  --slug "blog-post" \
  --schema-file schema.json
```

The system will return your `id` (let's assume it returned `id: 12`).

---

## 2. Define the Approval Target

WordClaw schemas automatically have governed workflow capability if configured. How do you know what to do next? Ask the runtime for guidance!

```bash
wordclaw content guide --content-type-id 12
```

This dynamic response tells you exactly what shape the payload must be, and it also informs you if an approval workflow must be completed before the content reaches a `published` state.

If you do not have a content type yet, start with `wordclaw content guide` first to get schema-design patterns and authoring bootstrap guidance.

## 3. Authoring the Draft

Let's author some content. We submit this as a `draft`:

```bash
wordclaw content create \
  --content-type-id 12 \
  --status "draft" \
  --data-json '{"title": "AI Workflows", "body": "They are complex, but safe.", "author": "Agent Smith"}'
```

This returns a Content Item `id` (let's assume `id: 345`).

## 4. Resolving the Workflow Constraints

Before moving the draft to `review`, an agent can inspect the active workflow rules on the schema:

```bash
wordclaw workflow active --content-type-id 12
```

The runtime will list the required transitions (e.g., `draft -> review -> published`) and state which profiles can execute those transitions, ensuring the agent doesn't illegally attempt to bypass the `review` state.

## 5. Submitting for Review

We explicitly move the content off the authoring desk and onto the review desk, assigning it to a known human reviewer profile (e.g., `editor-1`).

```bash
wordclaw workflow submit \
  --id 345 \
  --transition 1 \
  --assignee "editor-1"
```

*Tip: You use `--transition <id>` from the output of `workflow active`.*

Once submitted, the `status` of item `345` is now `review`. It is locked from further generic edits until the review task is resolved.

## 6. Approving the Task

A different agent (or human) acting with the `editor-1` API key can now find this pending review task:

```bash
# Switch identity context
export WORDCLAW_API_KEY=editor-1

# View my tasks
wordclaw workflow tasks
```

To approve the content and unblock its transition to `published`, the editor executes a decision:

```bash
wordclaw workflow decide \
  --id <task-id> \
  --decision approved
```

The content item `345` is now formally `published`!

## Audit Trail

Every step of this workflow was cryptographically logged. You can ask WordClaw for the provenance trail of this exact item to prove who authored it and who approved it:

```bash
wordclaw audit guide --entity-type content_item --entity-id 345
```

You've successfully orchestrated a multi-actor, policy-driven editorial workflow using WordClaw!
