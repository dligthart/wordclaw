# Using WordClaw as Durable Memory and RAG for Claude Code and OpenClaw

This guide shows how to use WordClaw as the system of record for agent memory, session checkpoints, and retrieval-augmented generation for **Claude Code** and **OpenClaw**.

The core pattern is simple:

- keep the agent's local memory small
- store durable facts, task logs, and checkpoints in WordClaw
- use exact reads for structured state
- use semantic search for fuzzy recall and supporting context

WordClaw should hold the durable state. The agent should hold only the current intent, a few canonical IDs, and the next action.

## What to Store in WordClaw

| Need | WordClaw pattern | Why |
| --- | --- | --- |
| Durable facts and preferences | `Agent Memory` content type | Searchable across runs and reusable by multiple agents |
| Execution history | `Task Log` content type | Operator-visible run history and audit-friendly traces |
| Session resume state | `Checkpoint` content type | Lets a fresh agent session restart from stable IDs instead of old chat context |
| Exact memory lookup | `get_content_item`, `get_content_items`, `content get`, `content list` | Deterministic reload by id, subject, status, or other top-level fields |
| Fuzzy recall / RAG | `search_semantic_knowledge` or `GET /api/search/semantic` | Retrieves semantically similar content chunks from published items |

## Available Skills

WordClaw currently ships these reusable skill files:

- Repo-scoped WordClaw skill: `.agents/skills/wordclaw-cms/SKILL.md`
- OpenClaw installable skill: `doc/guides/openclaw-integration/SKILL.md`

Use them like this:

- **OpenClaw** can install the `doc/guides/openclaw-integration/SKILL.md` file directly.
- **Codex** can use the repo-scoped skill automatically when run inside this repository.
- **Claude Code** does not have a WordClaw-specific skill file in this repo today. Use MCP provisioning plus the operating prompt in this guide.

## Runtime Prerequisites

Before using WordClaw as memory or RAG:

1. Run the database migrations and bootstrap at least one domain.
2. Provision an API key with `content:read` and `content:write`.
3. Set `OPENAI_API_KEY` if you want semantic retrieval.
4. Confirm readiness through deployment discovery.

Recommended checks:

```bash
wordclaw capabilities status

wordclaw mcp inspect \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer
```

Semantic retrieval is only active when embeddings are enabled. Check `GET /api/deployment-status` or `system://deployment-status` and confirm the embeddings block is healthy before relying on RAG.

## Provision Claude Code and OpenClaw

### Claude Code

Use the built-in provisioning helper instead of hand-authoring MCP config:

```bash
wordclaw provision --agent claude-code --transport http --scope project --write
export WORDCLAW_API_KEY=writer
```

That writes project-scoped MCP config to `.mcp.json`.

If you prefer local stdio during development:

```bash
wordclaw provision --agent claude-code --transport stdio --scope project --write
```

### OpenClaw

Generate the OpenClaw MCP snippet:

```bash
wordclaw provision --agent openclaw --transport http
```

Merge the output into `~/.openclaw/openclaw.json`, or use the example file `doc/guides/openclaw-integration/openclaw.example.json`.

Install the OpenClaw WordClaw skill:

```bash
mkdir -p ~/.openclaw/skills/wordclaw-cms
cp doc/guides/openclaw-integration/SKILL.md ~/.openclaw/skills/wordclaw-cms/SKILL.md
```

## Model Memory Explicitly

Do not treat one generic content type as both memory, logs, and checkpoints. Create separate models with different retrieval and lifecycle behavior.

Start with the built-in schema bootstrap:

```bash
wordclaw content guide
```

Or over MCP:

```bash
wordclaw mcp call guide_task --json '{"taskId":"author-content"}' \
  --mcp-transport http \
  --mcp-url http://localhost:4000/mcp \
  --api-key writer
```

That guide returns starter schema-manifest patterns for:

- `memory`
- `task-log`
- `checkpoint`

### Example Memory Manifest

Save this as `memory.manifest.json`:

```json
{
  "title": "Agent Memory",
  "description": "Durable memory entries optimized for retrieval.",
  "preview": {
    "titleField": "summary",
    "subtitleField": "memoryKey"
  },
  "fields": [
    { "name": "memoryKey", "type": "text", "required": true },
    { "name": "subjectId", "type": "text", "required": true },
    { "name": "summary", "type": "text", "required": true },
    { "name": "details", "type": "textarea" },
    { "name": "tags", "type": "array", "itemType": "text" },
    {
      "name": "status",
      "type": "select",
      "required": true,
      "options": ["active", "stale", "archived"]
    },
    {
      "name": "provenance",
      "type": "group",
      "fields": [
        { "name": "source", "type": "text" },
        { "name": "capturedBy", "type": "text" },
        { "name": "capturedAt", "type": "text" }
      ]
    }
  ]
}
```

Create the content type:

```bash
wordclaw content-types create \
  --name AgentMemory \
  --slug agent-memory \
  --schema-manifest-file memory.manifest.json \
  --dry-run

wordclaw content-types create \
  --name AgentMemory \
  --slug agent-memory \
  --schema-manifest-file memory.manifest.json
```

Use the same approach for `Task Log` and `Checkpoint`, but keep the summary/title field top-level so semantic indexing can extract meaningful text.

