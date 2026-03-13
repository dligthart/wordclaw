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
let gameSessionContentTypeId: number | null = null;

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

        const existingNode = types.find(t => t.slug === 'story-node-v3');
        if (existingNode) {
            storyNodeContentTypeId = existingNode.id;
            console.log(`✅ StoryNode V3 Schema found (ID: ${storyNodeContentTypeId})`);
        } else {
            console.log("📦 Creating new StoryNode V3 ContentType...");
            const schemaDef = JSON.parse(fs.readFileSync('./schema.json', 'utf-8'));
            const createRes = await fetch(`${WORDCLAW_API_URL}/content-types`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': WORDCLAW_API_KEY!
                },
                body: JSON.stringify({
                    name: 'StoryNode V3',
                    slug: 'story-node-v3',
                    description: 'Interactive fiction nodes with D20 Risky Hooks and Inventory arrays.',
                    schema: schemaDef
                })
            });

            if (createRes.ok) {
                const created = await createRes.json();
                storyNodeContentTypeId = created.data.id;
                console.log(`✅ StoryNode V3 Schema created (ID: ${storyNodeContentTypeId})`);
            } else {
                console.error("❌ Failed to create StoryNode V3 Schema:", await createRes.json());
                process.exit(1);
            }
        }

        const existingPublish = types.find(t => t.slug === 'published-story-v3');
        if (existingPublish) {
            publishedStoryContentTypeId = existingPublish.id;
            console.log(`✅ PublishedStory V3 Schema found (ID: ${publishedStoryContentTypeId})`);
        } else {
            console.log("📦 Creating new PublishedStory V3 ContentType...");
            const publishDef = JSON.parse(fs.readFileSync('./published-schema.json', 'utf-8'));
            const createPubRes = await fetch(`${WORDCLAW_API_URL}/content-types`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': WORDCLAW_API_KEY!
                },
                body: JSON.stringify({
                    name: 'PublishedStory V3',
                    slug: 'published-story-v3',
                    description: 'Completed interactive fiction runs including Roguelike RPG data and Grand Archives enrichment.',
                    schema: publishDef
                })
            });

            if (createPubRes.ok) {
                const created = await createPubRes.json();
                publishedStoryContentTypeId = created.data.id;
                console.log(`✅ PublishedStory V3 Schema created (ID: ${publishedStoryContentTypeId})`);
            } else {
                console.error("❌ Failed to create PublishedStory V3 Schema:", await createPubRes.json());
                process.exit(1);
            }
        }

        const existingSession = types.find(t => t.slug === 'game-session-v3');
        if (existingSession) {
            gameSessionContentTypeId = existingSession.id;
            console.log(`✅ GameSession V3 Schema found (ID: ${gameSessionContentTypeId})`);
        } else {
            console.log("📦 Creating new GameSession V3 ContentType...");
            const sessionDef = JSON.parse(fs.readFileSync('./session-schema.json', 'utf-8'));
            const createSessRes = await fetch(`${WORDCLAW_API_URL}/content-types`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': WORDCLAW_API_KEY!
                },
                body: JSON.stringify({
                    name: 'GameSession V3',
                    slug: 'game-session-v3',
                    description: 'A saved interactive fiction game session with scene history.',
                    schema: sessionDef
                })
            });

            if (createSessRes.ok) {
                const created = await createSessRes.json();
                gameSessionContentTypeId = created.data.id;
                console.log(`✅ GameSession V3 Schema created (ID: ${gameSessionContentTypeId})`);
            } else {
                console.error("❌ Failed to create GameSession V3 Schema:", await createSessRes.json());
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
You are given a context of the story so far, including the player's character class, their quirk, and their current inventory.
You MUST generate an array containing EXACTLY 3 distinct potential branching narratives representing what happens next.
Because the player's choices impact their stats, you must provide a "health_delta" (e.g., -10 if they get hurt, +5 if they heal, 0 if nothing happens) and a "score_delta" (e.g. +50 for finding an item, +10 for progressing safely).
The "inventory_changes" field MUST be an array of strings representing items gained or lost in this specific narrative beat (e.g. ["+Rusty Key", "-Gold Coin"]). If nothing changes, return an empty array []. TRY to include an inventory item every 2-3 scenes to keep the inventory alive.

EACH of the 3 branches MUST provide EXACTLY 3 available_choices following this pattern:
1. A RISKY choice with is_risky: true and a difficulty between 8-18 (a daring, bold action requiring a dice roll)
2. A SAFE choice with is_risky: false (a cautious, sensible approach)
3. A CLASS/QUIRK-FLAVORED choice with is_risky: false (an action uniquely suited to the player's character class or quirk — reference their class or quirk directly in the text)

When setting difficulty values, consider the player's class:
- Warrior: lower DC for combat/strength actions
- Spellcaster: lower DC for magic/knowledge actions
- Cyber-Hacker: lower DC for tech/hacking actions
- Scoundrel: lower DC for stealth/deception actions
- Ranger: lower DC for nature/survival actions

EACH of the 3 branches must strictly follow this JSON schema structure:
{
  "title": "Short title",
  "narrative_text": "Atmospheric description of what happens",
  "available_choices": [
    { "text": "Choice A (bold action)", "is_risky": true, "difficulty": 12 },
    { "text": "Choice B (safe approach)", "is_risky": false, "difficulty": 0 },
    { "text": "Choice C (class-flavored)", "is_risky": false, "difficulty": 0 }
  ],
  "inventory_changes": [],
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
    characterClass: string;
    quirk: string;
    inventory: string[];
    history: string[];
    log: any[];
    scene_images: string[];
    heroImageUrl?: string | null;
    sceneImageUrl?: string | null;
    finaleImageUrl?: string | null;
    achievements?: string[];
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
    const { theme, characterClass, quirk } = req.body;
    const sessionId = Math.random().toString(36).substring(7);
    sessions[sessionId] = {
        health: 100,
        score: 0,
        theme: theme || 'dark fantasy',
        characterClass: characterClass || 'Adventurer',
        quirk: quirk || 'Optimistic',
        inventory: [],
        history: [],
        log: [],
        scene_images: []
    };

    const branches = await generateBranches([], sessions[sessionId].theme);
    const validBranch = await validateAndSaveBranch(branches, storyNodeContentTypeId!);

    if (!validBranch) {
        return res.status(500).json({ error: "Failed to generate valid opening scene." });
    }

    // Generate Hero Portrait and Scene Image in parallel
    let heroImageUrl: string | null = null;
    let sceneImageUrl: string | null = null;

    try {
        const [heroRes, sceneRes] = await Promise.all([
            fetch('https://api.openai.com/v1/images/generations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                },
                body: JSON.stringify({
                    model: "dall-e-3",
                    prompt: `A beautiful, majestic, epic fantasy portrait of a ${sessions[sessionId].quirk} ${sessions[sessionId].characterClass}. The setting and style should be heavily inspired by the following theme: ${sessions[sessionId].theme}. High quality digital art style, highly detailed.`,
                    n: 1,
                    size: "1024x1024"
                })
            }),
            fetch('https://api.openai.com/v1/images/generations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                },
                body: JSON.stringify({
                    model: "dall-e-3",
                    prompt: `A highly detailed, epic fantasy digital painting illustrating the following scene: "${validBranch.narrative_text}". The scene features our hero: a ${sessions[sessionId].quirk} ${sessions[sessionId].characterClass} in the setting: ${sessions[sessionId].theme}. Style: Immersive, dramatic, high fantasy concept art. Keep the artwork entirely safe, abstracting any violence, gore, or sensitive themes to adhere strictly to safety policies.`,
                    n: 1,
                    size: "1024x1024"
                })
            })
        ]);

        if (heroRes.ok) {
            const imgBody = await heroRes.json() as any;
            heroImageUrl = imgBody.data[0].url;
            sessions[sessionId].heroImageUrl = heroImageUrl;
        } else {
            console.error("DALL-E Hero generation failed", await heroRes.text());
        }

        if (sceneRes.ok) {
            const imgBody = await sceneRes.json() as any;
            sceneImageUrl = imgBody.data[0].url;
            sessions[sessionId].sceneImageUrl = sceneImageUrl;
            sessions[sessionId].scene_images.push(sceneImageUrl as string);
        } else {
            console.error("DALL-E Scene generation failed", await sceneRes.text());
        }

    } catch (e) {
        console.error("Failed to generate DALL-E images", e);
    }

    sessions[sessionId].history.push(`Scene: ${validBranch.narrative_text}`);
    sessions[sessionId].log.push(validBranch);

    res.json({
        sessionId,
        node: validBranch,
        health: sessions[sessionId].health,
        score: sessions[sessionId].score,
        inventory: sessions[sessionId].inventory,
        heroImageUrl,
        sceneImageUrl
    });
});

