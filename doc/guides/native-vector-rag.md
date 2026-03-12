# Native Vector RAG and Semantic Search

In WordClaw, RAG (Retrieval-Augmented Generation) is built directly into the core system so that you don't have to bolt on external vector databases (like Pinecone or Weaviate) or build custom data pipelines to give your AI agents context about your content.

This guide breaks down exactly what it does, how it works, and how you can utilize it.

---

## ⚙️ How it works (The Mechanics)

WordClaw utilizes PostgreSQL and the `pgvector` extension to handle everything internally. Because this happens entirely inside the CMS, your vectors can never drift out of sync with your true content state. If you edit a published blog post, the embeddings are automatically recalculated.

1. **Auto-Enablement**: If you place an `OPENAI_API_KEY` into your WordClaw `.env` file, the native RAG feature turns itself on automatically upon server startup.
2. **Background Chunking and Embedding**: Whenever a Content Item's workflow status changes to **"published"**, WordClaw catches that event and tosses it into an internal background worker queue.
3. **Clean Data Extraction**: The worker parses the JSON document, strips away hidden metadata (like `slate`, `coverImage`, or `authorId`), and flattens the readable data into paragraphs.
4. **Native Postgres Storage**: The worker breaks the clean text down into smaller semantic chunks, calls the OpenAI Embeddings API (`text-embedding-3-small`), and stores the resulting vectors directly inside your existing Postgres database.

---

## 🚀 How to Utilize Native RAG

You can utilize WordClaw's native RAG in two main ways: by autonomous agents, or by frontend applications.

### 1. By AI Agents (Via MCP or REST)

If you have an autonomous AI agent (like a LangChain bot or an Anthropic Assistant connecting via the Model Context Protocol), it can use the semantic search tools to pull relevant context *before* it tries to answer a question or write an article.

Instead of writing a complex SQL query to find related content, the agent can use the REST endpoint natively:

```bash
curl -H "x-api-key: your-api-key" \
  "http://localhost:4000/api/search/semantic?query=headless%20cms%20approvals"
```

The API returns a sorted list of the most semantically relevant content chunks (along with their `similarity` scores and references to the parent Content Item), so the agent can load them directly into its prompt context window.

### 2. By Frontend Applications

You can use the exact same `/api/search/semantic` endpoint to power an incredibly smart headless search bar on your public-facing frontend (like React, Vue, or SvelteKit).

If a user searches your blog for *"How do I track who approved an article?"*, the semantic search will return the article on **"Actor Identity Propagation"**—even if those exact keywords aren't in the title—simply because the *meaning* of the article matches the user's intent.

## Example API Response

```json
{
  "data": [
    {
      "id": 12,
      "contentItemId": 42,
      "textChunk": "WordClaw resolves every inbound request down to a canonical CurrentActorSnapshot ensuring strict audit provenance...",
      "similarity": 0.8241
    },
    {
      "id": 13,
      "contentItemId": 88,
      "textChunk": "Human approval should feel like a useful checkpoint, not a clerical tax...",
      "similarity": 0.6123
    }
  ],
  "meta": {
    "total": 2
  }
}
```

## 🛠️ Building a Smart Search UI (React Example)

Because WordClaw's `/api/search/semantic` endpoint natively calculates and projects `similarity` values (via PgVector cosine inversion) and returns clean `textChunk` snippets, building a hyper-relevant frontend search component is straightforward.

Here is an example of a Smart Search component React implementation that queries the API as the user types, filters out irrelevant hits, and displays a dropdown with semantic excerpts and relevance scores.

```tsx
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'

interface SearchResult {
  id: number
  contentItemId: number
  textChunk: string
  similarity: number
}

// Ensure you pass your fetched WordClaw posts into this component
export function SemanticSearch({ posts }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    // Debounce the search input so we don't spam the API
    const handler = setTimeout(async () => {
      if (!query.trim()) {
        setResults([])
        return
      }

      try {
        const res = await fetch(`http://localhost:4000/api/search/semantic?query=${encodeURIComponent(query)}`, {
          headers: { 'x-api-key': 'your-api-key' }
        })
        const payload = await res.json()
        
        if (res.ok && payload.data) {
          setResults(payload.data)
        }
      } catch (err) {
        console.error("Semantic search failed", err)
      }
    }, 500)

    return () => clearTimeout(handler)
  }, [query])

  return (
    <div className="relative w-full">
      <input
        className="h-10 w-full rounded-full border px-4"
        onChange={(e) => {
          setQuery(e.target.value)
          setIsOpen(true)
        }}
        placeholder="Semantic search..."
        value={query}
      />

      {isOpen && query.trim() && (
        <div className="absolute top-full mt-2 w-full rounded-xl border bg-white shadow-lg p-2 max-h-96 overflow-y-auto">
          {results.length === 0 ? (
            <p className="p-4 text-center text-gray-500">No relevant content found.</p>
          ) : (
            results.map((result) => {
              // Map the contentItemId from the vector chunk back to the parent post data
              const post = posts.find((p) => p.id === result.contentItemId)
              if (!post) return null
              
              return (
                <Link key={result.id} to={`/post/${post.slug}`} className="block p-3 hover:bg-gray-50 rounded-lg">
                  <p className="font-semibold text-sm">{post.title}</p>
                  
                  {/* Display the heavily context-aware vector excerpt */}
                  <p className="text-xs text-gray-600 border-l-2 border-blue-500 pl-2 mt-1 line-clamp-2">
                    {result.textChunk}
                  </p>
                  
                  {/* Convert the pgvector similarity calculation (0.0 to 1.0) into a percentage */}
                  <p className="text-[10px] text-blue-500 mt-2 font-medium">
                    Relevance Score: {(result.similarity * 100).toFixed(1)}%
                  </p>
                </Link>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
```

This simple React component effectively bridges your headless CMS directly into AI-era information retrieval without requiring external middleware or vector synchronization services.
