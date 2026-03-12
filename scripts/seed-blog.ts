import { db } from '../src/db/index.js';
import { domains, apiKeys, contentTypes, contentItems } from '../src/db/schema.js';
import { createApiKey } from '../src/services/api-key.js';
import { and, eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function setupBlogDemo() {
    console.log("=========================================");
    console.log(" Setting up Headless Blog CMS Demo       ");
    console.log("=========================================\n");

    try {
        // 1. Setup Demo Domain
        console.log("Setting up Blog Domain...");
        let [blogDomain] = await db.insert(domains).values({
            name: "WordClaw Demo Blog",
            hostname: "blog.demo.local"
        }).onConflictDoNothing().returning();

        if (!blogDomain) {
            [blogDomain] = await db.select().from(domains).where(eq(domains.name, "WordClaw Demo Blog")).limit(1);
        }

        const apiKeyResult = await createApiKey({
            domainId: blogDomain.id,
            name: "Vite React Frontend",
            scopes: ['content:read']
        });

        console.log("Setting up Content Types...");
        // 2. Setup Author Schema
        const [authorSchema] = await db.insert(contentTypes).values({
            domainId: blogDomain.id,
            name: "Demo Author",
            slug: "demo-author",
            schema: JSON.stringify({
                type: "object",
                properties: {
                    name: { type: "string" },
                    slug: { type: "string" },
                    bio: { type: "string" },
                    avatarUrl: { type: "string" },
                    socialLinks: { type: "array", items: { type: "string" } }
                },
                required: ["name", "slug"]
            })
        }).onConflictDoNothing().returning();

        let authorSchemaId = authorSchema?.id;
        if (!authorSchemaId) {
            const [ct] = await db.select().from(contentTypes).where(and(
                eq(contentTypes.domainId, blogDomain.id),
                eq(contentTypes.slug, "demo-author")
            )).limit(1);
            authorSchemaId = ct.id;
        }

        // 3. Setup Blog Post Schema
        const [postSchema] = await db.insert(contentTypes).values({
            domainId: blogDomain.id,
            name: "Demo Blog Post",
            slug: "demo-blog-post",
            schema: JSON.stringify({
                type: "object",
                properties: {
                    title: { type: "string" },
                    slug: { type: "string" },
                    excerpt: { type: "string" },
                    content: { type: "string" },
                    coverImage: { type: "string" },
                    category: { type: "string" },
                    authorId: { type: "number" },
                    readTimeMinutes: { type: "number" },
                    tags: { type: "array", items: { type: "string" } }
                },
                required: ["title", "slug", "content", "authorId"]
            })
        }).onConflictDoNothing().returning();

        let postSchemaId = postSchema?.id;
        if (!postSchemaId) {
            const [ct] = await db.select().from(contentTypes).where(and(
                eq(contentTypes.domainId, blogDomain.id),
                eq(contentTypes.slug, "demo-blog-post")
            )).limit(1);
            postSchemaId = ct.id;
        }

        console.log("Seeding Database...");

        // Clear old ones first for clean rerun (optional but nice)
        await db.delete(contentItems).where(eq(contentItems.domainId, blogDomain.id));

        // 4. Create Authors
        const [alice] = await db.insert(contentItems).values([
            {
                domainId: blogDomain.id,
                contentTypeId: authorSchemaId,
                status: 'published',
                data: JSON.stringify({
                    name: "Alice Builder",
                    slug: "alice-builder",
                    bio: "Senior Architect exploring autonomous agents and headless CMS systems.",
                    avatarUrl: "https://i.pravatar.cc/150?u=alice",
                    socialLinks: ["https://twitter.com/example_alice"]
                })
            }
        ]).returning();

        const [bob] = await db.insert(contentItems).values([
            {
                domainId: blogDomain.id,
                contentTypeId: authorSchemaId,
                status: 'published',
                data: JSON.stringify({
                    name: "Bob Operator",
                    slug: "bob-operator",
                    bio: "Platform Engineer passionate about multi-tenant security and L402 payments.",
                    avatarUrl: "https://i.pravatar.cc/150?u=bob",
                    socialLinks: ["https://github.com/example_bob"]
                })
            }
        ]).returning();

        // 5. Create Posts
        await db.insert(contentItems).values([
            {
                domainId: blogDomain.id,
                contentTypeId: postSchemaId,
                status: 'published',
                data: JSON.stringify({
                    title: "Connecting Agents to the Multi-Tenant CMS",
                    slug: "connecting-agents-multi-tenant",
                    excerpt: "Why flat REST APIs fail for context-aware agents, and how intent-driven targeting fixes it.",
                    content: "## The Architecture Problem\n\nTraditional REST endpoints are designed around flat structures. An agent asking `GET /content-types` doesn't know what schema actually applies to the domain.\n\n## The WordClaw Solution\n\nBy leveraging `GET /api/workspace-target`, agents dynamically receive the correct working JSON schemas and outstanding task targets...",
                    coverImage: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2672&auto=format&fit=crop",
                    category: "Engineering",
                    tags: ["Agents", "Architecture", "CMS"],
                    authorId: alice.id,
                    readTimeMinutes: 5
                })
            },
            {
                domainId: blogDomain.id,
                contentTypeId: postSchemaId,
                status: 'published',
                data: JSON.stringify({
                    title: "Safely Monetizing AI Outputs",
                    slug: "safely-monetizing-ai-outputs",
                    excerpt: "A deep dive into combining L402 cryptographic challenges with AI capabilities.",
                    content: "## Free Access is Expensive\n\nWhen exposing high-compute Agent logic via APIs, standard rate-limits don't protect the balance sheet.\n\n## L402 Protocol\n\nBy issuing a Bolt11 Invoice disguised as a `402 Payment Required` challenge, we merge AuthZ and billing into a single cryptographic payload. Preimages serve as immutable proof...",
                    coverImage: "https://images.unsplash.com/photo-1639762681485-074b7f4fc651?q=80&w=2832&auto=format&fit=crop",
                    category: "Monetization",
                    tags: ["L402", "Lightning", "Economics"],
                    authorId: bob.id,
                    readTimeMinutes: 4
                })
            },
            {
                domainId: blogDomain.id,
                contentTypeId: postSchemaId,
                status: 'published',
                data: JSON.stringify({
                    title: "Building Autonomous Agentic Workflows",
                    slug: "building-autonomous-agentic-workflows",
                    excerpt: "A comprehensive guide to leveraging WordClaw's MCP integration to create robust, self-healing, agent-driven content cycles.",
                    content: "## Introduction to Autonomous Workflows\n\nThe future of content creation is a collaborative cycle between human editors and autonomous agents. WordClaw embraces this by treating AI as a first-class citizen in the editorial workflow.\n\n### Why Traditional CMSs Fail Agents\n\nMost CMS platforms provide simple CRUD APIs intended for human-driven frontends. When an *Agent* attempts to write an article, it faces several hurdles:\n\n1. It doesn't know the **JSON Schema** of the content type.\n2. It lacks the ability to reliably retrieve the constraints of the editorial policy.\n3. Making a mistake means corrupting production data.\n\n> \"Agents need metadata and semantic intent, not just raw REST endpoints.\" - WordClaw Philosophy\n\n### The Model Context Protocol (MCP) Solution\n\nWordClaw integrates the unified **Model Context Protocol** directly into its API layer. This means an AI agent can natively discover tools, prompts, and resources.\n\nTake a look at how an agent might discover capabilities via the MCP endpoint:\n\n```json\n{\n  \"action\": \"list_tools\",\n  \"response\": {\n    \"tools\": [\n      { \"name\": \"create_content_item\" },\n      { \"name\": \"submit_review_task\" }\n    ]\n  }\n}\n```\n\n### Step-by-Step Implementation\n\nHere's how you can bootstrap your own workflow:\n\n* **Define the Schema**: Clearly articulate the required fields.\n* **Establish the Review Policy**: Require manual \"Publisher\" review.\n* **Unleash the Agent**: Let the agent use `?mode=dry_run` to test its drafts before committing.\n\n#### Security and Sandboxing\n\nWordClaw guarantees safety via transaction isolation. If an agent tries to modify a field it shouldn't, the API instantly rejects the schema mismatch and returns a clear, actionable `400 Bad Request` that the agent can read and self-correct against.\n\nConclusion: Building agentic loops is easy when the CMS understands intent.",
                    coverImage: "https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=2670&auto=format&fit=crop",
                    category: "Tutorials",
                    tags: ["Agents", "MCP", "Workflows", "TypeScript"],
                    authorId: alice.id,
                    readTimeMinutes: 12
                })
            }
        ]);

        // 6. Write key to `.env` inside demo-blog
        const envPath = path.join(__dirname, '../demos/demo-blog/.env');
        fs.writeFileSync(
            envPath,
            `VITE_WORDCLAW_URL=http://localhost:4000/api\nVITE_WORDCLAW_API_KEY=${apiKeyResult.plaintext}\n`
        );

        console.log("\n✅ Demo seeded successfully!");
        console.log(`Blog API Key: ${apiKeyResult.plaintext}`);
        console.log("\nThe React app has been automatically configured. You can now start it:");
        console.log(`cd demos/demo-blog && npm run dev`);

        process.exit(0);
    } catch (e) {
        console.error("Setup failed:", e);
        process.exit(1);
    }
}

setupBlogDemo();
