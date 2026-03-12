# Demo Blog

This demo shows a schema-driven blog frontend backed by WordClaw content models.

It reads two content schemas from WordClaw:

- `demo-author`
- `demo-blog-post`

The blog then renders:

- the post index
- author-linked post detail pages
- a `Get Started` page that explains the human and agent integration paths

## Run It

1. Start the WordClaw backend:

   ```bash
   npm run dev
   ```

2. Seed demo blog content if you have not already:

   Use the schema manager or existing setup flow to create:

   - a `demo-author` content model
   - a `demo-blog-post` content model
   - at least one author item and one blog post item

3. Create a local `.env` in this folder:

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
