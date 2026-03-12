import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const mocks = vi.hoisted(() => ({
    getWorkspaceContextSnapshotMock: vi.fn(),
    resolveWorkspaceTargetMock: vi.fn(),
}));

vi.mock('../services/workspace-context.js', () => ({
    getWorkspaceContextSnapshot: mocks.getWorkspaceContextSnapshotMock,
    resolveWorkspaceTarget: mocks.resolveWorkspaceTargetMock,
}));

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
        mocks.getWorkspaceContextSnapshotMock.mockImplementation(async (currentActor, options) => ({
            generatedAt: '2026-03-11T12:00:00.000Z',
            currentActor,
            currentDomain: {
                id: currentActor.domainId,
                name: 'Local Dev',
                hostname: 'localhost',
                current: true,
            },
            accessibleDomains: [{
                id: currentActor.domainId,
                name: 'Local Dev',
                hostname: 'localhost',
                current: true,
            }],
            filter: {
                intent: options?.intent ?? 'all',
                search: options?.search ?? null,
                limit: options?.limit ?? null,
                totalContentTypesBeforeFilter: 2,
                totalContentTypesAfterSearch: 1,
                returnedContentTypes: 1,
            },
            summary: {
                totalContentTypes: 2,
                contentTypesWithContent: 1,
                workflowEnabledContentTypes: 1,
                paidContentTypes: 0,
                pendingReviewTaskCount: 1,
            },
            targets: {
                authoring: [{
                    id: 12,
                    name: 'Editorial Article',
                    slug: 'editorial-article',
                    itemCount: 1,
                    pendingReviewTaskCount: 1,
                    activeWorkflowCount: 1,
                    activeTypeOfferCount: 0,
                    reason: '1 stored item(s) and 1 active workflow(s) make this a strong authoring target.',
                    recommendedCommands: {
                        contentGuide: 'node dist/cli/index.js content guide --content-type-id 12',
                        listContent: 'node dist/cli/index.js content list --content-type-id 12',
                        workflowActive: 'node dist/cli/index.js workflow active --content-type-id 12',
                    },
                }],
                review: [{
                    id: 12,
                    name: 'Editorial Article',
                    slug: 'editorial-article',
                    itemCount: 1,
                    pendingReviewTaskCount: 1,
                    activeWorkflowCount: 1,
                    activeTypeOfferCount: 0,
                    reason: '1 pending review task(s) across 1 stored item(s).',
                    recommendedCommands: {
                        contentGuide: 'node dist/cli/index.js content guide --content-type-id 12',
                        listContent: 'node dist/cli/index.js content list --content-type-id 12',
                        workflowActive: 'node dist/cli/index.js workflow active --content-type-id 12',
                    },
                }],
                workflow: [{
                    id: 12,
                    name: 'Editorial Article',
                    slug: 'editorial-article',
                    itemCount: 1,
                    pendingReviewTaskCount: 1,
                    activeWorkflowCount: 1,
                    activeTypeOfferCount: 0,
                    reason: '1 active workflow(s) and 1 pending review task(s) are mapped to this schema.',
                    recommendedCommands: {
                        contentGuide: 'node dist/cli/index.js content guide --content-type-id 12',
                        listContent: 'node dist/cli/index.js content list --content-type-id 12',
                        workflowActive: 'node dist/cli/index.js workflow active --content-type-id 12',
                    },
                }],
                paid: [],
            },
            contentTypes: [{
                id: 12,
                name: 'Editorial Article',
                slug: 'editorial-article',
                description: 'Reviewed content',
                fieldCount: 2,
                requiredFieldCount: 1,
                itemCount: 1,
                hasContent: true,
                pendingReviewTaskCount: 1,
                lastItemUpdatedAt: '2026-03-11T11:00:00.000Z',
                paid: {
                    basePrice: null,
                    activeTypeOfferCount: 0,
                    lowestTypeOfferSats: null,
                },
                workflow: {
                    activeWorkflowCount: 1,
                    activeWorkflows: [{
                        id: 22,
                        name: 'Editorial Flow',
                        transitionCount: 1,
                    }],
                },
                recommendedCommands: {
                    contentGuide: 'node dist/cli/index.js content guide --content-type-id 12',
                    listContent: 'node dist/cli/index.js content list --content-type-id 12',
                    workflowActive: 'node dist/cli/index.js workflow active --content-type-id 12',
                },
            }],
            warnings: [],
        }));
        mocks.resolveWorkspaceTargetMock.mockImplementation(async (currentActor, options) => ({
            generatedAt: '2026-03-11T12:00:00.000Z',
            currentActor,
            currentDomain: {
                id: currentActor.domainId,
                name: 'Local Dev',
                hostname: 'localhost',
                current: true,
            },
            intent: options.intent,
            search: options.search ?? null,
            availableTargetCount: 1,
            target: {
                id: 12,
                name: 'Editorial Article',
                slug: 'editorial-article',
                itemCount: 1,
                pendingReviewTaskCount: 1,
                activeWorkflowCount: 1,
                activeTypeOfferCount: 0,
                reason: '1 pending review task(s) across 1 stored item(s).',
                rank: 1,
                recommendedCommands: {
                    contentGuide: 'node dist/cli/index.js content guide --content-type-id 12',
                    listContent: 'node dist/cli/index.js content list --content-type-id 12',
                    workflowActive: 'node dist/cli/index.js workflow active --content-type-id 12',
                },
                contentType: {
                    id: 12,
                    name: 'Editorial Article',
                    slug: 'editorial-article',
                    description: 'Reviewed content',
                    fieldCount: 2,
                    requiredFieldCount: 1,
                    itemCount: 1,
                    hasContent: true,
                    pendingReviewTaskCount: 1,
                    lastItemUpdatedAt: '2026-03-11T11:00:00.000Z',
                    paid: {
                        basePrice: null,
                        activeTypeOfferCount: 0,
                        lowestTypeOfferSats: null,
                    },
                    workflow: {
                        activeWorkflowCount: 1,
                        activeWorkflows: [{
                            id: 22,
                            name: 'Editorial Flow',
                            transitionCount: 1,
                        }],
                    },
                    recommendedCommands: {
                        contentGuide: 'node dist/cli/index.js content guide --content-type-id 12',
                        listContent: 'node dist/cli/index.js content list --content-type-id 12',
                        workflowActive: 'node dist/cli/index.js workflow active --content-type-id 12',
                    },
                },
                workTarget: {
                    kind: 'review-task',
                    status: 'ready',
                    label: 'Editorial Draft (draft → in_review)',
                    reason: 'Review task #88 is actionable for the current actor.',
                    notes: ['Workflow: Editorial Flow.', 'Content item #501 is currently in_review.'],
                    recommendedCommands: [
                        'node dist/cli/index.js workflow guide --task 88',
                        'node dist/cli/index.js workflow decide --id 88 --decision approved',
                        'node dist/cli/index.js content get --id 501',
                    ],
                    contentType: {
                        id: 12,
                        name: 'Editorial Article',
                        slug: 'editorial-article',
                    },
                    contentItem: {
                        id: 501,
                        label: 'Editorial Draft',
                        status: 'in_review',
                        version: 3,
                        slug: 'editorial-draft',
                        createdAt: '2026-03-11T10:30:00.000Z',
                        updatedAt: '2026-03-11T11:00:00.000Z',
                    },
                    reviewTask: {
                        id: 88,
                        status: 'pending',
                        assignee: currentActor.actorId,
                        workflowTransitionId: 77,
                        actionable: true,
                        fromState: 'draft',
                        toState: 'in_review',
                    },
                    workflow: {
                        id: 22,
                        name: 'Editorial Flow',
                        transitionCount: 1,
                    },
                    paid: null,
                },
            },
            alternatives: [],
            warnings: [],
        }));
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
        mocks.getWorkspaceContextSnapshotMock.mockReset();
        mocks.resolveWorkspaceTargetMock.mockReset();
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
        expect(transport.sessionId).toBeTruthy();

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
                taskId: 'discover-workspace',
                intent: 'review',
            }
        });
        const resolvedWorkspaceTarget = await client.callTool({
            name: 'resolve_workspace_target',
            arguments: {
                intent: 'review',
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
        expect(tools.tools.some((tool) => tool.name === 'resolve_workspace_target')).toBe(true);
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
            checks: expect.objectContaining({
                database: expect.objectContaining({
                    status: expect.any(String),
                }),
                mcp: expect.objectContaining({
                    status: 'ready',
                    attachable: true,
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
        const resolvedWorkspaceTargetText = extractFirstText(resolvedWorkspaceTarget.content as Array<{ type: string; text?: string }>);
        const deploymentGuideText = extractFirstText(deploymentGuide.content as Array<{ type: string; text?: string }>);
        const workspaceGuideText = extractFirstText(workspaceGuide.content as Array<{ type: string; text?: string }>);
        const filteredWorkspaceGuideText = extractFirstText(filteredWorkspaceGuide.content as Array<{ type: string; text?: string }>);
        const taskGuideJson = JSON.parse(taskGuideText);
        expect(taskGuideJson.taskId).toBe('discover-workspace');
        expect(taskGuideJson.preferredSurface).toBe('mcp');
        expect(taskGuideJson.currentActor).toEqual(expect.objectContaining({
            actorId: 'env_key:remote-admin',
            actorProfileId: 'env-key',
        }));
        expect(taskGuideJson.guide).toEqual(expect.objectContaining({
            taskId: 'discover-workspace',
            steps: expect.arrayContaining([
                expect.objectContaining({
                    id: 'choose-authoring-target',
                }),
            ]),
        }));
        expect(taskGuideJson.resolvedTarget).toEqual(expect.objectContaining({
            intent: 'review',
            target: expect.objectContaining({
                workTarget: expect.objectContaining({
                    kind: 'review-task',
                }),
            }),
        }));
        const deploymentGuideJson = JSON.parse(deploymentGuideText);
        expect(deploymentGuideJson.taskId).toBe('discover-deployment');
        expect(deploymentGuideJson.preferredSurface).toBe('rest');
        expect(deploymentGuideJson.deploymentStatus).toEqual(expect.objectContaining({
            checks: expect.objectContaining({
                mcp: expect.objectContaining({
                    endpoint: '/mcp',
                }),
            }),
        }));
        expect(deploymentGuideJson.guide).toEqual(expect.objectContaining({
            steps: expect.arrayContaining([
                expect.objectContaining({
                    command: 'node dist/cli/index.js capabilities show',
                }),
                expect.objectContaining({
                    command: 'node dist/cli/index.js capabilities status',
                }),
            ]),
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
        expect(JSON.parse(resolvedWorkspaceTargetText)).toEqual(expect.objectContaining({
            intent: 'review',
            target: expect.objectContaining({
                rank: 1,
                workTarget: expect.objectContaining({
                    kind: 'review-task',
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
            resolvedTarget: expect.objectContaining({
                intent: 'review',
                target: expect.objectContaining({
                    rank: 1,
                    workTarget: expect.objectContaining({
                        kind: 'review-task',
                    }),
                }),
            }),
        }));

        const decisionText = extractFirstText(policyDecision.content as Array<{ type: string; text?: string }>);
        expect(JSON.parse(decisionText)).toEqual(expect.objectContaining({
            outcome: 'allow'
        }));
    });

    it('streams subscribed content publication events over the MCP SSE session', async () => {
        app = await buildServer();
        const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
        const notifications: Array<Record<string, any>> = [];

        client = new Client({
            name: 'wordclaw-reactive-http-test',
            version: '1.0.0'
        });
        client.fallbackNotificationHandler = async (notification) => {
            notifications.push(notification as Record<string, any>);
        };

        const transport = new StreamableHTTPClientTransport(new URL('/mcp', `${baseUrl}/`), {
            requestInit: {
                headers: {
                    'x-api-key': 'remote-admin'
                }
            }
        });

        await client.connect(transport);
        expect(transport.sessionId).toBeTruthy();

        await vi.waitFor(async () => {
            const probe = await fetch(new URL('/mcp', `${baseUrl}/`), {
                method: 'GET',
                headers: {
                    accept: 'text/event-stream',
                    'mcp-session-id': transport.sessionId as string,
                    'x-api-key': 'remote-admin'
                }
            });

            expect(probe.status).toBe(409);
        });

        const createTypeResponse = await fetch(new URL('/api/content-types', `${baseUrl}/`), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': 'remote-admin'
            },
            body: JSON.stringify({
                name: 'Reactive Article',
                slug: `reactive-article-${Date.now()}`,
                schema: {
                    type: 'object',
                    properties: {
                        title: { type: 'string' }
                    },
                    required: ['title']
                }
            })
        });
        expect(createTypeResponse.status).toBe(201);
        const createTypePayload = await createTypeResponse.json() as {
            data: { id: number };
        };

        const subscription = await client.callTool({
            name: 'subscribe_events',
            arguments: {
                topics: ['content_item.published'],
                replaceExisting: true
            }
        });
        const subscriptionText = extractFirstText(subscription.content as Array<{ type: string; text?: string }>);
        expect(JSON.parse(subscriptionText)).toEqual(expect.objectContaining({
            subscribedTopics: ['content_item.published'],
            newlyAddedTopics: ['content_item.published'],
        }));

        const createItemResponse = await fetch(new URL('/api/content-items', `${baseUrl}/`), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': 'remote-admin'
            },
            body: JSON.stringify({
                contentTypeId: createTypePayload.data.id,
                data: {
                    title: 'Reactive publish event'
                },
                status: 'published'
            })
        });

        expect(createItemResponse.status).toBe(201);

        await vi.waitFor(() => {
            expect(
                notifications.some((notification) => (
                    notification.method === 'notifications/wordclaw/event'
                    && notification.params?.topic === 'content_item.published'
                ))
            ).toBe(true);
        }, { timeout: 5000 });

        const eventNotification = notifications.find((notification) => (
            notification.method === 'notifications/wordclaw/event'
            && notification.params?.topic === 'content_item.published'
        ));

        expect(eventNotification).toEqual(expect.objectContaining({
            method: 'notifications/wordclaw/event',
            params: expect.objectContaining({
                topic: 'content_item.published',
                matchedTopics: ['content_item.published'],
                matchedSubscriptions: [
                    {
                        topic: 'content_item.published',
                        filters: {},
                    },
                ],
                event: expect.objectContaining({
                    source: 'audit',
                    domainId: 1,
                    entityType: 'content_item',
                    action: 'create',
                    name: 'content_item.published',
                })
            })
        }));
    });

    it('applies content-type filters to reactive subscriptions', async () => {
        app = await buildServer();
        const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
        const notifications: Array<Record<string, any>> = [];

        client = new Client({
            name: 'wordclaw-reactive-filter-test',
            version: '1.0.0'
        });
        client.fallbackNotificationHandler = async (notification) => {
            notifications.push(notification as Record<string, any>);
        };

        const transport = new StreamableHTTPClientTransport(new URL('/mcp', `${baseUrl}/`), {
            requestInit: {
                headers: {
                    'x-api-key': 'remote-admin'
                }
            }
        });

        await client.connect(transport);
        expect(transport.sessionId).toBeTruthy();

        await vi.waitFor(async () => {
            const probe = await fetch(new URL('/mcp', `${baseUrl}/`), {
                method: 'GET',
                headers: {
                    accept: 'text/event-stream',
                    'mcp-session-id': transport.sessionId as string,
                    'x-api-key': 'remote-admin'
                }
            });

            expect(probe.status).toBe(409);
        });

        const createContentType = async (name: string, slug: string) => {
            const response = await fetch(new URL('/api/content-types', `${baseUrl}/`), {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-api-key': 'remote-admin'
                },
                body: JSON.stringify({
                    name,
                    slug,
                    schema: {
                        type: 'object',
                        properties: {
                            title: { type: 'string' }
                        },
                        required: ['title']
                    }
                })
            });

            expect(response.status).toBe(201);
            const payload = await response.json() as {
                data: { id: number };
            };
            return payload.data.id;
        };

        const filteredContentTypeId = await createContentType(
            'Filtered Reactive Article',
            `filtered-reactive-article-${Date.now()}`,
        );
        const otherContentTypeId = await createContentType(
            'Other Reactive Article',
            `other-reactive-article-${Date.now()}`,
        );

        const subscription = await client.callTool({
            name: 'subscribe_events',
            arguments: {
                topics: ['content_item.published'],
                replaceExisting: true,
                filters: {
                    contentTypeId: filteredContentTypeId,
                },
            }
        });
        const subscriptionText = extractFirstText(subscription.content as Array<{ type: string; text?: string }>);
        expect(JSON.parse(subscriptionText)).toEqual(expect.objectContaining({
            subscribedTopics: ['content_item.published'],
            subscriptions: [
                {
                    topic: 'content_item.published',
                    filters: {
                        contentTypeId: filteredContentTypeId,
                    },
                },
            ],
        }));

        const createPublishedItem = async (contentTypeId: number, title: string) => {
            const response = await fetch(new URL('/api/content-items', `${baseUrl}/`), {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-api-key': 'remote-admin'
                },
                body: JSON.stringify({
                    contentTypeId,
                    data: {
                        title,
                    },
                    status: 'published'
                })
            });

            expect(response.status).toBe(201);
            const payload = await response.json() as {
                data: { id: number };
            };
            return payload.data.id;
        };

        const unrelatedItemId = await createPublishedItem(otherContentTypeId, 'Unrelated reactive event');
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(
            notifications.some((notification) => (
                notification.method === 'notifications/wordclaw/event'
                && notification.params?.event?.entityId === unrelatedItemId
            ))
        ).toBe(false);

        const filteredItemId = await createPublishedItem(filteredContentTypeId, 'Filtered reactive event');

        await vi.waitFor(() => {
            expect(
                notifications.some((notification) => (
                    notification.method === 'notifications/wordclaw/event'
                    && notification.params?.event?.entityId === filteredItemId
                ))
            ).toBe(true);
        }, { timeout: 5000 });

        const eventNotification = notifications.find((notification) => (
            notification.method === 'notifications/wordclaw/event'
            && notification.params?.event?.entityId === filteredItemId
        ));

        expect(eventNotification).toEqual(expect.objectContaining({
            params: expect.objectContaining({
                topic: 'content_item.published',
                matchedTopics: ['content_item.published'],
                matchedSubscriptions: [
                    {
                        topic: 'content_item.published',
                        filters: {
                            contentTypeId: filteredContentTypeId,
                        },
                    },
                ],
                event: expect.objectContaining({
                    entityId: filteredItemId,
                }),
            }),
        }));
    });
});
