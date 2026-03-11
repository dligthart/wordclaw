import { db } from '../../src/db/index.js';
import { domains, apiKeys, contentTypes, contentItems } from '../../src/db/schema.js';
import { createApiKey } from '../../src/services/api-key.js';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function setupMultiTenantDemo() {
    console.log("=========================================");
    console.log(" Setting up Multi-Tenant Isolation Demo  ");
    console.log("=========================================\n");

    try {
        // 1. Setup Acme Corp
        console.log("Setting up Acme Corp...");
        let [acmeDomain] = await db.insert(domains).values({
            name: "Acme Corp",
            hostname: "acme.multi-tenant.demo"
        }).onConflictDoNothing().returning();

        if (!acmeDomain) {
            [acmeDomain] = await db.select().from(domains).where(eq(domains.name, "Acme Corp")).limit(1);
        }

        const acmeKeyResult = await createApiKey({
            domainId: acmeDomain.id,
            name: "Acme frontend",
            scopes: ['content:read', 'content:write']
        });

        const [acmeSchema] = await db.insert(contentTypes).values({
            domainId: acmeDomain.id,
            name: "Acme Product",
            slug: "acme-product",
            schema: JSON.stringify({ type: "object", properties: { name: { type: "string" }, price: { type: "number" }, description: { type: "string" } } })
        }).onConflictDoNothing().returning();

        let acmeSchemaId = acmeSchema?.id;
        if (!acmeSchemaId) {
            const [ct] = await db.select().from(contentTypes).where(eq(contentTypes.slug, "acme-product")).limit(1);
            acmeSchemaId = ct.id;
        }

        await db.insert(contentItems).values({
            domainId: acmeDomain.id,
            contentTypeId: acmeSchemaId,
            status: 'published',
            data: JSON.stringify({ name: "Anvil 5000", price: 99.99, description: "Heavy duty drop mechanism." })
        });

        // 2. Setup Globex
        console.log("Setting up Globex Inc...");
        let [globexDomain] = await db.insert(domains).values({
            name: "Globex Inc",
            hostname: "globex.multi-tenant.demo"
        }).onConflictDoNothing().returning();

        if (!globexDomain) {
            [globexDomain] = await db.select().from(domains).where(eq(domains.name, "Globex Inc")).limit(1);
        }

        const globexKeyResult = await createApiKey({
            domainId: globexDomain.id,
            name: "Globex frontend",
            scopes: ['content:read', 'content:write']
        });

        const [globexSchema] = await db.insert(contentTypes).values({
            domainId: globexDomain.id,
            name: "Globex Product",
            slug: "globex-product",
            schema: JSON.stringify({ type: "object", properties: { name: { type: "string" }, price: { type: "number" }, description: { type: "string" } } })
        }).onConflictDoNothing().returning();

        let globexSchemaId = globexSchema?.id;
        if (!globexSchemaId) {
            const [ct] = await db.select().from(contentTypes).where(eq(contentTypes.slug, "globex-product")).limit(1);
            globexSchemaId = ct.id;
        }

        await db.insert(contentItems).values({
            domainId: globexDomain.id,
            contentTypeId: globexSchemaId,
            status: 'published',
            data: JSON.stringify({ name: "Nuclear Reactor", price: 5000000, description: "Safe and reliable power source." })
        });

        // 3. Update HTML automatically
        console.log("\nInjecting keys into index.html...");
        const htmlPath = path.join(__dirname, 'index.html');
        let htmlContent = fs.readFileSync(htmlPath, 'utf8');

        htmlContent = htmlContent.replace(
            /key:\s*'wcak_[^']+',\s*\/\/ ACME/g,
            `key: '${acmeKeyResult.plaintext}', // ACME`
        );
        htmlContent = htmlContent.replace(
            /key:\s*'wcak_[^']+'\s*\/\/ GLOBEX/g,
            `key: '${globexKeyResult.plaintext}' // GLOBEX`
        );

        // Fallback replacement if comments aren't there
        htmlContent = htmlContent.replace(
            /acme:\s*{\s*name:\s*'Acme Corp',\s*key:\s*'wcak_[^']+',/s,
            `acme: {\n                name: 'Acme Corp',\n                key: '${acmeKeyResult.plaintext}',`
        );

        htmlContent = htmlContent.replace(
            /globex:\s*{\s*name:\s*'Globex Inc',\s*key:\s*'wcak_[^']+',/s,
            `globex: {\n                name: 'Globex Inc',\n                key: '${globexKeyResult.plaintext}',`
        );

        fs.writeFileSync(htmlPath, htmlContent);

        console.log("\n✅ Demo seeded successfully!");
        console.log(`Acme Key:   ${acmeKeyResult.plaintext}`);
        console.log(`Globex Key: ${globexKeyResult.plaintext}`);
        console.log("\nYou can now open `demos/multi-tenant/index.html` in your browser.");
        process.exit(0);
    } catch (e) {
        console.error("Setup failed:", e);
        process.exit(1);
    }
}

setupMultiTenantDemo();
