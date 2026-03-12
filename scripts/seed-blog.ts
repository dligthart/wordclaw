import { and, eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { db } from '../src/db/index.js';
import { apiKeys, contentItems, contentTypes, domains } from '../src/db/schema.js';
import { createApiKey } from '../src/services/api-key.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type SeedAuthor = {
    name: string;
    slug: string;
    bio: string;
    avatarUrl: string;
    socialLinks: string[];
};

type SeedPost = {
    title: string;
    slug: string;
    excerpt: string;
    content: string;
    coverImage: string;
    category: string;
    tags: string[];
    authorSlug: string;
    readTimeMinutes: number;
};

const demoAuthors: SeedAuthor[] = [
    {
        name: 'Alice Builder',
        slug: 'alice-builder',
        bio: 'Senior architect exploring autonomous agents, workspace discovery, and schema-first publishing systems.',
        avatarUrl: 'https://i.pravatar.cc/150?u=alice',
        socialLinks: ['https://github.com/example-alice'],
    },
    {
        name: 'Bob Operator',
        slug: 'bob-operator',
        bio: 'Platform engineer focused on approvals, paid content, and safe deployment paths for AI-driven systems.',
        avatarUrl: 'https://i.pravatar.cc/150?u=bob',
        socialLinks: ['https://example.com/operators/bob'],
    },
    {
        name: 'Clara Reviewer',
        slug: 'clara-reviewer',
        bio: 'Editorial lead translating workflow controls into review experiences humans can actually trust.',
        avatarUrl: 'https://i.pravatar.cc/150?u=clara',
        socialLinks: ['https://example.com/reviewers/clara'],
    },
];

