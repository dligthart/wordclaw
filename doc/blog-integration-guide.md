# Building a Headless Blog with WordClaw

WordClaw is a headless CMS designed for both human developers and AI agents. Building a custom frontend for your content is straightforward using the REST API. This guide walks through the process of integrating WordClaw into a modern frontend framework (like React, SvelteKit, or Vue) to build a blog.

## 1. Setting Up Content Types (Schemas)

WordClaw uses **JSON Schema** to define the structure of your content. To power a blog, you typically need at least two Content Types: `Author` and `Blog Post`.

You can create these schemas using the `/api/content-types` endpoint.

### Author Schema
```json
{
  "name": "Author",
  "slug": "author",
  "schema": {
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "slug": { "type": "string" },
      "bio": { "type": "string" },
      "avatarUrl": { "type": "string" }
    },
    "required": ["name", "slug", "bio"]
  }
}
```

### Blog Post Schema
A blog post will reference an author and contain the rich content.

> **Important**: When relating one content item to another (e.g., a Post to an Author), define the reference ID as a `number` to match the integer `id` of the target Content Item in WordClaw.

```json
{
  "name": "Blog Post",
  "slug": "blog-post",
  "schema": {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "slug": { "type": "string" },
      "excerpt": { "type": "string" },
      "content": { "type": "string" },
      "coverImage": { "type": "string" },
      "authorId": { "type": "number", "description": "Reference to Author ID" },
      "category": { "type": "string" }
    },
    "required": ["title", "slug", "content", "authorId", "category"]
  }
}
```

## 2. Managing Content

Content Items represent the actual rows of data conforming to your Content Type schemas. 

### Inserting Data
When inserting or updating content via the `/api/content-items` endpoint, you must pass the `contentTypeId` and the `data` object that matches your schema.

```javascript
// Example POST request to create an Author
const res = await fetch("http://localhost:4000/api/content-items", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    contentTypeId: authorContentTypeId,
    data: {
      name: "Marcus Aurelius",
      slug: "marcus-aurelius",
      bio: "Writing about modern philosophy and code.",
      avatarUrl: "https://example.com/marcus.jpg"
    },
    status: "published" // Can be "draft" or "published"
  })
});
```

> **Passing Data**: Since `v1.0`, you can pass the `data` field to `/api/content-items` directly as a JSON object; you no longer need to strictly stringify the inner `data` payload.

## 3. Frontend Integration Pattern

The typical workflow in your frontend application (e.g., Vite + React) will involve fetching both the Content Types and the Content Items to resolve relationships.

### Fetching Content Types and Items
You can query items by their `contentTypeId`. Here is a common React Hook pattern for fetching the blog data:

```typescript
import { useEffect, useState } from 'react';

const API_BASE = 'http://localhost:4000/api';

export function useWordClawBlog() {
  const [posts, setPosts] = useState([]);
  const [authors, setAuthors] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      // 1. Fetch Content Types to resolve IDs by slug
      const ctRes = await fetch(`${API_BASE}/content-types`).then(res => res.json());
      const types = ctRes.data || [];
      
      const authorType = types.find(t => t.slug === 'author');
      const postType = types.find(t => t.slug === 'blog-post');

      if (authorType && postType) {
        // 2. Fetch the actual content items
        const [authorsRes, postsRes] = await Promise.all([
          fetch(`${API_BASE}/content-items?contentTypeId=${authorType.id}`).then(res => res.json()),
          fetch(`${API_BASE}/content-items?contentTypeId=${postType.id}`).then(res => res.json())
        ]);

        // WordClaw returns the user-defined `data` as a stringified JSON payload
        const parsedAuthors = authorsRes.data.map(item => ({...item, data: JSON.parse(item.data)}));
        const parsedPosts = postsRes.data.map(item => ({...item, data: JSON.parse(item.data)}));

        setAuthors(parsedAuthors);
        setPosts(parsedPosts);
      }
      setLoading(false);
    }
    
    loadData();
  }, []);

  return { posts, authors, loading };
}
```

### Resolving Relationships in UI
Once the data is normalized in your frontend's state, you can map over your posts and easily join the author.

```tsx
const BlogRoll = () => {
  const { posts, authors, loading } = useWordClawBlog();

  if (loading) return <p>Loading...</p>;

  return (
    <div className="grid">
      {posts.map(post => {
        // Resolve relationship using authorId
        const author = authors.find(a => a.id === post.data.authorId);

        return (
          <article key={post.id}>
            <h2>{post.data.title}</h2>
            <img src={post.data.coverImage} alt={post.data.title} />
            <p>{post.data.excerpt}</p>
            {author && (
                <div className="author-info">
                   <img src={author.data.avatarUrl} alt={author.data.name} />
                   <p>By {author.data.name}</p>
                </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
```

## 4. Developer Tools & Tips

- **Dry Run Mode**: Agents or CLI tools interacting with the WordClaw API can simulate writes using the `?mode=dry_run` query parameter. This guarantees the schema validation will run, but the item will not be physically inserted into the database.
- **Data Parsing**: While WordClaw allows the API payload input of `data` to be a plain object, the `GET` endpoints will consistently return `data` as a **JSON string**. Make sure to run `JSON.parse(item.data)` before trying to access custom fields in your application.
- **Embeddings**: When `status` is set to `"published"`, WordClaw automatically generates vector embeddings for semantic search. Consider utilizing `GET /api/search/semantic?query=xyz` if your frontend requires a dynamic search component instead of an exact-match filter.
