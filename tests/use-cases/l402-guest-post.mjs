import * as crypto from 'crypto';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000/api';

async function runGuestPostUsabilityTest() {
    console.log('🚀 Starting L402 Guest Post Usability Test (Agent flow)\\n');

    try {
        // Step 1: Supervisor creates a content type with a base price
        console.log('1. [Supervisor] Creating "Guest Post" content type with basePrice of 500 Sats...');
        const typeRes = await fetch(`${API_BASE_URL}/content-types`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Guest Post',
                slug: `guest-post-${crypto.randomUUID().slice(0, 8)}`,
                basePrice: 500, // Important change: dynamic pricing
                schema: JSON.stringify({
                    type: 'object',
                    properties: {
                        title: { type: 'string' },
                        body: { type: 'string' },
                        author: { type: 'string' }
                    },
                    required: ['title', 'body', 'author']
                })
            })
        });

        if (!typeRes.ok) {
            throw new Error(`Failed to create content type: ${await typeRes.text()}`);
        }

        const typeData = await typeRes.json();
        const contentTypeId = typeData.data.id;
        console.log(`   ✅ Content Type created (ID: ${contentTypeId})\\n`);

        // Step 2: Agent attempts to create a post without paying
        console.log('2. [Agent] Attempting to create a Guest Post without a payment token...');
        const unauthRes = await fetch(`${API_BASE_URL}/content-items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contentTypeId,
                data: JSON.stringify({
                    title: 'My First AI Guest Post',
                    body: 'This is a test post submitted by an AI agent.',
                    author: 'Agent Smith'
                }),
                status: 'draft' // Guest posts might start as drafts
            })
        });

        if (unauthRes.status !== 402) {
            throw new Error(`Expected 402 Payment Required, got ${unauthRes.status}\\nBody: ${await unauthRes.text()}`);
        }

        const authHeader = unauthRes.headers.get('www-authenticate');
        const l402Data = await unauthRes.json();

        console.log('   🛑 Received 402 Payment Required.');
        console.log(`   - Www-Authenticate: ${authHeader}`);
        console.log(`   - AI Guidance Payload: ${JSON.stringify(l402Data, null, 2)}\\n`);

        // Step 3: Parse the WWW-Authenticate header
        const match = authHeader.match(/L402 macaroon="(.*?)", invoice="(.*?)"/);
        if (!match) {
            throw new Error('Invalid Www-Authenticate header format.');
        }

        const [, macaroon, invoiceStr] = match;

        // Ensure the invoice string looks somewhat right (starts with lntb or lnbc)
        if (!invoiceStr.startsWith('lntb') && !invoiceStr.startsWith('lnbc')) {
            throw new Error(`Invalid invoice format: ${invoiceStr}`);
        }

        console.log('3. [Agent] Extracted Payment Information:');
        console.log(`   - Macaroon present: true`);
        console.log(`   - Invoice present: true (length: ${invoiceStr.length})\\n`);


        // Step 4: Agent decides to propose a higher price
        console.log('4. [Agent] Deciding to pay more for faster review, sending x-proposed-price: 1500...');
        const proposeRes = await fetch(`${API_BASE_URL}/content-items`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-proposed-price': '1500'
            },
            body: JSON.stringify({
                contentTypeId,
                data: JSON.stringify({
                    title: 'My Premium Guest Post',
                    body: 'I am paying premium for this placement.',
                    author: 'Rich Agent'
                })
            })
        });

        if (proposeRes.status !== 402) {
            throw new Error(`Expected 402 Payment Required, got ${proposeRes.status}`);
        }

        const proposedL402Data = await proposeRes.json();
        const invoiceStrProp = proposedL402Data.error.details.invoice;
        const amountSats = proposedL402Data.error.details.amountSatoshis;

        if (amountSats !== 1500) {
            throw new Error(`Expected invoice to be 1500 sats (proposed), but got ${amountSats} sats.`);
        }

        const proposedAuthHeader = proposeRes.headers.get('www-authenticate');
        const proposedMatch = proposedAuthHeader.match(/L402 macaroon="(.*?)", invoice="(.*?)"/);
        if (!proposedMatch) {
            throw new Error('Invalid Www-Authenticate header format on proposed request.');
        }
        const [, proposedMacaroon,] = proposedMatch;


        console.log(`   ✅ Successfully received new invoice for 1500 sats.\\n`);

        // Step 5: Agent simulates payment (we assume the mock provider uses a fixed preimage)
        const mockPreimage = 'mock_preimage_12345';
        console.log(`5. [Agent] Simulating Lightning Payment (assuming preimage: ${mockPreimage})...\\n`);


        // Step 6: Agent retries request with L402 token
        console.log('6. [Agent] Retrying request with L402 Authorization Header...');
        const authzHeader = `L402 ${proposedMacaroon}:${mockPreimage}`;

        const successRes = await fetch(`${API_BASE_URL}/content-items`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authzHeader,
                'x-proposed-price': '1500'
            },
            body: JSON.stringify({
                contentTypeId,
                data: JSON.stringify({
                    title: 'My Premium Guest Post',
                    body: 'I am paying premium for this placement.',
                    author: 'Rich Agent'
                }),
                status: 'draft'
            })
        });

        if (!successRes.ok) {
            throw new Error(`Failed to create post after payment: ${await successRes.text()}`);
        }

        const finalData = await successRes.json();
        console.log('   ✅ Successfully created post after payment!');
        console.log(`   - Item ID: ${finalData.data.id}`);
        console.log(`   - Meta next step: ${finalData.meta.recommendedNextAction}\\n`);

        console.log('🎉 L402 Usability Test Completed Successfully!');

    } catch (e) {
        console.error('\\n❌ Usability Test Failed:');
        console.error(e);
        process.exit(1);
    }
}

const fileUrl = new URL(import.meta.url);
if (fileUrl.pathname === process.argv[1]) {
    runGuestPostUsabilityTest().then(() => {
        console.log("Exiting test execution...");
        process.exit(0);
    });
}
