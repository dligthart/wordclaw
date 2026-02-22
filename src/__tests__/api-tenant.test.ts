import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { db } from '../db/index.js';
import { apiKeys, domains, contentTypes } from '../db/schema.js';
import { eq } from 'drizzle-orm';
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

        const [d2] = await db.insert(domains).values({ id: 2, name: 'Secondary Test Domain', hostname: 'tenant2.local' }).returning();
        domain2Id = d2.id;

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
        if (domain2Id) await db.delete(domains).where(eq(domains.id, domain2Id));
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
});
