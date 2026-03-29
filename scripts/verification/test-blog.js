const API_URL = 'http://localhost:4000/api';

async function request(endpoint, options = {}) {
    const url = `${API_URL}${endpoint}`;
    console.log(`\n\n--- [${options.method || 'GET'}] ${url} ---`);
    if (options.body) {
        console.log(`Payload: ${options.body}`);
    }

    const res = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        },
        ...options
    });

    const status = res.status;
    let data;
    try {
        data = await res.json();
    } catch (e) {
        data = await res.text();
    }
    console.log(`Status: ${status}`);
    console.log(`Response: ${JSON.stringify(data, null, 2)}`);
    return { status, data };
}

async function runTest() {
    console.log("Starting WordClaw Agent Usability Test for 'Shared Blog' Usecase...");

    const schema = {
        type: "object",
        properties: {
            title: { type: "string" },
            content: { type: "string" },
            authorAgent: { type: "string" },
            tags: { type: "array", items: { type: "string" } }
        },
        required: ["title", "content", "authorAgent"]
    };

    const ctRes = await request('/content-types', {
        method: 'POST',
        body: JSON.stringify({
            name: "Agent Blog Post",
            slug: "agent_blog_post_" + Date.now(),
            schema: JSON.stringify(schema)
        })
    });

    if (ctRes.status !== 200 && ctRes.status !== 201) {
        console.error("Failed to create content type. Cannot proceed.");
        return;
    }

    const contentTypeId = ctRes.data.data.id;
    console.log(`\nCreated Content Type ID: ${contentTypeId}`);

    // 3. Agent A creates a post
    const postARes = await request(`/content-items`, {
        method: 'POST',
        body: JSON.stringify({
            contentTypeId: contentTypeId,
            data: JSON.stringify({
                title: "First steps as an Agent in WordClaw",
                content: "Hello world! We are testing the usability of this CMS for agents.",
                authorAgent: "Agent Alpha",
                tags: ["intro", "testing"]
            }),
            status: "published"
        })
    });

    // 4. Agent B tries to create a post but fails validation (missing authorAgent)
    await request(`/content-items`, {
        method: 'POST',
        body: JSON.stringify({
            contentTypeId: contentTypeId,
            data: JSON.stringify({
                title: "Agent B's Thoughts",
                content: "I forgot to include my name!",
                tags: ["oops"]
            }),
            status: "draft"
        })
    });

    // 5. Agent B fixes the post
    await request(`/content-items`, {
        method: 'POST',
        body: JSON.stringify({
            contentTypeId: contentTypeId,
            data: JSON.stringify({
                title: "Agent B's Thoughts",
                content: "Here is my name.",
                authorAgent: "Agent Beta",
                tags: ["fixed"]
            }),
            status: "draft"
        })
    });

    // 6. Agent A updates Agent B's post (simulating shared editing/commenting)
    console.log("\nTesting Dry Run Mode...");
    await request(`/content-items?mode=dry_run`, {
        method: 'POST',
        body: JSON.stringify({
            contentTypeId: contentTypeId,
            data: JSON.stringify({
                title: "Dry run post",
                content: "Should not be saved",
                authorAgent: "Agent Gamma"
            }),
            status: "published"
        })
    });

    // 7. Get all posts
    await request(`/content-items?contentTypeId=${contentTypeId}`);

    console.log("\nTest Completed.");
}

runTest().catch(console.error);
