import express from 'express';
import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config({ path: '../../.env' });
dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WORDCLAW_API_KEY = process.env.WORDCLAW_API_KEY;
// Connect to the local unauthenticated docker environment or your deployed wordclaw api base url
const WORDCLAW_API_URL = process.env.WORDCLAW_API_URL || 'http://localhost:4000/api';

if (!OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY is not set in .env");
    process.exit(1);
}

if (!WORDCLAW_API_KEY) {
    console.error("❌ WORDCLAW_API_KEY is not set in .env");
    process.exit(1);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let storyNodeContentTypeId: number | null = null;
let publishedStoryContentTypeId: number | null = null;

// Initial setup logic
async function setupWordclawSchemas() {
    console.log("🔄 Checking WordClaw for Schemas...");

    // Check StoryNode schema
    const snRes = await fetch(`${WORDCLAW_API_URL}/content-types?limit=500`, {
        headers: {
            'x-api-key': WORDCLAW_API_KEY!
        }
    });

    if (snRes.ok) {
        const data = await snRes.json();
        const types = data.data as any[];

        const existingNode = types.find(t => t.slug === 'story-node-v2');
        if (existingNode) {
            storyNodeContentTypeId = existingNode.id;
            console.log(`✅ StoryNode V2 Schema found (ID: ${storyNodeContentTypeId})`);
        } else {
            console.log("📦 Creating new StoryNode V2 ContentType...");
            const schemaDef = JSON.parse(fs.readFileSync('./schema.json', 'utf-8'));
            const createRes = await fetch(`${WORDCLAW_API_URL}/content-types`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': WORDCLAW_API_KEY!
                },
                body: JSON.stringify({
                    name: 'StoryNode V2',
                    slug: 'story-node-v2',
                    description: 'Interactive fiction nodes (Supports Win States).',
                    schema: schemaDef
                })
            });

            if (createRes.ok) {
                const created = await createRes.json();
                storyNodeContentTypeId = created.data.id;
                console.log(`✅ StoryNode V2 Schema created (ID: ${storyNodeContentTypeId})`);
            } else {
                console.error("❌ Failed to create StoryNode V2 Schema:", await createRes.json());
                process.exit(1);
            }
        }

        const existingPublish = types.find(t => t.slug === 'published-story');
        if (existingPublish) {
            publishedStoryContentTypeId = existingPublish.id;
            console.log(`✅ PublishedStory Schema found (ID: ${publishedStoryContentTypeId})`);
        } else {
            console.log("📦 Creating new PublishedStory ContentType...");
            const publishDef = JSON.parse(fs.readFileSync('./published-schema.json', 'utf-8'));
            const createPubRes = await fetch(`${WORDCLAW_API_URL}/content-types`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': WORDCLAW_API_KEY!
                },
                body: JSON.stringify({
                    name: 'PublishedStory',
                    slug: 'published-story',
                    description: 'Completed interactive fiction runs.',
                    schema: publishDef
                })
            });

            if (createPubRes.ok) {
                const created = await createPubRes.json();
                publishedStoryContentTypeId = created.data.id;
                console.log(`✅ PublishedStory Schema created (ID: ${publishedStoryContentTypeId})`);
            } else {
                console.error("❌ Failed to create PublishedStory Schema:", await createPubRes.json());
                process.exit(1);
            }
        }
    } else {
        console.error("❌ Failed to fetch content types", await snRes.json());
        process.exit(1);
    }
}

// Interacting with the OpenAI API
async function generateBranches(contextLog: string[], theme?: string, isFinale: boolean = false) {
    const contextPrompt = contextLog.length > 0
        ? `Here is what has happened so far:\n${contextLog.join('\n')}\n\nBased on the player's last choice, generate the next immediate result.`
        : `Generate the very first opening scene for a ${theme || 'dark fantasy'} interactive text adventure.`;

    let systemPrompt = `You are an interactive fiction engine that strictly outputs JSON. 
You are given a context of the story so far.
You MUST generate an array containing EXACTLY 3 distinct potential branching narratives representing what happens next.
Because the player's choices impact their stats, you must provide a "health_delta" (e.g., -10 if they get hurt, +5 if they heal, 0 if nothing happens) and a "score_delta" (e.g. +50 for finding an item, +10 for progressing safely).

EACH of the 3 branches must strictly follow this JSON schema structure:
{
  "title": "Short title",
  "narrative_text": "Atmospheric description of what happens",
  "available_choices": ["Choice A", "Choice B"],
  "body": "Required string by the engine",
  "health_delta": 0,
  "score_delta": 10
}

Return ONLY a JSON array containing the 3 objects. Do not include markdown blocks.`;

    if (isFinale) {
        systemPrompt += `\n\nCRITICAL STATE: The player has collected enough score points and achieved VICTORY! This is the ultimate, epic conclusion to their adventure! You MUST set "available_choices" to an empty array [] because the game is completely over.`;
    }

    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: "gpt-4o-mini", // fast and cheap for generation
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: contextPrompt
                }
            ],
            temperature: 0.8
        })
    });

    const body = await completion.json();
    const content = body.choices[0].message.content;

    try {
        // Parse out any markdown if the LLM hallucinated codeblocks despite instructions
        const cleaned = content.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
        }
        return [];
    } catch (err) {
        console.error("Failed to parse LLM generation:", err);
        console.error("Raw content was:", content);
        return [];
    }
}