const demoPosts: SeedPost[] = [
    {
        title: 'Building Autonomous Agentic Workflows',
        slug: 'building-autonomous-agentic-workflows',
        excerpt: 'A practical walkthrough of schema-aware authoring, review loops, and MCP-driven discovery inside WordClaw.',
        content: `# Start with intent, not endpoints

WordClaw works best when the editorial workflow is explicit. An *agent* should not guess which schema to write to or which review lane is active. It should discover that context from the runtime.

> "Agents need metadata and semantic intent, not just raw REST endpoints."

## Why generic CRUD breaks down

Most headless systems tell an agent where to send a request, but not **what the request should mean**.

1. The agent has to discover the correct content schema.
2. It needs a safe way to validate a draft before mutating state.
3. It should know whether that content must enter human review.

### A safer write path

In WordClaw the recommended loop is simple:

- resolve the best workspace target
- inspect the schema and actor guidance
- run a dry run first
- create content only after validation passes

See the [Get Started guide](/get-started) if you want the human operator version, or browse the [MCP tag page](/tag/mcp) for more agent-focused articles.

\`\`\`json
{
  "taskId": "author-content",
  "preferredSurface": "mcp",
  "recommendedCommand": "wordclaw content guide --content-type-id 12"
}
\`\`\`

## Human review is part of the feature

Workflow lanes are not an afterthought. They are what makes autonomous output publishable.

When a schema has an attached workflow, the authoring step and the review step become distinct parts of the same system instead of informal conventions.
`,
        coverImage: 'https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=2670&auto=format&fit=crop',
        category: 'Tutorials',
        tags: ['Agents', 'MCP', 'Workflows', 'Schemas'],
        authorSlug: 'alice-builder',
        readTimeMinutes: 9,
    },
    {
        title: 'Connecting Agents to the Multi-Tenant CMS',
        slug: 'connecting-agents-multi-tenant',
        excerpt: 'Why schema resolution and workspace targeting matter more than flat content-type lists in tenant-aware systems.',
        content: `# Context before mutation

In a multi-tenant CMS, the real question is not "what schemas exist?" but "which schema is the best target **for this actor in this domain right now**?"

## Resolve the best target first

WordClaw can narrow the active workspace before an agent attempts a write.

| Question | WordClaw answer |
| --- | --- |
| Which domain am I in? | actor and workspace preflight |
| Which schema should I use? | workspace target resolution |
| What can I act on next? | actionable work target |

### Why this matters

Without target resolution, a model might pick the noisiest schema instead of the one with the best current workflow fit.

Read more from [Alice Builder](/author/alice-builder) or jump to the [Engineering category](/category/engineering).

## Practical rule

Always let the runtime answer "what should I do next?" before you decide on a payload.
`,
        coverImage: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2672&auto=format&fit=crop',
        category: 'Engineering',
        tags: ['Agents', 'Architecture', 'CMS', 'Workspace'],
        authorSlug: 'alice-builder',
        readTimeMinutes: 6,
    },
    {
        title: 'Safely Monetizing AI Outputs',
        slug: 'safely-monetizing-ai-outputs',
        excerpt: 'How L402 turns paid content consumption into an explicit, actor-aware workflow for agents and operators.',
        content: `# Paid content without guesswork

Charging for AI-delivered content is not just a billing problem. It is an **execution-path problem**.

## Why L402 matters

L402 makes the payment requirement part of the protocol instead of an after-the-fact business rule.

> Payment should be explicit in the response path, not hidden in product copy.

### Recommended sequence

- discover the deployment and current actor
- fetch content or offers
- follow the purchase and confirm path
- retry the protected read with the entitlement in place

If you want a quick operator overview, visit the [Monetization category](/category/monetization). If you want the protocol background, start with the [Model Context Protocol site](https://modelcontextprotocol.io).

\`\`\`bash
wordclaw l402 guide --item 123
\`\`\`

The result is simpler for both humans and agents: a blocked read becomes a readable plan.
`,
        coverImage: 'https://images.unsplash.com/photo-1639762681485-074b7f4fc651?q=80&w=2832&auto=format&fit=crop',
        category: 'Monetization',
        tags: ['L402', 'Payments', 'Agents', 'Monetization'],
        authorSlug: 'bob-operator',
        readTimeMinutes: 5,
    },
    {
        title: 'Editorial Review Loops That Humans Actually Trust',
        slug: 'editorial-review-loops-humans-trust',
        excerpt: 'A quieter, more reliable way to combine machine speed with human oversight in content production.',
        content: `# Review is a product feature

Human approval should feel like a useful checkpoint, not a clerical tax.

## What reviewers need

Reviewers need three things before they can confidently approve a task:

1. a readable summary of what changed
2. the current workflow position
3. a clear actor trail showing who performed the last action

### A practical review checklist

- read the summary before opening raw payloads
- confirm the workflow transition
- check that the current actor is allowed to decide
- leave a comment if the draft needs revision

> The best approval queue is one that reduces hesitation, not one that celebrates complexity.

Browse the [author page for Clara Reviewer](/author/clara-reviewer) or scan the [archive](/archive) for other workflow-oriented posts.
`,
        coverImage: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=2874&auto=format&fit=crop',
        category: 'Editorial',
        tags: ['Review', 'Workflow', 'Editorial', 'Approvals'],
        authorSlug: 'clara-reviewer',
        readTimeMinutes: 7,
    },
    {
        title: 'Designing Content Models for Rich Longform Pages',
        slug: 'designing-content-models-for-rich-longform-pages',
        excerpt: 'A schema-first approach to longform content that still renders elegantly in a frontend demo.',
        content: `# Rich markdown content models

This article deliberately exercises paragraphs, *emphasis*, **strong copy**, [internal links](/authors), and [external references](https://github.com/dligthart/wordclaw).

## A compact schema shape

For longform publishing, keep the content model tight:

- title
- excerpt
- content
- cover image
- author reference
- category and tags

### Example payload

\`\`\`yaml
title: Designing Content Models for Rich Longform Pages
excerpt: Schema-first publishing for longform content.
authorId: 21
tags:
  - Markdown
  - CMS
  - Schemas
\`\`\`

---

## Why rendering matters

If a demo cannot show headings, blockquotes, links, lists, and inline code like \`content guide\`, it does not actually prove the editorial model is usable.

> A content model is only as convincing as the frontend that renders it.
`,
        coverImage: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?q=80&w=2834&auto=format&fit=crop',
        category: 'Tutorials',
        tags: ['Markdown', 'Schemas', 'CMS', 'Frontend'],
        authorSlug: 'alice-builder',
        readTimeMinutes: 8,
    },
    {
        title: 'Auto-Publishing Pipelines With an Approval Gate',
        slug: 'auto-publishing-pipelines-with-an-approval-gate',
        excerpt: 'How to connect automated publishing flows to a human checkpoint without breaking delivery speed.',
        content: `# Automation with a human stop

Autopublishing works when the machine handles repetition and the human handles judgment.

## Pipeline outline

1. draft content from a trusted source
2. validate against the schema in dry-run mode
3. create the content item
4. submit it into the workflow
5. publish only after approval

### Triggering downstream systems

You can keep the runtime strict and still trigger external delivery after publication.

\`\`\`bash
curl -X POST https://example.com/deploy-hook \\
  -H "Content-Type: application/json" \\
  -d '{"event":"content.published","slug":"auto-publishing-pipelines-with-an-approval-gate"}'
\`\`\`

For a wider operator view, inspect the [Editorial category](/category/editorial) or the [Approvals tag](/tag/approvals).
`,
        coverImage: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?q=80&w=2872&auto=format&fit=crop',
        category: 'Product',
        tags: ['Automation', 'Workflow', 'Editorial', 'Approvals'],
        authorSlug: 'bob-operator',
        readTimeMinutes: 6,
    },
];