app.post('/api/choose', async (req, res) => {
    const { sessionId, choice, rollEvent } = req.body;
    const session = sessions[sessionId];

    if (!session) {
        return res.status(404).json({ error: "Session not found." });
    }

    let actionLog = choice;
    if (rollEvent) {
        const { result, difficulty } = rollEvent;
        const isSuccess = result >= difficulty;
        actionLog += ` [D20 ROLL: ${result} vs DC ${difficulty} - ${isSuccess ? 'SUCCESS!' : 'CRITICAL FAILURE!'}]`;
    }

    session.history.push(`Player Action: ${actionLog}`);

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

    // Process inventory
    if (validBranch.inventory_changes && Array.isArray(validBranch.inventory_changes)) {
        validBranch.inventory_changes.forEach((change: string) => {
            if (change.startsWith('+')) {
                const item = change.substring(1).trim();
                session.inventory.push(item);
            } else if (change.startsWith('-')) {
                const item = change.substring(1).trim();
                session.inventory = session.inventory.filter(i => i !== item);
            }
        });
    }

    // Bounds check
    if (session.health > 100) session.health = 100;

    // Inject winning transition if target score achieved
    if (session.score >= 100 && validBranch.available_choices && validBranch.available_choices.length > 0) {
        validBranch.available_choices = ["Claim your destiny to conclude the story!"];
    }

    session.history.push(`Scene: ${validBranch.narrative_text}`);
    session.log.push(validBranch);

    let sceneImageUrl = undefined;

    if (session.health <= 0 || isFinale) {
        try {
            const promptOutcome = session.health <= 0
                ? `A dramatic, highly detailed illustration showing the tragic defeat of the hero. They were a ${session.quirk} ${session.characterClass}. Setting: ${session.theme}. Style: Dramatic, melancholic, epic digital art. Keep the artwork entirely safe, abstracting any violence or gore.`
                : `A glorious, triumphant, highly detailed illustration showing the hero achieving their ultimate destiny in victory. They are a ${session.quirk} ${session.characterClass}. Setting: ${session.theme}. Style: Bright, heroic, epic digital art. Keep the artwork entirely safe, avoiding any explicit content.`;

            const achievementPrompt = `Based on the following adventure history, invent exactly 3 creative, short string achievements the player has earned during this run. \nHistory: ${session.history.join('. ')}\nReturn ONLY a raw JSON array of 3 strings. Example: ["Slayer of the Beast", "Master Thief", "Narrow Escape"]`;

            const [imageRes, achRes] = await Promise.all([
                fetch('https://api.openai.com/v1/images/generations', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${OPENAI_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: "dall-e-3",
                        prompt: promptOutcome,
                        n: 1,
                        size: "1024x1024"
                    })
                }),
                fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${OPENAI_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: "gpt-4o-mini",
                        messages: [{ role: "system", content: achievementPrompt }],
                        temperature: 0.9
                    })
                })
            ]);

            if (imageRes.ok) {
                const imgBody = await imageRes.json() as any;
                session.finaleImageUrl = imgBody.data[0].url;
            } else {
                console.error("DALL-E Finale generation failed", await imageRes.text());
            }

            if (achRes.ok) {
                const achBody = await achRes.json() as any;
                const content = achBody.choices[0].message.content;
                const cleaned = content.replace(/```json/g, '').replace(/```/g, '').trim();
                session.achievements = JSON.parse(cleaned);
            } else {
                console.error("GPT Achievements generation failed", await achRes.text());
                session.achievements = ["Participant"];
            }
        } catch (e) {
            console.error("Failed to generate finale data", e);
            session.achievements = ["Participant"];
        }
    }

    if (session.health <= 0) {
        res.json({
            node: validBranch,
            health: session.health,
            score: session.score,
            inventory: session.inventory,
            death: true,
            finaleImageUrl: session.finaleImageUrl,
            achievements: session.achievements
        });
    } else {
        // Generate a scene image for normal progression
        try {
            const imageRes = await fetch('https://api.openai.com/v1/images/generations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                },
                body: JSON.stringify({
                    model: "dall-e-3",
                    prompt: `A highly detailed, epic fantasy digital painting illustrating the following scene: "${validBranch.narrative_text}". The scene features our hero: a ${session.quirk} ${session.characterClass} in the setting: ${session.theme}. Style: Immersive, dramatic, high fantasy concept art. Keep the artwork entirely safe, abstracting any violence, gore, or sensitive themes to adhere strictly to safety policies.`,
                    n: 1,
                    size: "1024x1024"
                })
            });
            if (imageRes.ok) {
                const imgBody = await imageRes.json() as any;
                sceneImageUrl = imgBody.data[0].url;
                session.scene_images.push(sceneImageUrl as string);
            } else {
                console.error("DALL-E Scene generation failed", await imageRes.text());
            }
        } catch (e) {
            console.error("Failed to generate scene image", e);
        }

        session.sceneImageUrl = sceneImageUrl;

        res.json({
            node: validBranch,
            health: session.health,
            score: session.score,
            inventory: session.inventory,
            death: false,
            sceneImageUrl: sceneImageUrl,
            finaleImageUrl: isFinale ? session.finaleImageUrl : undefined,
            achievements: isFinale ? session.achievements : undefined,
            isFinale: isFinale
        });
    }
});

