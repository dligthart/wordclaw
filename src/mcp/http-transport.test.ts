import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { buildServer } from '../server.js';

const originalAuthRequired = process.env.AUTH_REQUIRED;
const originalApiKeys = process.env.API_KEYS;
const originalAllowInsecureLocalAdmin = process.env.ALLOW_INSECURE_LOCAL_ADMIN;

function restoreEnv() {
    if (originalAuthRequired === undefined) {
        delete process.env.AUTH_REQUIRED;
    } else {
        process.env.AUTH_REQUIRED = originalAuthRequired;
    }

    if (originalApiKeys === undefined) {
        delete process.env.API_KEYS;
    } else {
        process.env.API_KEYS = originalApiKeys;
    }

    if (originalAllowInsecureLocalAdmin === undefined) {
        delete process.env.ALLOW_INSECURE_LOCAL_ADMIN;
    } else {
        process.env.ALLOW_INSECURE_LOCAL_ADMIN = originalAllowInsecureLocalAdmin;
    }
}

function extractFirstText(contents: Array<{ type: string; text?: string }>): string {
    const text = contents.find((item) => item.type === 'text')?.text;
    if (typeof text !== 'string') {
        throw new Error('Expected text content in MCP result.');
    }
    return text;
}

describe('MCP HTTP transport', () => {
    let app: FastifyInstance | null = null;
    let client: Client | null = null;

    beforeEach(() => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'remote-admin=admin';
        process.env.ALLOW_INSECURE_LOCAL_ADMIN = 'false';
    });

    afterEach(async () => {
        if (client) {
            await client.close();
            client = null;
        }

        if (app) {
            await app.close();
            app = null;
        }

        restoreEnv();
    });

    it('supports authenticated streamable HTTP discovery and tool execution', async () => {
        app = await buildServer();
        const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });

        client = new Client({
            name: 'wordclaw-http-transport-test',
            version: '1.0.0'
        });

        const transport = new StreamableHTTPClientTransport(new URL('/mcp', `${baseUrl}/`), {
            requestInit: {
                headers: {
                    'x-api-key': 'remote-admin'
                }
            }
        });

        await client.connect(transport);

        const tools = await client.listTools();
        const resources = await client.listResources();
        const capabilityResource = await client.readResource({ uri: 'system://capabilities' });
        const policyDecision = await client.callTool({
            name: 'evaluate_policy',
            arguments: {
                operation: 'content.read',
                resourceType: 'system'
            }
        });

        expect(tools.tools.some((tool) => tool.name === 'evaluate_policy')).toBe(true);
        expect(resources.resources.some((resource) => resource.uri === 'system://capabilities')).toBe(true);

        const manifestText = capabilityResource.contents.find((entry) => 'text' in entry)?.text;
        expect(typeof manifestText).toBe('string');
        expect(JSON.parse(manifestText as string)).toEqual(expect.objectContaining({
            protocolSurfaces: expect.objectContaining({
                mcp: expect.objectContaining({
                    endpoint: '/mcp',
                    attachable: true,
                    transports: ['stdio', 'streamable-http']
                })
            })
        }));

        const decisionText = extractFirstText(policyDecision.content as Array<{ type: string; text?: string }>);
        expect(JSON.parse(decisionText)).toEqual(expect.objectContaining({
            outcome: 'allow'
        }));
    });
});
