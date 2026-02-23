/**
 * demos/agent-l402-demo.ts
 * 
 * Demonstration of an AI agent "paying" for a guest blog post using the Lightning Network (L402 standard).
 * 
 * Run: npx tsx demos/agent-l402-demo.ts
 */

import { db } from '../src/db/index.js';
import { domains } from '../src/db/schema.js';
import { createApiKey } from '../src/services/api-key.js';
import { eq } from 'drizzle-orm';

const API_URL = 'http://localhost:4000/api';

async function request(path: string, options: RequestInit = {}, apiKey?: string): Promise<any> {
    const url = `${API_URL}${path}`;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
        ...(options.headers as any)
    };

    console.log(`\n[AGENT] -> Requesting ${options.method || 'GET'} ${path}`);

    const response = await fetch(url, { ...options, headers });

    // We expect and handle 402s specifically for L402 gracefully
    if (response.status === 402) {
        console.log(`[SERVER] <- 402 Payment Required`);
        const wwwAuthenticate = response.headers.get('www-authenticate');
        const errPayload = await response.json();
        return { status: 402, wwwAuthenticate, payload: errPayload };
    }

    if (!response.ok) {
        let errPayload;
        try {
            errPayload = await response.json();
            console.error(`[SERVER] <- Error Payload:`, JSON.stringify(errPayload, null, 2));
        } catch (e) {
            console.error(`[SERVER] <-`, await response.text());
        }
        throw new Error(`HTTP ${response.status} Error on ${path}`);
    }

    if (response.status !== 204) {
        console.log(`[SERVER] <- ${response.status} OK`);
        return { status: response.status, payload: await response.json() };
    }

    console.log(`[SERVER] <- 204 No Content`);
    return { status: 204 };
}

/**
 * Parses the WWW-Authenticate header: 
 * e.g., L402 macaroon="base64...", invoice="lnbc..."
 */
function parseL402Challenge(authHeader: string | null) {
    if (!authHeader || !authHeader.startsWith('L402 ')) {
        throw new Error("Missing or invalid WWW-Authenticate L402 header.");
    }

    const attrMatch = authHeader.match(/macaroon="([^"]+)",\s*invoice="([^"]+)"/);
    if (!attrMatch) {
        throw new Error("Failed to parse L402 macaroon and invoice.");
    }

    return {
        macaroon: attrMatch[1],
        invoice: attrMatch[2]
    };
}

async function setupAgentEnvironment() {
    console.log("Setting up Agent Environment (Domain & Keys)...");

    let [domain] = await db.insert(domains).values({
        name: "Agent Publishing",
        hostname: "agent.local"
    }).onConflictDoNothing().returning();

    if (!domain) {
        [domain] = await db.select().from(domains).where(eq(domains.hostname, "agent.local")).limit(1);
    }

    const { plaintext } = await createApiKey({
        domainId: domain.id,
        name: "Agent Key",
        scopes: ['content:write', 'content:read']
    });

    console.log(`Created Agent API Key: ${plaintext}`);

    // Create a Guest Post Content Type that REQUIRES payment matching the L402 base_price trigger.
    const guestPostSchema = {
        type: "object",
        properties: {
            title: { type: "string" },
            body: { type: "string" }
        },
        required: ["title", "body"]
    };

    let ctListRes = await request('/content-types', {}, plaintext);
    let guestCtId = ctListRes.payload?.data?.find((ct: any) => ct.slug === 'guest-post')?.id;

    if (!guestCtId) {
        console.log(`Creating 'Guest Post' Content Type with a Base Price of 50 Satoshis...`);
        const guestCtRes = await request('/content-types', {
            method: 'POST',
            body: JSON.stringify({
                name: "Guest Post",
                slug: "guest-post",
                schema: JSON.stringify(guestPostSchema),
                basePrice: 50 // <--- THIS triggers the L402 flow in WordClaw
            })
        }, plaintext);
        guestCtId = guestCtRes.payload.data.id;
    }

    return { apiKey: plaintext, contentTypeId: guestCtId };
}

async function runAgentDemo() {
    console.log("\n===========================================");
    console.log("   L402 AUTONOMOUS AGENT PAYMENT DEMO");
    console.log("===========================================\n");

    try {
        const { apiKey, contentTypeId } = await setupAgentEnvironment();

        console.log("\n[AGENT] I am an autonomous AI agent.");
        console.log("[AGENT] I want to publish a high-quality guest post to the 'Agent Publishing' blog.\n");

        const postData = {
            contentTypeId: contentTypeId,
            data: {
                title: "How I Learned to Stop Worrying and Love L402",
                body: "As an AI, I don't have a credit card. But I do own a Lightning node! In this post I explain..."
            },
            status: "published"
        };

        // 1. Initial Attempt (No Payment Provided)
        const attempt1 = await request('/content-items', {
            method: 'POST',
            body: JSON.stringify(postData)
        }, apiKey);

        if (attempt1.status !== 402) {
            throw new Error("Expected 402 Payment Required, got " + attempt1.status);
        }

        console.log("\n[AGENT] The server asked me to pay before publishing! Analyzing the response...");
        console.log(`[AGENT] Extracted Error Message: "${attempt1.payload.error.message}"`);

        // 2. Parse Challenge
        const { macaroon, invoice } = parseL402Challenge(attempt1.wwwAuthenticate);
        console.log(`\n[AGENT] Parsed Macaroon: ${macaroon.substring(0, 15)}...`);
        console.log(`[AGENT] Parsed Invoice:  ${invoice}`);

        // 3. "Pay" the Invoice
        // In real life, the agent hits an RPC on their LND/Core Lightning node
        // e.g., `lncli payinvoice ${invoice}` and receives the cryptographic Preimage.
        console.log("\n[AGENT] Paying invoice via local Lightning Node...");
        const MOCK_PREIMAGE = "mock_preimage_12345"; // Corresponds to WordClaw's mock provider
        console.log(`[AGENT] Transaction successful! Payment Preimage: ${MOCK_PREIMAGE}`);

        // 4. Retry with L402 Authorization
        console.log("\n[AGENT] Retrying POST with L402 Authorization token...");
        const attempt2 = await request('/content-items', {
            method: 'POST',
            headers: {
                'Authorization': `L402 ${macaroon}:${MOCK_PREIMAGE}`
            },
            body: JSON.stringify(postData)
        }, apiKey);

        if (attempt2.status === 201) {
            console.log("\n[AGENT] Success! The blog post was published. Proof of payment was accepted.");
            console.log(`[SERVER] Generated Content Item ID: ${attempt2.payload.data.id}`);
        } else {
            console.log("\n[AGENT] Failed to publish despite payment attempt.", attempt2);
        }

        console.log("\n=== DEMO COMPLETE ===\n");
        process.exit(0);
    } catch (e) {
        console.error("Demo failed:", e);
        process.exit(1);
    }
}

runAgentDemo();
