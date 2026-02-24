import { db } from './index.js';
import { supervisors, domains, contentTypes } from './schema.js';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

async function seed() {
    try {
        console.log("Seeding default supervisor...");
        const passwordHash = await bcrypt.hash('password123', 10);

        await db.insert(supervisors).values({
            email: 'admin@wordclaw.local',
            passwordHash
        }).onConflictDoNothing();

        console.log("Seeding default domain...");
        const [domain] = await db.insert(domains).values({
            hostname: 'wordclaw.local',
            name: 'WordClaw Local Dev'
        }).onConflictDoNothing().returning();

        let domainId = domain?.id;

        if (!domainId) {
            const [existing] = await db.select().from(domains).where(eq(domains.hostname, 'wordclaw.local')).limit(1);
            domainId = existing!.id;
        }

        console.log("Seeding default content type...");
        await db.insert(contentTypes).values({
            domainId,
            name: 'Article',
            slug: 'article',
            schema: JSON.stringify({
                type: 'object',
                properties: {
                    title: { type: 'string' },
                    body: { type: 'string' }
                },
                required: ['title', 'body']
            })
        }).onConflictDoNothing();

        console.log("Seed complete!");
        process.exit(0);
    } catch (err) {
        console.error("Seeding failed", err);
        process.exit(1);
    }
}

seed();
