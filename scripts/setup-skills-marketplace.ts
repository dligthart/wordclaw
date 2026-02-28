import { db } from '../src/db/index.js';
import { domains, apiKeys } from '../src/db/schema.js';
import { createApiKey } from '../src/services/api-key.js';
import { eq } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

const API_URL = 'http://localhost:4000/api';

async function request(path: string, options: RequestInit = {}, apiKey?: string): Promise<any> {
    const url = `${API_URL}${path}`;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
        ...(options.headers as any)
    };

    let response = await fetch(url, { ...options, headers });

    if (!response.ok) {
        let errPayload;
        try {
            errPayload = await response.json();
        } catch (e) {
            console.error(`Error on ${path}:`, await response.text());
        }
        throw new Error(`HTTP ${response.status} Error on ${path}: ${JSON.stringify(errPayload)}`);
    }

    if (response.status !== 204) {
        return await response.json();
    }
}

async function setupSkillsMarketplace() {
    console.log("Setting up Agent Skills Marketplace Environment...");

    // 1. Setup Domain & API Key
    let [domain] = await db.insert(domains).values({
        name: "Agent Skills Marketplace",
        hostname: "marketplace.agent.local"
    }).onConflictDoNothing().returning();

    if (!domain) {
        [domain] = await db.select().from(domains).where(eq(domains.hostname, "marketplace.agent.local")).limit(1);
    }

    const { plaintext } = await createApiKey({
        domainId: domain.id,
        name: "Marketplace Admin Key",
        scopes: ['content:write', 'content:read', 'admin']
    });

    console.log(`Created Marketplace API Key: ${plaintext}`);

    // 2. Create Skill Content Type (Price = 0 initially)
    const skillSchema = {
        type: "object",
        properties: {
            title: { type: "string", description: "Name of the skill" },
            slug: { type: "string" },
            description: { type: "string", description: "What the skill does" },
            authorName: { type: "string", description: "Creator agent name" },
            authorAvatar: { type: "string", description: "Creator agent avatar" },
            category: { type: "string", enum: ["Data Analysis", "Code Generation", "Research", "Copywriting", "Other"] },
            promptTemplate: { type: "string", description: "The actual prompt or instructions for the agent" },
            basePrice: { type: "number", description: "Price in Satoshis" }
        },
        required: ["title", "slug", "description", "authorName", "category", "promptTemplate", "basePrice"]
    };

    let ctListRes = await request('/content-types', {}, plaintext);
    let skillCtId = ctListRes.data?.find((ct: any) => ct.slug === 'agent-skill')?.id;

    if (!skillCtId) {
        console.log("Creating 'Agent Skill' Content Type...");
        const res = await request('/content-types', {
            method: 'POST',
            body: JSON.stringify({
                name: "Agent Skill",
                slug: "agent-skill",
                schema: JSON.stringify(skillSchema),
                basePrice: 0 // Base price on the type is 0 initially
            })
        }, plaintext);
        skillCtId = res.data.id;
    }

    console.log(`Skill Content Type ID: ${skillCtId}`);

    // Ensure price is 0 for setup
    console.log(`Temporarily setting basePrice to 0 on Agent Skill Content Type for data insertion...`);
    await request(`/content-types/${skillCtId}`, {
        method: 'PUT',
        body: JSON.stringify({
            name: "Agent Skill",
            schema: JSON.stringify(skillSchema),
            basePrice: 0
        })
    }, plaintext);

    // 3. Insert Dummy Skills
    // Load elaborate skill
    const reactSkillPayload = fs.existsSync(path.join(process.cwd(), 'demos/agent-skills-marketplace/sample-skills/react.md'))
        ? fs.readFileSync(path.join(process.cwd(), 'demos/agent-skills-marketplace/sample-skills/react.md'), 'utf-8')
        : "You are an expert React UI developer. Generate a functional component for: {{input}}.";

    const skills = [
        {
            title: "React 19 Engineering System",
            slug: "react-19-engineering",
            description: "Production-grade React engineering. This skill transforms how you build React applications — from component architecture to deployment. Includes core rules, state management, Next.js Server Components, use() hook, forms, and strict performance targets.",
            authorName: "UI_Architect_Bot",
            authorAvatar: "https://api.dicebear.com/7.x/bottts/svg?seed=UI_Architect_Bot&backgroundColor=b6e3f4",
            category: "Code Generation",
            promptTemplate: reactSkillPayload,
            basePrice: 500
        },
        {
            title: "Long-term Memory (KV Store)",
            slug: "memory-kv",
            description: "Store and retrieve key-value pairs for long-term agent memory across sessions.",
            authorName: "DataCore",
            authorAvatar: "https://api.dicebear.com/7.x/bottts/svg?seed=DataCore&backgroundColor=c0aede",
            category: "Data Analysis",
            promptTemplate: "Store the following context under the key '{{key}}': '{{value}}'. If retrieving, fetch the value for key '{{key}}'.",
            basePrice: 100
        },
        {
            title: "X (Twitter) Auto-Poster",
            slug: "x-poster",
            description: "Automatically format, schedule, and post content to X (Twitter). Enforces character limits and thread formatting.",
            authorName: "SocialBot",
            authorAvatar: "https://api.dicebear.com/7.x/bottts/svg?seed=SocialBot&backgroundColor=ffdfbf",
            category: "Copywriting",
            promptTemplate: "Format this text into a compelling X post or thread: '{{text}}'. Ensure it includes engaging hooks and relevant hashtags.",
            basePrice: 200
        },
        {
            title: "GitHub Repository Reader",
            slug: "github-repo-reader",
            description: "Ingest and analyze the file structure, README, and recent commits of a public GitHub repository.",
            authorName: "CodeSmith",
            authorAvatar: "https://api.dicebear.com/7.x/bottts/svg?seed=CodeSmith&backgroundColor=b6e3f4",
            category: "Code Generation",
            promptTemplate: "Analyze the repository at '{{repo_url}}'. Provide an overview of the architecture and list the most important files.",
            basePrice: 300
        },
        {
            title: "Website Scraper (Markdown)",
            slug: "website-scraper",
            description: "Extracts the main content from any URL and converts it into clean, readable Markdown for LLM context inclusion.",
            authorName: "CrawlerOS",
            authorAvatar: "https://api.dicebear.com/7.x/bottts/svg?seed=CrawlerOS&backgroundColor=bbf7d0",
            category: "Research",
            promptTemplate: "Fetch the content from '{{url}}' and return it formatted as clean Markdown, stripping out all navigations and ads.",
            basePrice: 150
        }
    ];

    for (const skill of skills) {
        console.log(`Inserting Skill: ${skill.title}`);
        try {
            // Check if already exists by slug
            const searchRes = await request(`/content-items?contentTypeId=${skillCtId}`, {}, plaintext);
            const exists = searchRes.data?.some((item: any) => item.data.slug === skill.slug);
            if (!exists) {
                await request(`/content-items`, {
                    method: 'POST',
                    body: JSON.stringify({
                        contentTypeId: skillCtId,
                        data: skill,
                        status: "published"
                    })
                }, plaintext);
            } else {
                console.log(`Skill ${skill.title} already exists, skipping.`);
            }
        } catch (e) {
            console.error(`Failed to insert skill ${skill.title}`, e);
        }
    }

    // 4. Update CT to have a basePrice for read/write gating for L402
    console.log(`Setting basePrice to 200 on Agent Skill Content Type for L402 gating...`);
    await request(`/content-types/${skillCtId}`, {
        method: 'PUT',
        body: JSON.stringify({
            name: "Agent Skill",
            schema: JSON.stringify(skillSchema),
            basePrice: 200
        })
    }, plaintext);

    console.log("\nMarketplace setup complete! Note down the API key above for your frontend env.");
}

setupSkillsMarketplace().catch(console.error);
