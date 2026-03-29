import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { eq, inArray } from 'drizzle-orm';

const mocks = vi.hoisted(() => ({
    getWorkspaceContextSnapshotMock: vi.fn(),
    resolveWorkspaceTargetMock: vi.fn(),
}));

vi.mock('../services/workspace-context.js', () => ({
    getWorkspaceContextSnapshot: mocks.getWorkspaceContextSnapshotMock,
    resolveWorkspaceTarget: mocks.resolveWorkspaceTargetMock,
}));

import { buildServer } from '../server.js';
import { db } from '../db/index.js';
import { assets, domains } from '../db/schema.js';
import { getAssetStorageProvider } from '../services/asset-storage.js';

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
    let createdAssetIds: number[] = [];
    let createdDomainIds: number[] = [];

    beforeEach(() => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'remote-admin=admin';
        process.env.ALLOW_INSECURE_LOCAL_ADMIN = 'false';
        createdAssetIds = [];
        createdDomainIds = [];
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

        if (createdAssetIds.length > 0) {
            const storage = getAssetStorageProvider();
            const existingAssets = await db.select()
                .from(assets)
                .where(inArray(assets.id, createdAssetIds));

            for (const asset of existingAssets) {
                await storage.remove(asset.storageKey).catch(() => undefined);
            }

            await db.delete(assets).where(inArray(assets.id, createdAssetIds));
            createdAssetIds = [];
        }

        if (createdDomainIds.length > 0) {
            await db.delete(domains).where(inArray(domains.id, createdDomainIds));
            createdDomainIds = [];
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
        const assetsResource = await client.readResource({ uri: 'content://assets' });
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
        const bootstrapGuide = await client.callTool({
            name: 'guide_task',
            arguments: {
                taskId: 'bootstrap-workspace',
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
        expect(tools.tools.some((tool) => tool.name === 'create_domain')).toBe(true);
        expect(tools.tools.some((tool) => tool.name === 'create_asset')).toBe(true);
        expect(tools.tools.some((tool) => tool.name === 'list_assets')).toBe(true);
        expect(tools.tools.some((tool) => tool.name === 'get_asset')).toBe(true);
        expect(tools.tools.some((tool) => tool.name === 'get_asset_access')).toBe(true);
        expect(tools.tools.some((tool) => tool.name === 'issue_asset_access')).toBe(true);
        expect(tools.tools.some((tool) => tool.name === 'delete_asset')).toBe(true);
        expect(tools.tools.some((tool) => tool.name === 'restore_asset')).toBe(true);
        expect(tools.tools.some((tool) => tool.name === 'purge_asset')).toBe(true);
        expect(resources.resources.some((resource) => resource.uri === 'system://capabilities')).toBe(true);
        expect(resources.resources.some((resource) => resource.uri === 'system://deployment-status')).toBe(true);
        expect(resources.resources.some((resource) => resource.uri === 'system://workspace-context')).toBe(true);
        expect(resources.resources.some((resource) => resource.uri === 'system://agent-guidance')).toBe(true);
        expect(resources.resources.some((resource) => resource.uri === 'system://current-actor')).toBe(true);
        expect(resources.resources.some((resource) => resource.uri === 'content://assets')).toBe(true);
        expect(prompts.prompts.some((prompt) => prompt.name === 'task-guidance')).toBe(true);

        const manifestText = capabilityResource.contents.find((entry) => 'text' in entry)?.text;
        expect(typeof manifestText).toBe('string');
        expect(JSON.parse(manifestText as string)).toEqual(expect.objectContaining({
            bootstrap: expect.objectContaining({
                mcpCreateDomainTool: 'create_domain',
                recommendedGuideTask: 'bootstrap-workspace',
            }),
            assetStorage: expect.objectContaining({
                configuredProvider: 'local',
                effectiveProvider: 'local',
                upload: expect.objectContaining({
                    rest: expect.objectContaining({
                        modes: ['json-base64', 'multipart-form-data'],
                        directProviderUpload: expect.objectContaining({
                            enabled: false,
                            issuePath: '/api/assets/direct-upload',
                            completePath: '/api/assets/direct-upload/complete',
                        }),
                    }),
                    mcp: expect.objectContaining({
                        modes: ['inline-base64'],
                    }),
                }),
                delivery: expect.objectContaining({
                    supportedModes: ['public', 'signed', 'entitled'],
                    signed: expect.objectContaining({
                        issueTool: 'issue_asset_access',
                    }),
                }),
            }),
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
        const assetsText = assetsResource.contents.find((entry) => 'text' in entry)?.text;
        expect(typeof guidanceText).toBe('string');
        expect(typeof deploymentStatusText).toBe('string');
        expect(typeof workspaceText).toBe('string');
        expect(typeof filteredWorkspaceText).toBe('string');
        expect(typeof assetsText).toBe('string');
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
                bootstrap: expect.objectContaining({
                    mcpCreateDomainTool: 'create_domain',
                    recommendedGuideTask: 'bootstrap-workspace',
                }),
                assetStorage: expect.objectContaining({
                    enabled: true,
                    configuredProvider: 'local',
                    effectiveProvider: 'local',
                    restUploadModes: ['json-base64', 'multipart-form-data'],
                    mcpUploadModes: ['inline-base64'],
                    directProviderUpload: expect.objectContaining({
                        enabled: false,
                        issuePath: '/api/assets/direct-upload',
                        completePath: '/api/assets/direct-upload/complete',
                    }),
                    deliveryModes: ['public', 'signed', 'entitled'],
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
                    id: 'bootstrap-workspace',
                    preferredActorProfile: 'mcp-local',
                    recommendedApiKeyScopes: ['admin'],
                }),
                expect.objectContaining({
                    id: 'discover-workspace',
                    preferredActorProfile: 'api-key',
                    recommendedApiKeyScopes: ['content:read'],
                }),
                expect.objectContaining({
                    id: 'author-content',
                    preferredActorProfile: 'api-key',
                    recommendedApiKeyScopes: ['content:write'],
                    reactiveFollowUp: expect.objectContaining({
                        recipeId: 'content-lifecycle',
                        recommendedFilters: ['contentTypeId'],
                    }),
                })
            ])
        }));
        const assetsJson = JSON.parse(assetsText as string);
        expect(assetsJson).toEqual(expect.objectContaining({
            items: expect.any(Array),
            total: expect.any(Number),
            limit: expect.any(Number),
            hasMore: expect.any(Boolean),
        }));
        expect(assetsJson).toHaveProperty('nextCursor');
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
        expect(taskPromptText).toContain('Reactive follow-up:');
        expect(taskPromptText).toContain('Recipe: content-lifecycle');
        expect(taskPromptText).toContain('Example subscribe_events payload: {"recipeId":"content-lifecycle","filters":{"contentTypeId":"<resolved contentTypeId>"}}');
        expect(JSON.parse(manifestText as string)).toEqual(expect.objectContaining({
            modules: expect.arrayContaining([
                expect.objectContaining({
                    id: 'asset-storage',
                    enabled: true,
                }),
            ]),
            capabilities: expect.arrayContaining([
                expect.objectContaining({
                    id: 'create_domain',
                    mcp: expect.objectContaining({
                        tool: 'create_domain',
                    }),
                }),
                expect.objectContaining({
                    id: 'create_asset',
                    mcp: expect.objectContaining({
                        tool: 'create_asset',
                    }),
                }),
                expect.objectContaining({
                    id: 'list_assets',
                    mcp: expect.objectContaining({
                        tool: 'list_assets',
                    }),
                }),
            ]),
        }));

        const taskGuideText = extractFirstText(taskGuide.content as Array<{ type: string; text?: string }>);
        const resolvedWorkspaceTargetText = extractFirstText(resolvedWorkspaceTarget.content as Array<{ type: string; text?: string }>);
        const deploymentGuideText = extractFirstText(deploymentGuide.content as Array<{ type: string; text?: string }>);
        const bootstrapGuideText = extractFirstText(bootstrapGuide.content as Array<{ type: string; text?: string }>);
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
        expect(JSON.parse(bootstrapGuideText)).toEqual(expect.objectContaining({
            taskId: 'bootstrap-workspace',
            preferredSurface: 'mcp',
            guide: expect.objectContaining({
                taskId: 'bootstrap-workspace',
                bootstrap: expect.objectContaining({
                    mcpCreateDomainTool: 'create_domain',
                    recommendedGuideTask: 'bootstrap-workspace',
                }),
                steps: expect.arrayContaining([
                    expect.objectContaining({
                        id: 'create-domain',
                        status: 'completed',
                    }),
                    expect.objectContaining({
                        id: 'handoff-discover-workspace',
                        status: 'ready',
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

    it('creates domains over MCP for admin actors and blocks non-admin actors once bootstrap is complete', async () => {
        process.env.API_KEYS = 'remote-admin=admin,writer=content:write';
        app = await buildServer();
        const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });

        client = new Client({
            name: 'wordclaw-domain-bootstrap-test',
            version: '1.0.0'
        });

        const adminTransport = new StreamableHTTPClientTransport(new URL('/mcp', `${baseUrl}/`), {
            requestInit: {
                headers: {
                    'x-api-key': 'remote-admin'
                }
            }
        });

        await client.connect(adminTransport);

        const hostname = `bootstrap-${Date.now()}.example.test`;
        const created = await client.callTool({
            name: 'create_domain',
            arguments: {
                name: 'Bootstrap Domain',
                hostname,
            }
        });
        const createdPayload = JSON.parse(
            extractFirstText(created.content as Array<{ type: string; text?: string }>),
        ) as { id: number; hostname: string; bootstrap: boolean };
        createdDomainIds.push(createdPayload.id);

        expect(created.isError).not.toBe(true);
        expect(createdPayload).toEqual(expect.objectContaining({
            hostname,
            bootstrap: false,
        }));

        await client.close();
        client = new Client({
            name: 'wordclaw-domain-bootstrap-blocked-test',
            version: '1.0.0'
        });

        const writerTransport = new StreamableHTTPClientTransport(new URL('/mcp', `${baseUrl}/`), {
            requestInit: {
                headers: {
                    'x-api-key': 'writer'
                }
            }
        });

        await client.connect(writerTransport);

        const forbidden = await client.callTool({
            name: 'create_domain',
            arguments: {
                name: 'Forbidden Domain',
                hostname: `forbidden-${Date.now()}.example.test`,
            }
        });

        expect(forbidden.isError).toBe(true);
        expect(extractFirstText(forbidden.content as Array<{ type: string; text?: string }>)).toContain('DOMAIN_CREATE_FORBIDDEN');
    });

    it('supports MCP asset management while keeping byte delivery REST-first', async () => {
        app = await buildServer();
        const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });

        client = new Client({
            name: 'wordclaw-http-asset-test',
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

        const createPublicAsset = await client.callTool({
            name: 'create_asset',
            arguments: {
                filename: 'mcp-public-asset.txt',
                originalFilename: 'public-note.txt',
                mimeType: 'text/plain',
                contentBase64: Buffer.from('hello from mcp asset tool').toString('base64'),
                accessMode: 'public',
                metadata: {
                    source: 'mcp-http-test'
                }
            }
        });

        const createEntitledAsset = await client.callTool({
            name: 'create_asset',
            arguments: {
                filename: 'mcp-entitled-asset.txt',
                originalFilename: 'licensed-note.txt',
                mimeType: 'text/plain',
                contentBase64: Buffer.from('licensed hello').toString('base64'),
                accessMode: 'entitled',
                entitlementScope: {
                    type: 'subscription'
                },
                metadata: {
                    source: 'mcp-http-test'
                }
            }
        });
        const createSignedAsset = await client.callTool({
            name: 'create_asset',
            arguments: {
                filename: 'mcp-signed-asset.txt',
                originalFilename: 'private-note.txt',
                mimeType: 'text/plain',
                contentBase64: Buffer.from('signed hello').toString('base64'),
                accessMode: 'signed',
                metadata: {
                    source: 'mcp-http-test'
                }
            }
        });

        const publicAssetPayload = JSON.parse(
            extractFirstText(createPublicAsset.content as Array<{ type: string; text?: string }>)
        );
        const entitledAssetPayload = JSON.parse(
            extractFirstText(createEntitledAsset.content as Array<{ type: string; text?: string }>)
        );
        const signedAssetPayload = JSON.parse(
            extractFirstText(createSignedAsset.content as Array<{ type: string; text?: string }>)
        );

        const publicAssetId = publicAssetPayload.asset.id as number;
        const entitledAssetId = entitledAssetPayload.asset.id as number;
        const signedAssetId = signedAssetPayload.asset.id as number;
        createdAssetIds.push(publicAssetId, entitledAssetId, signedAssetId);

        const listResult = await client.callTool({
            name: 'list_assets',
            arguments: {
                q: 'mcp-',
                limit: 10
            }
        });
        const getResult = await client.callTool({
            name: 'get_asset',
            arguments: {
                id: publicAssetId
            }
        });
        const publicAccessResult = await client.callTool({
            name: 'get_asset_access',
            arguments: {
                id: publicAssetId
            }
        });
        const entitledAccessResult = await client.callTool({
            name: 'get_asset_access',
            arguments: {
                id: entitledAssetId
            }
        });
        const issueSignedAccessResult = await client.callTool({
            name: 'issue_asset_access',
            arguments: {
                id: signedAssetId,
                ttlSeconds: 120
            }
        });
        const assetResource = await client.readResource({ uri: `content://assets/${publicAssetId}` });
        const deleteResult = await client.callTool({
            name: 'delete_asset',
            arguments: {
                id: publicAssetId
            }
        });
        const restoreResult = await client.callTool({
            name: 'restore_asset',
            arguments: {
                id: publicAssetId
            }
        });
        const deleteAgainResult = await client.callTool({
            name: 'delete_asset',
            arguments: {
                id: publicAssetId
            }
        });
        const purgeResult = await client.callTool({
            name: 'purge_asset',
            arguments: {
                id: publicAssetId
            }
        });

        const listJson = JSON.parse(extractFirstText(listResult.content as Array<{ type: string; text?: string }>));
        const getJson = JSON.parse(extractFirstText(getResult.content as Array<{ type: string; text?: string }>));
        const publicAccessJson = JSON.parse(extractFirstText(publicAccessResult.content as Array<{ type: string; text?: string }>));
        const entitledAccessJson = JSON.parse(extractFirstText(entitledAccessResult.content as Array<{ type: string; text?: string }>));
        const signedAccessJson = JSON.parse(extractFirstText(issueSignedAccessResult.content as Array<{ type: string; text?: string }>));
        const deleteJson = JSON.parse(extractFirstText(deleteResult.content as Array<{ type: string; text?: string }>));
        const restoreJson = JSON.parse(extractFirstText(restoreResult.content as Array<{ type: string; text?: string }>));
        const deleteAgainJson = JSON.parse(extractFirstText(deleteAgainResult.content as Array<{ type: string; text?: string }>));
        const purgeJson = JSON.parse(extractFirstText(purgeResult.content as Array<{ type: string; text?: string }>));
        const assetResourceText = assetResource.contents.find((entry) => 'text' in entry)?.text;
        const signedReadResponse = await fetch(new URL(signedAccessJson.access.signedUrl as string, `${baseUrl}/`));

        expect(publicAssetPayload).toEqual(expect.objectContaining({
            asset: expect.objectContaining({
                id: expect.any(Number),
                filename: 'mcp-public-asset.txt',
                accessMode: 'public',
                delivery: expect.objectContaining({
                    readSurface: 'rest',
                    requiresAuth: false,
                    requiresEntitlement: false,
                }),
            }),
        }));
        expect(entitledAssetPayload).toEqual(expect.objectContaining({
            asset: expect.objectContaining({
                id: expect.any(Number),
                accessMode: 'entitled',
                entitlementScope: {
                    type: 'subscription',
                    ref: null,
                },
                delivery: expect.objectContaining({
                    readSurface: 'rest',
                    requiresAuth: true,
                    requiresEntitlement: true,
                }),
            }),
        }));
        expect(signedAssetPayload).toEqual(expect.objectContaining({
            asset: expect.objectContaining({
                id: expect.any(Number),
                accessMode: 'signed',
                delivery: expect.objectContaining({
                    accessPath: `/api/assets/${signedAssetId}/access`,
                    requiresAuth: true,
                    requiresEntitlement: false,
                }),
            }),
        }));
        expect(listJson.items).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: publicAssetId }),
            expect.objectContaining({ id: entitledAssetId }),
            expect.objectContaining({ id: signedAssetId }),
        ]));
        expect(getJson).toEqual(expect.objectContaining({
            id: publicAssetId,
            originalFilename: 'public-note.txt',
        }));
        expect(publicAccessJson).toEqual(expect.objectContaining({
            readSurface: 'rest',
            access: expect.objectContaining({
                auth: 'none',
                path: `/api/assets/${publicAssetId}/content`,
            }),
            offers: [],
        }));
        expect(entitledAccessJson).toEqual(expect.objectContaining({
            readSurface: 'rest',
            access: expect.objectContaining({
                auth: 'api-key-or-session',
                entitlementHeader: 'x-entitlement-id',
                path: `/api/assets/${entitledAssetId}/content`,
                offersPath: `/api/assets/${entitledAssetId}/offers`,
            }),
            offers: [],
        }));
        expect(signedAccessJson).toEqual(expect.objectContaining({
            asset: expect.objectContaining({
                id: signedAssetId,
                accessMode: 'signed',
            }),
            access: expect.objectContaining({
                mode: 'signed',
                contentPath: `/api/assets/${signedAssetId}/content`,
                signedUrl: expect.stringContaining(`/api/assets/${signedAssetId}/content?token=`),
                token: expect.any(String),
                ttlSeconds: 120,
            }),
        }));
        expect(signedReadResponse.status).toBe(200);
        expect(await signedReadResponse.text()).toBe('signed hello');
        expect(typeof assetResourceText).toBe('string');
        expect(JSON.parse(assetResourceText as string)).toEqual(expect.objectContaining({
            id: publicAssetId,
            filename: 'mcp-public-asset.txt',
        }));
        expect(deleteJson).toEqual(expect.objectContaining({
            asset: expect.objectContaining({
                id: publicAssetId,
                status: 'deleted',
            }),
        }));
        expect(restoreJson).toEqual(expect.objectContaining({
            asset: expect.objectContaining({
                id: publicAssetId,
                status: 'active',
            }),
        }));
        expect(deleteAgainJson).toEqual(expect.objectContaining({
            asset: expect.objectContaining({
                id: publicAssetId,
                status: 'deleted',
            }),
        }));
        expect(purgeJson).toEqual(expect.objectContaining({
            purged: true,
            asset: expect.objectContaining({
                id: publicAssetId,
                status: 'deleted',
            }),
            referenceSummary: {
                activeReferenceCount: 0,
                historicalReferenceCount: 0,
            },
        }));

        const [deletedRecord] = await db.select()
            .from(assets)
            .where(eq(assets.id, publicAssetId));
        expect(deletedRecord).toBeUndefined();
    });

    it('blocks purge_asset for non-admin actors', async () => {
        process.env.API_KEYS = 'writer=content:write';
        app = await buildServer();
        const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });

        client = new Client({
            name: 'wordclaw-http-asset-admin-test',
            version: '1.0.0'
        });

        const transport = new StreamableHTTPClientTransport(new URL('/mcp', `${baseUrl}/`), {
            requestInit: {
                headers: {
                    'x-api-key': 'writer'
                }
            }
        });

        await client.connect(transport);

        const purgeResult = await client.callTool({
            name: 'purge_asset',
            arguments: {
                id: 999999
            }
        });

        expect(purgeResult.isError).toBe(true);
        expect(extractFirstText(purgeResult.content as Array<{ type: string; text?: string }>)).toContain('ADMIN_REQUIRED');
    });

    it('returns actor-aware reactive recommendations in task guidance payloads', async () => {
        app = await buildServer();
        const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });

        client = new Client({
            name: 'wordclaw-reactive-guidance-test',
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

        const createTypeResponse = await fetch(new URL('/api/content-types', `${baseUrl}/`), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': 'remote-admin'
            },
            body: JSON.stringify({
                name: 'Reactive Guidance Article',
                slug: `reactive-guidance-article-${Date.now()}`,
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

        const authorGuide = await client.callTool({
            name: 'guide_task',
            arguments: {
                taskId: 'author-content',
                contentTypeId: createTypePayload.data.id,
            }
        });
        const integrationGuide = await client.callTool({
            name: 'guide_task',
            arguments: {
                taskId: 'manage-integrations',
            }
        });
        const entityProvenanceGuide = await client.callTool({
            name: 'guide_task',
            arguments: {
                taskId: 'verify-provenance',
                entityType: 'content_item',
                entityId: 123,
                action: 'update',
            }
        });
        const actorProvenanceGuide = await client.callTool({
            name: 'guide_task',
            arguments: {
                taskId: 'verify-provenance',
                actorId: 'env_key:remote-admin',
                actorType: 'env_key',
            }
        });

        const authorGuideJson = JSON.parse(
            extractFirstText(authorGuide.content as Array<{ type: string; text?: string }>),
        );
        const integrationGuideJson = JSON.parse(
            extractFirstText(integrationGuide.content as Array<{ type: string; text?: string }>),
        );
        const entityProvenanceGuideJson = JSON.parse(
            extractFirstText(entityProvenanceGuide.content as Array<{ type: string; text?: string }>),
        );
        const actorProvenanceGuideJson = JSON.parse(
            extractFirstText(actorProvenanceGuide.content as Array<{ type: string; text?: string }>),
        );

        expect(authorGuideJson).toEqual(expect.objectContaining({
            taskId: 'author-content',
            reactiveRecommendation: expect.objectContaining({
                available: true,
                recipeId: 'content-lifecycle',
                filters: {
                    contentTypeId: createTypePayload.data.id,
                },
                subscribe: {
                    tool: 'subscribe_events',
                    arguments: {
                        recipeId: 'content-lifecycle',
                        filters: {
                            contentTypeId: createTypePayload.data.id,
                        },
                    },
                },
            }),
        }));
        expect(authorGuideJson.reactiveRecommendation.resolvedTopics).toEqual(
            expect.arrayContaining(['content_item.create', 'content_item.update', 'content_item.published']),
        );

        expect(integrationGuideJson).toEqual(expect.objectContaining({
            taskId: 'manage-integrations',
            reactiveRecommendation: expect.objectContaining({
                available: true,
                recipeId: 'integration-admin',
                subscribe: {
                    tool: 'subscribe_events',
                    arguments: {
                        recipeId: 'integration-admin',
                    },
                },
            }),
        }));

        expect(entityProvenanceGuideJson).toEqual(expect.objectContaining({
            taskId: 'verify-provenance',
            reactiveRecommendation: expect.objectContaining({
                available: true,
                recipeId: 'content-lifecycle',
                filters: {
                    entityId: 123,
                    action: 'update',
                },
                subscribe: {
                    tool: 'subscribe_events',
                    arguments: {
                        recipeId: 'content-lifecycle',
                        filters: {
                            entityId: 123,
                            action: 'update',
                        },
                    },
                },
            }),
        }));

        expect(actorProvenanceGuideJson).toEqual(expect.objectContaining({
            taskId: 'verify-provenance',
            reactiveRecommendation: expect.objectContaining({
                available: true,
                recipeId: null,
                resolvedTopics: ['audit.*'],
                blockedTopics: [],
                filters: {
                    actorId: 'env_key:remote-admin',
                    actorType: 'env_key',
                },
                subscribe: {
                    tool: 'subscribe_events',
                    arguments: {
                        topics: ['audit.*'],
                        filters: {
                            actorId: 'env_key:remote-admin',
                            actorType: 'env_key',
                        },
                    },
                },
            }),
        }));
    });

    it('suppresses blocked reactive recommendations for actors without the required scopes', async () => {
        process.env.API_KEYS = 'reviewer=content:write';

        app = await buildServer();
        const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });

        client = new Client({
            name: 'wordclaw-reactive-guidance-blocked-test',
            version: '1.0.0'
        });

        const transport = new StreamableHTTPClientTransport(new URL('/mcp', `${baseUrl}/`), {
            requestInit: {
                headers: {
                    'x-api-key': 'reviewer'
                }
            }
        });

        await client.connect(transport);

        const guide = await client.callTool({
            name: 'guide_task',
            arguments: {
                taskId: 'manage-integrations',
            }
        });
        const guideJson = JSON.parse(
            extractFirstText(guide.content as Array<{ type: string; text?: string }>),
        );

        expect(guideJson).toEqual(expect.objectContaining({
            taskId: 'manage-integrations',
            reactiveRecommendation: expect.objectContaining({
                available: false,
                recipeId: 'integration-admin',
                subscribe: null,
                reason: 'Current actor is missing the scopes required for the recommended reactive subscription.',
            }),
        }));
        expect(guideJson.reactiveRecommendation.blockedTopics).toEqual(
            expect.arrayContaining(['api_key.create', 'webhook.create']),
        );
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

    it('delivers api key creation events through integration-admin recipe subscriptions', async () => {
        app = await buildServer();
        const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
        const notifications: Array<Record<string, any>> = [];

        client = new Client({
            name: 'wordclaw-reactive-api-key-test',
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

        const subscription = await client.callTool({
            name: 'subscribe_events',
            arguments: {
                recipeId: 'integration-admin',
                replaceExisting: true
            }
        });
        const subscriptionText = extractFirstText(subscription.content as Array<{ type: string; text?: string }>);
        expect(JSON.parse(subscriptionText)).toEqual(expect.objectContaining({
            recipe: expect.objectContaining({
                id: 'integration-admin',
                topics: expect.arrayContaining(['api_key.create', 'webhook.create']),
                requiredScopes: ['admin'],
            }),
            resolvedTopics: expect.arrayContaining(['api_key.create', 'webhook.create']),
            subscribedTopics: expect.arrayContaining(['api_key.create', 'webhook.create']),
            newlyAddedTopics: expect.arrayContaining(['api_key.create', 'webhook.create']),
            blockedTopics: [],
        }));

        const createKeyResponse = await fetch(new URL('/api/auth/keys', `${baseUrl}/`), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': 'remote-admin'
            },
            body: JSON.stringify({
                name: `Reactive session key ${Date.now()}`,
                scopes: ['content:read']
            })
        });
        expect(createKeyResponse.status).toBe(201);
        const createKeyPayload = await createKeyResponse.json() as {
            data: { id: number };
        };

        await vi.waitFor(() => {
            expect(
                notifications.some((notification) => (
                    notification.method === 'notifications/wordclaw/event'
                    && notification.params?.topic === 'api_key.create'
                    && notification.params?.event?.entityId === createKeyPayload.data.id
                ))
            ).toBe(true);
        }, { timeout: 5000 });

        const eventNotification = notifications.find((notification) => (
            notification.method === 'notifications/wordclaw/event'
            && notification.params?.topic === 'api_key.create'
            && notification.params?.event?.entityId === createKeyPayload.data.id
        ));

        expect(eventNotification).toEqual(expect.objectContaining({
            method: 'notifications/wordclaw/event',
            params: expect.objectContaining({
                topic: 'api_key.create',
                matchedTopics: ['api_key.create'],
                matchedSubscriptions: [
                    {
                        topic: 'api_key.create',
                        filters: {},
                    },
                ],
                event: expect.objectContaining({
                    source: 'audit',
                    domainId: 1,
                    entityType: 'api_key',
                    action: 'create',
                    entityId: createKeyPayload.data.id,
                    name: 'api_key.create',
                }),
            }),
        }));
    });

    it('blocks integration-admin reactive subscriptions for non-admin actors', async () => {
        process.env.API_KEYS = 'remote-admin=admin,writer=content:write';
        app = await buildServer();
        const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });

        client = new Client({
            name: 'wordclaw-reactive-api-key-blocked-test',
            version: '1.0.0'
        });

        const transport = new StreamableHTTPClientTransport(new URL('/mcp', `${baseUrl}/`), {
            requestInit: {
                headers: {
                    'x-api-key': 'writer'
                }
            }
        });

        await client.connect(transport);

        const subscription = await client.callTool({
            name: 'subscribe_events',
            arguments: {
                recipeId: 'integration-admin',
                replaceExisting: true
            }
        });
        const subscriptionText = extractFirstText(subscription.content as Array<{ type: string; text?: string }>);

        expect(JSON.parse(subscriptionText)).toEqual(expect.objectContaining({
            recipe: expect.objectContaining({
                id: 'integration-admin',
            }),
            subscribedTopics: [],
            newlyAddedTopics: [],
            blockedTopics: expect.arrayContaining([
                {
                    topic: 'api_key.create',
                    reason: 'Current actor is missing the scope required for this event topic.',
                },
                {
                    topic: 'webhook.create',
                    reason: 'Current actor is missing the scope required for this event topic.',
                },
            ]),
            unsupportedTopics: [],
        }));
    });

    it('rejects reactive subscriptions without topics or a recipe', async () => {
        app = await buildServer();
        const baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });

        client = new Client({
            name: 'wordclaw-reactive-missing-selection-test',
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

        const subscription = await client.callTool({
            name: 'subscribe_events',
            arguments: {
                replaceExisting: true
            }
        });
        const subscriptionText = extractFirstText(subscription.content as Array<{ type: string; text?: string }>);

        expect(subscription.isError).toBe(true);
        expect(subscriptionText).toContain('MISSING_REACTIVE_SELECTION');
    });
});
