# Demo Blog

This demo shows a schema-driven blog frontend backed by WordClaw content models.

It reads two content schemas from WordClaw:

- `demo-author`
- `demo-blog-post`

The blog then renders:

- a richer post index with featured content
- author directory and author detail pages
- category archive pages
- tag pages for cross-category browsing
- a full archive view
- post detail pages with styled markdown bodies
- a `Get Started` page that explains the human and agent integration paths

The seeded demo content intentionally exercises:

- paragraphs
- `h1`, `h2`, and `h3`
- links
- blockquotes
- emphasis and strong text
- ordered and unordered lists
- fenced code blocks
- inline code
- markdown tables

## Run It

1. Start the WordClaw backend:

   ```bash
   npm run dev
   ```

2. Seed the demo blog domain, schemas, posts, and frontend `.env`:

   ```bash
   npm run demo:seed-blog
   ```

3. Create a local `.env` in this folder:

   The seeder writes this for you automatically. If you need to create it manually:

   ```bash
   VITE_WORDCLAW_URL=http://localhost:4000/api
   VITE_WORDCLAW_API_KEY=<paste-api-key-here>
   ```

4. Install dependencies and start the demo:

   ```bash
   npm install
   npm run dev
   ```

5. Open the local Vite URL.

## Notes

- `VITE_WORDCLAW_URL` should point to the WordClaw API base, typically `http://localhost:4000/api`
- the demo expects WordClaw to return blog and author item payloads in the `data` field
- this demo is read-only; publishing and editorial workflow actions stay in the main WordClaw supervisor/runtime
- if the page still shows no posts, rerun `npm run demo:seed-blog` so the local `.env` and the demo domain contents are refreshed