app.post('/api/save', async (req, res) => {
    const { sessionId } = req.body;
    const session = sessions[sessionId];

    if (!session) {
        return res.status(404).json({ error: "Session not found." });
    }

    try {
        const payload = {
            sessionId,
            health: session.health,
            score: session.score,
            theme: session.theme,
            characterClass: session.characterClass,
            quirk: session.quirk,
            inventory: session.inventory,
            history: session.history,
            log: session.log,
            scene_images: session.scene_images,
            heroImageUrl: session.heroImageUrl,
            sceneImageUrl: session.sceneImageUrl,
            finaleImageUrl: session.finaleImageUrl,
            body: `Saved game session: ${sessionId}`
        };

        const saveRes = await fetch(`${WORDCLAW_API_URL}/content-items`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': WORDCLAW_API_KEY!
            },
            body: JSON.stringify({
                contentTypeId: gameSessionContentTypeId,
                data: payload,
                status: 'published'
            })
        });

        if (!saveRes.ok) throw new Error("Failed to save to WordClaw");

        res.json({ success: true, message: "Game progress saved to WordClaw." });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/load', async (req, res) => {
    const { sessionId } = req.body;

    try {
        const fetchRes = await fetch(`${WORDCLAW_API_URL}/content-items?limit=500`, {
            headers: { 'x-api-key': WORDCLAW_API_KEY! }
        });

        if (!fetchRes.ok) throw new Error("Failed to search WordClaw");

        const data = await fetchRes.json() as any;
        const allItems = data.data || [];

        let loadedSession = null;
        for (const item of allItems) {
            if (item.contentTypeId === gameSessionContentTypeId) {
                const parsed = typeof item.data === 'string' ? JSON.parse(item.data) : item.data;
                if (parsed.sessionId === sessionId) {
                    loadedSession = parsed;
                    break;
                }
            }
        }

        if (!loadedSession) return res.status(404).json({ error: "Save file not found." });

        sessions[sessionId] = {
            health: loadedSession.health,
            score: loadedSession.score,
            theme: loadedSession.theme,
            characterClass: loadedSession.characterClass,
            quirk: loadedSession.quirk,
            inventory: loadedSession.inventory || [],
            history: loadedSession.history || [],
            log: loadedSession.log || [],
            scene_images: loadedSession.scene_images || [],
            heroImageUrl: loadedSession.heroImageUrl,
            sceneImageUrl: loadedSession.sceneImageUrl,
            finaleImageUrl: loadedSession.finaleImageUrl
        };

        const lastNode = loadedSession.log[loadedSession.log.length - 1];

        res.json({
            node: lastNode,
            health: sessions[sessionId].health,
            score: sessions[sessionId].score,
            inventory: sessions[sessionId].inventory,
            heroImageUrl: sessions[sessionId].heroImageUrl,
            sceneImageUrl: sessions[sessionId].sceneImageUrl,
            finaleImageUrl: sessions[sessionId].finaleImageUrl,
            message: "Save file restored successfully."
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/stories', async (req, res) => {
    try {
        const fetchRes = await fetch(`${WORDCLAW_API_URL}/content-items?content_type_id=${publishedStoryContentTypeId}&limit=50&sort=-created_at`, {
            headers: {
                'x-api-key': WORDCLAW_API_KEY!
            }
        });

        const data = await fetchRes.json() as any;

        if (!fetchRes.ok) {
            console.error("Failed to fetch stories from WordClaw:", data);
            return res.status(500).json({ error: "Failed to fetch stories from WordClaw" });
        }

        const allItems = data.data || [];

        const filtered = allItems.filter((item: any) => item.contentTypeId === publishedStoryContentTypeId);
        const mapped = filtered.map((item: any) => {
            let parsedData = {};
            try {
                parsedData = typeof item.data === 'string' ? JSON.parse(item.data) : item.data;
            } catch (e) { }
            return {
                ...item,
                data: parsedData
            };
        });

        res.json({ stories: mapped });
    } catch (e) {
        console.error("Error fetching library:", e);
        res.status(500).json({ error: "Internal server error" });
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
        character_class: `${session.quirk} ${session.characterClass}`,
        cause_of_death: session.health <= 0 ? "Succumbed to their injuries" : "Survived the adventure",
        hero_image_url: session.heroImageUrl,
        finale_image_url: session.finaleImageUrl,
        scene_images: session.scene_images,
        inventory: session.inventory,
        achievements: session.achievements || [],
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
        const err = await saveRes.json() as any;
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