async function validateAndSaveBranch(branches: any[], contentTypeId: number) {
    console.log("\n🛡️ Validating the 3 branches via WordClaw dry_run...");

    for (let i = 0; i < branches.length; i++) {
        const branch = branches[i];

        // Simulate the save
        const dryRunRes = await fetch(`${WORDCLAW_API_URL}/content-items?mode=dry_run`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': WORDCLAW_API_KEY!
            },
            body: JSON.stringify({
                contentTypeId,
                data: branch,
                status: 'published'
            })
        });

        const result = await dryRunRes.json();

        if (dryRunRes.ok) {
            console.log(`✅ Branch ${i + 1} passed WordClaw schema validation! Select!`);

            // We found a valid branch. Now permanently save it (no dry_run).
            const saveRes = await fetch(`${WORDCLAW_API_URL}/content-items`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': WORDCLAW_API_KEY!
                },
                body: JSON.stringify({
                    contentTypeId,
                    data: branch,
                    status: 'published'
                })
            });

            if (saveRes.ok) {
                console.log(`💾 Branch ${i + 1} permanently saved to WordClaw DB.`);
                return branch;
            }
        } else {
            console.log(`❌ Branch ${i + 1} failed WordClaw validation. Error: ${result.error}. Details: ${result.context?.details || result.remediation}`);
        }
    }

    return null; // None passed validation
}

// In-memory sessions (for demo simplicity)
const sessions: Record<string, {
    health: number;
    score: number;
    theme: string;
    history: string[];
    log: any[];
}> = {};

app.get('/api/themes', async (req, res) => {
    try {
        const completion = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: `You are an interactive fiction engine that strictly outputs JSON. 
Generate exactly 3 random, completely different, and highly engaging story themes/vibes for a text adventure. 
Example themes: "A suspenseful sci-fi thriller on Mars", "A hilarious romp through a magical bakery", "A gritty cyberpunk detective mystery".

Return a JSON array containing EXACTLY 3 objects with these properties:
{
  "title": "Short catchy title of the theme",
  "description": "A one sentence hook about the vibe"
}

Return ONLY the JSON array. Do not include markdown blocks.`
                    }
                ],
                temperature: 0.9
            })
        });

        const body = await completion.json() as any;
        const content = body.choices[0].message.content;
        const cleaned = content.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned);

        res.json({ themes: parsed });
    } catch (err) {
        console.error("Failed to generate themes:", err);
        res.status(500).json({ error: "Failed to generate story themes." });
    }
});

app.post('/api/start', async (req, res) => {
    const { theme } = req.body;
    const sessionId = Math.random().toString(36).substring(7);
    sessions[sessionId] = {
        health: 100,
        score: 0,
        theme: theme || 'dark fantasy',
        history: [],
        log: []
    };

    const branches = await generateBranches([], sessions[sessionId].theme);
    const validBranch = await validateAndSaveBranch(branches, storyNodeContentTypeId!);

    if (!validBranch) {
        return res.status(500).json({ error: "Failed to generate valid opening scene." });
    }

    sessions[sessionId].history.push(`Scene: ${validBranch.narrative_text}`);
    sessions[sessionId].log.push(validBranch);

    res.json({
        sessionId,
        node: validBranch,
        health: sessions[sessionId].health,
        score: sessions[sessionId].score
    });
});

app.post('/api/choose', async (req, res) => {
    const { sessionId, choice } = req.body;
    const session = sessions[sessionId];

    if (!session) {
        return res.status(404).json({ error: "Session not found." });
    }

    session.history.push(`Player Action: ${choice}`);

    // Check if dead
    if (session.health <= 0) {
        return res.json({ death: true, reason: "You succumbed to your injuries." });
    }

    const isFinale = choice === "Claim your destiny to conclude the story!";
    const branches = await generateBranches(session.history, session.theme, isFinale);
    const validBranch = await validateAndSaveBranch(branches, storyNodeContentTypeId!);

    if (!validBranch) {
        return res.status(500).json({ error: "Failed to generate valid continuation." });
    }

    session.health += (validBranch.health_delta || 0);
    session.score += (validBranch.score_delta || 0);

    // Bounds check
    if (session.health > 100) session.health = 100;

    // Inject winning transition if target score achieved
    if (session.score >= 100 && validBranch.available_choices && validBranch.available_choices.length > 0) {
        validBranch.available_choices = ["Claim your destiny to conclude the story!"];
    }

    session.history.push(`Scene: ${validBranch.narrative_text}`);
    session.log.push(validBranch);

    if (session.health <= 0) {
        res.json({
            node: validBranch,
            health: session.health,
            score: session.score,
            death: true
        });
    } else {
        res.json({
            node: validBranch,
            health: session.health,
            score: session.score,
            death: false
        });
    }
});

app.post('/api/publish', async (req, res) => {
    const { sessionId, author } = req.body;
    const session = sessions[sessionId];

    if (!session) {
        return res.status(404).json({ error: "Session not found." });
    }

    const full_text = session.log.map(n => `**${n.title}**\n${n.narrative_text}`).join('\n\n--- \n\n');

    const payload = {
        title: `The Tale of ${author || "Anonymous"}`,
        full_text,
        final_score: session.score,
        author: author || "Anonymous",
        body: "Generated published story."
    };

    const saveRes = await fetch(`${WORDCLAW_API_URL}/content-items`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': WORDCLAW_API_KEY!
        },
        body: JSON.stringify({
            contentTypeId: publishedStoryContentTypeId,
            data: payload,
            status: 'published'
        })
    });

    if (saveRes.ok) {
        res.json({ success: true, message: "Story published to WordClaw successfully!" });
    } else {
        const err = await saveRes.json();
        console.error("Failed to publish story:", err);
        res.status(500).json({ error: "Failed to publish story to WordClaw." });
    }
});

const PORT = 8080;
setupWordclawSchemas().then(() => {
    app.listen(PORT, () => {
        console.log(`🎮 Game Engine Server running on http://localhost:${PORT}`);
    });
});
