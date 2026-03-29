import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db } from '../src/db/index.js';
import { contentItems, domains } from '../src/db/schema.js';
import { createApiKey } from '../src/services/api-key.js';
import { and, eq } from 'drizzle-orm';

const API_URL = process.env.WORDCLAW_API_URL || 'http://localhost:4000/api';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const MULTI_TENANT_CONFIG_PATH = path.join(REPO_ROOT, 'demos', 'multi-tenant', 'tenant-config.js');

async function request(path, options = {}, apiKey) {
    const url = `${API_URL}${path}`;
    const headers = {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
        ...options.headers
    };

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
        let errPayload;
        try {
            errPayload = await response.json();
            console.error(`Error Payload:`, JSON.stringify(errPayload, null, 2));
        } catch (e) {
            console.error(await response.text());
        }
        throw new Error(`HTTP ${response.status} Error on ${path}`);
    }

    if (response.status !== 204) {
        return await response.json();
    }
}

async function setupTenant(name, hostname) {
    console.log(`Setting up tenant: ${name} (${hostname})...`);

    // 1. Create Domain
    let [domain] = await db.insert(domains).values({
        name,
        hostname
    }).onConflictDoNothing().returning();

    if (!domain) {
        [domain] = await db.select().from(domains).where(eq(domains.hostname, hostname)).limit(1);
    }

    // 2. Create API Key
    const { key, plaintext } = await createApiKey({
        domainId: domain.id,
        name: `Demo Key for ${name}`,
        scopes: ['admin'] // Granting full test access
    });

    console.log(`   Created API Key for ${name}: ${plaintext}`);

    // 3. Create Content Type via API
    const tenantSlugPrefix = name.split(' ')[0].toLowerCase();
    const productSlug = `${tenantSlugPrefix}-product`;

    const productSchema = {
        type: "object",
        properties: {
            name: { type: "string" },
            slug: { type: "string" },
            price: { type: "number" },
            description: { type: "string" }
        },
        required: ["name", "slug", "price"]
    };

    const ctListRes = await request('/content-types?limit=500', {}, plaintext);
    let productCtId = ctListRes.data?.find(ct => ct.slug === productSlug)?.id;

    if (!productCtId) {
        console.log(`   Creating Product Content Type for ${name}...`);
        const productCtRes = await request('/content-types', {
            method: 'POST',
            body: JSON.stringify({
                name: `${name} Product`,
                slug: productSlug,
                schema: JSON.stringify(productSchema)
            })
        }, plaintext);
        productCtId = productCtRes.data.id;
    }

    // 4. Create isolated Items
    console.log(`   Populating Products for ${name}...`);

    const products = name === 'Acme Corp' ? [
        { name: 'Anvil', slug: 'anvil', price: 99.99, description: 'Heavy duty iron anvil.' },
        { name: 'Giant Rubber Band', slug: 'rubber-band', price: 14.99, description: 'Very stretchy.' }
    ] : [
        { name: 'Teleporter', slug: 'teleporter', price: 99999.00, description: 'Experimental teleportation device.' },
        { name: 'Neutrino Bomb', slug: 'bomb', price: 4995.00, description: 'Handle with extreme care.' }
    ];

    for (const p of products) {
        const existing = await db.select().from(contentItems).where(and(
            eq(contentItems.domainId, domain.id),
            eq(contentItems.contentTypeId, productCtId)
        ));
        const match = existing.find((item) => {
            try {
                const parsed = JSON.parse(item.data);
                return parsed?.slug === p.slug;
            } catch {
                return false;
            }
        });

        if (match) {
            await request(`/content-items/${match.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                    data: p,
                    status: 'published'
                })
            }, plaintext);
            continue;
        }

        await request('/content-items', {
            method: 'POST',
            body: JSON.stringify({
                contentTypeId: productCtId,
                data: p,
                status: 'published'
            })
        }, plaintext);
    }

    console.log(`   Finished tenant: ${name}\n`);
    return plaintext;
}

async function run() {
    console.log("Starting Multi-Tenant Local Setup...\n");

    try {
        const acmeKey = await setupTenant("Acme Corp", "acme.local");
        const globexKey = await setupTenant("Globex Inc", "globex.local");

        fs.writeFileSync(
            MULTI_TENANT_CONFIG_PATH,
            `window.WORDCLAW_MULTI_TENANT_CONFIG = ${JSON.stringify({
                apiUrl: API_URL,
                tenants: {
                    acme: {
                        name: 'Acme Corp',
                        key: acmeKey,
                        class: 'acme'
                    },
                    globex: {
                        name: 'Globex Inc',
                        key: globexKey,
                        class: 'globex'
                    }
                }
            }, null, 2)};\n`
        );

        console.log("=== DONE ===");
        console.log("Use the following keys in your multi-tenant frontend app:");
        console.log(`ACME_KEY=${acmeKey}`);
        console.log(`GLOBEX_KEY=${globexKey}`);
        console.log(`Wrote browser config to ${MULTI_TENANT_CONFIG_PATH}`);

        process.exit(0);
    } catch (e) {
        console.error("Setup failed:", e);
        process.exit(1);
    }
}

run();
