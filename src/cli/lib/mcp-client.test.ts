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
        expect(capabilities.resources.some((resource) => resource.uri === 'system://deployment-status')).toBe(true);
        expect(capabilities.resources.some((resource) => resource.uri === 'system://current-actor')).toBe(true);
        expect(capabilities.resources.some((resource) => resource.uri === 'system://workspace-context')).toBe(true);
        expect(capabilities.manifest).toEqual(expect.objectContaining({
            protocolSurfaces: expect.objectContaining({
                mcp: expect.objectContaining({
                    endpoint: '/mcp',
                    attachable: true,
                    transports: ['stdio', 'streamable-http'],
                    reactive: expect.objectContaining({
                        supported: true,
                        transport: 'streamable-http',
                        subscriptionTool: 'subscribe_events',
                        notificationMethod: 'notifications/wordclaw/event',
                        subscriptionRecipes: expect.arrayContaining([
                            expect.objectContaining({
                                id: 'content-publication',
                                topics: ['content_item.published'],
                            }),
                            expect.objectContaining({
                                id: 'integration-admin',
                                requiredScopes: ['admin'],
                            }),
                        ]),
                        supportedFilterFields: expect.arrayContaining(['contentTypeId', 'entityId', 'actorType']),
                    }),
                }),
            }),
            agentGuidance: expect.objectContaining({
                taskRecipes: expect.arrayContaining([
                    expect.objectContaining({
                        id: 'author-content',
                        reactiveFollowUp: expect.objectContaining({
                            recipeId: 'content-lifecycle',
                        }),
                    }),
                    expect.objectContaining({
                        id: 'verify-provenance',
                        reactiveFollowUp: expect.objectContaining({
                            recipeId: null,
                            topics: ['audit.*'],
                        }),
                    }),
                ]),
            }),
        }));
        expect(capabilities.currentActor).toEqual(expect.objectContaining({
            actorId: 'env_key:remote-admin',
            actorType: 'env_key',
            actorProfileId: 'env-key',
            domainId: 1,
            assignmentRefs: ['env_key:remote-admin', 'remote-admin'],
        }));
        expect(capabilities.deploymentStatus).toEqual(expect.objectContaining({
            overallStatus: expect.any(String),
            checks: expect.objectContaining({
                database: expect.objectContaining({
                    status: expect.any(String),
                }),
            }),
        }));
        if (capabilities.workspaceContext) {
            expect(capabilities.workspaceContext).toEqual(expect.objectContaining({
                currentActor: expect.objectContaining({
                    actorId: 'env_key:remote-admin',
                }),
                currentDomain: expect.objectContaining({
                    id: 1,
                }),
                targets: expect.objectContaining({
                    authoring: expect.any(Array),
                    review: expect.any(Array),
                    workflow: expect.any(Array),
                    paid: expect.any(Array),
                }),
            }));
        } else {
            expect(capabilities.currentActor).toEqual(expect.objectContaining({
                actorId: 'env_key:remote-admin',
            }));
        }
    }, 30000);
});
