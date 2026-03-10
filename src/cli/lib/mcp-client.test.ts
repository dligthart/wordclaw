import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import {
    cleanupSmokeArtifacts,
    inspectCapabilities,
    resolveMcpHttpEndpoint,
    type SmokeState,
    WordClawMcpClient,
} from './mcp-client.js';
import { buildServer } from '../../server.js';

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

describe('cleanupSmokeArtifacts', () => {
    it('deletes workflow content types even when workflow artifacts were created', async () => {
        const callTool = vi.fn().mockResolvedValue({
            content: [{ text: '{"ok":true}' }],
            isError: false,
        });
        const state: SmokeState = {
            batchItemIds: [],
            workflowDraftItemId: 11,
            workflowTypeId: 22,
            workflowId: 33,
            workflowTransitionId: 44,
            reviewTaskId: 55,
        };

        await cleanupSmokeArtifacts({ callTool }, state);

        expect(callTool).toHaveBeenCalledWith('delete_content_item', { id: 11 });
        expect(callTool).toHaveBeenCalledWith('delete_content_type', { id: 22 });

        const deleteItemCallIndex = callTool.mock.calls.findIndex(
            ([tool]) => tool === 'delete_content_item',
        );
        const deleteTypeCallIndex = callTool.mock.calls.findIndex(
            ([tool]) => tool === 'delete_content_type',
        );

        expect(deleteItemCallIndex).toBeGreaterThanOrEqual(0);
        expect(deleteTypeCallIndex).toBeGreaterThan(deleteItemCallIndex);
    });
});

describe('resolveMcpHttpEndpoint', () => {
    it('derives /mcp from base urls', () => {
        expect(resolveMcpHttpEndpoint(undefined, 'http://localhost:4000')).toBe(
            'http://localhost:4000/mcp',
        );
        expect(resolveMcpHttpEndpoint(undefined, 'http://localhost:4000/api')).toBe(
            'http://localhost:4000/mcp',
        );
    });

    it('prefers explicit endpoints', () => {
        expect(
            resolveMcpHttpEndpoint(
                'http://localhost:4100/custom-mcp',
                'http://localhost:4000',
            ),
        ).toBe('http://localhost:4100/custom-mcp');
    });
});

describe('WordClawMcpClient over HTTP', () => {
    let app: FastifyInstance | null = null;
    let client: WordClawMcpClient | null = null;

    beforeEach(() => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'remote-admin=admin';
        process.env.ALLOW_INSECURE_LOCAL_ADMIN = 'false';
    });

    afterEach(async () => {
        if (client) {
            await client.stop();
            client = null;
        }

        if (app) {
            await app.close();
            app = null;
        }

        restoreEnv();
    });

    it('attaches to the remote /mcp endpoint with an API key', async () => {
        app = await buildServer();
        const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });

        client = new WordClawMcpClient(process.cwd(), {
            transport: 'http',
            endpoint: resolveMcpHttpEndpoint(undefined, baseUrl),
            apiKey: 'remote-admin',
        });
        await client.initialize();

        const capabilities = await inspectCapabilities(client);

        expect(capabilities.tools.some((tool) => tool.name === 'evaluate_policy')).toBe(true);
        expect(capabilities.resources.some((resource) => resource.uri === 'system://capabilities')).toBe(true);
        expect(capabilities.manifest).toEqual(expect.objectContaining({
            protocolSurfaces: expect.objectContaining({
                mcp: expect.objectContaining({
                    endpoint: '/mcp',
                    attachable: true,
                    transports: ['stdio', 'streamable-http'],
                }),
            }),
        }));
    });
});
