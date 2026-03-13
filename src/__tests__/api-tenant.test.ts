import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { db } from '../db/index.js';
import { accessEvents, agentProfiles, agentRunDefinitions, agentRuns, apiKeys, assets, domains, contentItems, contentTypes, entitlements, licensePolicies, offers, reviewTasks, workflowTransitions, workflows } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import apiRoutes from '../api/routes.js';
import { errorHandler } from '../api/error-handler.js';
import { hashApiKey } from '../services/api-key.js';
import { getAssetStorageProvider } from '../services/asset-storage.js';
import { settleAgentRun } from '../test/agent-run-test-helpers.js';
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

            // Other suites may create content in parallel, so assert scoping and pagination invariants
            // instead of exact live totals from a separate query.
            expect(domain1Payload.meta.total).toBeGreaterThanOrEqual(domain1Payload.data.length);
            expect(domain2Payload.meta.total).toBeGreaterThanOrEqual(domain2Payload.data.length);
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

    it('content-item create rejects asset references outside the caller domain', async () => {
        let assetBackedTypeId: number | null = null;
        let foreignAssetId: number | null = null;

        try {
            const [assetBackedType] = await db.insert(contentTypes).values({
                domainId: domain1Id,
                name: 'Domain 1 Asset-backed Type',
                slug: 'd1-asset-type-' + crypto.randomUUID().slice(0, 8),
                schema: JSON.stringify({
                    type: 'object',
                    properties: {
                        title: { type: 'string' },
                        heroImage: {
                            type: 'object',
                            'x-wordclaw-field-kind': 'asset',
                            properties: {
                                assetId: { type: 'integer' },
                                alt: { type: 'string' }
                            },
                            required: ['assetId']
                        }
                    },
                    required: ['title', 'heroImage']
                }),
                basePrice: 0
            }).returning();
            assetBackedTypeId = assetBackedType.id;

            const [foreignAsset] = await db.insert(assets).values({
                domainId: domain2Id,
                filename: 'tenant-2-cover.png',
                originalFilename: 'tenant-2-cover.png',
                mimeType: 'image/png',
                sizeBytes: 512,
                storageProvider: 'local',
                storageKey: `tenant-${domain2Id}/asset-${crypto.randomUUID()}.png`,
                accessMode: 'public',
                status: 'active',
                metadata: {}
            }).returning();
            foreignAssetId = foreignAsset.id;

            const response = await fastify.inject({
                method: 'POST',
                url: '/api/content-items',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    contentTypeId: assetBackedTypeId,
                    data: {
                        title: 'Cross-domain asset reference',
                        heroImage: {
                            assetId: foreignAssetId,
                            alt: 'Should fail'
                        }
                    },
                    status: 'draft'
                }
            });

            expect(response.statusCode).toBe(400);
            const payload = JSON.parse(response.payload) as {
                code: string;
                context?: {
                    details?: string;
                    invalidAssetIds?: number[];
                };
            };
            expect(payload.code).toBe('CONTENT_ASSET_REFERENCE_INVALID');
            expect(payload.context?.invalidAssetIds).toContain(foreignAssetId);
            expect(payload.context?.details).toContain(String(foreignAssetId));
        } finally {
            if (foreignAssetId) {
                await db.delete(assets).where(eq(assets.id, foreignAssetId));
            }
            if (assetBackedTypeId) {
                await db.delete(contentTypes).where(eq(contentTypes.id, assetBackedTypeId));
            }
        }
    });

    it('entitled asset content requires a domain-owned entitlement and consumes it on read', async () => {
        let assetId: number | null = null;
        let assetStorageKey: string | null = null;
        let offerId: number | null = null;
        let policyId: number | null = null;
        let agentProfileId: number | null = null;
        let entitlementId: number | null = null;

        try {
            const createAssetResponse = await fastify.inject({
                method: 'POST',
                url: '/api/assets',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    filename: 'premium-guide.pdf',
                    mimeType: 'application/pdf',
                    contentBase64: Buffer.from('premium asset bytes').toString('base64'),
                    accessMode: 'entitled',
                    entitlementScope: {
                        type: 'subscription'
                    }
                }
            });

            expect(createAssetResponse.statusCode).toBe(201);
            const createdAssetId = (JSON.parse(createAssetResponse.payload) as { data: { id: number } }).data.id;
            assetId = createdAssetId;

            const [asset] = await db.select().from(assets).where(eq(assets.id, createdAssetId));
            expect(asset.accessMode).toBe('entitled');
            assetStorageKey = asset.storageKey;

            const [offer] = await db.insert(offers).values({
                domainId: domain1Id,
                slug: 'asset-sub-' + crypto.randomUUID().slice(0, 8),
                name: 'Asset Subscription',
                scopeType: 'subscription',
                scopeRef: null,
                priceSats: 125,
                active: true
            }).returning();
            offerId = offer.id;

            const [policy] = await db.insert(licensePolicies).values({
                domainId: domain1Id,
                offerId: offer.id,
                version: 1,
                maxReads: 2,
                allowedChannels: ['rest']
            }).returning();
            policyId = policy.id;

            const [profile] = await db.insert(agentProfiles).values({
                domainId: domain1Id,
                apiKeyId: Number(apiKey1Id),
                displayName: 'Domain 1 reader'
            }).returning();
            agentProfileId = profile.id;

            const offersResponse = await fastify.inject({
                method: 'GET',
                url: `/api/assets/${assetId}/offers`,
                headers: { 'x-api-key': rawKey1 }
            });

            expect(offersResponse.statusCode).toBe(200);
            const offersPayload = JSON.parse(offersResponse.payload) as {
                data: Array<{ id: number }>;
            };
            expect(offersPayload.data.some((candidate) => candidate.id === offer.id)).toBe(true);

            const withoutEntitlement = await fastify.inject({
                method: 'GET',
                url: `/api/assets/${assetId}/content`,
                headers: { 'x-api-key': rawKey1 }
            });

            expect(withoutEntitlement.statusCode).toBe(402);
            expect(JSON.parse(withoutEntitlement.payload).code).toBe('OFFER_REQUIRED');

            const [entitlement] = await db.insert(entitlements).values({
                domainId: domain1Id,
                offerId: offer.id,
                policyId: policy.id,
                policyVersion: policy.version,
                agentProfileId: profile.id,
                paymentHash: 'asset-pay-' + crypto.randomUUID().slice(0, 12),
                status: 'active',
                remainingReads: 2,
                activatedAt: new Date()
            }).returning();
            entitlementId = entitlement.id;

            const wrongDomainRead = await fastify.inject({
                method: 'GET',
                url: `/api/assets/${assetId}/content`,
                headers: {
                    'x-api-key': rawKey2,
                    'x-entitlement-id': String(entitlement.id)
                }
            });

            expect(wrongDomainRead.statusCode).toBe(404);
            expect(JSON.parse(wrongDomainRead.payload).code).toBe('ASSET_NOT_FOUND');

            const entitledRead = await fastify.inject({
                method: 'GET',
                url: `/api/assets/${assetId}/content`,
                headers: {
                    'x-api-key': rawKey1,
                    'x-entitlement-id': String(entitlement.id)
                }
            });

            expect(entitledRead.statusCode).toBe(200);
            expect(entitledRead.headers['x-wordclaw-access-mode']).toBe('entitled');
            expect(entitledRead.body).toBe('premium asset bytes');

            const [updatedEntitlement] = await db.select().from(entitlements).where(eq(entitlements.id, entitlement.id));
            expect(updatedEntitlement.remainingReads).toBe(1);
        } finally {
            if (entitlementId) {
                await db.delete(accessEvents).where(eq(accessEvents.entitlementId, entitlementId));
                await db.delete(entitlements).where(eq(entitlements.id, entitlementId));
            }
            if (policyId) {
                await db.delete(licensePolicies).where(eq(licensePolicies.id, policyId));
            }
            if (offerId) {
                await db.delete(offers).where(eq(offers.id, offerId));
            }
            if (agentProfileId) {
                await db.delete(agentProfiles).where(eq(agentProfiles.id, agentProfileId));
            }
            if (assetId) {
                await db.delete(assets).where(eq(assets.id, assetId));
            }
            if (assetStorageKey) {
                await getAssetStorageProvider().remove(assetStorageKey).catch(() => undefined);
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
            expect(readAfterPayload.data.steps[0].status).toBe('succeeded');
            expect(readAfterPayload.data.checkpoints.some((checkpoint) => checkpoint.checkpointKey === 'control_approve')).toBe(true);
        } finally {
            if (domain1RunId) {
                await db.delete(agentRuns).where(eq(agentRuns.id, domain1RunId));
            }
        }
    });

    it('review_backlog_manager run creation snapshots draft backlog candidates', async () => {
        let scopedTypeId: number | null = null;
        let draftItemOneId: number | null = null;
        let draftItemTwoId: number | null = null;
        let publishedItemId: number | null = null;
        let runId: number | null = null;

        try {
            const [scopedType] = await db.insert(contentTypes).values({
                domainId: domain1Id,
                name: `Backlog Plan Type ${crypto.randomUUID().slice(0, 6)}`,
                slug: `backlog-plan-${crypto.randomUUID().slice(0, 8)}`,
                schema: JSON.stringify({ type: 'object' }),
                basePrice: 0
            }).returning();
            scopedTypeId = scopedType.id;

            const [draftOne] = await db.insert(contentItems).values({
                domainId: domain1Id,
                contentTypeId: scopedTypeId,
                data: JSON.stringify({ title: 'draft-one' }),
                status: 'draft'
            }).returning();
            draftItemOneId = draftOne.id;

            const [draftTwo] = await db.insert(contentItems).values({
                domainId: domain1Id,
                contentTypeId: scopedTypeId,
                data: JSON.stringify({ title: 'draft-two' }),
                status: 'draft'
            }).returning();
            draftItemTwoId = draftTwo.id;

            const [publishedItem] = await db.insert(contentItems).values({
                domainId: domain1Id,
                contentTypeId: scopedTypeId,
                data: JSON.stringify({ title: 'published-item' }),
                status: 'published'
            }).returning();
            publishedItemId = publishedItem.id;

            const createRun = await fastify.inject({
                method: 'POST',
                url: '/api/agent-runs',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    goal: `plan-review-backlog-${crypto.randomUUID().slice(0, 8)}`,
                    runType: 'review_backlog_manager',
                    metadata: {
                        contentTypeId: scopedTypeId,
                        maxCandidates: 10,
                        dryRun: true
                    }
                }
            });
            expect(createRun.statusCode).toBe(201);
            runId = JSON.parse(createRun.payload).data.id as number;

            const getRun = await fastify.inject({
                method: 'GET',
                url: `/api/agent-runs/${runId}`,
                headers: { 'x-api-key': rawKey1 }
            });
            expect(getRun.statusCode).toBe(200);

            const runPayload = JSON.parse(getRun.payload) as {
                data: {
                    checkpoints: Array<{
                        checkpointKey: string;
                        payload?: {
                            mode?: string;
                            runType?: string;
                            criteria?: {
                                status?: string;
                                contentTypeId?: number | null;
                            };
                            summary?: {
                                backlogCount?: number;
                                selectedCount?: number;
                                maxCandidates?: number;
                            };
                            candidates?: Array<{
                                id: number;
                                contentTypeId: number;
                                status: string;
                            }>;
                        };
                    }>;
                };
            };

            const planCheckpoint = runPayload.data.checkpoints.find(
                (checkpoint) => checkpoint.checkpointKey === 'plan_review_backlog'
            );

            expect(planCheckpoint).toBeDefined();
            expect(planCheckpoint?.payload?.mode).toBe('dry_run');
            expect(planCheckpoint?.payload?.runType).toBe('review_backlog_manager');
            expect(planCheckpoint?.payload?.criteria?.status).toBe('draft');
            expect(planCheckpoint?.payload?.criteria?.contentTypeId).toBe(scopedTypeId);
            expect(planCheckpoint?.payload?.summary?.backlogCount).toBe(2);
            expect(planCheckpoint?.payload?.summary?.selectedCount).toBe(2);
            expect(planCheckpoint?.payload?.summary?.maxCandidates).toBe(10);

            const candidateIds = new Set((planCheckpoint?.payload?.candidates ?? []).map((candidate) => candidate.id));
            expect(candidateIds.has(draftItemOneId!)).toBe(true);
            expect(candidateIds.has(draftItemTwoId!)).toBe(true);
            expect(candidateIds.has(publishedItemId!)).toBe(false);
        } finally {
            if (runId) {
                await db.delete(agentRuns).where(eq(agentRuns.id, runId));
            }
            if (draftItemOneId) {
                await db.delete(contentItems).where(eq(contentItems.id, draftItemOneId));
            }
            if (draftItemTwoId) {
                await db.delete(contentItems).where(eq(contentItems.id, draftItemTwoId));
            }
            if (publishedItemId) {
                await db.delete(contentItems).where(eq(contentItems.id, publishedItemId));
            }
            if (scopedTypeId) {
                await db.delete(contentTypes).where(eq(contentTypes.id, scopedTypeId));
            }
        }
    });

    it('review_backlog_manager approve stages submit_review steps from plan checkpoint', async () => {
        let scopedTypeId: number | null = null;
        let draftItemOneId: number | null = null;
        let draftItemTwoId: number | null = null;
        let runId: number | null = null;

        try {
            const [scopedType] = await db.insert(contentTypes).values({
                domainId: domain1Id,
                name: `Backlog Stage Type ${crypto.randomUUID().slice(0, 6)}`,
                slug: `backlog-stage-${crypto.randomUUID().slice(0, 8)}`,
                schema: JSON.stringify({ type: 'object' }),
                basePrice: 0
            }).returning();
            scopedTypeId = scopedType.id;

            const [draftOne] = await db.insert(contentItems).values({
                domainId: domain1Id,
                contentTypeId: scopedTypeId,
                data: JSON.stringify({ title: 'stage-draft-one' }),
                status: 'draft'
            }).returning();
            draftItemOneId = draftOne.id;

            const [draftTwo] = await db.insert(contentItems).values({
                domainId: domain1Id,
                contentTypeId: scopedTypeId,
                data: JSON.stringify({ title: 'stage-draft-two' }),
                status: 'draft'
            }).returning();
            draftItemTwoId = draftTwo.id;

            const createRun = await fastify.inject({
                method: 'POST',
                url: '/api/agent-runs',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    goal: `stage-review-backlog-${crypto.randomUUID().slice(0, 8)}`,
                    runType: 'review_backlog_manager',
                    requireApproval: true,
                    metadata: {
                        contentTypeId: scopedTypeId,
                        maxCandidates: 10
                    }
                }
            });
            expect(createRun.statusCode).toBe(201);
            runId = JSON.parse(createRun.payload).data.id as number;

            const approveRun = await fastify.inject({
                method: 'POST',
                url: `/api/agent-runs/${runId}/control`,
                headers: { 'x-api-key': rawKey1 },
                payload: { action: 'approve' }
            });
            expect(approveRun.statusCode).toBe(200);
            expect(JSON.parse(approveRun.payload).data.status).toBe('running');

            const details = await fastify.inject({
                method: 'GET',
                url: `/api/agent-runs/${runId}`,
                headers: { 'x-api-key': rawKey1 }
            });
            expect(details.statusCode).toBe(200);
            const detailsPayload = JSON.parse(details.payload) as {
                data: {
                    steps: Array<{
                        stepKey: string;
                        actionType: string;
                        status: string;
                        requestSnapshot?: {
                            contentItemId?: number;
                        } | null;
                    }>;
                    checkpoints: Array<{
                        checkpointKey: string;
                        payload?: {
                            selectedCount?: number;
                            candidateIds?: number[];
                        };
                    }>;
                };
            };

            const submitSteps = detailsPayload.data.steps.filter((step) => step.actionType === 'submit_review');
            expect(submitSteps).toHaveLength(2);
            expect(submitSteps.every((step) => step.status === 'pending')).toBe(true);

            const stagedIds = new Set(submitSteps.map((step) => step.requestSnapshot?.contentItemId));
            expect(stagedIds.has(draftItemOneId)).toBe(true);
            expect(stagedIds.has(draftItemTwoId)).toBe(true);

            const planStep = detailsPayload.data.steps.find((step) => step.stepKey === 'plan_run');
            expect(planStep?.status).toBe('succeeded');

            const stagedCheckpoint = detailsPayload.data.checkpoints.find(
                (checkpoint) => checkpoint.checkpointKey === 'planned_review_actions'
            );
            expect(stagedCheckpoint?.payload?.selectedCount).toBe(2);
            expect(stagedCheckpoint?.payload?.candidateIds).toEqual(
                expect.arrayContaining([draftItemOneId!, draftItemTwoId!])
            );
        } finally {
            if (runId) {
                await db.delete(agentRuns).where(eq(agentRuns.id, runId));
            }
            if (draftItemOneId) {
                await db.delete(contentItems).where(eq(contentItems.id, draftItemOneId));
            }
            if (draftItemTwoId) {
                await db.delete(contentItems).where(eq(contentItems.id, draftItemTwoId));
            }
            if (scopedTypeId) {
                await db.delete(contentTypes).where(eq(contentTypes.id, scopedTypeId));
            }
        }
    });

    it('review_backlog_manager approve auto-submits staged review tasks when enabled', async () => {
        let scopedTypeId: number | null = null;
        let workflowId: number | null = null;
        let transitionId: number | null = null;
        let draftItemOneId: number | null = null;
        let draftItemTwoId: number | null = null;
        let runId: number | null = null;

        try {
            const [scopedType] = await db.insert(contentTypes).values({
                domainId: domain1Id,
                name: `Backlog Execute Type ${crypto.randomUUID().slice(0, 6)}`,
                slug: `backlog-exec-${crypto.randomUUID().slice(0, 8)}`,
                schema: JSON.stringify({ type: 'object' }),
                basePrice: 0
            }).returning();
            scopedTypeId = scopedType.id;

            const [workflow] = await db.insert(workflows).values({
                domainId: domain1Id,
                name: `Auto Submit Workflow ${crypto.randomUUID().slice(0, 6)}`,
                contentTypeId: scopedTypeId,
                active: true
            }).returning();
            workflowId = workflow.id;

            const [transition] = await db.insert(workflowTransitions).values({
                workflowId: workflowId,
                fromState: 'draft',
                toState: 'pending_review',
                requiredRoles: []
            }).returning();
            transitionId = transition.id;

            const [draftOne] = await db.insert(contentItems).values({
                domainId: domain1Id,
                contentTypeId: scopedTypeId,
                data: JSON.stringify({ title: 'exec-draft-one' }),
                status: 'draft'
            }).returning();
            draftItemOneId = draftOne.id;

            const [draftTwo] = await db.insert(contentItems).values({
                domainId: domain1Id,
                contentTypeId: scopedTypeId,
                data: JSON.stringify({ title: 'exec-draft-two' }),
                status: 'draft'
            }).returning();
            draftItemTwoId = draftTwo.id;

            const createRun = await fastify.inject({
                method: 'POST',
                url: '/api/agent-runs',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    goal: `execute-review-backlog-${crypto.randomUUID().slice(0, 8)}`,
                    runType: 'review_backlog_manager',
                    requireApproval: true,
                    metadata: {
                        contentTypeId: scopedTypeId,
                        maxCandidates: 10,
                        autoSubmitReview: true
                    }
                }
            });
            expect(createRun.statusCode).toBe(201);
            runId = JSON.parse(createRun.payload).data.id as number;

            const approveRun = await fastify.inject({
                method: 'POST',
                url: `/api/agent-runs/${runId}/control`,
                headers: { 'x-api-key': rawKey1 },
                payload: { action: 'approve' }
            });
            expect(approveRun.statusCode).toBe(200);
            const approvePayload = JSON.parse(approveRun.payload) as {
                data: {
                    status: string;
                    completedAt: string | null;
                };
            };
            expect(approvePayload.data.status).toBe('running');
            expect(approvePayload.data.completedAt).toBeNull();

            await settleAgentRun(domain1Id, runId!);

            const details = await fastify.inject({
                method: 'GET',
                url: `/api/agent-runs/${runId}`,
                headers: { 'x-api-key': rawKey1 }
            });
            expect(details.statusCode).toBe(200);
            const detailsPayload = JSON.parse(details.payload) as {
                data: {
                    run: {
                        status: string;
                    };
                    steps: Array<{
                        actionType: string;
                        status: string;
                        responseSnapshot?: {
                            reviewTaskId?: number;
                            workflowTransitionId?: number;
                        } | null;
                    }>;
                    checkpoints: Array<{
                        checkpointKey: string;
                        payload?: {
                            succeededCount?: number;
                            settledStatus?: string;
                        };
                    }>;
                };
            };

            expect(detailsPayload.data.run.status).toBe('succeeded');
            const submitSteps = detailsPayload.data.steps.filter((step) => step.actionType === 'submit_review');
            expect(submitSteps).toHaveLength(2);
            expect(submitSteps.every((step) => step.status === 'succeeded')).toBe(true);
            expect(submitSteps.every((step) => step.responseSnapshot?.workflowTransitionId === transitionId)).toBe(true);
            expect(submitSteps.every((step) => typeof step.responseSnapshot?.reviewTaskId === 'number')).toBe(true);

            const completionCheckpoint = detailsPayload.data.checkpoints.find(
                (checkpoint) => checkpoint.checkpointKey === 'review_execution_completed'
            );
            expect(completionCheckpoint?.payload?.succeededCount).toBe(2);

            const settledCheckpoint = detailsPayload.data.checkpoints.find(
                (checkpoint) => checkpoint.checkpointKey === 'control_approve_settled'
            );
            expect(settledCheckpoint?.payload?.settledStatus).toBe('succeeded');

            const pendingTasksResponse = await fastify.inject({
                method: 'GET',
                url: '/api/review-tasks',
                headers: { 'x-api-key': rawKey1 }
            });
            expect(pendingTasksResponse.statusCode).toBe(200);
            const pendingTasksPayload = JSON.parse(pendingTasksResponse.payload) as {
                data: Array<{
                    task: {
                        contentItemId: number;
                        workflowTransitionId: number;
                        status: string;
                    };
                }>;
            };
            const taskItems = pendingTasksPayload.data
                .filter((row) => row.task.workflowTransitionId === transitionId)
                .map((row) => row.task.contentItemId);
            expect(taskItems).toEqual(expect.arrayContaining([draftItemOneId!, draftItemTwoId!]));
            expect(
                pendingTasksPayload.data.filter((row) => row.task.workflowTransitionId === transitionId).every((row) => row.task.status === 'pending')
            ).toBe(true);
        } finally {
            if (runId) {
                await db.delete(agentRuns).where(eq(agentRuns.id, runId));
            }
            if (draftItemOneId) {
                await db.delete(contentItems).where(eq(contentItems.id, draftItemOneId));
            }
            if (draftItemTwoId) {
                await db.delete(contentItems).where(eq(contentItems.id, draftItemTwoId));
            }
            if (transitionId) {
                await db.delete(reviewTasks).where(eq(reviewTasks.workflowTransitionId, transitionId));
                await db.delete(workflowTransitions).where(eq(workflowTransitions.id, transitionId));
            }
            if (workflowId) {
                await db.delete(workflows).where(eq(workflows.id, workflowId));
            }
            if (scopedTypeId) {
                await db.delete(contentTypes).where(eq(contentTypes.id, scopedTypeId));
            }
        }
    });

    it('review_backlog_manager auto-submit does not bypass required workflow roles', async () => {
        let scopedTypeId: number | null = null;
        let workflowId: number | null = null;
        let transitionId: number | null = null;
        let draftItemId: number | null = null;
        let runId: number | null = null;
        let limitedKeyId: number | null = null;
        const limitedRawKey = `wc_test_limited_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

        try {
            const [limitedKey] = await db.insert(apiKeys).values({
                keyHash: hashApiKey(limitedRawKey),
                keyPrefix: limitedRawKey.slice(0, 12),
                name: `Limited Runtime Key ${crypto.randomUUID().slice(0, 6)}`,
                domainId: domain1Id,
                scopes: 'content:write'
            }).returning();
            limitedKeyId = limitedKey.id;

            const [scopedType] = await db.insert(contentTypes).values({
                domainId: domain1Id,
                name: `Backlog Role Type ${crypto.randomUUID().slice(0, 6)}`,
                slug: `backlog-role-${crypto.randomUUID().slice(0, 8)}`,
                schema: JSON.stringify({ type: 'object' }),
                basePrice: 0
            }).returning();
            scopedTypeId = scopedType.id;

            const [workflow] = await db.insert(workflows).values({
                domainId: domain1Id,
                name: `Role Guard Workflow ${crypto.randomUUID().slice(0, 6)}`,
                contentTypeId: scopedTypeId,
                active: true
            }).returning();
            workflowId = workflow.id;

            const [transition] = await db.insert(workflowTransitions).values({
                workflowId: workflowId,
                fromState: 'draft',
                toState: 'pending_review',
                requiredRoles: ['admin']
            }).returning();
            transitionId = transition.id;

            const [draftItem] = await db.insert(contentItems).values({
                domainId: domain1Id,
                contentTypeId: scopedTypeId,
                data: JSON.stringify({ title: 'role-guard-item' }),
                status: 'draft'
            }).returning();
            draftItemId = draftItem.id;

            const createRun = await fastify.inject({
                method: 'POST',
                url: '/api/agent-runs',
                headers: { 'x-api-key': limitedRawKey },
                payload: {
                    goal: `review-role-guard-${crypto.randomUUID().slice(0, 8)}`,
                    runType: 'review_backlog_manager',
                    requireApproval: true,
                    metadata: {
                        contentTypeId: scopedTypeId,
                        autoSubmitReview: true
                    }
                }
            });
            expect(createRun.statusCode).toBe(201);
            runId = JSON.parse(createRun.payload).data.id as number;

            const approveRun = await fastify.inject({
                method: 'POST',
                url: `/api/agent-runs/${runId}/control`,
                headers: { 'x-api-key': limitedRawKey },
                payload: { action: 'approve' }
            });
            expect(approveRun.statusCode).toBe(200);
            expect(JSON.parse(approveRun.payload).data.status).toBe('running');

            await settleAgentRun(domain1Id, runId!);

            const details = await fastify.inject({
                method: 'GET',
                url: `/api/agent-runs/${runId}`,
                headers: { 'x-api-key': limitedRawKey }
            });
            expect(details.statusCode).toBe(200);
            const detailsPayload = JSON.parse(details.payload) as {
                data: {
                    steps: Array<{
                        actionType: string;
                        status: string;
                        errorMessage?: string | null;
                    }>;
                };
            };

            const submitStep = detailsPayload.data.steps.find((step) => step.actionType === 'submit_review');
            expect(submitStep?.status).toBe('failed');
            expect(submitStep?.errorMessage).toContain('UNAUTHORIZED_WORKFLOW_TRANSITION');
        } finally {
            if (runId) {
                await db.delete(agentRuns).where(eq(agentRuns.id, runId));
            }
            if (draftItemId) {
                await db.delete(contentItems).where(eq(contentItems.id, draftItemId));
            }
            if (transitionId) {
                await db.delete(reviewTasks).where(eq(reviewTasks.workflowTransitionId, transitionId));
                await db.delete(workflowTransitions).where(eq(workflowTransitions.id, transitionId));
            }
            if (workflowId) {
                await db.delete(workflows).where(eq(workflows.id, workflowId));
            }
            if (scopedTypeId) {
                await db.delete(contentTypes).where(eq(contentTypes.id, scopedTypeId));
            }
            if (limitedKeyId) {
                await db.delete(apiKeys).where(eq(apiKeys.id, limitedKeyId));
            }
        }
    });

    it('review_backlog_manager auto-submit succeeds with noop completion when no candidates are staged', async () => {
        let scopedTypeId: number | null = null;
        let runId: number | null = null;

        try {
            const [scopedType] = await db.insert(contentTypes).values({
                domainId: domain1Id,
                name: `Backlog Noop Type ${crypto.randomUUID().slice(0, 6)}`,
                slug: `backlog-noop-${crypto.randomUUID().slice(0, 8)}`,
                schema: JSON.stringify({ type: 'object' }),
                basePrice: 0
            }).returning();
            scopedTypeId = scopedType.id;

            const createRun = await fastify.inject({
                method: 'POST',
                url: '/api/agent-runs',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    goal: `noop-review-backlog-${crypto.randomUUID().slice(0, 8)}`,
                    runType: 'review_backlog_manager',
                    requireApproval: true,
                    metadata: {
                        contentTypeId: scopedTypeId,
                        autoSubmitReview: true
                    }
                }
            });
            expect(createRun.statusCode).toBe(201);
            runId = JSON.parse(createRun.payload).data.id as number;

            const approveRun = await fastify.inject({
                method: 'POST',
                url: `/api/agent-runs/${runId}/control`,
                headers: { 'x-api-key': rawKey1 },
                payload: { action: 'approve' }
            });
            expect(approveRun.statusCode).toBe(200);
            expect(JSON.parse(approveRun.payload).data.status).toBe('running');

            await settleAgentRun(domain1Id, runId!);

            const details = await fastify.inject({
                method: 'GET',
                url: `/api/agent-runs/${runId}`,
                headers: { 'x-api-key': rawKey1 }
            });
            expect(details.statusCode).toBe(200);
            const detailsPayload = JSON.parse(details.payload) as {
                data: {
                    run: {
                        status: string;
                    };
                    steps: Array<{
                        actionType: string;
                    }>;
                    checkpoints: Array<{
                        checkpointKey: string;
                        payload?: {
                            succeededCount?: number;
                            noop?: boolean;
                            settledStatus?: string;
                        };
                    }>;
                };
            };

            expect(detailsPayload.data.run.status).toBe('succeeded');
            expect(detailsPayload.data.steps.some((step) => step.actionType === 'submit_review')).toBe(false);

            const completionCheckpoint = detailsPayload.data.checkpoints.find(
                (checkpoint) => checkpoint.checkpointKey === 'review_execution_completed'
            );
            expect(completionCheckpoint?.payload?.succeededCount).toBe(0);
            expect(completionCheckpoint?.payload?.noop).toBe(true);

            const settledCheckpoint = detailsPayload.data.checkpoints.find(
                (checkpoint) => checkpoint.checkpointKey === 'control_approve_settled'
            );
            expect(settledCheckpoint?.payload?.settledStatus).toBe('succeeded');
        } finally {
            if (runId) {
                await db.delete(agentRuns).where(eq(agentRuns.id, runId));
            }
            if (scopedTypeId) {
                await db.delete(contentTypes).where(eq(contentTypes.id, scopedTypeId));
            }
        }
    });

    it('review_backlog_manager auto-submit fails run when workflow is missing', async () => {
        let scopedTypeId: number | null = null;
        let draftItemId: number | null = null;
        let runId: number | null = null;

        try {
            const [scopedType] = await db.insert(contentTypes).values({
                domainId: domain1Id,
                name: `Backlog Fail Type ${crypto.randomUUID().slice(0, 6)}`,
                slug: `backlog-fail-${crypto.randomUUID().slice(0, 8)}`,
                schema: JSON.stringify({ type: 'object' }),
                basePrice: 0
            }).returning();
            scopedTypeId = scopedType.id;

            const [draftItem] = await db.insert(contentItems).values({
                domainId: domain1Id,
                contentTypeId: scopedTypeId,
                data: JSON.stringify({ title: 'missing-workflow-draft' }),
                status: 'draft'
            }).returning();
            draftItemId = draftItem.id;

            const createRun = await fastify.inject({
                method: 'POST',
                url: '/api/agent-runs',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    goal: `fail-review-backlog-${crypto.randomUUID().slice(0, 8)}`,
                    runType: 'review_backlog_manager',
                    requireApproval: true,
                    metadata: {
                        contentTypeId: scopedTypeId,
                        autoSubmitReview: true
                    }
                }
            });
            expect(createRun.statusCode).toBe(201);
            runId = JSON.parse(createRun.payload).data.id as number;

            const approveRun = await fastify.inject({
                method: 'POST',
                url: `/api/agent-runs/${runId}/control`,
                headers: { 'x-api-key': rawKey1 },
                payload: { action: 'approve' }
            });
            expect(approveRun.statusCode).toBe(200);
            expect(JSON.parse(approveRun.payload).data.status).toBe('running');

            await settleAgentRun(domain1Id, runId!);

            const details = await fastify.inject({
                method: 'GET',
                url: `/api/agent-runs/${runId}`,
                headers: { 'x-api-key': rawKey1 }
            });
            expect(details.statusCode).toBe(200);
            const detailsPayload = JSON.parse(details.payload) as {
                data: {
                    run: {
                        status: string;
                    };
                    steps: Array<{
                        actionType: string;
                        status: string;
                        errorMessage?: string | null;
                    }>;
                    checkpoints: Array<{
                        checkpointKey: string;
                        payload?: {
                            failedCount?: number;
                            settledStatus?: string;
                        };
                    }>;
                };
            };

            expect(detailsPayload.data.run.status).toBe('failed');
            const submitSteps = detailsPayload.data.steps.filter((step) => step.actionType === 'submit_review');
            expect(submitSteps).toHaveLength(1);
            expect(submitSteps[0].status).toBe('failed');
            expect(submitSteps[0].errorMessage).toContain('No active workflow transitions');

            const failedCheckpoint = detailsPayload.data.checkpoints.find(
                (checkpoint) => checkpoint.checkpointKey === 'review_execution_failed'
            );
            expect(failedCheckpoint?.payload?.failedCount).toBe(1);

            const settledCheckpoint = detailsPayload.data.checkpoints.find(
                (checkpoint) => checkpoint.checkpointKey === 'control_approve_settled'
            );
            expect(settledCheckpoint?.payload?.settledStatus).toBe('failed');
        } finally {
            if (runId) {
                await db.delete(agentRuns).where(eq(agentRuns.id, runId));
            }
            if (draftItemId) {
                await db.delete(contentItems).where(eq(contentItems.id, draftItemId));
            }
            if (scopedTypeId) {
                await db.delete(contentTypes).where(eq(contentTypes.id, scopedTypeId));
            }
        }
    });

    it('review_backlog_manager resume retries failed submit_review steps after workflow is configured', async () => {
        let scopedTypeId: number | null = null;
        let workflowId: number | null = null;
        let transitionId: number | null = null;
        let draftItemId: number | null = null;
        let runId: number | null = null;

        try {
            const [scopedType] = await db.insert(contentTypes).values({
                domainId: domain1Id,
                name: `Backlog Retry Type ${crypto.randomUUID().slice(0, 6)}`,
                slug: `backlog-retry-${crypto.randomUUID().slice(0, 8)}`,
                schema: JSON.stringify({ type: 'object' }),
                basePrice: 0
            }).returning();
            scopedTypeId = scopedType.id;

            const [draftItem] = await db.insert(contentItems).values({
                domainId: domain1Id,
                contentTypeId: scopedTypeId,
                data: JSON.stringify({ title: 'retry-draft-item' }),
                status: 'draft'
            }).returning();
            draftItemId = draftItem.id;

            const createRun = await fastify.inject({
                method: 'POST',
                url: '/api/agent-runs',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    goal: `retry-review-backlog-${crypto.randomUUID().slice(0, 8)}`,
                    runType: 'review_backlog_manager',
                    requireApproval: true,
                    metadata: {
                        contentTypeId: scopedTypeId,
                        autoSubmitReview: true
                    }
                }
            });
            expect(createRun.statusCode).toBe(201);
            runId = JSON.parse(createRun.payload).data.id as number;

            const initialApprove = await fastify.inject({
                method: 'POST',
                url: `/api/agent-runs/${runId}/control`,
                headers: { 'x-api-key': rawKey1 },
                payload: { action: 'approve' }
            });
            expect(initialApprove.statusCode).toBe(200);
            expect(JSON.parse(initialApprove.payload).data.status).toBe('running');

            await settleAgentRun(domain1Id, runId!);

            const [workflow] = await db.insert(workflows).values({
                domainId: domain1Id,
                name: `Retry Workflow ${crypto.randomUUID().slice(0, 6)}`,
                contentTypeId: scopedTypeId,
                active: true
            }).returning();
            workflowId = workflow.id;

            const [transition] = await db.insert(workflowTransitions).values({
                workflowId: workflowId,
                fromState: 'draft',
                toState: 'pending_review',
                requiredRoles: []
            }).returning();
            transitionId = transition.id;

            const resumeRun = await fastify.inject({
                method: 'POST',
                url: `/api/agent-runs/${runId}/control`,
                headers: { 'x-api-key': rawKey1 },
                payload: { action: 'resume' }
            });
            expect(resumeRun.statusCode).toBe(200);
            expect(JSON.parse(resumeRun.payload).data.status).toBe('queued');

            const finalApprove = await fastify.inject({
                method: 'POST',
                url: `/api/agent-runs/${runId}/control`,
                headers: { 'x-api-key': rawKey1 },
                payload: { action: 'approve' }
            });
            expect(finalApprove.statusCode).toBe(200);
            expect(JSON.parse(finalApprove.payload).data.status).toBe('running');

            await settleAgentRun(domain1Id, runId!);

            const details = await fastify.inject({
                method: 'GET',
                url: `/api/agent-runs/${runId}`,
                headers: { 'x-api-key': rawKey1 }
            });
            expect(details.statusCode).toBe(200);
            const detailsPayload = JSON.parse(details.payload) as {
                data: {
                    run: {
                        status: string;
                    };
                    steps: Array<{
                        actionType: string;
                        status: string;
                        responseSnapshot?: {
                            reviewTaskId?: number;
                            workflowTransitionId?: number;
                        } | null;
                    }>;
                    checkpoints: Array<{
                        checkpointKey: string;
                        payload?: {
                            failedCount?: number;
                            succeededCount?: number;
                        };
                    }>;
                };
            };

            expect(detailsPayload.data.run.status).toBe('succeeded');
            const submitSteps = detailsPayload.data.steps.filter((step) => step.actionType === 'submit_review');
            expect(submitSteps).toHaveLength(1);
            expect(submitSteps[0].status).toBe('succeeded');
            expect(submitSteps[0].responseSnapshot?.workflowTransitionId).toBe(transitionId);
            expect(typeof submitSteps[0].responseSnapshot?.reviewTaskId).toBe('number');

            const retryCheckpoint = detailsPayload.data.checkpoints.find(
                (checkpoint) => checkpoint.checkpointKey === 'review_retry_scheduled'
            );
            expect(retryCheckpoint?.payload?.failedCount).toBe(1);

            const completionCheckpoint = detailsPayload.data.checkpoints.find(
                (checkpoint) => checkpoint.checkpointKey === 'review_execution_completed'
            );
            expect(completionCheckpoint?.payload?.succeededCount).toBe(1);

            const pendingTasksResponse = await fastify.inject({
                method: 'GET',
                url: '/api/review-tasks',
                headers: { 'x-api-key': rawKey1 }
            });
            expect(pendingTasksResponse.statusCode).toBe(200);
            const pendingTasksPayload = JSON.parse(pendingTasksResponse.payload) as {
                data: Array<{
                    task: {
                        contentItemId: number;
                        workflowTransitionId: number;
                        status: string;
                    };
                }>;
            };
            expect(
                pendingTasksPayload.data.some((row) =>
                    row.task.contentItemId === draftItemId
                    && row.task.workflowTransitionId === transitionId
                    && row.task.status === 'pending'
                )
            ).toBe(true);
        } finally {
            if (runId) {
                await db.delete(agentRuns).where(eq(agentRuns.id, runId));
            }
            if (draftItemId) {
                await db.delete(contentItems).where(eq(contentItems.id, draftItemId));
            }
            if (transitionId) {
                await db.delete(reviewTasks).where(eq(reviewTasks.workflowTransitionId, transitionId));
                await db.delete(workflowTransitions).where(eq(workflowTransitions.id, transitionId));
            }
            if (workflowId) {
                await db.delete(workflows).where(eq(workflows.id, workflowId));
            }
            if (scopedTypeId) {
                await db.delete(contentTypes).where(eq(contentTypes.id, scopedTypeId));
            }
        }
    });

    it('quality_refiner approve auto-validates staged schema checks when enabled', async () => {
        let scopedTypeId: number | null = null;
        let contentItemId: number | null = null;
        let runId: number | null = null;

        try {
            const [scopedType] = await db.insert(contentTypes).values({
                domainId: domain1Id,
                name: `Quality Refiner Type ${crypto.randomUUID().slice(0, 6)}`,
                slug: `quality-refiner-${crypto.randomUUID().slice(0, 8)}`,
                schema: JSON.stringify({
                    type: 'object',
                    properties: {
                        title: { type: 'string' }
                    },
                    required: ['title']
                }),
                basePrice: 0
            }).returning();
            scopedTypeId = scopedType.id;

            const [item] = await db.insert(contentItems).values({
                domainId: domain1Id,
                contentTypeId: scopedTypeId,
                data: JSON.stringify({ title: 'valid-quality-item' }),
                status: 'draft'
            }).returning();
            contentItemId = item.id;

            const createRun = await fastify.inject({
                method: 'POST',
                url: '/api/agent-runs',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    goal: `quality-refiner-success-${crypto.randomUUID().slice(0, 8)}`,
                    runType: 'quality_refiner',
                    requireApproval: true,
                    metadata: {
                        contentTypeId: scopedTypeId,
                        autoValidateQuality: true,
                        maxCandidates: 5
                    }
                }
            });
            expect(createRun.statusCode).toBe(201);
            runId = JSON.parse(createRun.payload).data.id as number;

            const approveRun = await fastify.inject({
                method: 'POST',
                url: `/api/agent-runs/${runId}/control`,
                headers: { 'x-api-key': rawKey1 },
                payload: { action: 'approve' }
            });
            expect(approveRun.statusCode).toBe(200);
            expect(JSON.parse(approveRun.payload).data.status).toBe('running');

            await settleAgentRun(domain1Id, runId!);

            const details = await fastify.inject({
                method: 'GET',
                url: `/api/agent-runs/${runId}`,
                headers: { 'x-api-key': rawKey1 }
            });
            expect(details.statusCode).toBe(200);
            const detailsPayload = JSON.parse(details.payload) as {
                data: {
                    run: { status: string };
                    steps: Array<{
                        actionType: string;
                        status: string;
                        responseSnapshot?: {
                            valid?: boolean;
                            contentItemId?: number;
                        } | null;
                    }>;
                    checkpoints: Array<{
                        checkpointKey: string;
                        payload?: {
                            selectedCount?: number;
                            succeededCount?: number;
                            settledStatus?: string;
                        };
                    }>;
                };
            };

            expect(detailsPayload.data.run.status).toBe('succeeded');
            const validationSteps = detailsPayload.data.steps.filter((step) => step.actionType === 'validate_schema');
            expect(validationSteps).toHaveLength(1);
            expect(validationSteps[0].status).toBe('succeeded');
            expect(validationSteps[0].responseSnapshot?.valid).toBe(true);
            expect(validationSteps[0].responseSnapshot?.contentItemId).toBe(contentItemId);

            const stagedCheckpoint = detailsPayload.data.checkpoints.find(
                (checkpoint) => checkpoint.checkpointKey === 'planned_quality_checks'
            );
            expect(stagedCheckpoint?.payload?.selectedCount).toBe(1);

            const completionCheckpoint = detailsPayload.data.checkpoints.find(
                (checkpoint) => checkpoint.checkpointKey === 'quality_validation_completed'
            );
            expect(completionCheckpoint?.payload?.succeededCount).toBe(1);

            const settledCheckpoint = detailsPayload.data.checkpoints.find(
                (checkpoint) => checkpoint.checkpointKey === 'control_approve_settled'
            );
            expect(settledCheckpoint?.payload?.settledStatus).toBe('succeeded');
        } finally {
            if (runId) {
                await db.delete(agentRuns).where(eq(agentRuns.id, runId));
            }
            if (contentItemId) {
                await db.delete(contentItems).where(eq(contentItems.id, contentItemId));
            }
            if (scopedTypeId) {
                await db.delete(contentTypes).where(eq(contentTypes.id, scopedTypeId));
            }
        }
    });

    it('quality_refiner resume retries failed validations after content is fixed', async () => {
        let scopedTypeId: number | null = null;
        let contentItemId: number | null = null;
        let runId: number | null = null;

        try {
            const [scopedType] = await db.insert(contentTypes).values({
                domainId: domain1Id,
                name: `Quality Retry Type ${crypto.randomUUID().slice(0, 6)}`,
                slug: `quality-retry-${crypto.randomUUID().slice(0, 8)}`,
                schema: JSON.stringify({
                    type: 'object',
                    properties: {
                        title: { type: 'string' }
                    },
                    required: ['title']
                }),
                basePrice: 0
            }).returning();
            scopedTypeId = scopedType.id;

            const [item] = await db.insert(contentItems).values({
                domainId: domain1Id,
                contentTypeId: scopedTypeId,
                data: JSON.stringify({}),
                status: 'draft'
            }).returning();
            contentItemId = item.id;

            const createRun = await fastify.inject({
                method: 'POST',
                url: '/api/agent-runs',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    goal: `quality-refiner-retry-${crypto.randomUUID().slice(0, 8)}`,
                    runType: 'quality_refiner',
                    requireApproval: true,
                    metadata: {
                        contentTypeId: scopedTypeId,
                        autoValidateQuality: true
                    }
                }
            });
            expect(createRun.statusCode).toBe(201);
            runId = JSON.parse(createRun.payload).data.id as number;

            const initialApprove = await fastify.inject({
                method: 'POST',
                url: `/api/agent-runs/${runId}/control`,
                headers: { 'x-api-key': rawKey1 },
                payload: { action: 'approve' }
            });
            expect(initialApprove.statusCode).toBe(200);
            expect(JSON.parse(initialApprove.payload).data.status).toBe('running');

            await settleAgentRun(domain1Id, runId!);

            await db.update(contentItems)
                .set({
                    data: JSON.stringify({ title: 'fixed-quality-item' })
                })
                .where(and(
                    eq(contentItems.id, contentItemId),
                    eq(contentItems.domainId, domain1Id)
                ));

            const resumeRun = await fastify.inject({
                method: 'POST',
                url: `/api/agent-runs/${runId}/control`,
                headers: { 'x-api-key': rawKey1 },
                payload: { action: 'resume' }
            });
            expect(resumeRun.statusCode).toBe(200);
            expect(JSON.parse(resumeRun.payload).data.status).toBe('queued');

            const finalApprove = await fastify.inject({
                method: 'POST',
                url: `/api/agent-runs/${runId}/control`,
                headers: { 'x-api-key': rawKey1 },
                payload: { action: 'approve' }
            });
            expect(finalApprove.statusCode).toBe(200);
            expect(JSON.parse(finalApprove.payload).data.status).toBe('running');

            await settleAgentRun(domain1Id, runId!);

            const details = await fastify.inject({
                method: 'GET',
                url: `/api/agent-runs/${runId}`,
                headers: { 'x-api-key': rawKey1 }
            });
            expect(details.statusCode).toBe(200);
            const detailsPayload = JSON.parse(details.payload) as {
                data: {
                    run: {
                        status: string;
                    };
                    steps: Array<{
                        actionType: string;
                        status: string;
                        errorMessage?: string | null;
                        responseSnapshot?: {
                            valid?: boolean;
                        } | null;
                    }>;
                    checkpoints: Array<{
                        checkpointKey: string;
                        payload?: {
                            failedCount?: number;
                            succeededCount?: number;
                        };
                    }>;
                };
            };

            expect(detailsPayload.data.run.status).toBe('succeeded');
            const validationSteps = detailsPayload.data.steps.filter((step) => step.actionType === 'validate_schema');
            expect(validationSteps).toHaveLength(1);
            expect(validationSteps[0].status).toBe('succeeded');
            expect(validationSteps[0].errorMessage).toBeNull();
            expect(validationSteps[0].responseSnapshot?.valid).toBe(true);

            const retryCheckpoint = detailsPayload.data.checkpoints.find(
                (checkpoint) => checkpoint.checkpointKey === 'quality_retry_scheduled'
            );
            expect(retryCheckpoint?.payload?.failedCount).toBe(1);

            const completionCheckpoint = detailsPayload.data.checkpoints.find(
                (checkpoint) => checkpoint.checkpointKey === 'quality_validation_completed'
            );
            expect(completionCheckpoint?.payload?.succeededCount).toBe(1);
        } finally {
            if (runId) {
                await db.delete(agentRuns).where(eq(agentRuns.id, runId));
            }
            if (contentItemId) {
                await db.delete(contentItems).where(eq(contentItems.id, contentItemId));
            }
            if (scopedTypeId) {
                await db.delete(contentTypes).where(eq(contentTypes.id, scopedTypeId));
            }
        }
    });

    it('agent-run control approve action is idempotent', async () => {
        let runId: number | null = null;

        try {
            const createRun = await fastify.inject({
                method: 'POST',
                url: '/api/agent-runs',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    goal: `idempotent-control-${crypto.randomUUID().slice(0, 8)}`,
                    runType: 'review_backlog_manager',
                    requireApproval: true
                }
            });
            expect(createRun.statusCode).toBe(201);
            runId = JSON.parse(createRun.payload).data.id as number;

            const firstApprove = await fastify.inject({
                method: 'POST',
                url: `/api/agent-runs/${runId}/control`,
                headers: {
                    'x-api-key': rawKey1
                },
                payload: { action: 'approve' }
            });
            expect(firstApprove.statusCode).toBe(200);
            expect(JSON.parse(firstApprove.payload).data.status).toBe('running');

            const replayApprove = await fastify.inject({
                method: 'POST',
                url: `/api/agent-runs/${runId}/control`,
                headers: {
                    'x-api-key': rawKey1
                },
                payload: { action: 'approve' }
            });
            expect(replayApprove.statusCode).toBe(200);
            expect(JSON.parse(replayApprove.payload).data.status).toBe('running');

            const runDetails = await fastify.inject({
                method: 'GET',
                url: `/api/agent-runs/${runId}`,
                headers: { 'x-api-key': rawKey1 }
            });
            expect(runDetails.statusCode).toBe(200);

            const detailsPayload = JSON.parse(runDetails.payload) as {
                data: {
                    checkpoints: Array<{ checkpointKey: string }>;
                };
            };
            const approveCheckpointCount = detailsPayload.data.checkpoints
                .filter((checkpoint) => checkpoint.checkpointKey === 'control_approve')
                .length;

            expect(approveCheckpointCount).toBe(1);
        } finally {
            if (runId) {
                await db.delete(agentRuns).where(eq(agentRuns.id, runId));
            }
        }
    });

    it('agent-run resume recovers failed run back to queued', async () => {
        let runId: number | null = null;

        try {
            const [failedRun] = await db.insert(agentRuns).values({
                domainId: domain1Id,
                goal: `recover-failed-${crypto.randomUUID().slice(0, 8)}`,
                runType: 'review_backlog_manager',
                status: 'failed',
                requestedBy: apiKey1Id,
                startedAt: new Date(Date.now() - 5 * 60 * 1000),
                completedAt: new Date(Date.now() - 60 * 1000),
                metadata: { reason: 'transient_network_error' }
            }).returning();
            runId = failedRun.id;

            const resumeResponse = await fastify.inject({
                method: 'POST',
                url: `/api/agent-runs/${runId}/control`,
                headers: { 'x-api-key': rawKey1 },
                payload: { action: 'resume' }
            });
            expect(resumeResponse.statusCode).toBe(200);
            const resumePayload = JSON.parse(resumeResponse.payload) as {
                data: {
                    status: string;
                    completedAt: string | null;
                };
            };
            expect(resumePayload.data.status).toBe('queued');
            expect(resumePayload.data.completedAt).toBeNull();

            const detailsResponse = await fastify.inject({
                method: 'GET',
                url: `/api/agent-runs/${runId}`,
                headers: { 'x-api-key': rawKey1 }
            });
            expect(detailsResponse.statusCode).toBe(200);
            const detailsPayload = JSON.parse(detailsResponse.payload) as {
                data: {
                    checkpoints: Array<{ checkpointKey: string }>;
                };
            };
            expect(detailsPayload.data.checkpoints.some((checkpoint) => checkpoint.checkpointKey === 'control_resume')).toBe(true);
        } finally {
            if (runId) {
                await db.delete(agentRuns).where(eq(agentRuns.id, runId));
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

    it('agent-run-definition list supports runType filter', async () => {
        const definitionIds: number[] = [];

        try {
            const reviewDefinition = await fastify.inject({
                method: 'POST',
                url: '/api/agent-run-definitions',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    name: `d1-review-${crypto.randomUUID().slice(0, 8)}`,
                    runType: 'review_backlog_manager',
                    strategyConfig: {},
                    active: true
                }
            });
            expect(reviewDefinition.statusCode).toBe(201);
            definitionIds.push(JSON.parse(reviewDefinition.payload).data.id as number);

            const qualityDefinition = await fastify.inject({
                method: 'POST',
                url: '/api/agent-run-definitions',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    name: `d1-quality-${crypto.randomUUID().slice(0, 8)}`,
                    runType: 'quality_refiner',
                    strategyConfig: {},
                    active: true
                }
            });
            expect(qualityDefinition.statusCode).toBe(201);
            const qualityDefinitionId = JSON.parse(qualityDefinition.payload).data.id as number;
            definitionIds.push(qualityDefinitionId);

            const filteredList = await fastify.inject({
                method: 'GET',
                url: '/api/agent-run-definitions?runType=quality_refiner&limit=500',
                headers: { 'x-api-key': rawKey1 }
            });
            expect(filteredList.statusCode).toBe(200);
            const filteredPayload = JSON.parse(filteredList.payload) as {
                data: Array<{ id: number; runType: string }>;
            };

            const matchingDefinitionIds = filteredPayload.data
                .filter((definition) => definition.runType === 'quality_refiner')
                .map((definition) => definition.id);

            expect(matchingDefinitionIds).toContain(qualityDefinitionId);
            expect(filteredPayload.data.some((definition) => definition.id === definitionIds[0])).toBe(false);
        } finally {
            for (const definitionId of definitionIds) {
                await db.delete(agentRunDefinitions).where(eq(agentRunDefinitions.id, definitionId));
            }
        }
    });

    it('agent-run creation from definition inherits strategy config and definition runType', async () => {
        let domain1DefinitionId: number | null = null;
        let domain1RunId: number | null = null;

        try {
            const createDefinition = await fastify.inject({
                method: 'POST',
                url: '/api/agent-run-definitions',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    name: `d1-inherit-${crypto.randomUUID().slice(0, 8)}`,
                    runType: 'quality_refiner',
                    strategyConfig: {
                        maxCandidates: 5,
                        safeMode: true
                    },
                    active: true
                }
            });
            expect(createDefinition.statusCode).toBe(201);
            domain1DefinitionId = JSON.parse(createDefinition.payload).data.id as number;

            const createRun = await fastify.inject({
                method: 'POST',
                url: '/api/agent-runs',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    goal: 'Run from template',
                    definitionId: domain1DefinitionId,
                    runType: 'review_backlog_manager',
                    metadata: {
                        safeMode: false,
                        operator: 'tenant-test'
                    }
                }
            });
            expect(createRun.statusCode).toBe(201);

            const runPayload = JSON.parse(createRun.payload) as {
                data: {
                    id: number;
                    runType: string;
                    definitionId: number | null;
                    metadata: Record<string, unknown> | null;
                };
            };
            domain1RunId = runPayload.data.id;

            expect(runPayload.data.definitionId).toBe(domain1DefinitionId);
            expect(runPayload.data.runType).toBe('quality_refiner');
            expect(runPayload.data.metadata).toEqual({
                maxCandidates: 5,
                safeMode: false,
                operator: 'tenant-test'
            });
        } finally {
            if (domain1RunId) {
                await db.delete(agentRuns).where(eq(agentRuns.id, domain1RunId));
            }
            if (domain1DefinitionId) {
                await db.delete(agentRunDefinitions).where(eq(agentRunDefinitions.id, domain1DefinitionId));
            }
        }
    });

    it('agent-run list supports runType and definitionId filters', async () => {
        let definitionId: number | null = null;
        let runFromDefinitionId: number | null = null;
        let runManualId: number | null = null;

        try {
            const createDefinition = await fastify.inject({
                method: 'POST',
                url: '/api/agent-run-definitions',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    name: `d1-filter-${crypto.randomUUID().slice(0, 8)}`,
                    runType: 'review_backlog_manager',
                    strategyConfig: {},
                    active: true
                }
            });
            expect(createDefinition.statusCode).toBe(201);
            definitionId = JSON.parse(createDefinition.payload).data.id as number;

            const runFromDefinition = await fastify.inject({
                method: 'POST',
                url: '/api/agent-runs',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    goal: 'from-definition',
                    definitionId
                }
            });
            expect(runFromDefinition.statusCode).toBe(201);
            runFromDefinitionId = JSON.parse(runFromDefinition.payload).data.id as number;

            const runManual = await fastify.inject({
                method: 'POST',
                url: '/api/agent-runs',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    goal: 'manual',
                    runType: 'quality_refiner'
                }
            });
            expect(runManual.statusCode).toBe(201);
            runManualId = JSON.parse(runManual.payload).data.id as number;

            const byRunType = await fastify.inject({
                method: 'GET',
                url: '/api/agent-runs?runType=quality_refiner&limit=500',
                headers: { 'x-api-key': rawKey1 }
            });
            expect(byRunType.statusCode).toBe(200);
            const byRunTypePayload = JSON.parse(byRunType.payload) as {
                data: Array<{ id: number; runType: string }>;
            };
            expect(byRunTypePayload.data.some((run) => run.id === runManualId)).toBe(true);
            expect(byRunTypePayload.data.some((run) => run.id === runFromDefinitionId)).toBe(false);

            const byDefinition = await fastify.inject({
                method: 'GET',
                url: `/api/agent-runs?definitionId=${definitionId}&limit=500`,
                headers: { 'x-api-key': rawKey1 }
            });
            expect(byDefinition.statusCode).toBe(200);
            const byDefinitionPayload = JSON.parse(byDefinition.payload) as {
                data: Array<{ id: number; definitionId: number | null }>;
            };
            expect(byDefinitionPayload.data.some((run) => run.id === runFromDefinitionId)).toBe(true);
            expect(byDefinitionPayload.data.some((run) => run.id === runManualId)).toBe(false);
        } finally {
            if (runFromDefinitionId) {
                await db.delete(agentRuns).where(eq(agentRuns.id, runFromDefinitionId));
            }
            if (runManualId) {
                await db.delete(agentRuns).where(eq(agentRuns.id, runManualId));
            }
            if (definitionId) {
                await db.delete(agentRunDefinitions).where(eq(agentRunDefinitions.id, definitionId));
            }
        }
    });

    it('rejects run creation from inactive definitions', async () => {
        let definitionId: number | null = null;

        try {
            const createDefinition = await fastify.inject({
                method: 'POST',
                url: '/api/agent-run-definitions',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    name: `d1-inactive-${crypto.randomUUID().slice(0, 8)}`,
                    runType: 'review_backlog_manager',
                    strategyConfig: {},
                    active: false
                }
            });
            expect(createDefinition.statusCode).toBe(201);
            definitionId = JSON.parse(createDefinition.payload).data.id as number;

            const createRun = await fastify.inject({
                method: 'POST',
                url: '/api/agent-runs',
                headers: { 'x-api-key': rawKey1 },
                payload: {
                    goal: 'inactive-definition-run',
                    definitionId
                }
            });
            expect(createRun.statusCode).toBe(400);
            expect(JSON.parse(createRun.payload).code).toBe('AGENT_RUN_DEFINITION_INACTIVE');
        } finally {
            if (definitionId) {
                await db.delete(agentRunDefinitions).where(eq(agentRunDefinitions.id, definitionId));
            }
        }
    });
});
