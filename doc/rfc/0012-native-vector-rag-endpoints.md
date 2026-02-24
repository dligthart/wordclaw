# RFC 0012: Native Vector RAG (Retrieval-Augmented Generation) Endpoints

**Author:** AI Assistant  
**Status:** Implemented  
**Date:** 2026-02-22  
## 1. Summary

This proposal introduces a native RAG (Retrieval-Augmented Generation) engine directly into the WordClaw CMS database layer. By seamlessly generating and storing vector embeddings for all `Published` content items, WordClaw will expose unified semantic search endpoints across REST, GraphQL, and the Model Context Protocol (MCP).

This turns WordClaw into an out-of-the-box "Knowledge Base API" that Autonomous Agents can query semantically (e.g., "Summarize all policies regarding onboarding") rather than forcing them to brute-force keyword extraction over raw JSON REST lists.

## 2. Motivation

Currently, when an AI Agent needs to pull context from WordClaw, it calls `listItems` or full-text-search endpoints (proposed in RFC 0009). However, LLMs operate optimally on semantic relevance, not traditional lexical indexing. 

Right now, developers building enterprise AI workflows must:
1. Pull content out of WordClaw via webhook.
2. Chunk the text in an external service (like LangChain).
3. Send it to OpenAI to generate an embedding.
4. Store it in a secondary database like Pinecone or Weaviate.

**By bringing `pgvector` into the primary Postgres database alongside WordClaw's strict Policy Engine and multi-tenant `domainId` isolation, we eliminate this fragmented external infrastructure and provide a secure, all-in-one Agentic Database layer.**

## 3. Proposal

### 3.1 Architecture Model
We will implement an `EmbeddingService` that listens continuously to the WordClaw `EventBus` for the `content_item.published` event.

When content is published:
1. The service chunks the JSON `data` payload into semantic segments.
2. It sends the chunks to a configurable LLM Embeddings Provider (e.g., OpenAI `text-embedding-3-small` or local Ollama).
3. The resulting embedding vectors are saved into a new `content_item_embeddings` PostgreSQL table utilizing the `pgvector` extension.

### 3.2 Database Schema (Drizzle ORM)
```typescript
import { pgTable, text, integer, vector, index } from "drizzle-orm/pg-core";

export const contentItemEmbeddings = pgTable("content_item_embeddings", {
    id: serial("id").primaryKey(),
    contentItemId: integer("content_item_id").references(() => contentItems.id).notNull(),
    domainId: integer("domain_id").references(() => domains.id).notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    textChunk: text("text_chunk").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(), // Default OpenAI size
}, (table) => ({
    embeddingIndex: index("embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
    domainIndex: index("embedding_domain_idx").on(table.domainId)
}));
```

### 3.3 Protocol Endpoints

#### REST Endpoint
`GET /api/search/semantic?query=company+vacation+policy&limit=5`

#### GraphQL Query
```graphql
query {
  semanticSearch(query: "company vacation policy", limit: 5) {
    score
    contentItem {
      id
      schema {
        name
      }
      data
    }
    chunk
  }
}
```

#### MCP Tool Definition
```typescript
{
  name: "search_semantic_knowledge",
  description: "Queries the CMS database using natural language to retrieve highly relevant chunks of published knowledge.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" }
    }
  }
}
```

### 3.4 Context Geometry Parity & Monetization
Semantic search results will seamlessly honor the exact same `OperationContext` boundaries established in `RFC 0008` & `RFC 0011`. 
* **Tenant Boundaries:** The Drizzle `where(eq(domainId))` clause is prepended before the vector cosine calculation, meaning an Agent in Domain 2 cannot semantically search data from Domain 1.
* **L402 Gates:** The REST endpoint can easily be mapped to an L402 `<PricingContext>` where Agents must pay per semantic search query based on the computational intensity of the operation.

## 4. Drawbacks

- **Database Size:** Storing millions of float embeddings drastically increases the Postgres disk footprint. The `hnsw` index is highly performant but memory intensive.
- **Provider Costs:** Hitting external APIs (like OpenAI) every time a document is published incurs hard monetary costs.
- **Complexity of Chunking:** JSON payloads (WordClaw content types) are harder to chunk semantically than raw markdown. The solution will require a customizable chunking interface so users can define "Extract only the `body` field of the Blog Post Type".

## 5. Alternatives

- **External Integration Only:** We could simply rely on Webhooks (already implemented) and force users to build their own Pinecone integrations. This retains WordClaw's purity as a CMS but forfeits the massive PMF advantage of being an out-of-the-box RAG destination.
- **Full Text Search (RFC 0009):** Relying strictly on `tsvector` Postgres lexical search. Lexical search is significantly cheaper to operate but inherently inferior for LLM context injection.

## 6. Open Questions

1. Should the LLM Provider be strictly swappable (OpenAI vs Cohere vs Local Ollama), or should we enforce a standard 1536-dimension boundary for v1?
2. Should we implement an asynchronous queue (`pg-boss`) for the chunking service to ensure bulk imports don't trigger OpenAI rate limits?