async function setupBlogDemo() {
    console.log('=========================================');
    console.log(' Setting up Headless Blog CMS Demo       ');
    console.log('=========================================\n');

    try {
        console.log('Setting up Blog Domain...');
        let [blogDomain] = await db
            .insert(domains)
            .values({
                name: 'WordClaw Demo Blog',
                hostname: 'blog.demo.local',
            })
            .onConflictDoNothing()
            .returning();

        if (!blogDomain) {
            [blogDomain] = await db
                .select()
                .from(domains)
                .where(eq(domains.name, 'WordClaw Demo Blog'))
                .limit(1);
        }

        const apiKeyResult = await createApiKey({
            domainId: blogDomain.id,
            name: 'Vite React Frontend',
            scopes: ['content:read'],
        });

        console.log('Setting up Content Types...');
        const [authorSchema] = await db
            .insert(contentTypes)
            .values({
                domainId: blogDomain.id,
                name: 'Demo Author',
                slug: 'demo-author',
                schema: JSON.stringify({
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        slug: { type: 'string' },
                        bio: { type: 'string' },
                        avatarUrl: { type: 'string' },
                        socialLinks: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['name', 'slug'],
                }),
            })
            .onConflictDoNothing()
            .returning();

        let authorSchemaId = authorSchema?.id;
        if (!authorSchemaId) {
            const [contentType] = await db
                .select()
                .from(contentTypes)
                .where(
                    and(
                        eq(contentTypes.domainId, blogDomain.id),
                        eq(contentTypes.slug, 'demo-author'),
                    ),
                )
                .limit(1);
            authorSchemaId = contentType.id;
        }

        const [postSchema] = await db
            .insert(contentTypes)
            .values({
                domainId: blogDomain.id,
                name: 'Demo Blog Post',
                slug: 'demo-blog-post',
                schema: JSON.stringify({
                    type: 'object',
                    properties: {
                        title: { type: 'string' },
                        slug: { type: 'string' },
                        excerpt: { type: 'string' },
                        content: { type: 'string' },
                        coverImage: { type: 'string' },
                        category: { type: 'string' },
                        authorId: { type: 'number' },
                        readTimeMinutes: { type: 'number' },
                        tags: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['title', 'slug', 'content', 'authorId'],
                }),
            })
            .onConflictDoNothing()
            .returning();

        let postSchemaId = postSchema?.id;
        if (!postSchemaId) {
            const [contentType] = await db
                .select()
                .from(contentTypes)
                .where(
                    and(
                        eq(contentTypes.domainId, blogDomain.id),
                        eq(contentTypes.slug, 'demo-blog-post'),
                    ),
                )
                .limit(1);
            postSchemaId = contentType.id;
        }

        console.log('Seeding Database...');
        await db.delete(contentItems).where(eq(contentItems.domainId, blogDomain.id));

        const createdAuthors = await db
            .insert(contentItems)
            .values(
                demoAuthors.map((author) => ({
                    domainId: blogDomain.id,
                    contentTypeId: authorSchemaId,
                    status: 'published',
                    data: JSON.stringify(author),
                })),
            )
            .returning();

        const authorsBySlug = new Map(
            createdAuthors.map((authorRecord, index) => [demoAuthors[index].slug, authorRecord.id]),
        );

        await db.insert(contentItems).values(
            demoPosts.map((post) => {
                const authorId = authorsBySlug.get(post.authorSlug);
                if (!authorId) {
                    throw new Error(`Missing seeded author for slug "${post.authorSlug}"`);
                }

                return {
                    domainId: blogDomain.id,
                    contentTypeId: postSchemaId,
                    status: 'published',
                    data: JSON.stringify({
                        title: post.title,
                        slug: post.slug,
                        excerpt: post.excerpt,
                        content: post.content,
                        coverImage: post.coverImage,
                        category: post.category,
                        tags: post.tags,
                        authorId,
                        readTimeMinutes: post.readTimeMinutes,
                    }),
                };
            }),
        );

        const envPath = path.join(__dirname, '../demos/demo-blog/.env');
        fs.writeFileSync(
            envPath,
            `VITE_WORDCLAW_URL=http://localhost:4000/api\nVITE_WORDCLAW_API_KEY=${apiKeyResult.plaintext}\n`,
        );

        console.log('\n✅ Demo seeded successfully!');
        console.log(`Blog API Key: ${apiKeyResult.plaintext}`);
        console.log(`Seeded ${demoAuthors.length} authors and ${demoPosts.length} posts.`);
        console.log('\nThe React app has been automatically configured. You can now start it:');
        console.log('cd demos/demo-blog && npm run dev');

        process.exit(0);
    } catch (error) {
        console.error('Setup failed:', error);
        process.exit(1);
    }
}

setupBlogDemo();
