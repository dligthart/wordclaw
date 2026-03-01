import Fastify, { type FastifyRequest } from 'fastify';
import mercurius from 'mercurius';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { agentRunDefinitions, agentRuns, contentItems, contentTypes, domains } from '../db/schema.js';
import { resolvers } from './resolvers.js';
import { schema } from './schema.js';

describe('GraphQL Tenant Isolation', () => {
    let app: ReturnType<typeof Fastify>;
    let domain1TypeId: number;
    let domain2TypeId: number;
    let domain1ItemId: number;
    let domain2ItemId: number;
    let domain1RunId: number;
    let domain1DefinitionId: number;

    beforeAll(async () => {
        const [domain1] = await db.select().from(domains).where(eq(domains.id, 1));
        if (!domain1) {
            await db.insert(domains).values({
                id: 1,
                name: 'Default Local Domain',
                hostname: 'localhost'
            });
        }

        const [domain2] = await db.select().from(domains).where(eq(domains.id, 2));
        if (!domain2) {
            await db.insert(domains).values({
                id: 2,
                name: 'GraphQL Tenant Isolation Domain',
                hostname: `graphql-tenant-${Date.now()}.local`
            });
        }

        const [type1] = await db.insert(contentTypes).values({
            domainId: 1,
            name: 'Tenant One GraphQL Type',
            slug: `tenant-one-graphql-type-${Date.now()}`,
            schema: JSON.stringify({
                type: 'object',
                properties: { title: { type: 'string' } },
                required: ['title']
            }),
            basePrice: 0
        }).returning();
        domain1TypeId = type1.id;

        const [type2] = await db.insert(contentTypes).values({
            domainId: 2,
            name: 'Tenant Two GraphQL Type',
            slug: `tenant-two-graphql-type-${Date.now()}`,
            schema: JSON.stringify({
                type: 'object',
                properties: { title: { type: 'string' } },
                required: ['title']
            }),
            basePrice: 0
        }).returning();
        domain2TypeId = type2.id;

        const [item1] = await db.insert(contentItems).values({
            domainId: 1,
            contentTypeId: domain1TypeId,
            data: JSON.stringify({ title: 'domain-one-item' }),
            status: 'draft'
        }).returning();
        domain1ItemId = item1.id;

        const [item2] = await db.insert(contentItems).values({
            domainId: 2,
            contentTypeId: domain2TypeId,
            data: JSON.stringify({ title: 'domain-two-item' }),
            status: 'draft'
        }).returning();
        domain2ItemId = item2.id;

        const [run1] = await db.insert(agentRuns).values({
            domainId: 1,
            goal: `domain-one-tenant-graphql-run-${Date.now()}`,
            runType: 'review_backlog_manager',
            status: 'waiting_approval',
            requestedBy: 'tenant-1'
        }).returning();
        domain1RunId = run1.id;

        const [definition1] = await db.insert(agentRunDefinitions).values({
            domainId: 1,
            name: `domain-one-graphql-def-${Date.now()}`,
            runType: 'review_backlog_manager',
            strategyConfig: {},
            active: true
        }).returning();
        domain1DefinitionId = definition1.id;

        app = Fastify({ logger: false });
        app.register(mercurius, {
            schema,
            resolvers,
            context: async (request: FastifyRequest) => {
                const domainHeader = request.headers['x-domain-id'];
                const domainId = typeof domainHeader === 'string'
                    ? Number.parseInt(domainHeader, 10)
                    : 1;

                return {
                    requestId: request.id,
                    headers: request.headers as Record<string, string>,
                    url: '/graphql',
                    authPrincipal: {
                        keyId: `tenant-${domainId}`,
                        domainId,
                        scopes: new Set(['admin']),
                        source: 'test'
                    }
                };
            }
        });

        await app.ready();
    });

    afterAll(async () => {
        await app?.close();
        if (domain1ItemId) {
            await db.delete(contentItems).where(eq(contentItems.id, domain1ItemId));
        }
        if (domain2ItemId) {
            await db.delete(contentItems).where(eq(contentItems.id, domain2ItemId));
        }
        if (domain1TypeId) {
            await db.delete(contentTypes).where(eq(contentTypes.id, domain1TypeId));
        }
        if (domain2TypeId) {
            await db.delete(contentTypes).where(eq(contentTypes.id, domain2TypeId));
        }
        if (domain1RunId) {
            await db.delete(agentRuns).where(eq(agentRuns.id, domain1RunId));
        }
        if (domain1DefinitionId) {
            await db.delete(agentRunDefinitions).where(eq(agentRunDefinitions.id, domain1DefinitionId));
        }
    });

    it('rejects assigning a cross-tenant content type on updateContentItem', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/graphql',
            headers: {
                'x-domain-id': '2'
            },
            payload: {
                query: `
                  mutation UpdateItem($id: ID!, $contentTypeId: ID!, $data: JSON) {
                    updateContentItem(id: $id, contentTypeId: $contentTypeId, data: $data) { id }
                  }
                `,
                variables: {
                    id: String(domain2ItemId),
                    contentTypeId: String(domain1TypeId),
                    data: { title: 'attempt-cross-tenant-type' }
                }
            }
        });

        expect(response.statusCode).toBe(200);
        const payload = response.json() as {
            errors?: Array<{ extensions?: { code?: string } }>
        };
        expect(payload.errors?.[0]?.extensions?.code).toBe('CONTENT_TYPE_NOT_FOUND');
    });

    it('returns CONTENT_TYPE_NOT_FOUND in createContentItemsBatch for foreign content type IDs', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/graphql',
            headers: {
                'x-domain-id': '2'
            },
            payload: {
                query: `
                  mutation CreateBatch($items: [BatchCreateContentItemInput!]!) {
                    createContentItemsBatch(items: $items, atomic: false) {
                      results { index ok code error }
                    }
                  }
                `,
                variables: {
                    items: [{
                        contentTypeId: String(domain1TypeId),
                        data: { title: 'cross-tenant-batch-create' },
                        status: 'draft'
                    }]
                }
            }
        });

        expect(response.statusCode).toBe(200);
        const payload = response.json() as {
            data?: {
                createContentItemsBatch?: {
                    results: Array<{ code?: string; ok: boolean }>
                }
            }
        };
        expect(payload.data?.createContentItemsBatch?.results[0]?.ok).toBe(false);
        expect(payload.data?.createContentItemsBatch?.results[0]?.code).toBe('CONTENT_TYPE_NOT_FOUND');
    });

    it('returns CONTENT_ITEM_NOT_FOUND in updateContentItemsBatch for foreign item IDs', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/graphql',
            headers: {
                'x-domain-id': '2'
            },
            payload: {
                query: `
                  mutation UpdateBatch($items: [BatchUpdateContentItemInput!]!) {
                    updateContentItemsBatch(items: $items, atomic: false) {
                      results { index ok code error }
                    }
                  }
                `,
                variables: {
                    items: [{
                        id: String(domain1ItemId),
                        data: { title: 'cross-tenant-batch-update' }
                    }]
                }
            }
        });

        expect(response.statusCode).toBe(200);
        const payload = response.json() as {
            data?: {
                updateContentItemsBatch?: {
                    results: Array<{ code?: string; ok: boolean }>
                }
            }
        };
        expect(payload.data?.updateContentItemsBatch?.results[0]?.ok).toBe(false);
        expect(payload.data?.updateContentItemsBatch?.results[0]?.code).toBe('CONTENT_ITEM_NOT_FOUND');
    });

    it('hides cross-tenant agent runs and rejects cross-tenant control actions', async () => {
        const queryResponse = await app.inject({
            method: 'POST',
            url: '/graphql',
            headers: {
                'x-domain-id': '2'
            },
            payload: {
                query: `
                  query AgentRun($id: ID!) {
                    agentRun(id: $id) { id status }
                  }
                `,
                variables: {
                    id: String(domain1RunId)
                }
            }
        });

        expect(queryResponse.statusCode).toBe(200);
        const queryPayload = queryResponse.json() as {
            data?: { agentRun?: { id: string } | null };
        };
        expect(queryPayload.data?.agentRun).toBeNull();

        const controlResponse = await app.inject({
            method: 'POST',
            url: '/graphql',
            headers: {
                'x-domain-id': '2'
            },
            payload: {
                query: `
                  mutation ControlRun($id: ID!, $action: String!) {
                    controlAgentRun(id: $id, action: $action) { id status }
                  }
                `,
                variables: {
                    id: String(domain1RunId),
                    action: 'cancel'
                }
            }
        });

        expect(controlResponse.statusCode).toBe(200);
        const controlPayload = controlResponse.json() as {
            errors?: Array<{ extensions?: { code?: string } }>;
        };
        expect(controlPayload.errors?.[0]?.extensions?.code).toBe('AGENT_RUN_NOT_FOUND');
    });

    it('hides cross-tenant run definitions and rejects cross-tenant updates', async () => {
        const queryResponse = await app.inject({
            method: 'POST',
            url: '/graphql',
            headers: {
                'x-domain-id': '2'
            },
            payload: {
                query: `
                  query AgentRunDefinition($id: ID!) {
                    agentRunDefinition(id: $id) { id name }
                  }
                `,
                variables: {
                    id: String(domain1DefinitionId)
                }
            }
        });

        expect(queryResponse.statusCode).toBe(200);
        const queryPayload = queryResponse.json() as {
            data?: { agentRunDefinition?: { id: string } | null };
        };
        expect(queryPayload.data?.agentRunDefinition).toBeNull();

        const updateResponse = await app.inject({
            method: 'POST',
            url: '/graphql',
            headers: {
                'x-domain-id': '2'
            },
            payload: {
                query: `
                  mutation UpdateDefinition($id: ID!, $active: Boolean!) {
                    updateAgentRunDefinition(id: $id, active: $active) { id active }
                  }
                `,
                variables: {
                    id: String(domain1DefinitionId),
                    active: false
                }
            }
        });

        expect(updateResponse.statusCode).toBe(200);
        const updatePayload = updateResponse.json() as {
            errors?: Array<{ extensions?: { code?: string } }>;
        };
        expect(updatePayload.errors?.[0]?.extensions?.code).toBe('AGENT_RUN_DEFINITION_NOT_FOUND');
    });
});
