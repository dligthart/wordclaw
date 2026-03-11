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

function extractPromptUserText(
    messages: Array<{ role: 'user' | 'assistant'; content: { type: string; text?: string } }>,
): string {
    const text = messages.find(
        (message) =>
            message.role === 'user'
            && message.content.type === 'text'
            && typeof message.content.text === 'string',
    )?.content.text;

    if (typeof text !== 'string') {
        throw new Error('Expected text content in MCP prompt result.');
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
        const prompts = await client.listPrompts();
        const capabilityResource = await client.readResource({ uri: 'system://capabilities' });
        const deploymentStatusResource = await client.readResource({ uri: 'system://deployment-status' });
        const workspaceResource = await client.readResource({ uri: 'system://workspace-context' });
        const filteredWorkspaceResource = await client.readResource({ uri: 'system://workspace-context/review/1' });
        const guidanceResource = await client.readResource({ uri: 'system://agent-guidance' });
        const actorResource = await client.readResource({ uri: 'system://current-actor' });
        const taskPrompt = await client.getPrompt({
            name: 'task-guidance',
            arguments: {
                taskId: 'author-content'
            }
        });
        const taskGuide = await client.callTool({
            name: 'guide_task',
            arguments: {
                taskId: 'manage-integrations',
            }
        });
        const deploymentGuide = await client.callTool({
            name: 'guide_task',
            arguments: {
                taskId: 'discover-deployment',
            }
        });
        const workspaceGuide = await client.callTool({
            name: 'guide_task',
            arguments: {
                taskId: 'discover-workspace',
            }
        });
        const filteredWorkspaceGuide = await client.callTool({
            name: 'guide_task',
            arguments: {
                taskId: 'discover-workspace',
                intent: 'review',
                workspaceLimit: 1,
            }
        });
        const policyDecision = await client.callTool({
            name: 'evaluate_policy',
            arguments: {
                operation: 'content.read',
                resourceType: 'system'
            }
        });

        expect(tools.tools.some((tool) => tool.name === 'evaluate_policy')).toBe(true);
        expect(tools.tools.some((tool) => tool.name === 'guide_task')).toBe(true);
        expect(resources.resources.some((resource) => resource.uri === 'system://capabilities')).toBe(true);
        expect(resources.resources.some((resource) => resource.uri === 'system://deployment-status')).toBe(true);
        expect(resources.resources.some((resource) => resource.uri === 'system://workspace-context')).toBe(true);
        expect(resources.resources.some((resource) => resource.uri === 'system://agent-guidance')).toBe(true);
        expect(resources.resources.some((resource) => resource.uri === 'system://current-actor')).toBe(true);
        expect(prompts.prompts.some((prompt) => prompt.name === 'task-guidance')).toBe(true);

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
        const guidanceText = guidanceResource.contents.find((entry) => 'text' in entry)?.text;
        const deploymentStatusText = deploymentStatusResource.contents.find((entry) => 'text' in entry)?.text;
        const workspaceText = workspaceResource.contents.find((entry) => 'text' in entry)?.text;
        const filteredWorkspaceText = filteredWorkspaceResource.contents.find((entry) => 'text' in entry)?.text;
        expect(typeof guidanceText).toBe('string');
        expect(typeof deploymentStatusText).toBe('string');
        expect(typeof workspaceText).toBe('string');
        expect(typeof filteredWorkspaceText).toBe('string');
        expect(JSON.parse(deploymentStatusText as string)).toEqual(expect.objectContaining({
            overallStatus: 'ready',
            checks: expect.objectContaining({
                database: expect.objectContaining({
                    status: 'ready',
                }),
                mcp: expect.objectContaining({
                    endpoint: '/mcp',
                    transports: ['stdio', 'streamable-http'],
                }),
            }),
        }));
        expect(JSON.parse(guidanceText as string)).toEqual(expect.objectContaining({
            routingHints: expect.arrayContaining([
                expect.objectContaining({
                    intent: 'discover-workspace',
                    preferredActorProfile: 'api-key',
                }),
                expect.objectContaining({
                    intent: 'author-content',
                    preferredActorProfile: 'api-key',
                })
            ]),
            actorProfiles: expect.arrayContaining([
                expect.objectContaining({
                    id: 'api-key',
                    actorType: 'api_key',
                }),
                expect.objectContaining({
                    id: 'supervisor-session',
                    actorType: 'supervisor',
                }),
            ]),
            taskRecipes: expect.arrayContaining([
                expect.objectContaining({
                    id: 'discover-workspace',
                    preferredActorProfile: 'api-key',
                    recommendedApiKeyScopes: ['content:read'],
                }),
                expect.objectContaining({
                    id: 'author-content',
                    preferredActorProfile: 'api-key',
                    recommendedApiKeyScopes: ['content:write'],
                })
            ])
        }));
        const taskPromptText = extractPromptUserText(
            taskPrompt.messages as Array<{ role: 'user' | 'assistant'; content: { type: string; text?: string } }>,
        );
        const actorText = actorResource.contents.find((entry) => 'text' in entry)?.text;
        expect(typeof actorText).toBe('string');
        expect(JSON.parse(workspaceText as string)).toEqual(expect.objectContaining({
            currentActor: expect.objectContaining({
                actorId: 'env_key:remote-admin',
                actorProfileId: 'env-key',
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
        expect(JSON.parse(filteredWorkspaceText as string)).toEqual(expect.objectContaining({
            filter: expect.objectContaining({
                intent: 'review',
                limit: 1,
                returnedContentTypes: expect.any(Number),
            }),
            contentTypes: expect.any(Array),
        }));
        expect(JSON.parse(actorText as string)).toEqual(expect.objectContaining({
            actorId: 'env_key:remote-admin',
            actorType: 'env_key',
            actorProfileId: 'env-key',
            domainId: 1,
            assignmentRefs: ['env_key:remote-admin', 'remote-admin'],
        }));
        expect(taskPromptText).toContain('Task: author-content');
        expect(taskPromptText).toContain('Preferred surface: mcp');
        expect(taskPromptText).toContain('Preferred actor profile: api-key');
        expect(taskPromptText).toContain('Supported actor profiles: api-key, env-key, mcp-local, supervisor-session');
        expect(taskPromptText).toContain('Actor type: api_key');
        expect(taskPromptText).toContain('Domain context: implicit-from-key');

        const taskGuideText = extractFirstText(taskGuide.content as Array<{ type: string; text?: string }>);
        const deploymentGuideText = extractFirstText(deploymentGuide.content as Array<{ type: string; text?: string }>);
        const workspaceGuideText = extractFirstText(workspaceGuide.content as Array<{ type: string; text?: string }>);
        const filteredWorkspaceGuideText = extractFirstText(filteredWorkspaceGuide.content as Array<{ type: string; text?: string }>);
        expect(JSON.parse(taskGuideText)).toEqual(expect.objectContaining({
            taskId: 'manage-integrations',
            preferredSurface: 'mcp',
            currentActor: expect.objectContaining({
                actorId: 'env_key:remote-admin',
                actorProfileId: 'env-key',
            }),
            guide: expect.objectContaining({
                taskId: 'manage-integrations',
                actorReadiness: expect.objectContaining({
                    status: 'warning',
                }),
                apiKeys: expect.objectContaining({
                    accessible: true,
                }),
                webhooks: expect.objectContaining({
                    accessible: true,
                }),
            }),
        }));
        expect(JSON.parse(deploymentGuideText)).toEqual(expect.objectContaining({
            taskId: 'discover-deployment',
            preferredSurface: 'rest',
            deploymentStatus: expect.objectContaining({
                overallStatus: 'ready',
            }),
            guide: expect.objectContaining({
                overallStatus: 'ready',
                steps: expect.arrayContaining([
                    expect.objectContaining({
                        command: 'node dist/cli/index.js capabilities show',
                    }),
                    expect.objectContaining({
                        command: 'node dist/cli/index.js capabilities status',
                    }),
                ]),
            }),
        }));
        expect(JSON.parse(workspaceGuideText)).toEqual(expect.objectContaining({
            taskId: 'discover-workspace',
            preferredSurface: 'mcp',
            workspaceContext: expect.objectContaining({
                currentActor: expect.objectContaining({
                    actorId: 'env_key:remote-admin',
                }),
            }),
            guide: expect.objectContaining({
                taskId: 'discover-workspace',
                steps: expect.arrayContaining([
                    expect.objectContaining({
                        command: 'node dist/cli/index.js workspace guide',
                    }),
                ]),
            }),
        }));
        expect(JSON.parse(workspaceGuideText)).toEqual(expect.objectContaining({
            guide: expect.objectContaining({
                steps: expect.arrayContaining([
                    expect.objectContaining({
                        id: 'choose-authoring-target',
                    }),
                ]),
            }),
            workspaceContext: expect.objectContaining({
                targets: expect.objectContaining({
                    authoring: expect.any(Array),
                }),
            }),
        }));
        expect(JSON.parse(filteredWorkspaceGuideText)).toEqual(expect.objectContaining({
            workspaceContext: expect.objectContaining({
                filter: expect.objectContaining({
                    intent: 'review',
                    limit: 1,
                }),
            }),
        }));

        const decisionText = extractFirstText(policyDecision.content as Array<{ type: string; text?: string }>);
        expect(JSON.parse(decisionText)).toEqual(expect.objectContaining({
            outcome: 'allow'
        }));
    });
});
