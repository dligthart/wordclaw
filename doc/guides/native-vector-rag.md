# Native Vector RAG and Semantic Search

In WordClaw, RAG (Retrieval-Augmented Generation) is built directly into the core system so that you don't have to bolt on external vector databases (like Pinecone or Weaviate) or build custom data pipelines to give your AI agents context about your content.

This guide breaks down exactly what it does, how it works, and how you can utilize it.

---

## ⚙️ How it works (The Mechanics)

WordClaw utilizes PostgreSQL and the \`pgvector\` extension to handle everything internally. Because this happens entirely inside the CMS, your vectors can never drift out of sync with your true content state. If you edit a published blog post, the embeddings are automatically recalculated.

1. **Auto-Enablement**: If you place an \`OPENAI_API_KEY\` into your WordClaw \`.env\` file, the native RAG feature turns itself on automatically upon server startup.
2. **Background Chunking and Embedding**: Whenever a Content Item's workflow status changes to **"published"**, WordClaw catches that event and tosses it into an internal background worker queue.
3. **Native Postgres Storage**: The worker breaks the text content down into smaller chunks, calls the OpenAI Embeddings API (\`text-embedding-3-small\`), and stores the resulting vectors directly inside your existing Postgres database.

---

## 🚀 How to Utilize Native RAG

You can utilize WordClaw's native RAG in two main ways: by autonomous agents, or by frontend applications.

### 1. By AI Agents (Via MCP or REST)

If you have an autonomous AI agent (like a LangChain bot or an Anthropic Assistant connecting via the Model Context Protocol), it can use the semantic search tools to pull relevant context *before* it tries to answer a question or write an article.

Instead of writing a complex SQL query to find related content, the agent can use the REST endpoint natively:

\`\`\`bash
curl -H "x-api-key: your-api-key" \\
  "http://localhost:4000/api/search/semantic?query=headless%20cms%20approvals"
\`\`\`

The API returns a sorted list of the most semantically relevant content chunks (along with their \`distance\` scores and references to the parent Content Item), so the agent can load them directly into its prompt context window.

### 2. By Frontend Applications

You can use the exact same \`/api/search/semantic\` endpoint to power an incredibly smart headless search bar on your public-facing frontend (like React, Vue, or SvelteKit).

If a user searches your blog for *"How do I track who approved an article?"*, the semantic search will return the article on **"Actor Identity Propagation"**—even if those exact keywords aren't in the title—simply because the *meaning* of the article matches the user's intent.

## Example API Response

\`\`\`json
{
  "data": [
    {
      "chunkId": "123e4567-...",
      "contentItemId": 42,
      "text": "WordClaw resolves every inbound request down to a canonical CurrentActorSnapshot ensuring strict audit provenance...",
      "distance": 0.4571
    },
    {
      "chunkId": "abc12345-...",
      "contentItemId": 88,
      "text": "Human approval should feel like a useful checkpoint, not a clerical tax...",
      "distance": 0.5123
    }
  ]
}
\`\`\`
