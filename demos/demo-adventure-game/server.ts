import express from 'express';
import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';

import { db } from '../../src/db/index.js';
import { domains } from '../../src/db/schema.js';
import { createApiKey } from '../../src/services/api-key.js';

// Load environment variables
dotenv.config({ path: '../../.env' });
dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
let WORDCLAW_API_KEY = process.env.WORDCLAW_API_KEY;
// Connect to the local unauthenticated docker environment or your deployed wordclaw api base url
const WORDCLAW_API_URL = process.env.WORDCLAW_API_URL || 'http://localhost:4000/api';

if (!OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY is not set in .env");
    process.exit(1);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let storyNodeContentTypeId: number | null = null;
let publishedStoryContentTypeId: number | null = null;
let gameSessionContentTypeId: number | null = null;
let themePackContentTypeId: number | null = null;
let characterClassContentTypeId: number | null = null;

async function ensureWordClawApiKey() {
    if (WORDCLAW_API_KEY) {
        return WORDCLAW_API_KEY;
    }

    console.log('🔐 WORDCLAW_API_KEY not provided. Bootstrapping a local demo domain and API key...');

    let [domain] = await db.insert(domains).values({
        name: 'Adventure Game Demo',
        hostname: 'adventure-game.demo.local'
    }).onConflictDoNothing().returning();

    if (!domain) {
        [domain] = await db.select().from(domains).where(eq(domains.hostname, 'adventure-game.demo.local')).limit(1);
    }

    const { plaintext } = await createApiKey({
        domainId: domain.id,
        name: 'Adventure Game Demo Key',
        scopes: ['content:read', 'content:write']
    });

    WORDCLAW_API_KEY = plaintext;
    console.log('✅ Adventure Game demo key created for local use.');
    return WORDCLAW_API_KEY;
}

async function preflightWordClaw() {
    const deploymentStatusUrl = WORDCLAW_API_URL.endsWith('/api')
        ? `${WORDCLAW_API_URL}/deployment-status`
        : `${WORDCLAW_API_URL}/api/deployment-status`;

    try {
        const response = await fetch(deploymentStatusUrl);
        if (!response.ok) {
            console.warn(`⚠️ Deployment preflight returned ${response.status}. Continuing with direct demo bootstrap.`);
            return;
        }

        const payload = await response.json() as any;
        const domainCount = payload?.data?.checks?.bootstrap?.domainCount ?? payload?.data?.domainCount ?? 'unknown';
        const embeddingsStatus = payload?.data?.checks?.embeddings?.status ?? 'unknown';
        console.log(`🔎 WordClaw preflight: domainCount=${domainCount}, embeddings=${embeddingsStatus}`);
    } catch (error) {
        console.warn(`⚠️ Deployment preflight failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

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
        // ---- Adventure Theme Pack ----
        const existingTheme = types.find(t => t.slug === 'adventure-theme-pack');
        if (existingTheme) {
            themePackContentTypeId = existingTheme.id;
            console.log(`✅ ThemePack Schema found (ID: ${themePackContentTypeId})`);
        } else {
            console.log("📦 Creating new ThemePack ContentType...");
            const themeDef = JSON.parse(fs.readFileSync('./theme-pack-schema.json', 'utf-8'));
            const createThemeRes = await fetch(`${WORDCLAW_API_URL}/content-types`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': WORDCLAW_API_KEY! },
                body: JSON.stringify({
                    name: 'Adventure Theme Pack',
                    slug: 'adventure-theme-pack',
                    description: 'Curated world themes for the adventure game.',
                    schema: themeDef
                })
            });
            if (createThemeRes.ok) {
                const created = await createThemeRes.json();
                themePackContentTypeId = created.data.id;
                console.log(`✅ ThemePack Schema created (ID: ${themePackContentTypeId})`);
            } else {
                console.error("❌ Failed to create ThemePack Schema:", await createThemeRes.json());
            }
        }

        // ---- Adventure Character Class ----
        const existingClass = types.find(t => t.slug === 'adventure-character-class');
        if (existingClass) {
            characterClassContentTypeId = existingClass.id;
            console.log(`✅ CharacterClass Schema found (ID: ${characterClassContentTypeId})`);
        } else {
            console.log("📦 Creating new CharacterClass ContentType...");
            const classDef = JSON.parse(fs.readFileSync('./character-class-schema.json', 'utf-8'));
            const createClassRes = await fetch(`${WORDCLAW_API_URL}/content-types`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': WORDCLAW_API_KEY! },
                body: JSON.stringify({
                    name: 'Adventure Character Class',
                    slug: 'adventure-character-class',
                    description: 'Playable character classes for the adventure game.',
                    schema: classDef
                })
            });
            if (createClassRes.ok) {
                const created = await createClassRes.json();
                characterClassContentTypeId = created.data.id;
                console.log(`✅ CharacterClass Schema created (ID: ${characterClassContentTypeId})`);
            } else {
                console.error("❌ Failed to create CharacterClass Schema:", await createClassRes.json());
            }
        }
    } else {
        console.error("❌ Failed to fetch content types", await snRes.json());
        process.exit(1);
    }
}

// ---- Seed initial CMS data if content types are empty ----
async function seedCmsData() {
    // Seed theme packs
    if (themePackContentTypeId) {
        const existingThemes = await fetch(
            `${WORDCLAW_API_URL}/content-items?contentTypeId=${themePackContentTypeId}&limit=1`,
            { headers: { 'x-api-key': WORDCLAW_API_KEY! } }
        );
        const themesData = await existingThemes.json() as any;
        if (!themesData.data || themesData.data.length === 0) {
            console.log("🌱 Seeding initial theme packs...");
            const seedThemes = [
                { title: "Haunted Steampunk Bayou", description: "Mist-choked swamps where clockwork gators lurk beneath rusted iron bridges.", genre_tags: ["steampunk", "horror", "swamp"], difficulty_modifier: 1.2, lore_context: "In the fog-draped Bayou of Meridian, steam-powered contraptions and spectral apparitions coexist. The locals whisper of a clockwork curse that animates the dead.", enabled: true },
                { title: "Neon Cyberpunk Undercity", description: "Hack your way through corporate firewalls in the rain-slicked streets below the megacorps.", genre_tags: ["cyberpunk", "noir", "tech"], difficulty_modifier: 1.0, lore_context: "Beneath the towering arcologies of Neo-Shinjuku lies the Undercity — a lawless maze of black-market hackers, rogue AIs, and neon-lit ramen bars.", enabled: true },
                { title: "Whimsical Enchanted Forest", description: "A magical woodland where talking animals guard ancient secrets and mischievous fae play tricks.", genre_tags: ["fantasy", "whimsical", "nature"], difficulty_modifier: 0.8, lore_context: "The Everbloom Forest is alive with magic. Ancient oaks whisper prophecies, mushroom circles are portals to the Fae Court, and every creature has a story to tell.", enabled: true },
                { title: "Post-Apocalyptic Wasteland", description: "Survive the irradiated desert where water is currency and mutant beasts roam the ruins.", genre_tags: ["post-apocalyptic", "survival", "desert"], difficulty_modifier: 1.5, lore_context: "The Great Collapse left the world a scorched husk. Scattered settlements trade in purified water while nomad clans war over the last functioning tech from the Old World.", enabled: true },
                { title: "Cosmic Horror Deep Space", description: "Your research vessel drifts into uncharted space where reality itself begins to unravel.", genre_tags: ["sci-fi", "horror", "space"], difficulty_modifier: 1.3, lore_context: "The research vessel ISS Prometheus ventured beyond the Kuiper Belt and found something that defies physics — a living void that whispers in dead languages.", enabled: true }
            ];
            for (const theme of seedThemes) {
                await fetch(`${WORDCLAW_API_URL}/content-items`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-api-key': WORDCLAW_API_KEY! },
                    body: JSON.stringify({ contentTypeId: themePackContentTypeId, data: theme, status: 'published' })
                });
            }
            console.log(`✅ Seeded ${seedThemes.length} theme packs`);
        }
    }

    // Seed character classes
    if (characterClassContentTypeId) {
        const existingClasses = await fetch(
            `${WORDCLAW_API_URL}/content-items?contentTypeId=${characterClassContentTypeId}&limit=1`,
            { headers: { 'x-api-key': WORDCLAW_API_KEY! } }
        );
        const classesData = await existingClasses.json() as any;
        if (!classesData.data || classesData.data.length === 0) {
            console.log("🌱 Seeding initial character classes...");
            const seedClasses = [
                { name: "Warrior", description: "A battle-hardened fighter who excels in close combat.", icon_emoji: "⚔️", ability_description: "Powerful melee attacks and defensive stances.", visual_archetype: "Muscular figure in heavy plate armor with a greatsword", dc_bonus_categories: ["combat", "strength", "intimidation"], enabled: true },
                { name: "Spellcaster", description: "A wielder of arcane forces who bends reality to their will.", icon_emoji: "🔮", ability_description: "Cast devastating spells and uncover magical secrets.", visual_archetype: "Robed figure with glowing staff and arcane runes", dc_bonus_categories: ["magic", "knowledge", "arcana"], enabled: true },
                { name: "Cyber-Hacker", description: "A tech genius who can crack any system and weaponize data.", icon_emoji: "💻", ability_description: "Hack systems, deploy tech gadgets, and manipulate digital environments.", visual_archetype: "Sleek figure with cybernetic implants and holographic displays", dc_bonus_categories: ["tech", "hacking", "electronics"], enabled: true },
                { name: "Scoundrel", description: "A cunning rogue who thrives in shadows and deception.", icon_emoji: "🗡️", ability_description: "Stealth, lockpicking, and silver-tongued persuasion.", visual_archetype: "Hooded figure in dark leather with daggers and a sly grin", dc_bonus_categories: ["stealth", "deception", "lockpicking"], enabled: true },
                { name: "Ranger", description: "A wilderness expert who commands nature and tracks any prey.", icon_emoji: "🏹", ability_description: "Expert tracker, animal companion, and deadly archer.", visual_archetype: "Cloaked figure with a longbow, animal companion, and forest camouflage", dc_bonus_categories: ["nature", "survival", "tracking"], enabled: true }
            ];
            for (const cls of seedClasses) {
                await fetch(`${WORDCLAW_API_URL}/content-items`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-api-key': WORDCLAW_API_KEY! },
                    body: JSON.stringify({ contentTypeId: characterClassContentTypeId, data: cls, status: 'published' })
                });
            }
            console.log(`✅ Seeded ${seedClasses.length} character classes`);
        }
    }
}

// Interacting with the OpenAI API
async function generateBranches(
    contextLog: string[],
    theme?: string,
    isFinale: boolean = false,
    characterClass?: string,
    quirk?: string,
    inventory?: string[]
) {
    let contextPrompt = contextLog.length > 0
        ? `Here is what has happened so far:\n${contextLog.join('\n')}\n\nBased on the player's last choice, generate the next immediate result.`
        : `Generate the very first opening scene for a ${theme || 'dark fantasy'} interactive text adventure.`;

    // Inject character context so the LLM knows the actual class, quirk, and inventory
    if (characterClass || quirk || inventory) {
        contextPrompt += `\n\nPLAYER CHARACTER:\n- Class: ${characterClass || 'Adventurer'}\n- Quirk: ${quirk || 'None'}\n- Current Inventory: ${inventory && inventory.length > 0 ? inventory.join(', ') : 'Empty'}`;
    }

    let systemPrompt = `You are an interactive fiction engine that strictly outputs JSON. 
You are given a context of the story so far, including the player's character class, their quirk, and their current inventory.
You MUST generate an array containing EXACTLY 3 distinct potential branching narratives representing what happens next.
Because the player's choices impact their stats, you must provide a "health_delta" (e.g., -10 if they get hurt, +5 if they heal, 0 if nothing happens) and a "score_delta" (e.g. +50 for finding an item, +10 for progressing safely).
The "inventory_changes" field MUST be an array of strings representing items gained or lost in this specific narrative beat (e.g. ["+Rusty Key", "-Gold Coin"]). If nothing changes, return an empty array []. TRY to include an inventory item every 2-3 scenes to keep the inventory alive.

EACH of the 3 branches MUST provide EXACTLY 3 available_choices following this pattern:
1. A RISKY choice with is_risky: true and a difficulty between 8-18 (a daring, bold action requiring a dice roll)
2. A SAFE choice with is_risky: false (a cautious, sensible approach)
3. A CLASS/QUIRK-FLAVORED choice with is_risky: false (an action uniquely suited to the player's SPECIFIC character class or quirk — reference their actual class abilities in the text)

IMPORTANT: The player's class is "${characterClass || 'Adventurer'}". The third choice MUST reference this specific class's abilities. Do NOT reference other classes.
IMPORTANT: Do NOT include meta-labels like "(bold action)", "(safe approach)", or "(class-flavored)" in the choice text. Write natural, immersive choice descriptions only.

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
    { "text": "Charge headlong into the fray", "is_risky": true, "difficulty": 12 },
    { "text": "Carefully observe before acting", "is_risky": false, "difficulty": 0 },
    { "text": "Cast a revealing spell to uncover the truth", "is_risky": false, "difficulty": 0 }
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

    const body = await completion.json() as any;
    if (!body.choices || !body.choices[0]) {
        console.error("OpenAI API error in generateBranches:", JSON.stringify(body));
        return [];
    }
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
    heroImageBase64?: string | null;
    characterVisualDesc?: string | null;
    characterProfile?: CharacterProfile | null;
    sceneImageUrl?: string | null;
    finaleImageUrl?: string | null;
    achievements?: string[];
}> = {};

// Structured character profile for image consistency
interface CharacterProfile {
    characterId: string;
    identityAnchors: string;
    wardrobeAnchors: string;
    styleAnchors: string;
    invarianceRules: string;
    negativeConstraints: string;
}

// Generate a structured character profile for consistent image generation
async function generateCharacterVisualDesc(characterClass: string, quirk: string, theme: string): Promise<{ desc: string, profile: CharacterProfile }> {
    try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{
                    role: "system",
                    content: `You are a character designer for AI image generation. Generate a STRUCTURED character profile as a JSON object with these exact fields:

{
  "identityAnchors": "same person in every image, [gender], [age range], [face shape], [cheekbone structure], [nose shape], [eye shape and color], [eyebrow style], [skin tone with texture detail], [hair length/style/color and parting], [expression type]",
  "wardrobeAnchors": "[primary garment with material and color], [secondary garment], [accessories - be specific], [footwear if relevant]",
  "styleAnchors": "digital fantasy concept art, painterly realism, cinematic lighting, natural skin texture, accurate facial proportions, consistent facial geometry, realistic fabric texture, high-detail fantasy illustration"
}

Make the identity anchors EXTREMELY specific — exact eye color, exact hair description, exact skin tone, distinct facial features. The wardrobe should suit a ${characterClass} class hero with a ${quirk} personality in a ${theme} setting. Include one distinctive visual feature (scar, tattoo, unique accessory, magical marking).

Return ONLY the JSON object, no markdown.`
                }, {
                    role: "user",
                    content: `Create a character profile for: Class: ${characterClass}, Personality: ${quirk}, Setting: ${theme}`
                }],
                temperature: 0.7
            })
        });
        const body = await res.json() as any;
        if (!body.choices || !body.choices[0]) {
            console.error("OpenAI API error in generateCharacterVisualDesc:", JSON.stringify(body));
            const fallbackDesc = `A ${quirk} ${characterClass}`;
            return {
                desc: fallbackDesc,
                profile: {
                    characterId: 'HERO-FALLBACK',
                    identityAnchors: `same person in every image, fantasy ${characterClass}`,
                    wardrobeAnchors: `typical ${characterClass} attire`,
                    styleAnchors: 'digital fantasy concept art, painterly realism, cinematic lighting',
                    invarianceRules: 'keep the exact same face, same age, same hair, same outfit',
                    negativeConstraints: 'no identity drift, no costume changes unless specified'
                }
            };
        }

        const content = body.choices[0].message.content.trim();
        const cleaned = content.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned);

        const profile: CharacterProfile = {
            characterId: `HERO-${Date.now().toString(36).toUpperCase()}`,
            identityAnchors: parsed.identityAnchors || `same person in every image, fantasy ${characterClass}`,
            wardrobeAnchors: parsed.wardrobeAnchors || `typical ${characterClass} attire`,
            styleAnchors: parsed.styleAnchors || 'digital fantasy concept art, painterly realism, cinematic lighting, consistent facial geometry',
            invarianceRules: 'keep the exact same face, same age, same hair color and hairstyle, same eyebrow shape, same skin tone, same body proportions, same wardrobe unless explicitly changed, same overall visual identity',
            negativeConstraints: 'do not change identity, no different face, no different hairstyle, no extra accessories unless specified, no beauty filter skin, no cartoon stylization, no warped hands, no distorted eyes, no identity drift'
        };

        // Also create a flat description string for backward compatibility
        const desc = `${profile.identityAnchors}. ${profile.wardrobeAnchors}`;

        console.log(`🎨 Character profile generated:`);
        console.log(`   ID: ${profile.characterId}`);
        console.log(`   Identity: ${profile.identityAnchors}`);
        console.log(`   Wardrobe: ${profile.wardrobeAnchors}`);

        return { desc, profile };
    } catch (e) {
        console.error("Failed to generate character profile", e);
        const fallbackDesc = `A ${quirk} ${characterClass}`;
        return {
            desc: fallbackDesc,
            profile: {
                characterId: 'HERO-FALLBACK',
                identityAnchors: `same person in every image, fantasy ${characterClass}`,
                wardrobeAnchors: `typical ${characterClass} attire`,
                styleAnchors: 'digital fantasy concept art, painterly realism, cinematic lighting',
                invarianceRules: 'keep the exact same face, same age, same hair, same outfit',
                negativeConstraints: 'no identity drift, no costume changes unless specified'
            }
        };
    }
}

// Build an image prompt using the structured character profile
// Separates CONSTANT identity from PER-SCENE variables
function buildImagePrompt(profile: CharacterProfile, scene: {
    pose?: string;
    action?: string;
    setting?: string;
    lighting?: string;
    camera?: string;
    mood?: string;
}): string {
    const parts = [
        // CONSTANT — Character Identity (never changes)
        `[CHARACTER ID: ${profile.characterId}]`,
        `[IDENTITY ANCHORS]: ${profile.identityAnchors}`,
        `[WARDROBE ANCHORS]: ${profile.wardrobeAnchors}`,
        `[STYLE ANCHORS]: ${profile.styleAnchors}`,

        // PER-SCENE — These change every image
        scene.pose ? `[POSE / ACTION]: ${scene.pose}` : '',
        scene.action ? `[SCENE ACTION]: ${scene.action}` : '',
        scene.camera ? `[CAMERA]: ${scene.camera}` : '[CAMERA]: Medium shot, eye-level',
        scene.lighting ? `[LIGHTING]: ${scene.lighting}` : '[LIGHTING]: Dramatic cinematic lighting',
        scene.setting ? `[SCENE]: ${scene.setting}` : '',
        scene.mood ? `[MOOD]: ${scene.mood}` : '',

        // CONSTANT — Consistency Rules (never changes)
        `[INVARIANCE RULES]: ${profile.invarianceRules}`,
        `[NEGATIVE CONSTRAINTS]: ${profile.negativeConstraints}`
    ];

    return parts.filter(p => p.length > 0).join('\n');
}

// Download an image URL and return as raw base64 string (no data URI prefix)
async function downloadImageAsBase64(imageUrl: string): Promise<string | null> {
    try {
        // If it's a local file path, read from disk
        if (imageUrl.startsWith('/generated/')) {
            const filePath = path.join(__dirname, 'public', imageUrl);
            const buffer = fs.readFileSync(filePath);
            return buffer.toString('base64');
        }
        const res = await fetch(imageUrl);
        if (!res.ok) return null;
        const buffer = await res.arrayBuffer();
        return Buffer.from(buffer).toString('base64');
    } catch (e) {
        console.error("Failed to download image as base64", e);
        return null;
    }
}

// Ensure the generated images directory exists (local cache fallback)
const generatedDir = path.join(__dirname, 'public', 'generated');
if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
}

// Upload image bytes to WordClaw asset storage via REST API
// Returns the proxied asset content URL or null on failure
async function uploadToAssetStorage(b64Data: string, filename: string, sessionId: string): Promise<string | null> {
    try {
        const res = await fetch(`${WORDCLAW_API_URL}/assets`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': WORDCLAW_API_KEY!
            },
            body: JSON.stringify({
                filename: `${sessionId}/${filename}`,
                mimeType: 'image/webp',
                contentBase64: b64Data,
                accessMode: 'public',
                metadata: { source: 'adventure-game', generator: 'gpt-image-1', sessionId }
            })
        });

        if (res.ok) {
            const body = await res.json() as any;
            const assetId = body.data?.id;
            if (assetId) {
                const assetUrl = `/wc-assets/${assetId}/content`;
                console.log(`📦 Asset uploaded to WordClaw: ID ${assetId} → ${assetUrl} (session: ${sessionId})`);
                return assetUrl;
            }
        }

        const errorText = await res.text();
        console.error('Asset upload to WordClaw failed:', errorText);
        return null;
    } catch (e) {
        console.error('Failed to upload asset to WordClaw:', e);
        return null;
    }
}

// Generate an image using gpt-image-1
// Uploads to WordClaw asset storage with local disk fallback
// Images are organized into session-specific folders
async function generateSceneImage(prompt: string, sessionId: string): Promise<string | null> {
    try {
        const body: any = {
            model: "gpt-image-1",
            prompt: prompt,
            n: 1,
            size: "1024x1024",
            output_format: "webp"
        };

        const res = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify(body)
        });

        if (res.ok) {
            const imgBody = await res.json() as any;
            const b64Data = imgBody.data[0].b64_json;

            if (!b64Data) {
                console.error("No b64_json in response", JSON.stringify(imgBody).substring(0, 200));
                return null;
            }

            // Save to local disk in session-specific folder as cache/fallback
            const sessionDir = path.join(generatedDir, sessionId);
            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
            }
            const filename = `img_${crypto.randomBytes(8).toString('hex')}.webp`;
            const filePath = path.join(sessionDir, filename);
            fs.writeFileSync(filePath, Buffer.from(b64Data, 'base64'));
            const localUrl = `/generated/${sessionId}/${filename}`;
            console.log(`🖼️  Image saved locally: ${localUrl}`);

            // Upload to WordClaw asset storage (with session in metadata)
            const assetUrl = await uploadToAssetStorage(b64Data, filename, sessionId);
            if (assetUrl) {
                return assetUrl;
            }

            // Fallback to local URL if asset upload fails
            console.log(`⚠️  Using local fallback: ${localUrl}`);
            return localUrl;
        } else {
            const errorText = await res.text();
            console.error("Image generation failed:", errorText);
            return null;
        }
    } catch (e) {
        console.error("Failed to generate image", e);
        return null;
    }
}

// Proxy route: serve WordClaw asset content through the game server
// This avoids CORS issues when the browser loads images from WordClaw
app.get('/wc-assets/:id/content', async (req, res) => {
    try {
        const assetId = req.params.id;
        const assetRes = await fetch(`${WORDCLAW_API_URL}/assets/${assetId}/content`, {
            headers: { 'x-api-key': WORDCLAW_API_KEY! }
        });

        if (assetRes.ok) {
            const contentType = assetRes.headers.get('content-type') || 'image/webp';
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'public, max-age=3600');
            const buffer = Buffer.from(await assetRes.arrayBuffer());
            res.send(buffer);
        } else {
            res.status(assetRes.status).json({ error: 'Asset not found' });
        }
    } catch (e) {
        console.error('Failed to proxy asset content:', e);
        res.status(500).json({ error: 'Failed to fetch asset' });
    }
});

// ---- CMS-Managed Themes (RFC 0026) ----
app.get('/api/themes', async (req, res) => {
    try {
        // Fetch published, enabled theme packs from WordClaw CMS
        const fetchRes = await fetch(
            `${WORDCLAW_API_URL}/content-items?contentTypeId=${themePackContentTypeId}&draft=false&fieldName=enabled&fieldOp=eq&fieldValue=true&limit=50`,
            { headers: { 'x-api-key': WORDCLAW_API_KEY! } }
        );
        const data = await fetchRes.json() as any;
        if (!fetchRes.ok) {
            console.error("Failed to fetch themes from CMS:", data);
            return res.status(500).json({ error: "Failed to fetch themes." });
        }

        const themes = (data.data || []).map((item: any) => {
            const d = typeof item.data === 'string' ? JSON.parse(item.data) : item.data;
            return {
                title: d.title,
                description: d.description,
                genre_tags: d.genre_tags || [],
                difficulty_modifier: d.difficulty_modifier || 1.0,
                lore_context: d.lore_context || ''
            };
        });

        res.json({ themes });
    } catch (err) {
        console.error("Failed to fetch themes:", err);
        res.status(500).json({ error: "Failed to fetch story themes." });
    }
});

// ---- CMS-Managed Character Classes (RFC 0026) ----
app.get('/api/classes', async (req, res) => {
    try {
        const fetchRes = await fetch(
            `${WORDCLAW_API_URL}/content-items?contentTypeId=${characterClassContentTypeId}&draft=false&fieldName=enabled&fieldOp=eq&fieldValue=true&limit=50`,
            { headers: { 'x-api-key': WORDCLAW_API_KEY! } }
        );
        const data = await fetchRes.json() as any;
        if (!fetchRes.ok) {
            console.error("Failed to fetch classes from CMS:", data);
            return res.status(500).json({ error: "Failed to fetch character classes." });
        }

        const classes = (data.data || []).map((item: any) => {
            const d = typeof item.data === 'string' ? JSON.parse(item.data) : item.data;
            return {
                name: d.name,
                description: d.description,
                icon_emoji: d.icon_emoji || '',
                ability_description: d.ability_description || '',
                visual_archetype: d.visual_archetype || '',
                dc_bonus_categories: d.dc_bonus_categories || []
            };
        });

        res.json({ classes });
    } catch (err) {
        console.error("Failed to fetch classes:", err);
        res.status(500).json({ error: "Failed to fetch character classes." });
    }
});

// ---- Leaderboard (RFC 0026 Phase 3) ----
app.get('/api/leaderboard', async (req, res) => {
    try {
        // Fetch published stories sorted by final_score descending
        const fetchRes = await fetch(
            `${WORDCLAW_API_URL}/content-items?contentTypeId=${publishedStoryContentTypeId}&draft=false&sortBy=final_score&sortDir=desc&limit=25`,
            { headers: { 'x-api-key': WORDCLAW_API_KEY! } }
        );
        const data = await fetchRes.json() as any;
        if (!fetchRes.ok) {
            console.error("Failed to fetch leaderboard:", data);
            return res.status(500).json({ error: "Failed to fetch leaderboard." });
        }

        const entries = (data.data || []).map((item: any, index: number) => {
            const d = typeof item.data === 'string' ? JSON.parse(item.data) : item.data;
            return {
                rank: index + 1,
                player_name: d.author || 'Anonymous',
                score: d.final_score || 0,
                character_class: d.character_class || 'Unknown',
                cause_of_death: d.cause_of_death || '',
                hero_image_url: d.hero_image_url || null,
                achievements: d.achievements || [],
                played_at: item.createdAt
            };
        });

        res.json({ entries });
    } catch (err) {
        console.error("Failed to fetch leaderboard:", err);
        res.status(500).json({ error: "Failed to fetch leaderboard." });
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

    const branches = await generateBranches([], sessions[sessionId].theme, false, sessions[sessionId].characterClass, sessions[sessionId].quirk, sessions[sessionId].inventory);
    const validBranch = await validateAndSaveBranch(branches, storyNodeContentTypeId!);

    if (!validBranch) {
        return res.status(500).json({ error: "Failed to generate valid opening scene." });
    }

    // Step 1: Generate structured character profile for consistency
    const session = sessions[sessionId];
    const { desc, profile } = await generateCharacterVisualDesc(
        session.characterClass, session.quirk, session.theme
    );
    session.characterVisualDesc = desc;
    session.characterProfile = profile;

    // Step 2: Generate Hero Portrait using gpt-image-1 + structured template
    let heroImageUrl: string | null = null;
    let sceneImageUrl: string | null = null;

    try {
        const heroPrompt = buildImagePrompt(profile, {
            pose: 'Standing heroically, facing the viewer, confident stance',
            camera: 'Close-up portrait, chest up, slightly low angle',
            lighting: 'Dramatic rim lighting, warm key light on face',
            setting: session.theme,
            mood: 'Majestic, epic, ready for adventure'
        });
        heroImageUrl = await generateSceneImage(heroPrompt, sessionId);

        if (heroImageUrl) {
            session.heroImageUrl = heroImageUrl;

            // Step 3: Download hero portrait as base64 for reference
            session.heroImageBase64 = await downloadImageAsBase64(heroImageUrl);
            console.log(`📸 Hero portrait saved as base64 reference (${session.heroImageBase64 ? 'success' : 'failed'})`);
        }

        // Step 4: Generate scene image with structured character consistency
        const scenePrompt = buildImagePrompt(profile, {
            action: validBranch.narrative_text,
            setting: session.theme,
            camera: 'Wide shot showing character and environment',
            lighting: 'Cinematic, atmospheric, matching the scene mood'
        });
        sceneImageUrl = await generateSceneImage(scenePrompt, sessionId);

        if (sceneImageUrl) {
            session.sceneImageUrl = sceneImageUrl;
            session.scene_images.push(sceneImageUrl);
        }
    } catch (e) {
        console.error("Failed to generate images", e);
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
    const branches = await generateBranches(session.history, session.theme, isFinale, session.characterClass, session.quirk, session.inventory);
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
            const finaleProfile = session.characterProfile;
            const promptOutcome = finaleProfile
                ? buildImagePrompt(finaleProfile, session.health <= 0 ? {
                    pose: 'Fallen, defeated, kneeling or collapsed',
                    setting: session.theme,
                    lighting: 'Dim, melancholic, fading light',
                    mood: 'Tragic defeat, somber, dramatic. Abstract any violence. Keep artwork safe.',
                    camera: 'Wide cinematic shot'
                } : {
                    pose: 'Triumphant, standing tall, arms raised or weapon held high',
                    setting: session.theme,
                    lighting: 'Bright golden light, victorious glow, sunrise or divine rays',
                    mood: 'Glorious victory, triumph, ultimate destiny achieved. Keep artwork safe.',
                    camera: 'Epic wide shot, slightly low angle'
                })
                : (session.health <= 0
                    ? `A dramatic illustration showing the tragic defeat of ${session.characterVisualDesc || `a ${session.quirk} ${session.characterClass}`}. Setting: ${session.theme}. Melancholic, safe artwork.`
                    : `A triumphant illustration of ${session.characterVisualDesc || `a ${session.quirk} ${session.characterClass}`} achieving victory. Setting: ${session.theme}. Heroic, safe artwork.`);

            const achievementPrompt = `Based on the following adventure history, invent exactly 3 creative, short string achievements the player has earned during this run. \nHistory: ${session.history.join('. ')}\nReturn ONLY a raw JSON array of 3 strings. Example: ["Slayer of the Beast", "Master Thief", "Narrow Escape"]`;

            const [finaleImageUrl, achRes] = await Promise.all([
                generateSceneImage(promptOutcome, sessionId),
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

            if (finaleImageUrl) {
                session.finaleImageUrl = finaleImageUrl;
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
        // Generate a scene image for normal progression with character consistency
        try {
            const sceneProfile = session.characterProfile;
            const scenePrompt = sceneProfile
                ? buildImagePrompt(sceneProfile, {
                    action: validBranch.narrative_text,
                    setting: session.theme,
                    camera: 'Wide shot showing character and environment',
                    lighting: 'Cinematic, atmospheric, matching the scene mood'
                })
                : `A highly detailed epic digital painting: "${validBranch.narrative_text}". Hero: ${session.characterVisualDesc || `a ${session.quirk} ${session.characterClass}`}. Setting: ${session.theme}. Style: Immersive fantasy concept art. Keep artwork safe.`;
            sceneImageUrl = await generateSceneImage(scenePrompt, sessionId);

            if (sceneImageUrl) {
                session.scene_images.push(sceneImageUrl);
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
        const fetchRes = await fetch(`${WORDCLAW_API_URL}/content-items?contentTypeId=${publishedStoryContentTypeId}&draft=false&limit=50&sortBy=createdAt&sortDir=desc`, {
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
            status: 'draft'
        })
    });

    if (saveRes.ok) {
        res.json({ success: true, message: "Your tale has been submitted for review! It will appear in the archives once approved." });
    } else {
        const err = await saveRes.json() as any;
        console.error("Failed to publish story:", err);
        res.status(500).json({ error: "Failed to publish story to WordClaw." });
    }
});

const PORT = 8080;
ensureWordClawApiKey().then(async () => {
    await preflightWordClaw();
    await setupWordclawSchemas();
    await seedCmsData();
    app.listen(PORT, () => {
        console.log(`🎮 Game Engine Server running on http://localhost:${PORT}`);
    });
});
