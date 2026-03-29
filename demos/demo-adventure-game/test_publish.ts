import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
import { eq } from 'drizzle-orm';

import { db } from '../../src/db/index.js';
import { domains } from '../../src/db/schema.js';
import { createApiKey } from '../../src/services/api-key.js';

dotenv.config({ path: '../../.env' });
dotenv.config();

let WORDCLAW_API_KEY = process.env.WORDCLAW_API_KEY;
const WORDCLAW_API_URL = process.env.WORDCLAW_API_URL || 'http://localhost:4000/api';

async function ensureWordClawApiKey() {
    if (WORDCLAW_API_KEY) {
        return WORDCLAW_API_KEY;
    }

    let [domain] = await db.insert(domains).values({
        name: 'Adventure Game Demo',
        hostname: 'adventure-game.demo.local'
    }).onConflictDoNothing().returning();

    if (!domain) {
        [domain] = await db.select().from(domains).where(eq(domains.hostname, 'adventure-game.demo.local')).limit(1);
    }

    const { plaintext } = await createApiKey({
        domainId: domain.id,
        name: 'Adventure Game Test Publish Key',
        scopes: ['content:read', 'content:write']
    });

    WORDCLAW_API_KEY = plaintext;
    return WORDCLAW_API_KEY;
}

async function seedMockData() {
    await ensureWordClawApiKey();

    // 1. Get published-story-v3 ContentType ID
    console.log("Fetching schemas...");
    const snRes = await fetch(`${WORDCLAW_API_URL}/content-types?limit=500`, {
        headers: { 'x-api-key': WORDCLAW_API_KEY }
    });
    const data = await snRes.json();
    const existingPublish = data.data.find(t => t.slug === 'published-story-v3');
    if (!existingPublish) {
        console.error("No published-story-v3 schema found!");
        process.exit(1);
    }

    // 2. Publish a mock payload
    console.log("Publishing mock story...");
    const payload = {
        title: "The Tale of the Automation Agent",
        full_text: "The hero journeyed through the realms of DOM and CSS to slay the terrible bug of non-rendering image arrays.",
        final_score: 9001,
        author: "Agent",
        character_class: "Robotic Mage",
        cause_of_death: "Survived the adventure",
        hero_image_url: "https://images.unsplash.com/photo-1542831371-29b0f74f9713?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=60",
        finale_image_url: "https://images.unsplash.com/photo-1518770660439-4636190af475?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=60",
        scene_images: [
            "https://images.unsplash.com/photo-1550745165-9bc0b252726f?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=60",
            "https://images.unsplash.com/photo-1511512578047-dfb367046420?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=60",
            "https://images.unsplash.com/photo-1534447677768-be436bb09401?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=60"
        ],
        inventory: ["Vorpal Sword", "Health Potion x4", "Orb of Knowledge"],
        achievements: ["Slayer of the Backend", "Master of CSS", "Flawless Execution"],
        body: "Mocked from script."
    };

    const saveRes = await fetch(`${WORDCLAW_API_URL}/content-items`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': WORDCLAW_API_KEY
        },
        body: JSON.stringify({
            contentTypeId: existingPublish.id,
            data: payload,
            status: 'published'
        })
    });

    if (saveRes.ok) {
        console.log("Mock injected successfully!");
    } else {
        console.error("Failed to inject", await saveRes.text());
    }
}

seedMockData();
