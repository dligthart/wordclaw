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
        title: 'Editorial Identity: The CurrentActorSnapshot',
        slug: 'editorial-identity-the-currentactorsnapshot',
        excerpt: 'WordClaw resolves every inbound request down to a canonical CurrentActorSnapshot ensuring strict audit provenance.',
        content: `# Conceptual Deep Dive: Actor Identity Propagation

WordClaw is a multi-actor system. Every API key, supervisor session, and integration worker executes within the bounds of a well-defined identity context. Because agents may spawn sub-agents or rely on third-party webhook processors, maintaining airtight identity context is paramount for both security scoping and strict audit provenance.

## The \`CurrentActorSnapshot\`

Rather than relying purely on generic authentication headers, WordClaw resolves every inbound request down to a canonical \`CurrentActorSnapshot\`.

This snapshot provides answers to three critical questions:
1.  **Who is acting?** (\`actorId\`, \`actorType\`)
2.  **Where can they act?** (\`domainId\`)
3.  **What can they do there?** (\`scopes\`, \`roles\`)

### Actor Types
An actor fundamentally represents the entity holding the credential:

-   \`supervisor\`: A human admin or operator authenticated via the UI dashboard layer.
-   \`api_key\`: A machine agent or developer executing operations via a scoped token.
-   \`system\`: The internal WordClaw background worker or reconciliation job.

When an agent requests \`GET /api/identity\` or runs \`wordclaw capabilities whoami\`, it doesn't just receive "200 Success". It receives its full Actor snapshot. This snapshot is the exact data object that propagates down through the service layer, guaranteeing that no stray webhook or unprivileged agent script can accidentally execute an untargeted database wipe or unauthorize an L402 invoice settlement!
`,
        coverImage: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=2874&auto=format&fit=crop',
        category: 'Editorial',
        tags: ['Identity', 'Audit', 'Security', 'Actors'],
        authorSlug: 'clara-reviewer',
        readTimeMinutes: 5,
    },
    {
        title: 'Contracts vs. Schemas in WordClaw',
        slug: 'contracts-vs-schemas-in-wordclaw',
        excerpt: 'When orchestrating autonomous agents, the WordClaw runtime distinguishes explicitly between the Deployment Contract and the Domain Schema.',
        content: `# Conceptual Deep Dive: Contracts vs. Schemas

When orchestrating autonomous agents, the WordClaw runtime distinguishes explicitly between two closely related concepts: the **Deployment Contract** and the **Domain Schema**. 

In most traditional headless CMS systems, "Schema" effectively *is* the contract. But because WordClaw must safely bind a heterogeneous mix of LLM agents, plugins, integration workers, and human supervisors to arbitrary tenant data, we need a higher-level primitive.

## The Deployment Contract

The Contract describes the *hardcoded physical realities* of the current WordClaw deployment. These facts do not change unless the runtime is restarted with different code or environment variables.

If an agent wants to know whether this deployment supports Lightning payments or what protocol transports it exposes, the agent reads the deployment capabilities manifest (\`system://capabilities\` or \`GET /api/capabilities\`).

A Contract informs an agent of available Transports, enabled Subsystems (like L402 workers), Active Feature Flags, and Dry-Run Verification capabilities.

## The Domain Schema

The Schema describes the *tenant-specific data models* defined dynamically inside a Workspace. It changes at the speed of business, not the speed of deployment. In WordClaw, Schemas are stored as JSON Schema objects under a \`ContentType\`.

If an agent wants to know what properties are required to author a "Blog Post", it reads the domain schema (\`GET /api/content-types/:id\`). This information varies completely between active Workspaces. 

Always inspect the Contract before trusting a system interaction. Always inspect the Schema before attempting an explicit data payload mutation.
`,
        coverImage: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?q=80&w=2834&auto=format&fit=crop',
        category: 'Architecture',
        tags: ['Schemas', 'Contracts', 'Agentic', 'System'],
        authorSlug: 'alice-builder',
        readTimeMinutes: 5,
    },
    {
        title: 'Building a Headless Blog Frontend',
        slug: 'building-a-headless-blog-frontend',
        excerpt: 'A practical look at integrating WordClaw into a modern frontend framework like React, SvelteKit, or Vue.',
        content: `# Building a Headless Blog with WordClaw

WordClaw is a headless CMS designed for both human developers and AI agents. Building a custom frontend for your content is straightforward using the REST API. 

## Fetching Content Types and Items

The typical workflow in your frontend application (e.g., Vite + React) will involve fetching both the Content Types and the Content Items to resolve relationships.

\`\`\`typescript
// 1. Fetch Content Types to resolve IDs by slug
const ctRes = await fetch('/api/content-types').then(res => res.json());
const types = ctRes.data || [];

const authorType = types.find(t => t.slug === 'author');
const postType = types.find(t => t.slug === 'blog-post');

if (authorType && postType) {
  // 2. Fetch the actual content items
  const [authorsRes, postsRes] = await Promise.all([
    fetch(\`/api/content-items?contentTypeId=\${authorType.id}\`).then(res => res.json()),
    fetch(\`/api/content-items?contentTypeId=\${postType.id}\`).then(res => res.json())
  ]);

  // WordClaw returns the user-defined \`data\` as a stringified JSON payload
  const parsedAuthors = authorsRes.data.map(item => ({...item, data: JSON.parse(item.data)}));
  const parsedPosts = postsRes.data.map(item => ({...item, data: JSON.parse(item.data)}));
}
\`\`\`

## Developer Tips

- **Dry Run Mode**: Agents or CLI tools interacting with the WordClaw API can simulate writes using the \`?mode=dry_run\` query parameter. This guarantees the schema validation will run, but the item will not be physically inserted into the database.
- **Embeddings**: When \`status\` is set to \`"published"\`, WordClaw automatically generates vector embeddings for semantic search. Consider utilizing \`GET /api/search/semantic?query=xyz\`.
`,
        coverImage: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?q=80&w=2872&auto=format&fit=crop',
        category: 'Tutorials',
        tags: ['React', 'Frontend', 'Tutorials', 'REST'],
        authorSlug: 'alice-builder',
        readTimeMinutes: 6,
    },
    {
        title: 'Mastering the WordClaw CLI',
        slug: 'mastering-the-wordclaw-cli',
        excerpt: 'The WordClaw CLI is a JSON-first command-line interface for agents and operators wrapping both MCP and REST surfaces.',
        content: `# WordClaw CLI Capabilities

The WordClaw CLI is a JSON-first command-line interface for agents and operators. It wraps both of the product's primary agent surfaces:

- \`MCP\` for local tool discovery or remote MCP attachment
- \`REST\` for content operations, workflows, and L402 purchase/entitlement flows

Use the CLI when you want a scriptable interface without writing a custom MCP client or hand-rolling HTTP requests.

## Interactive Mode

Use the REPL when you want to explore the deployment without retyping shared flags like \`--base-url\`, \`--api-key\`, or \`--mcp-transport\`.

\`\`\`bash
wordclaw repl
wordclaw> capabilities show
wordclaw> workspace guide --intent review --limit 5
wordclaw> exit
\`\`\`

## Output Model

The CLI prints JSON by default so agents can consume it reliably.
- Successful REST commands return transport metadata plus the API response body.
- Failures return a JSON error object and exit with code \`1\`.
- Use \`--raw\` when you want only the response body or MCP text without the CLI envelope.

## Standard MCP Preflight

\`\`\`bash
node dist/cli/index.js mcp resource system://deployment-status \\
  --mcp-transport http \\
  --mcp-url http://localhost:4000/mcp \\
  --api-key writer
\`\`\`
`,
        coverImage: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?q=80&w=2870&auto=format&fit=crop',
        category: 'Engineering',
        tags: ['CLI', 'Terminal', 'Operations', 'MCP'],
        authorSlug: 'bob-operator',
        readTimeMinutes: 5,
    },
    {
        title: 'Webhook Deliveries and Event Handoffs',
        slug: 'webhook-deliveries-and-event-handoffs',
        excerpt: 'WordClaw supports robust webhook integration with HMCA-SHA256 signature verification and exponential backoff retry semantics.',
        content: `# Publish is the integration boundary

The cleanest webhook is the one that fires *after* the content model and workflow state agree that content is live. WordClaw supports robust webhook integration with HMCA-SHA256 signature verification and exponential backoff retry semantics.

## Event Triggers

You can register callback URLs with event subscriptions such as:
- \`content_item.create\` 
- \`content_item.update\` 
- \`audit.*\` 

### Security and Retries

Payloads are signed with HMAC-SHA256 using a per-webhook secret. Delivery is non-blocking with automatic retries and exponential backoff.

If a webhook endpoint returns a 500 error, WordClaw queues the payload in its background worker queue to retry later, ensuring transient internet issues do not cause permanent un-synchronization between the CMS and your downstream frontend indexers!
`,
        coverImage: 'https://images.unsplash.com/photo-1516321497487-e288fb19713f?q=80&w=2874&auto=format&fit=crop',
        category: 'Integrations',
        tags: ['Webhooks', 'Automation', 'Integrations', 'Deployments'],
        authorSlug: 'evan-integrator',
        readTimeMinutes: 4,
    },
    {
        title: 'Core Product Features Overview',
        slug: 'core-product-features-overview',
        excerpt: 'A broad look at WordClaw\'s Tier 1 capabilities, from strict content modeling to immutable audit logs.',
        content: `# Tier 1 Capabilities

WordClaw separates its features into tiers to keep the core runtime stable while incubating new ideas. Here are the core Tier 1 systems:

## Structured Content
- **Content Types** — Define reusable JSON schemas that content items must conform to. Schemas are validated on creation and enforced on every content write.
- **Content Items** — Versioned content entities with \`draft\`, \`published\`, and \`archived\` status. Every update auto-increments the version and stores an immutable snapshot.
- **Batch Operations** — Create, update, or delete multiple items in a single call in atomic or partial mode.
- **Version History and Rollback** — Browse the full history of any content item and restore prior versions without losing auditability.

## Governance and Safety
- **Policy Engine** — A centralized authorization layer that maps identities, operations, and resources into one strict evaluation geometry.
- **Dry-Run Mode** — Supported write paths can be simulated before mutation.
- **Audit Logging** — Mutations record action, entity, actor, and request trace data for inspection and forensics.
- **Multi-Tenant Isolation** — Domains scope content, keys, and workflows to prevent cross-tenant overlap.
`,
        coverImage: 'https://images.unsplash.com/photo-1555949963-aa79dcee981c?q=80&w=2832&auto=format&fit=crop',
        category: 'Product',
        tags: ['Features', 'Architecture', 'Overview', 'Tier1'],
        authorSlug: 'dana-publisher',
        readTimeMinutes: 5,
    },
    {
        title: 'WordClaw Semantic Search with pgvector',
        slug: 'wordclaw-semantic-search-with-pgvector',
        excerpt: 'WordClaw brings native Vector RAG capabilities without requiring external vector infrastructure.',
        content: `# Semantic Search

WordClaw now ships with native Vector RAG and Semantic Search capabilities as a Tier 2 Optional Module!

## Automated Embeddings

Published content can be automatically chunked and embedded directly into the Postgres database using \`pgvector\`. This happens automatically in the background worker queue whenever a Content Item state transitions to 'Published'. WordClaw utilizes standard \`text-embedding-3-small\` style inference out of the box.

## Semantic AI Querying

Agents and human-facing frontend dashboards can query the CMS using natural-language relevance without paying a third-party vector provider!

\`\`\`http
GET /api/search/semantic?query=headless%20cms
\`\`\`

This returns a sorted \`distance\` list of the most semantically relevant items matching the query. You can see this integration locally by navigating to the UI search bar and using the intelligent routing system.
`,
        coverImage: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=2874&auto=format&fit=crop',
        category: 'Engineering',
        tags: ['AI', 'Vector', 'RAG', 'Postgres'],
        authorSlug: 'alice-builder',
        readTimeMinutes: 6,
    },
    {
        title: 'Reviewing Schema Checklists',
        slug: 'reviewing-schema-checklists',
        excerpt: 'Schema review should be boring. What to verify before you let a new content model become part of a supervised publishing workflow.',
        content: `# Good schemas make calm systems

Schema review should be boring in the best possible way. The point is not to maximize flexibility. The point is to give authors and agents a shape they can trust.

## Before you approve a model

1. **Confirm Requirements**: Ensure required fields are truly required by the presentation layer. Don't make "Excerpt" required if your frontend handles truncation flawlessly.
2. **Intent-driven naming**: Make sure editorial intent is reflected in field names.
3. **Draft the Policy**: Decide whether the model needs an approval workflow or if it can immediately transition to \`published\`.
4. **Dry Run**: Test the payload against the REST API in \`?mode=dry_run\` mode to verify all Regex and Type matchers before exposing the Schema ID to the MCP manifest.
`,
        coverImage: 'https://images.unsplash.com/photo-1516321165247-4aa89a48be28?q=80&w=2874&auto=format&fit=crop',
        category: 'Editorial',
        tags: ['Schemas', 'Review', 'Editorial', 'Validation'],
        authorSlug: 'clara-reviewer',
        readTimeMinutes: 4,
    },
    {
        title: 'The Supervisor Control Plane',
        slug: 'the-supervisor-control-plane',
        excerpt: 'A brief overview of the built-in SvelteKit WordClaw dashboard acting as the oversight surface over autonomous interactions.',
        content: `# Overseeing the Machines

The built-in SvelteKit UI under \`/ui\` is positioned as an oversight surface, not a full human-first CMS. WordClaw expects the primary authors on your domain to be automated LLM tasks executing via MCP.

Because of this, the dashboard is heavily optimized for operators and reviewers:

- **Dashboard** — System health and activity telemetry.
- **Audit Log Viewer** — Searchable history of mutations and raw payloads. Let's you pinpoint the exact millisecond an AI agent updated an article.
- **Schema Manager** — Visual schema administration for content models.
- **Approval Queue** — Review and decide pending workflow items where AI models requested human gate-keeping.
- **API Keys** — Provision, rotate, and revoke API credentials for agents and operator integrations.

In a traditional CMS, you log in to write. In WordClaw, you log in to **authorize**.
`,
        coverImage: 'https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?q=80&w=2874&auto=format&fit=crop',
        category: 'Product',
        tags: ['Dashboard', 'Operations', 'Governance', 'UX'],
        authorSlug: 'dana-publisher',
        readTimeMinutes: 5,
    },
    {
        title: 'Agent Guidance: Integrating OpenAI Assistants',
        slug: 'agent-guidance-integrating-openai-assistants',
        excerpt: 'A practical bridge between MCP-native discovery and the tool schemas expected by popular LLM runtimes.',
        content: `# Meet agents where they already are

Even if MCP is the cleanest discovery surface, many agent runtimes still expect OpenAI-style tool declarations.

WordClaw solves this via its \`system://agent-guidance\` resource.

When a LangChain agent boots up, it can fetch the Agent Guidance payload to retrieve explicit text-based "recipes" explaining exactly how to construct the JSON payloads for the WordClaw tools. Instead of relying solely on the LLM's hallucinated guessing based on tool schema descriptions, WordClaw provides explicit step-by-step guidance in English.

### Why it helps

Adoption improves when agents do not have to learn a custom adapter before they can do useful work. By providing intent-based resolutions and explicit conversational templates for tasks like "How do I author an article?", the success rate of Autonomous Systems operating against the headless CMS skyrockets.
`,
        coverImage: 'https://images.unsplash.com/photo-1558346490-a72e53ae2d4f?q=80&w=2940&auto=format&fit=crop',
        category: 'Integrations',
        tags: ['OpenAI', 'MCP', 'Integrations', 'Tooling'],
        authorSlug: 'evan-integrator',
        readTimeMinutes: 6,
    },
    {
        title: 'WordClaw Deployment Readiness',
        slug: 'wordclaw-deployment-readiness',
        excerpt: 'Why deployment status, workspace context, and actor preflight matter before you let automation touch production.',
        content: `# Environment awareness prevents dumb mistakes

An agent should know whether it is in local development, staging, or production *before* it writes anything.

## Useful preflight checks

WordClaw agents should always conduct the following before initiating a task loop:

1. **Deployment status**: Is the HTTP server up? Are background indices online?
2. **Current actor and scopes**: Does this currently authenticated API key even have \`content:write\` permission?
3. **Workspace target resolution**: What is the ID of the schema we should be writing into?
4. **Identify workflow constraints**: Is the resolved schema locked behind a human approval policy?

### Good habits

Run discovery first, act second. This is the cornerstone of responsible autonomous execution.
`,
        coverImage: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?q=80&w=2815&auto=format&fit=crop',
        category: 'Engineering',
        tags: ['Workspace', 'Deployment', 'Agents', 'Operations'],
        authorSlug: 'bob-operator',
        readTimeMinutes: 5,
    },
    {
        title: 'WordClaw Deployment with Docker',
        slug: 'wordclaw-deployment-with-docker',
        excerpt: 'WordClaw ships with a production Docker image definition and a GitHub Container Registry publish workflow.',
        content: `# Containerized Operations

WordClaw is built to be deployed anywhere that can run Node.js and PostgreSQL, but its primary supported deployment path is over Docker.

## Local Docker Compose

To start PostgreSQL and the API runtime together locally, simply use Docker Compose:

\`\`\`bash
docker compose --profile app up --build
\`\`\`

The \`app\` service builds the production image, runs database migrations on startup by default, and serves the API on \`http://localhost:4000\`.

## Running the published GHCR image

For remote deployments, WordClaw automatically publishes images to the GitHub Container Registry. 

- \`ghcr.io/dligthart/wordclaw:main\` on pushes to \`main\`
- \`ghcr.io/dligthart/wordclaw:vX.Y.Z\` on version tags
- \`ghcr.io/dligthart/wordclaw:latest\` from the default branch

If you want to handle your Drizzle ORM schema changes separately from your container startup, simply set \`RUN_DB_MIGRATIONS=false\` in the environment variables when executing \`docker run\`.
`,
        coverImage: 'https://images.unsplash.com/photo-1605745341112-85968b19335b?q=80&w=2942&auto=format&fit=crop',
        category: 'Tutorials',
        tags: ['Docker', 'Deployment', 'GHCR', 'Postgres'],
        authorSlug: 'evan-integrator',
        readTimeMinutes: 4,
    },
    {
        title: 'Fixing CI Migrations and Drizzle Idempotency',
        slug: 'fixing-ci-migrations-and-drizzle-idempotency',
        excerpt: 'A look at common CI failure patterns related to database migrations and how to design idempotent DDL statements in Postgres.',
        content: `# Protect your migration history

When heavily customizing WordClaw, you will inevitably write your own Drizzle ORM migrations. A common incident in CI workflows involves duplicate table creation errors when multiple developers merge schema changes simultaneously.

## The Idempotency Rule

Always use idempotent SQL for migration safety in CI and fresh databases:

- \`CREATE TABLE IF NOT EXISTS ...\`
- \`ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...\`
- \`CREATE INDEX IF NOT EXISTS ...\`

### Constraint-safe example

Foreign keys and constraints require slightly more manual care. Wrap constraint creation in identical guards:

\`\`\`sql
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'api_keys_created_by_users_id_fk'
  ) THEN
    ALTER TABLE "api_keys"
      ADD CONSTRAINT "api_keys_created_by_users_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
\`\`\`

If a migration fails because of a missing \`vector\` type, remember that WordClaw relies on \`pgvector\`. Ensure your CI bootstrap command runs \`CREATE EXTENSION IF NOT EXISTS vector;\` before executing the primary migration chain.
`,
        coverImage: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?q=80&w=2940&auto=format&fit=crop',
        category: 'Engineering',
        tags: ['CI', 'Database', 'Postgres', 'Migrations'],
        authorSlug: 'alice-builder',
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
