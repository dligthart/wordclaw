import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { db } from '../db/index.js';
import { agentRunDefinitions, agentRuns, apiKeys, domains, contentItems, contentTypes } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import apiRoutes from '../api/routes.js';
import { errorHandler } from '../api/error-handler.js';
import { hashApiKey } from '../services/api-key.js';
import crypto from 'crypto';

describe('Multi-Tenant Domain Isolation Tests', () => {
    let fastify: ReturnType<typeof Fastify>;

    // Configs
    let domain1Id: number;
    let domain2Id: number;
    let apiKey1Id: string;
    let apiKey2Id: string;
    let rawKey1 = 'wc_test_d1_1234567890';
    let rawKey2 = 'wc_test_d2_0987654321';
    let contentType1Id: number;
    let createdDomain2 = false;

    beforeAll(async () => {
        fastify = Fastify({ logger: false });
        fastify.setErrorHandler(errorHandler);
        await fastify.register(apiRoutes, { prefix: '/api' });

        // 1. Ensure domains exist
        const [d1] = await db.select().from(domains).where(eq(domains.id, 1));
        if (!d1) {
            await db.insert(domains).values({ id: 1, name: 'Default Local Domain', hostname: 'localhost' });
        }
        domain1Id = 1;

        const [existingDomain2] = await db.select().from(domains).where(eq(domains.id, 2));
        if (existingDomain2) {
            domain2Id = existingDomain2.id;
        } else {
            const [d2] = await db.insert(domains).values({ id: 2, name: 'Secondary Test Domain', hostname: 'tenant2.local' }).returning();
            domain2Id = d2.id;
            createdDomain2 = true;
        }

        // 2. Create API keys for each domain
        const key1Hash = hashApiKey(rawKey1);
        const [k1] = await db.insert(apiKeys).values({
            keyHash: key1Hash,
            keyPrefix: 'wc_test_d1_',
            name: 'Domain 1 Key',
            domainId: domain1Id,
            scopes: 'admin'
        }).returning();
        apiKey1Id = String(k1.id);

        const key2Hash = hashApiKey(rawKey2);
        const [k2] = await db.insert(apiKeys).values({
            keyHash: key2Hash,
            keyPrefix: 'wc_test_d2_',
            name: 'Domain 2 Key',
            domainId: domain2Id,
            scopes: 'admin'
        }).returning();
        apiKey2Id = String(k2.id);

        // 3. Create initial ContentType in Domain 1
        const [ct] = await db.insert(contentTypes).values({
            domainId: domain1Id,
            name: 'Domain 1 Type',
            slug: 'd1-type-' + crypto.randomUUID().slice(0, 8),
            schema: JSON.stringify({ type: 'object' }),
            basePrice: 0
        }).returning();
        contentType1Id = ct.id;
    });

    afterAll(async () => {
        await fastify?.close();
        if (apiKey1Id) await db.delete(apiKeys).where(eq(apiKeys.id, Number(apiKey1Id)));
        if (apiKey2Id) await db.delete(apiKeys).where(eq(apiKeys.id, Number(apiKey2Id)));
        if (contentType1Id) await db.delete(contentTypes).where(eq(contentTypes.id, contentType1Id));
        if (createdDomain2 && domain2Id) await db.delete(domains).where(eq(domains.id, domain2Id));
    });

    it('Domain 1 API Key can fetch its own ContentType', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: `/api/content-types/${contentType1Id}`,
            headers: { 'x-api-key': rawKey1 }
        });

        expect(response.statusCode).toBe(200);
        const payload = JSON.parse(response.payload);
        expect(payload.data.id).toBe(contentType1Id);
    });

    it('Domain 2 API Key cannot read Domain 1 ContentType (TENANT_ISOLATION_VIOLATION)', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: `/api/content-types/${contentType1Id}`,
            headers: { 'x-api-key': rawKey2 }
        });

        expect(response.statusCode).toBe(404);
        const payload = JSON.parse(response.payload);
        expect(payload.code).toBe('CONTENT_TYPE_NOT_FOUND');
        expect(payload.error).toBe('Content type not found');
    });

    it('Domain 2 API Key does not see Domain 1 content types in list', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/api/content-types',
            headers: { 'x-api-key': rawKey2 }
        });

        expect(response.statusCode).toBe(200);
        const payload = JSON.parse(response.payload);
        expect(Array.isArray(payload.data)).toBe(true);
        // It should definitely not include contentType1Id
        const hasD1Type = payload.data.some((t: any) => t.id === contentType1Id);
        expect(hasD1Type).toBe(false);
    });

    it('Domain 2 API Key creating a ContentType scopes it exclusively to Domain 2', async () => {
        // Create
        const createRes = await fastify.inject({
            method: 'POST',
            url: '/api/content-types',
            headers: { 'x-api-key': rawKey2 },
            payload: {
                name: 'Domain 2 Exclusive',
                slug: 'd2-excl-' + crypto.randomUUID().slice(0, 8),
                schema: { type: 'object' }
            }
        });

        expect(createRes.statusCode).toBe(201);
        const createdPayload = JSON.parse(createRes.payload);
        const createdId = createdPayload.data.id;

        // Let's verify it persisted inside domain 2 via direct DB fetch:
        const [dbCt] = await db.select().from(contentTypes).where(eq(contentTypes.id, createdId));
        expect(dbCt.domainId).toBe(domain2Id);

        // Try reading it from Domain 1
        const readD1Res = await fastify.inject({
            method: 'GET',
            url: `/api/content-types/${createdId}`,
            headers: { 'x-api-key': rawKey1 }
        });

        expect(readD1Res.statusCode).toBe(404);
        expect(JSON.parse(readD1Res.payload).code).toBe('CONTENT_TYPE_NOT_FOUND');

        // Cleanup
        await db.delete(contentTypes).where(eq(contentTypes.id, createdId));
    });

    it('GET /api/domains returns only caller-accessible domains for non-admin keys', async () => {
        const rawReadOnlyKey = `wc_test_d2_ro_${crypto.randomUUID().slice(0, 8)}`;
        const keyHash = hashApiKey(rawReadOnlyKey);
        const [readOnlyKey] = await db.insert(apiKeys).values({
            keyHash,
            keyPrefix: rawReadOnlyKey.slice(0, 12),
            name: 'Domain 2 Read-Only Key',
            domainId: domain2Id,
            scopes: 'content:read'
        }).returning();

        try {
            const response = await fastify.inject({
                method: 'GET',
                url: '/api/domains',
                headers: { 'x-api-key': rawReadOnlyKey }
            });

            expect(response.statusCode).toBe(200);
            const payload = JSON.parse(response.payload) as {
                data: Array<{ id: number }>;
            };

            expect(payload.data).toHaveLength(1);
            expect(payload.data[0].id).toBe(domain2Id);
            expect(payload.data.some((domain) => domain.id === domain1Id)).toBe(false);
        } finally {
            await db.delete(apiKeys).where(eq(apiKeys.id, readOnlyKey.id));
        }
    });

    it('Same content-type slug is allowed across different domains but conflicts within a single domain', async () => {
        const sharedSlug = `tenant-shared-${crypto.randomUUID().slice(0, 8)}`;
        let domain1TypeId: number | null = null;
        let domain2TypeId: number | null = null;

        try {
            const createDomain1 = await fastify.inject({
                method: 'POST',
                url: '/api/content-types',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    name: 'Shared Slug D1',
                    slug: sharedSlug,
                    schema: { type: 'object' }
                }
            });
            expect(createDomain1.statusCode).toBe(201);
            domain1TypeId = JSON.parse(createDomain1.payload).data.id;

            const createDomain2 = await fastify.inject({
                method: 'POST',
                url: '/api/content-types',
                headers: { 'x-api-key': rawKey2 },
                payload: {
                    name: 'Shared Slug D2',
                    slug: sharedSlug,
                    schema: { type: 'object' }
                }
            });
            expect(createDomain2.statusCode).toBe(201);
            domain2TypeId = JSON.parse(createDomain2.payload).data.id;

            const duplicateInDomain2 = await fastify.inject({
                method: 'POST',
                url: '/api/content-types',
                headers: { 'x-api-key': rawKey2 },
                payload: {
                    name: 'Duplicate Slug D2',
                    slug: sharedSlug,
                    schema: { type: 'object' }
                }
            });
            expect(duplicateInDomain2.statusCode).toBe(409);
            expect(JSON.parse(duplicateInDomain2.payload).code).toBe('CONTENT_TYPE_SLUG_CONFLICT');
        } finally {
            if (domain1TypeId) {
                await db.delete(contentTypes).where(eq(contentTypes.id, domain1TypeId));
            }
            if (domain2TypeId) {
                await db.delete(contentTypes).where(eq(contentTypes.id, domain2TypeId));
            }
        }
    });

    it('Domain-scoped content-item listing does not leak items or totals across tenants', async () => {
        let domain2TypeId: number | null = null;
        let domain1ItemId: number | null = null;
        let domain2ItemId: number | null = null;

        try {
            const [domain2Type] = await db.insert(contentTypes).values({
                domainId: domain2Id,
                name: 'Domain 2 List Scope Type',
                slug: 'd2-list-scope-' + crypto.randomUUID().slice(0, 8),
                schema: JSON.stringify({ type: 'object' }),
                basePrice: 0
            }).returning();
            domain2TypeId = domain2Type.id;

            const [domain1Item] = await db.insert(contentItems).values({
                domainId: domain1Id,
                contentTypeId: contentType1Id,
                data: JSON.stringify({ title: 'domain1-visible' }),
                status: 'draft'
            }).returning();
            domain1ItemId = domain1Item.id;

            const [domain2Item] = await db.insert(contentItems).values({
                domainId: domain2Id,
                contentTypeId: domain2Type.id,
                data: JSON.stringify({ title: 'domain2-visible' }),
                status: 'draft'
            }).returning();
            domain2ItemId = domain2Item.id;

            const domain1List = await fastify.inject({
                method: 'GET',
                url: '/api/content-items?limit=500',
                headers: { 'x-api-key': rawKey1 }
            });
            const domain2List = await fastify.inject({
                method: 'GET',
                url: '/api/content-items?limit=500',
                headers: { 'x-api-key': rawKey2 }
            });

            expect(domain1List.statusCode).toBe(200);
            expect(domain2List.statusCode).toBe(200);

            const domain1Payload = JSON.parse(domain1List.payload) as {
                data: Array<{ id: number }>;
                meta: { total: number };
            };
            const domain2Payload = JSON.parse(domain2List.payload) as {
                data: Array<{ id: number }>;
                meta: { total: number };
            };

            const domain1Ids = new Set(domain1Payload.data.map((row) => row.id));
            const domain2Ids = new Set(domain2Payload.data.map((row) => row.id));

            expect(domain1Ids.has(domain1Item.id)).toBe(true);
            expect(domain1Ids.has(domain2Item.id)).toBe(false);
            expect(domain2Ids.has(domain2Item.id)).toBe(true);
            expect(domain2Ids.has(domain1Item.id)).toBe(false);

            const [{ total: domain1Total }] = await db.select({ total: sql<number>`count(*)::int` })
                .from(contentItems)
                .where(eq(contentItems.domainId, domain1Id));
            const [{ total: domain2Total }] = await db.select({ total: sql<number>`count(*)::int` })
                .from(contentItems)
                .where(eq(contentItems.domainId, domain2Id));

            expect(domain1Payload.meta.total).toBe(domain1Total);
            expect(domain2Payload.meta.total).toBe(domain2Total);
        } finally {
            if (domain1ItemId) {
                await db.delete(contentItems).where(eq(contentItems.id, domain1ItemId));
            }
            if (domain2ItemId) {
                await db.delete(contentItems).where(eq(contentItems.id, domain2ItemId));
            }
            if (domain2TypeId) {
                await db.delete(contentTypes).where(eq(contentTypes.id, domain2TypeId));
            }
        }
    });

    it('agent-run lifecycle routes enforce tenant scoping for read and control', async () => {
        let domain1RunId: number | null = null;

        try {
            const createRun = await fastify.inject({
                method: 'POST',
                url: '/api/agent-runs',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    goal: `domain1-run-${crypto.randomUUID()}`,
                    runType: 'review_backlog_manager',
                    requireApproval: true
                }
            });

            expect(createRun.statusCode).toBe(201);
            const createPayload = JSON.parse(createRun.payload) as {
                data: { id: number; status: string };
            };
            domain1RunId = createPayload.data.id;
            expect(createPayload.data.status).toBe('waiting_approval');

            const domain1Read = await fastify.inject({
                method: 'GET',
                url: `/api/agent-runs/${domain1RunId}`,
                headers: { 'x-api-key': rawKey1 }
            });
            expect(domain1Read.statusCode).toBe(200);
            const domain1ReadPayload = JSON.parse(domain1Read.payload) as {
                data: {
                    steps: Array<{ stepKey: string; status: string }>;
                    checkpoints: Array<{ checkpointKey: string }>;
                };
            };
            expect(domain1ReadPayload.data.steps.length).toBeGreaterThan(0);
            expect(domain1ReadPayload.data.steps[0].stepKey).toBe('plan_run');
            expect(domain1ReadPayload.data.steps[0].status).toBe('pending');
            expect(domain1ReadPayload.data.checkpoints.some((checkpoint) => checkpoint.checkpointKey === 'created')).toBe(true);

            const domain2Read = await fastify.inject({
                method: 'GET',
                url: `/api/agent-runs/${domain1RunId}`,
                headers: { 'x-api-key': rawKey2 }
            });
            expect(domain2Read.statusCode).toBe(404);
            expect(JSON.parse(domain2Read.payload).code).toBe('AGENT_RUN_NOT_FOUND');

            const domain2Control = await fastify.inject({
                method: 'POST',
                url: `/api/agent-runs/${domain1RunId}/control`,
                headers: { 'x-api-key': rawKey2 },
                payload: { action: 'cancel' }
            });
            expect(domain2Control.statusCode).toBe(404);
            expect(JSON.parse(domain2Control.payload).code).toBe('AGENT_RUN_NOT_FOUND');

            const domain1Approve = await fastify.inject({
                method: 'POST',
                url: `/api/agent-runs/${domain1RunId}/control`,
                headers: { 'x-api-key': rawKey1 },
                payload: { action: 'approve' }
            });
            expect(domain1Approve.statusCode).toBe(200);
            expect(JSON.parse(domain1Approve.payload).data.status).toBe('running');

            const domain1ReadAfterApprove = await fastify.inject({
                method: 'GET',
                url: `/api/agent-runs/${domain1RunId}`,
                headers: { 'x-api-key': rawKey1 }
            });
            expect(domain1ReadAfterApprove.statusCode).toBe(200);
            const readAfterPayload = JSON.parse(domain1ReadAfterApprove.payload) as {
                data: {
                    steps: Array<{ stepKey: string; status: string }>;
                    checkpoints: Array<{ checkpointKey: string }>;
                };
            };
            expect(readAfterPayload.data.steps[0].status).toBe('executing');
            expect(readAfterPayload.data.checkpoints.some((checkpoint) => checkpoint.checkpointKey === 'control_approve')).toBe(true);
        } finally {
            if (domain1RunId) {
                await db.delete(agentRuns).where(eq(agentRuns.id, domain1RunId));
            }
        }
    });

    it('agent-run-definition routes enforce tenant scoping for read and update', async () => {
        let domain1DefinitionId: number | null = null;

        try {
            const createDefinition = await fastify.inject({
                method: 'POST',
                url: '/api/agent-run-definitions',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    name: `d1-definition-${crypto.randomUUID().slice(0, 8)}`,
                    runType: 'review_backlog_manager',
                    strategyConfig: { maxTasks: 10 },
                    active: true
                }
            });
            expect(createDefinition.statusCode).toBe(201);
            const createPayload = JSON.parse(createDefinition.payload) as {
                data: { id: number };
            };
            domain1DefinitionId = createPayload.data.id;

            const domain2Read = await fastify.inject({
                method: 'GET',
                url: `/api/agent-run-definitions/${domain1DefinitionId}`,
                headers: { 'x-api-key': rawKey2 }
            });
            expect(domain2Read.statusCode).toBe(404);
            expect(JSON.parse(domain2Read.payload).code).toBe('AGENT_RUN_DEFINITION_NOT_FOUND');

            const domain2Update = await fastify.inject({
                method: 'PUT',
                url: `/api/agent-run-definitions/${domain1DefinitionId}`,
                headers: { 'x-api-key': rawKey2 },
                payload: { active: false }
            });
            expect(domain2Update.statusCode).toBe(404);
            expect(JSON.parse(domain2Update.payload).code).toBe('AGENT_RUN_DEFINITION_NOT_FOUND');

            const domain1List = await fastify.inject({
                method: 'GET',
                url: '/api/agent-run-definitions?limit=500',
                headers: { 'x-api-key': rawKey1 }
            });
            const domain2List = await fastify.inject({
                method: 'GET',
                url: '/api/agent-run-definitions?limit=500',
                headers: { 'x-api-key': rawKey2 }
            });

            expect(domain1List.statusCode).toBe(200);
            expect(domain2List.statusCode).toBe(200);

            const domain1ListPayload = JSON.parse(domain1List.payload) as {
                data: Array<{ id: number }>;
            };
            const domain2ListPayload = JSON.parse(domain2List.payload) as {
                data: Array<{ id: number }>;
            };

            expect(domain1ListPayload.data.some((definition) => definition.id === domain1DefinitionId)).toBe(true);
            expect(domain2ListPayload.data.some((definition) => definition.id === domain1DefinitionId)).toBe(false);
        } finally {
            if (domain1DefinitionId) {
                await db.delete(agentRunDefinitions).where(eq(agentRunDefinitions.id, domain1DefinitionId));
            }
        }
    });
});