## Write Memory to WordClaw

Memory writes should be dry-run first, then persisted. Use `published` status for entries that should participate in semantic retrieval. Leave drafts unpublished when they are just scratch work.

Example `memory-item.json`:

```json
{
  "memoryKey": "customer:acme:billing-contact",
  "subjectId": "customer:acme",
  "summary": "Acme prefers invoices to be sent to finance@acme.example on the first business day of the month.",
  "details": "Confirmed by Jane Doe in the 2026-03-29 onboarding call. Escalate contract questions to legal@acme.example.",
  "tags": ["billing", "customer-profile"],
  "status": "active",
  "provenance": {
    "source": "onboarding-call",
    "capturedBy": "claude-code",
    "capturedAt": "2026-03-29T09:15:00Z"
  }
}
```

Dry-run first:

```bash
wordclaw content create \
  --content-type-id 12 \
  --status published \
  --data-file memory-item.json \
  --dry-run
```

Then persist it:

```bash
wordclaw content create \
  --content-type-id 12 \
  --status published \
  --data-file memory-item.json
```

Update an existing memory item the same way:

```bash
wordclaw content update --id 345 --data-file memory-item.json --dry-run
wordclaw content update --id 345 --data-file memory-item.json
```

## Read Memory Exactly

Use exact reads when you already know the subject, content type, or item id.

CLI examples:

```bash
wordclaw content list \
  --content-type-id 12 \
  --field-name subjectId \
  --field-op eq \
  --field-value customer:acme \
  --published

wordclaw content get --id 345 --published
```

MCP examples:

```json
get_content_items {
  "contentTypeId": 12,
  "fieldName": "subjectId",
  "fieldOp": "eq",
  "fieldValue": "customer:acme",
  "draft": false
}
```

```json
get_content_item {
  "id": 345,
  "draft": false
}
```

Use `draft=false` or `--published` when you want the latest published snapshot. That is the same snapshot semantic search will use.

## Use WordClaw for RAG

Semantic retrieval is the fuzzy-recall layer. Use it when the agent knows the concept but not the exact item id or field filter.

### REST

```bash
curl -H "x-api-key: writer" \
  "http://localhost:4000/api/search/semantic?query=who%20receives%20Acme%20invoices&limit=5"
```

### MCP

```json
search_semantic_knowledge {
  "query": "who receives Acme invoices",
  "limit": 5
}
```

The result includes:

- `contentItemId`
- `textChunk`
- `similarity`
- `contentItemData`
- `contentTypeSlug`

Recommended retrieval pattern:

1. Try exact lookup first when you know the subject or key.
2. Use semantic retrieval when the request is fuzzy or cross-cutting.
3. Load the full item only for the top semantic hits you actually need.
4. Keep only the final answer, cited ids, and the next action in agent-local memory.

## Recommended Agent Operating Pattern

Use this split:

- **Agent Memory** for durable facts that should survive many runs
- **Task Log** for chronological run notes and operator review
- **Checkpoint** for resumable machine state such as `nextAction`, `contentItemId`, and `lastAuditCursor`

Prefer this compact checkpoint shape:

```json
{
  "intent": "authoring",
  "domainId": 1,
  "actorId": "api_key:12",
  "contentTypeId": 12,
  "contentItemId": 345,
  "reviewTaskId": null,
  "lastAuditCursor": "<cursor-or-null>",
  "nextAction": "resume-memory-refresh"
}
```

Do not keep:

- full schema JSON after the write is complete
- full content item payloads across sessions
- repeated workspace inventory in the chat context
- long reasoning traces that WordClaw can be asked to rehydrate

## Prompting Claude Code

Claude Code does not have a repo-owned WordClaw skill file here today, so be explicit in the prompt:

> Use WordClaw as your durable memory and retrieval layer. Start with `system://capabilities`, `system://deployment-status`, `system://current-actor`, and `system://workspace-context`. If no memory schema exists yet, call `guide_task` for `author-content` and create one from the `memory`, `task-log`, or `checkpoint` starter patterns. Keep only compact checkpoints locally. Store durable facts in published memory items. Use exact content reads for known IDs and `search_semantic_knowledge` for fuzzy recall before answering.

## Prompting OpenClaw

With the OpenClaw skill installed, the agent should already follow the right pattern. A good operator prompt is:

> Use the `wordclaw-cms` skill. Treat WordClaw as the durable memory layer. Rehydrate state from WordClaw instead of prior conversation memory, store durable facts in Agent Memory, keep resumable state in Checkpoints, and use semantic retrieval only against published memory or knowledge items.

## Operational Rules of Thumb

- Publish memory entries that should be searchable.
- Keep retrieval-critical text in top-level summary/title fields.
- Use dry-run on every create or update path unless the user opts out.
- Use exact reads for deterministic state and semantic search for fuzzy recall.
- Use `subscribe_events` or audit deltas for freshness on long-lived runs.
- Check `embeddingReadiness` on content reads if you need to know whether the latest published snapshot is already searchable.

## Further Reading

- [MCP Integration](./mcp-integration.md)
- [OpenClaw Integration Guide](./openclaw-integration/README.md)
- [Native Vector RAG Guide](./native-vector-rag.md)
- [CLI Guide](./cli-guide.md)
