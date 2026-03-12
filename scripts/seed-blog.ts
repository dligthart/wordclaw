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
    {
        name: 'Dana Publisher',
        slug: 'dana-publisher',
        bio: 'Publisher focused on release cadence, launch checklists, and keeping content operations calm under pressure.',
        avatarUrl: 'https://i.pravatar.cc/150?u=dana',
        socialLinks: ['https://example.com/publishers/dana'],
    },
    {
        name: 'Evan Integrator',
        slug: 'evan-integrator',
        bio: 'Integration engineer working on webhooks, deployment handoffs, and framework interoperability.',
        avatarUrl: 'https://i.pravatar.cc/150?u=evan',
        socialLinks: ['https://example.com/integrators/evan'],
    },
];

const demoPosts: SeedPost[] = [
    {
        title: 'Native MCP Integration for AI Agents',
        slug: 'native-mcp-integration-for-ai-agents',
        excerpt: 'WordClaw ships a native Model Context Protocol server. Learn how LLMs can discover schemas and mutate content without writing raw HTTP requests.',
        content: `# Model Context Protocol in WordClaw

WordClaw natively implements the [Model Context Protocol (MCP)](https://modelcontextprotocol.io) as a primary product surface, acting alongside the REST API.

## Transports and Tooling

WordClaw exposes MCP in two distinct ways:
- **Local stdio**: For embedded integration and CLI sessions (run \`npm run mcp:start\`).
- **Streamable HTTP**: Hosted alongside the core API at \`/mcp\` for attachable remote agents.

> "To make content management agentic, the system must teach the agent its capabilities at runtime."

When an agent connects, it can instantly discover its operational boundaries via resources like \`system://capabilities\`, \`system://deployment-status\`, and \`system://workspace-context\`. 

### Recommended Discovery Loop

Rather than guessing how to start, an agent can securely inspect the stack over the CLI:

\`\`\`bash
node dist/cli/index.js mcp inspect \\
  --mcp-transport http \\
  --mcp-url http://localhost:4000/mcp \\
  --api-key writer
\`\`\`

Need to verify the active actor? Use the \`system://current-actor\` resource or fire \`mcp whoami\`. 

If an agent needs to know what step comes next in a workflow, tools like \`guide_task\` offer step-by-step recipes for deployment discovery, content authoring, review queues, and paid-content integrations.
`,
        coverImage: 'https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=2670&auto=format&fit=crop',
        category: 'Engineering',
        tags: ['Agents', 'MCP', 'LLMs', 'API'],
        authorSlug: 'alice-builder',
        readTimeMinutes: 5,
    },
    {
        title: 'Heuristic Workspace Target Resolution',
        slug: 'heuristic-workspace-target-resolution',
        excerpt: 'Why flat API schema discovery breaks down for agents, and how intent-driven workspace targeting fixes it.',
        content: `# Context Before Mutation

In a multi-tenant CMS like WordClaw, asking a REST API "what schemas exist?" is the wrong question for an AI agent. The right question is: **"Which schema is the best target for this actor right now?"**

## The Threat of Flat APIs

Traditional headless CMS layouts expose endpoints like \`/api/content-types\`. An agent downloads 50 schemas, scans for keywords like "article", and mutates a payload blindly. This breaks if the schema is archived, locked, or restricted.

WordClaw replaces this with \`Workspace Target Resolution\`.

| Agent Intent | What WordClaw Resolves |
| --- | --- |
| \`authoring\` | The most active, non-archived schema in the domain. |
| \`review\` | The schema carrying the highest density of unresolved review tasks. |
| \`workflow\`| Schemas with deeply nested policy configurations. |
| \`paid\` | Content or schemas carrying active \`Offers\` requiring an L402 payment. |

### Smart Targeting in Action

When you execute \`workspace resolve --intent review\`, WordClaw doesn't just guess. It counts active review tasks matching the intent, filters out items the current API Key cannot approve, and returns a concrete \`workTarget\` object pointing precisely at the clogged unit of work.

\`\`\`bash
node dist/cli/index.js mcp call resolve_workspace_target \\
  '{"intent":"review"}' \\
  --mcp-transport http \\
  --mcp-url http://localhost:4000/mcp
\`\`\`

Always let the runtime answer "what should I do next?" before formulating payloads.
`,
        coverImage: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2672&auto=format&fit=crop',
        category: 'Engineering',
        tags: ['Agents', 'Architecture', 'CMS', 'Workspace'],
        authorSlug: 'alice-builder',
        readTimeMinutes: 6,
    },
    {
        title: 'Defending Paid API Routes with L402 Macaroons',
        slug: 'defending-paid-api-routes-with-l402-macaroons',
        excerpt: 'Charging for AI content is an execution-path problem. Learn how exactly WordClaw implements Lightning invoices to gate premium endpoints.',
        content: `# Unifying Authorization and Settlement

The L402 integration acts as WordClaw's built-in Lightning-gated access layer for paid routes and offer flows. It brings monetization directly into the protocol via \`402 Payment Required\`.

## The Handshake

WordClaw seamlessly merges **Macaroons** (for authorization cryptography) with **Lightning Invoices** (for settlement).

1. **Unauthenticated Request:** An AI agent hits a paid REST or MCP endpoint.
2. **The Challenge:** WordClaw responds with HTTP \`402\`, generating a Lightning invoice and an unsigned Macaroon token tied to the request hash.
3. **The Settlement:** The agent pays the invoice through a Lightning wallet (like *LNbits*), securing the cryptographic preimage.
4. **The Authenticated Read:** The agent retries the call carrying the \`Authorization: L402 <macaroon>:<preimage>\` header. The middleware verifies the signature, and access is permanently granted to the generated content item.

### Offer Flows vs. Legacy Pricing

WordClaw allows you to gate entire \`Schemas\` or specific \`Content Items\` via \`Offers\`. 

An agent can discover paid endpoints rapidly using the MCP \`workspace-target\` tool passing the \`paid\` intent. This avoids scraping thousands of items to figure out where paid value is housed.

Whether using LND, LNbits, or bridging LangChain via custom Coinbase AgentKit providers, L402 brings programmatic billing natively into the headless CMS stack.
`,
        coverImage: 'https://images.unsplash.com/photo-1639762681485-074b7f4fc651?q=80&w=2832&auto=format&fit=crop',
        category: 'Monetization',
        tags: ['L402', 'Payments', 'Lightning', 'Monetization'],
        authorSlug: 'bob-operator',
        readTimeMinutes: 7,
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
    {
        title: 'Why Actor Identity Matters in Content Operations',
        slug: 'why-actor-identity-matters-in-content-operations',
        excerpt: 'A look at provenance, assignment, and why canonical actor IDs make review queues safer for humans and agents.',
        content: `# Identity is part of the workflow

If a system cannot answer *who acted*, it cannot support serious editorial review.

## What breaks without canonical identity

- comments become hard to trust
- assignments become ambiguous
- audit trails lose their value

### WordClaw's direction

The runtime is moving toward one canonical actor identity across auth, workflow, audit, and payments.

> Provenance is not extra metadata. It is how you keep an autonomous system governable.

See the [archive](/archive) for related operational posts or jump to the [Approvals tag](/tag/approvals).
`,
        coverImage: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?q=80&w=2870&auto=format&fit=crop',
        category: 'Editorial',
        tags: ['Audit', 'Approvals', 'Workflow', 'Identity'],
        authorSlug: 'clara-reviewer',
        readTimeMinutes: 5,
    },
    {
        title: 'Webhook Handoffs After Publish',
        slug: 'webhook-handoffs-after-publish',
        excerpt: 'How to trigger downstream systems only after content leaves workflow review and becomes genuinely publishable.',
        content: `# Publish is the integration boundary

The cleanest webhook is the one that fires *after* the content model and workflow state agree that content is live.

## Typical downstream tasks

1. trigger a frontend rebuild
2. invalidate search caches
3. notify subscribers

### Example event payload

\`\`\`json
{
  "event": "content.published",
  "entityType": "content_item",
  "slug": "webhook-handoffs-after-publish"
}
\`\`\`

For more integration examples, browse the [Tags page](/tags) and look for *Frameworks* or *Automation*.
`,
        coverImage: 'https://images.unsplash.com/photo-1516321497487-e288fb19713f?q=80&w=2874&auto=format&fit=crop',
        category: 'Integrations',
        tags: ['Webhooks', 'Automation', 'Integrations', 'Deployments'],
        authorSlug: 'evan-integrator',
        readTimeMinutes: 5,
    },
    {
        title: 'Starter Template for a LangGraph Editorial Agent',
        slug: 'starter-template-for-a-langgraph-editorial-agent',
        excerpt: 'A practical starting point for an agent that discovers workspace targets, drafts content, and submits work for review.',
        content: `# Template first, polish second

The fastest path to useful adoption is a small starter that already knows how to:

- discover the current actor
- resolve the best workspace target
- generate a draft payload
- submit to review

## Recommended loop

1. \`capabilities whoami\`
2. \`workspace resolve --intent authoring\`
3. \`content guide --content-type-id ...\`
4. \`workflow guide --task ...\`

Read the [Get Started page](/get-started) if you want the human operator equivalent.
`,
        coverImage: 'https://images.unsplash.com/photo-1555949963-aa79dcee981c?q=80&w=2832&auto=format&fit=crop',
        category: 'Engineering',
        tags: ['LangGraph', 'Agents', 'MCP', 'Templates'],
        authorSlug: 'alice-builder',
        readTimeMinutes: 7,
    },
    {
        title: 'Shipping a Paid Newsletter Without Splitting the Stack',
        slug: 'shipping-a-paid-newsletter-without-splitting-the-stack',
        excerpt: 'Why keeping schema, payment requirements, and editorial review inside one runtime simplifies paid publishing.',
        content: `# One runtime beats stitched workflows

Paid newsletters often fracture into separate systems for drafts, approvals, billing, and delivery.

## A more coherent path

Keep the schema, the workflow, and the payment requirement in one place.

- draft the post
- review the post
- attach the paid-content expectation
- publish once the entitlement path is ready

> Operational simplicity compounds. Every split system adds another place where content and billing can drift apart.
`,
        coverImage: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=2874&auto=format&fit=crop',
        category: 'Monetization',
        tags: ['Newsletter', 'Payments', 'L402', 'Publishing'],
        authorSlug: 'dana-publisher',
        readTimeMinutes: 6,
    },
    {
        title: 'A Practical Schema Review Checklist',
        slug: 'a-practical-schema-review-checklist',
        excerpt: 'What to verify before you let a new content model become part of a supervised publishing workflow.',
        content: `# Good schemas make calm systems

Schema review should be boring in the best possible way.

## Before you approve a model

1. confirm required fields are truly required
2. make sure editorial intent is reflected in field names
3. decide whether the model needs a workflow
4. test the payload in dry-run mode

### The real goal

The point is not to maximize flexibility. The point is to give authors and agents a shape they can trust.
`,
        coverImage: 'https://images.unsplash.com/photo-1516321165247-4aa89a48be28?q=80&w=2874&auto=format&fit=crop',
        category: 'Editorial',
        tags: ['Schemas', 'Review', 'Editorial', 'Validation'],
        authorSlug: 'clara-reviewer',
        readTimeMinutes: 4,
    },
    {
        title: 'What a Healthy Approval Queue Looks Like',
        slug: 'what-a-healthy-approval-queue-looks-like',
        excerpt: 'A quiet approval queue is not empty; it is understandable, actionable, and free of mystery work.',
        content: `# Calm over clever

The best approval queue is readable at a glance.

## Signals that matter

- what changed
- where the task sits in workflow
- whether the current actor can decide now
- what happens next if approved

### Avoid these failure modes

- giant payload-first layouts
- unclear assignee identity
- blocked decisions with no remediation

Browse the [Editorial category](/category/editorial) for more review-oriented posts.
`,
        coverImage: 'https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?q=80&w=2874&auto=format&fit=crop',
        category: 'Product',
        tags: ['Approvals', 'Review', 'Workflow', 'UX'],
        authorSlug: 'dana-publisher',
        readTimeMinutes: 5,
    },
    {
        title: 'Integrating OpenAI-Compatible Tool Schemas',
        slug: 'integrating-openai-compatible-tool-schemas',
        excerpt: 'A practical bridge between MCP-native discovery and the tool schemas expected by popular LLM runtimes.',
        content: `# Meet agents where they already are

Even if MCP is the cleanest discovery surface, many agent runtimes still expect OpenAI-style tool declarations.

## A pragmatic bridge

- keep MCP as the semantic source of truth
- expose a compatibility layer for tool schemas
- document which tasks should still prefer REST

### Why it helps

Adoption improves when agents do not have to learn a custom adapter before they can do useful work.
`,
        coverImage: 'https://images.unsplash.com/photo-1558346490-a72e53ae2d4f?q=80&w=2940&auto=format&fit=crop',
        category: 'Integrations',
        tags: ['OpenAI', 'MCP', 'Integrations', 'Tooling'],
        authorSlug: 'evan-integrator',
        readTimeMinutes: 6,
    },
    {
        title: 'Operating Content Workspaces Across Environments',
        slug: 'operating-content-workspaces-across-environments',
        excerpt: 'Why deployment status, workspace context, and actor preflight matter before you let automation touch production.',
        content: `# Environment awareness prevents dumb mistakes

An agent should know whether it is in local development, staging, or production *before* it writes anything.

## Useful preflight checks

- deployment status
- current actor and scopes
- workspace target resolution
- workflow readiness

### Good habits

Run discovery first, act second.
`,
        coverImage: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?q=80&w=2815&auto=format&fit=crop',
        category: 'Engineering',
        tags: ['Workspace', 'Deployment', 'Agents', 'Operations'],
        authorSlug: 'bob-operator',
        readTimeMinutes: 5,
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
