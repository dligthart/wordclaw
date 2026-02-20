
const API_URL = 'http://localhost:4000/api';

async function verifyRateLimit() {
    console.log('🚀 Starting Rate Limit Verification...');

    try {
        // Updated limit to 150 to ensure we breach the 100 limit
        const totalRequests = 150;
        const requests = [];
        console.log(`Sending ${totalRequests} requests rapidly...`);

        for (let i = 0; i < totalRequests; i++) {
            requests.push(fetch(`${API_URL}/content-types`)
                .catch(err => ({ status: 'NETWORK_ERROR', error: err.message } as any))
            );
        }

        const responses = await Promise.all(requests);

        let rateLimitedCount = 0;
        let successCount = 0;
        let otherCount = 0;

        for (const res of responses) {
            if (res.status === 429) {
                rateLimitedCount++;
            } else if (res.status === 200) {
                successCount++;
            } else {
                otherCount++;
                console.log(`Unexpected status: ${res.status}`);
            }
        }

        console.log(`Results: Success: ${successCount}, Rate Limited: ${rateLimitedCount}, Other: ${otherCount}`);

        if (rateLimitedCount > 0) {
            console.log('✅ Rate limiting triggered successfully.');
            // Check headers on one failure
            const blockedRes = responses.find(r => r.status === 429);
            if (blockedRes) {
                console.log('Retry-After:', blockedRes.headers.get('retry-after'));
                console.log('X-RateLimit-Limit:', blockedRes.headers.get('x-ratelimit-limit'));
                console.log('X-RateLimit-Remaining:', blockedRes.headers.get('x-ratelimit-remaining'));

                const blockedBody = await blockedRes.json();
                console.log('Blocked Response Body:', JSON.stringify(blockedBody, null, 2));

                if (blockedBody.remediation) {
                    console.log('✅ Response has AI remediation content.');
                } else {
                    console.error('❌ Response missing remediation content.');
                    throw new Error('Response missing remediation content');
                }
            }
        } else {
            console.error('❌ Rate limit was NOT triggered.');
            throw new Error('Rate limit was NOT triggered.');
        }

    } catch (error) {
        console.error('\n❌ Verification Failed:', error);
        process.exit(1);
    }
}

verifyRateLimit();
