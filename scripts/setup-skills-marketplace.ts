import { db } from '../src/db/index.js';
import { domains, offers, licensePolicies } from '../src/db/schema.js';
import { createApiKey } from '../src/services/api-key.js';
import { and, eq } from 'drizzle-orm';
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
    console.log("Setting up Paid Capability Library demo environment...");

    // 1. Setup Domain & API Key
    let [domain] = await db.insert(domains).values({
        name: "Paid Capability Library",
        hostname: "capability-library.agent.local"
    }).onConflictDoNothing().returning();

    if (!domain) {
        [domain] = await db.select().from(domains).where(eq(domains.hostname, "capability-library.agent.local")).limit(1);
    }

    const { plaintext } = await createApiKey({
        domainId: domain.id,
        name: "Capability Library Demo Key",
        scopes: ['content:write', 'content:read', 'admin']
    });

    console.log(`Created Demo API Key: ${plaintext}`);

    // 2. Create content type used by the demo library.
    const skillSchema = {
        type: "object",
        properties: {
            title: { type: "string", description: "Name of the capability" },
            slug: { type: "string" },
            description: { type: "string", description: "What the capability does" },
            authorName: { type: "string", description: "Creator agent or team name" },
            authorAvatar: { type: "string", description: "Creator avatar" },
            category: { type: "string", enum: ["Data Analysis", "Code Generation", "Research", "Copywriting", "Other"] },
            promptTemplate: { type: "string", description: "The actual prompt or instructions for the agent", premium: true },
            basePrice: { type: "number", description: "Suggested offer price in Satoshis" }
        },
        required: ["title", "slug", "description", "authorName", "category", "promptTemplate", "basePrice"]
    };

    let ctListRes = await request('/content-types', {}, plaintext);
    let skillCtId = ctListRes.data?.find((ct: any) => ct.slug === 'agent-skill')?.id;

    if (!skillCtId) {
        console.log("Creating 'Agent Skill' content type...");
        const res = await request('/content-types', {
            method: 'POST',
            body: JSON.stringify({
                name: "Agent Capability",
                slug: "agent-skill",
                schema: JSON.stringify(skillSchema),
                basePrice: 0
            })
        }, plaintext);
        skillCtId = res.data.id;
    }

    console.log(`Skill Content Type ID: ${skillCtId}`);

    console.log(`Ensuring content type pricing remains offer-first...`);
    await request(`/content-types/${skillCtId}`, {
        method: 'PUT',
        body: JSON.stringify({
            name: "Agent Capability",
            schema: JSON.stringify(skillSchema),
            basePrice: 0
        })
    }, plaintext);

    // 3. Insert capability content items.
    const reactSkillPayload = fs.existsSync(path.join(process.cwd(), 'demos/agent-skills-marketplace/sample-skills/react.md'))
        ? fs.readFileSync(path.join(process.cwd(), 'demos/agent-skills-marketplace/sample-skills/react.md'), 'utf-8')
        : "You are an expert React UI developer. Generate a functional component for: {{input}}.";

    const skills = [
        {
            title: "React 19 Engineering System",
            slug: "react-19-engineering",
            description: "A production-grade React capability pack covering component architecture, data flow, form handling, and shipping constraints for a modern frontend team.",
            authorName: "UI_Architect_Bot",
            authorAvatar: "https://api.dicebear.com/7.x/bottts/svg?seed=UI_Architect_Bot&backgroundColor=b6e3f4",
            category: "Code Generation",
            promptTemplate: reactSkillPayload,
            basePrice: 500
        },
        {
            title: "Approval Decision Brief",
            slug: "approval-decision-brief",
            description: "Generate a concise approve or reject brief for operators reviewing content changes in a governed workflow.",
            authorName: "ReviewDesk",
            authorAvatar: "https://api.dicebear.com/7.x/bottts/svg?seed=ReviewDesk&backgroundColor=c0aede",
            category: "Copywriting",
            promptTemplate: "Review this content payload: '{{payload}}'. Return a short approval brief with risks, missing checks, and a final recommendation.",
            basePrice: 180
        },
        {
            title: "Policy Remediation Formatter",
            slug: "policy-remediation-formatter",
            description: "Turn policy denials or validation failures into deterministic remediation steps for an agent loop.",
            authorName: "SafetyLoop",
            authorAvatar: "https://api.dicebear.com/7.x/bottts/svg?seed=SafetyLoop&backgroundColor=ffdfbf",
            category: "Other",
            promptTemplate: "Given this policy error: '{{error}}' and context '{{context}}', produce a numbered remediation plan that the caller can execute.",
            basePrice: 0
        },
        {
            title: "Schema Change Explainer",
            slug: "schema-change-explainer",
            description: "Explain a content-type schema update in operator language, highlighting breaking changes and rollout risks.",
            authorName: "SchemaSmith",
            authorAvatar: "https://api.dicebear.com/7.x/bottts/svg?seed=SchemaSmith&backgroundColor=b6e3f4",
            category: "Code Generation",
            promptTemplate: "Compare the previous schema '{{previous_schema}}' with the proposed schema '{{next_schema}}'. Summarize the key changes, migration risks, and safe rollout advice.",
            basePrice: 300
        },
        {
            title: "Content Research Summarizer",
            slug: "content-research-summarizer",
            description: "Condense source material into a structured summary with claims, evidence, and editorial caveats.",
            authorName: "SignalDesk",
            authorAvatar: "https://api.dicebear.com/7.x/bottts/svg?seed=SignalDesk&backgroundColor=bbf7d0",
            category: "Research",
            promptTemplate: "Summarize this research input: '{{source_material}}'. Return key findings, uncertain claims, and suggested follow-up questions.",
            basePrice: 150
        }
    ];

    for (const skill of skills) {
        console.log(`Upserting capability: ${skill.title}`);
        try {
            // Check if already exists by slug
            const searchRes = await request(`/content-items?contentTypeId=${skillCtId}`, {}, plaintext);
            const exists = searchRes.data?.find((item: any) => {
                const payload = typeof item.data === 'string' ? JSON.parse(item.data) : item.data;
                return payload?.slug === skill.slug;
            });

            let skillItemId = exists?.id;

            if (!exists) {
                const res = await request(`/content-items`, {
                    method: 'POST',
                    body: JSON.stringify({
                        contentTypeId: skillCtId,
                        data: skill,
                        status: "published"
                    })
                }, plaintext);
                skillItemId = res.data?.id;
            } else {
                await request(`/content-items/${exists.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        data: skill,
                        status: "published"
                    })
                }, plaintext);
                console.log(`Updated ${skill.title}.`);
            }

            if (skillItemId) {
                const existingOffer = await db.select().from(offers).where(and(
                    eq(offers.domainId, domain.id),
                    eq(offers.scopeRef, skillItemId)
                ));
                if (skill.basePrice > 0 && existingOffer.length === 0) {
                    const [newOffer] = await db.insert(offers).values({
                        domainId: domain.id,
                        slug: `${skill.slug}-access`,
                        name: `${skill.title} Access`,
                        scopeType: 'item',
                        scopeRef: skillItemId,
                        priceSats: skill.basePrice,
                        active: true
                    }).returning();

                    await db.insert(licensePolicies).values({
                        domainId: domain.id,
                        offerId: newOffer.id,
                        version: 1,
                        maxReads: null,
                        allowRedistribution: false
                    });
                    console.log(`Created offer for ${skill.title}`);
                } else if (skill.basePrice > 0 && existingOffer.length > 0) {
                    await db.update(offers).set({
                        name: `${skill.title} Access`,
                        priceSats: skill.basePrice,
                        active: true
                    }).where(eq(offers.id, existingOffer[0].id));
                    console.log(`Updated offer for ${skill.title}`);
                } else if (skill.basePrice <= 0 && existingOffer.length > 0) {
                    await db.update(offers).set({ active: false }).where(eq(offers.id, existingOffer[0].id));
                    console.log(`Disabled paid offer for free capability ${skill.title}`);
                }
            }
        } catch (e) {
            console.error(`Failed to upsert capability ${skill.title}`, e);
        }
    }

    console.log("\nPaid Capability Library setup complete. Use the API key above in the demo frontend env.");
}

setupSkillsMarketplace().catch(console.error);
