import { ActionPriority, AIResponseMetaType, AIErrorResponseType } from '../src/api/types.js';

interface AIResponse<T> {
    data: T;
    meta: AIResponseMetaType;
}

interface AIError {
    error: string;
    code: string;
    remediation: string;
    context?: any;
}

const BASE_URL = 'http://localhost:4000/api';

async function testEndpoint(name: string, fn: () => Promise<void>) {
    try {
        process.stdout.write(`Testing ${name}... `);
        await fn();
        console.log('✅ OK');
    } catch (err: any) {
        console.log('❌ FAILED');
        console.error(err.message);
        if (err.response) {
            console.error('Response:', await err.response.text());
        }
    }
}

async function verifyAIResponse<T>(res: Response): Promise<AIResponse<T>> {
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as AIResponse<T>;
    if (!body.meta) throw new Error('Missing meta field');
    if (!body.meta.recommendedNextAction) throw new Error('Missing recommendedNextAction');
    if (!Array.isArray(body.meta.availableActions)) throw new Error('availableActions is not an array');
    if (!body.meta.actionPriority) throw new Error('Missing actionPriority');
    return body;
}

async function verifyAIError(res: Response): Promise<AIError> {
    if (res.ok) {
        throw new Error(`Expected error but got HTTP ${res.status}`);
    }
    const body = (await res.json()) as AIError;
    if (!body.remediation) throw new Error('Missing remediation field');
    return body;
}

async function main() {
    await testEndpoint('GET /content-types (Empty list)', async () => {
        const res = await fetch(`${BASE_URL}/content-types`);
        await verifyAIResponse(res);
    });

    await testEndpoint('POST /content-types', async () => {
        const res = await fetch(`${BASE_URL}/content-types`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Blog Post',
                slug: 'blog-post',
                schema: JSON.stringify({ title: 'string', body: 'string' })
            })
        });
        const { data } = await verifyAIResponse<{ id: number }>(res);
        if (!data.id) throw new Error('Missing ID in response data');
    });

    await testEndpoint('GET /content-items (404 Error Check)', async () => {
        const res = await fetch(`${BASE_URL}/content-items/99999`);
        const err = await verifyAIError(res);
        console.log(`\n   [Remediation]: ${err.remediation}`);
        if (err.code !== 'CONTENT_ITEM_NOT_FOUND') throw new Error('Wrong error code');
    });
}

main().catch(console.error);
