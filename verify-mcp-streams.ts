import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { WORDCLAW_EVENT_NOTIFICATION_METHOD } from './src/mcp/reactive-events.js';

type WordClawEnvelope<T> = {
    data: T;
};

type ContentTypeResponse = WordClawEnvelope<{
    id: number;
}>;

type SubscribeResult = {
    subscribedTopics?: string[];
    blockedTopics?: Array<{ topic: string; reason: string }>;
    unsupportedTopics?: string[];
};

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createContentType(baseUrl: string, apiKey: string) {
    const response = await fetch(new URL('/api/content-types', `${baseUrl}/`), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify({
            name: 'Reactive Verification Article',
            slug: `reactive-verification-${Date.now()}`,
            schema: {
                type: 'object',
                properties: {
                    title: { type: 'string' },
                },
                required: ['title'],
            },
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to create content type: ${response.status} ${await response.text()}`);
    }

    const payload = await response.json() as ContentTypeResponse;
    return payload.data.id;
}

async function createPublishedContentItem(baseUrl: string, apiKey: string, contentTypeId: number) {
    const response = await fetch(new URL('/api/content-items', `${baseUrl}/`), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify({
            contentTypeId,
            data: {
                title: 'Reactive publish verification',
            },
            status: 'published',
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to create published content item: ${response.status} ${await response.text()}`);
    }
}

async function waitForStandaloneStream(baseUrl: string, apiKey: string, sessionId: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const probe = await fetch(new URL('/mcp', `${baseUrl}/`), {
            method: 'GET',
            headers: {
                accept: 'text/event-stream',
                'mcp-session-id': sessionId,
                'x-api-key': apiKey,
            },
        });

        if (probe.status === 409) {
            return;
        }

        await sleep(100);
    }

    throw new Error('Timed out waiting for the standalone MCP SSE stream to attach.');
}

async function main() {
    const baseUrl = process.env.WORDCLAW_BASE_URL ?? 'http://localhost:4000';
    const apiKey = process.env.WORDCLAW_API_KEY ?? 'remote-admin';
    const notifications: Array<Record<string, unknown>> = [];

    const client = new Client({
        name: 'verify-mcp-streams',
        version: '1.0.0',
    });
    client.fallbackNotificationHandler = async (notification) => {
        notifications.push(notification as Record<string, unknown>);
    };

    const transport = new StreamableHTTPClientTransport(new URL('/mcp', `${baseUrl}/`), {
        requestInit: {
            headers: {
                'x-api-key': apiKey,
            },
        },
    });

    console.log(`Connecting to ${new URL('/mcp', `${baseUrl}/`).toString()} ...`);
    await client.connect(transport);

    if (!transport.sessionId) {
        throw new Error('Expected the server to issue an Mcp-Session-Id.');
    }

    console.log(`Connected with session ${transport.sessionId}. Waiting for standalone SSE stream...`);
    await waitForStandaloneStream(baseUrl, apiKey, transport.sessionId);

    const typeId = await createContentType(baseUrl, apiKey);
    console.log(`Created verification content type ${typeId}.`);

    const subscription = await client.callTool({
        name: 'subscribe_events',
        arguments: {
            topics: ['content_item.published'],
            replaceExisting: true,
        },
    });
    const subscriptionText = subscription.content.find((entry) => entry.type === 'text')?.text;
    if (!subscriptionText) {
        throw new Error('subscribe_events returned no text payload.');
    }

    const parsedSubscription = JSON.parse(subscriptionText) as SubscribeResult;
    if (!parsedSubscription.subscribedTopics?.includes('content_item.published')) {
        throw new Error(`subscribe_events did not accept the topic: ${subscriptionText}`);
    }
    console.log('Subscribed to content_item.published.');

    await createPublishedContentItem(baseUrl, apiKey, typeId);
    console.log('Created a published content item. Waiting for notification...');

    for (let attempt = 0; attempt < 50; attempt += 1) {
        const notification = notifications.find((candidate) => (
            candidate.method === WORDCLAW_EVENT_NOTIFICATION_METHOD
            && (candidate.params as { topic?: string } | undefined)?.topic === 'content_item.published'
        ));

        if (notification) {
            console.log('Received reactive notification:');
            console.log(JSON.stringify(notification, null, 2));
            await client.close();
            return;
        }

        await sleep(100);
    }

    await client.close();
    throw new Error('Timed out waiting for a content_item.published notification.');
}

main().catch((error) => {
    console.error('[verify-mcp-streams] failed:', error);
    process.exitCode = 1;
});
