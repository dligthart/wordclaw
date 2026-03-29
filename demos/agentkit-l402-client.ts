/**
 * demos/agentkit-l402-client.ts
 * 
 * Demonstration of Coinbase AgentKit connecting an LLM to WordClaw
 * to autonomously pay L402 Lightning invoices using a custom ActionProvider.
 * 
 * Prerequisites:
 *   - OPENAI_API_KEY environment variable set
 *   - The WordClaw local server running on http://localhost:4000
 * 
 * Run: 
 *   export OPENAI_API_KEY="sk-..."
 *   npx tsx demos/agentkit-l402-client.ts
 */

import { AgentKit, customActionProvider } from "@coinbase/agentkit";
import { getLangChainTools } from "@coinbase/agentkit-langchain";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import * as dotenv from "dotenv";

import { db } from '../src/db/index.js';
import { domains } from '../src/db/schema.js';
import { createApiKey } from '../src/services/api-key.js';
import { eq } from 'drizzle-orm';

dotenv.config();

const API_URL = process.env.WORDCLAW_API_URL || 'http://localhost:4000/api';

async function preflightRuntime() {
    const statusUrl = API_URL.endsWith('/api')
        ? `${API_URL}/deployment-status`
        : `${API_URL}/api/deployment-status`;

    try {
        const response = await fetch(statusUrl);
        if (!response.ok) {
            console.warn(`[AgentKit] Runtime preflight returned ${response.status}. Continuing...`);
            return;
        }

        const payload = await response.json() as any;
        const bootstrapStatus = payload?.data?.checks?.bootstrap?.status ?? 'unknown';
        const embeddingsStatus = payload?.data?.checks?.embeddings?.status ?? 'unknown';
        console.log(`[AgentKit] Runtime preflight: bootstrap=${bootstrapStatus}, embeddings=${embeddingsStatus}`);
    } catch (error) {
        console.warn(`[AgentKit] Runtime preflight failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * 1. Define the Custom Action Provider for L402 / Lightning
 * 
 * This connects the LLM securely to a Lightning node (mocked here but production
 * ready for Alby, Strike, or a local LND instance).
 */
const lightningL402Provider = customActionProvider<any>({
    name: "pay_lightning_invoice",
    description: "Pays a Lightning Network BOLT11 invoice and returns the cryptographic payment preimage. Call this when an API returns 402 Payment Required and gives you an invoice.",
    schema: z.object({
        invoice: z.string().describe("The BOLT11 invoice string starting with lnbc..."),
    }),
    invoke: async (walletProvider: any, args: any) => {
        console.log(`\n===========================================`);
        console.log(`[LightningActionProvider] Intercepted Request`);
        console.log(`===========================================`);
        console.log(`[+] Attempting to pay invoice: ${args.invoice.substring(0, 25)}...`);

        // Simulate network delay for paying via Lightning
        await new Promise(r => setTimeout(r, 2000));

        // In production, you would call your Lightning Node or API here.
        // We mock the success by returning the environment parameter or the default mock.
        const preimage = process.env.L402_MOCK_PREIMAGE || "mock_preimage_12345";

        console.log(`[+] Payment successful! Lightning Preimage: ${preimage}`);
        console.log(`===========================================\n`);
        return preimage;
    }
});

/**
 * Helper to bootstrap a test domain and API key in the WordClaw database.
 */
async function setupAgentEnvironment() {
    console.log("Setting up WordClaw Database environment...");

    let [domain] = await db.insert(domains).values({
        name: "Agent Publishing",
        hostname: "agent.local"
    }).onConflictDoNothing().returning();

    if (!domain) {
        [domain] = await db.select().from(domains).where(eq(domains.hostname, "agent.local")).limit(1);
    }

    const { plaintext } = await createApiKey({
        domainId: domain.id,
        name: "AgentKit Dev Key",
        scopes: ['content:write', 'content:read']
    });

    console.log(`Created WordClaw API Key for the Agent.`);

    // Define a Guest Post schema that triggers the L402 payment
    const guestPostSchema = {
        type: "object",
        properties: {
            title: { type: "string" },
            body: { type: "string" }
        },
        required: ["title", "body"]
    };

    // Auto-create or find the content type
    let ctRes = await fetch(`${API_URL}/content-types`, {
        headers: { 'x-api-key': plaintext }
    });

    let ctList = await ctRes.json();
    let guestCtId = ctList.data?.find((ct: any) => ct.slug === 'guest-post')?.id;

    if (!guestCtId) {
        console.log(`Creating 'Guest Post' Content Type with a Base Price of 50 Satoshis...`);
        const guestCtCreateRes = await fetch(`${API_URL}/content-types`, {
            method: 'POST',
            body: JSON.stringify({
                name: "Guest Post",
                slug: "guest-post",
                schema: JSON.stringify(guestPostSchema),
                basePrice: 50 // <--- THIS triggers the L402 flow in WordClaw
            }),
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': plaintext
            }
        });
        const guestCtData = await guestCtCreateRes.json();
        guestCtId = guestCtData.data.id;
    }

    return { apiKey: plaintext, contentTypeId: guestCtId };
}

/**
 * Main Demo Flow
 */
async function runAgentKitDemo() {
    try {
        if (!process.env.OPENAI_API_KEY) {
            console.error("Error: OPENAI_API_KEY is not set. Please set it to run the AgentKit LLM.");
            process.exit(1);
        }

        await preflightRuntime();
        const { apiKey, contentTypeId } = await setupAgentEnvironment();

        console.log("\nInitializing Coinbase AgentKit...");

        // 2. Wrap our Lightning custom action provider in AgentKit
        const agentKit = await AgentKit.from({
            actionProviders: [lightningL402Provider()]
        });

        // Expose the tools for Langchain
        const tools = await getLangChainTools(agentKit);

        // 3. Add a tool explicitly for making HTTP requests to WordClaw API
        // LangChain has `RequestsGetTool` and `RequestsPostTool`, but we'll build a custom simple tool specifically
        // tailored for this demo so it handles L402 header parsing properly.
        const makeNetworkPostTool = {
            name: "post_to_wordclaw",
            description: "Posts content to the WordClaw API. Useful for submitting articles. If it returns 402 Payment Required, it will provide you with a WWW-Authenticate header containing a macaroon and an invoice. You must pay the invoice, and then retry this tool with the macaroon and preimage in the Authorization header. Takes three inputs: 'url', 'bodyJsonString', and 'authHeader'. authHeader should be empty initially, but look like 'L402 <macaroon>:<preimage>' when retrying.",
            schema: z.object({
                url: z.string(),
                bodyJsonString: z.string(),
                authHeader: z.string().optional()
            }),
            invoke: async (args: { url: string, bodyJsonString: string, authHeader?: string }) => {
                const headers: any = {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey
                };

                if (args.authHeader) {
                    headers['Authorization'] = args.authHeader;
                }

                const res = await fetch(args.url, {
                    method: 'POST',
                    headers,
                    body: args.bodyJsonString
                });

                if (res.status === 402) {
                    return `STATUS: 402 Payment Required\nWWW-Authenticate: ${res.headers.get('www-authenticate')}`;
                } else if (!res.ok) {
                    return `STATUS: ${res.status}\nError: ${await res.text()}`;
                } else {
                    return `STATUS: ${res.status}\nSUCCESS: ${await res.text()}`;
                }
            }
        };

        // We push the custom HTTP post tool to the mix
        tools.push(makeNetworkPostTool as any);

        console.log("Bootstrapping LangChain ReactAgent with gpt-4o-mini...");

        const llm = new ChatOpenAI({
            model: "gpt-4o-mini",
        });

        // 4. Create the LangChain generic ReAct agent using AgentKit tools
        const agent = createReactAgent({
            llm,
            tools,
            checkpointSaver: new MemorySaver(),
        });

        console.log("\n===========================================");
        console.log("   AGENTKIT L402 AUTONOMOUS AGENT");
        console.log("===========================================\n");

        const promptTemplate = `
You are an autonomous publishing agent. 
Your goal is to successfully publish a guest post on WordClaw at '${API_URL}/content-items'.
The content type ID is '${contentTypeId}'. 
The JSON body to post must be exactly:
{
    "contentTypeId": ${contentTypeId},
    "data": {
        "title": "AgentKit + L402 Demo",
        "body": "This article was written, paid for, and published autonomously by Coinbase AgentKit over Lightning."
    },
    "status": "published"
}

1. First, try calling 'post_to_wordclaw' without an authHeader.
2. If it returns 402, parse the 'macaroon' and 'invoice' from the WWW-Authenticate header.
3. Call your 'pay_lightning_invoice' tool with the invoice to get the preimage.
4. Retry you 'post_to_wordclaw' call, this time providing an authHeader formatted exactly like: 'L402 <macaroon>:<preimage>'.

Execute these steps until you succeed in publishing the article, and return a final summary of what happened.
        `;

        // 5. Run the agent
        const stream = await agent.stream(
            { messages: [new HumanMessage(promptTemplate)] },
            { configurable: { thread_id: "AgentKit L402 Demo Run" } }
        );

        for await (const chunk of stream) {
            if (chunk.agent) {
                console.log("- [Agent] " + chunk.agent.messages[0].content);
            } else if (chunk.tools) {
                console.log("- [Tool] Output: " + chunk.tools.messages[0].content);
            }
        }

        console.log("\n=== DEMO COMPLETE ===\n");
        process.exit(0);

    } catch (error) {
        console.error("Fatal Error:", error);
        process.exit(1);
    }
}

runAgentKitDemo();
