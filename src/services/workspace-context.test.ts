import { afterEach, describe, expect, it, vi } from 'vitest';

import { db } from '../db/index.js';
import { getWorkspaceContextSnapshot } from './workspace-context.js';

describe('getWorkspaceContextSnapshot', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('groups practical authoring, review, workflow, and paid targets for the active actor', async () => {
        vi.spyOn(db, 'select')
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 7,
                        name: 'Docs',
                        hostname: 'docs.example.com',
                    }]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([
                        {
                            id: 11,
                            domainId: 7,
                            name: 'Empty Draft',
                            slug: 'empty-draft',
                            description: null,
                            schema: JSON.stringify({
                                type: 'object',
                                properties: {
                                    title: { type: 'string' },
                                },
                                required: ['title'],
                            }),
                            basePrice: null,
                        },
                        {
                            id: 12,
                            domainId: 7,
                            name: 'Editorial Article',
                            slug: 'editorial-article',
                            description: 'Reviewed content',
                            schema: JSON.stringify({
                                type: 'object',
                                properties: {
                                    title: { type: 'string' },
                                    body: { type: 'string' },
                                },
                                required: ['title', 'body'],
                            }),
                            basePrice: null,
                        },
                        {
                            id: 13,
                            domainId: 7,
                            name: 'Premium Report',
                            slug: 'premium-report',
                            description: 'Paid content',
                            schema: JSON.stringify({
                                type: 'object',
                                properties: {
                                    title: { type: 'string' },
                                },
                                required: ['title'],
                            }),
                            basePrice: 500,
                        },
                    ]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([
                        {
                            id: 100,
                            contentTypeId: 12,
                            status: 'draft',
                            updatedAt: new Date('2026-03-11T10:00:00Z'),
                        },
                        {
                            id: 101,
                            contentTypeId: 12,
                            status: 'in_review',
                            updatedAt: new Date('2026-03-11T11:00:00Z'),
                        },
                        {
                            id: 102,
                            contentTypeId: 12,
                            status: 'published',
                            updatedAt: new Date('2026-03-11T12:00:00Z'),
                        },
                        {
                            id: 103,
                            contentTypeId: 13,
                            status: 'published',
                            updatedAt: new Date('2026-03-11T09:00:00Z'),
                        },
                    ]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 20,
                        domainId: 7,
                        name: 'Editorial Flow',
                        contentTypeId: 12,
                        active: true,
                    }]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([
                        { workflowId: 20 },
                        { workflowId: 20 },
                    ]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        scopeRef: 13,
                        priceSats: 500,
                    }]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([
                        { contentItemId: 100 },
                        { contentItemId: 101 },
                    ]),
                }),
            }) as unknown as ReturnType<typeof db.select>);

        const snapshot = await getWorkspaceContextSnapshot({
            actorId: 'api_key:12',
            actorType: 'api_key',
            actorSource: 'db',
            actorProfileId: 'api-key',
            domainId: 7,
            scopes: ['content:read', 'content:write'],
            assignmentRefs: ['api_key:12', '12'],
        });

        expect(snapshot.summary).toEqual({
            totalContentTypes: 3,
            contentTypesWithContent: 2,
            workflowEnabledContentTypes: 1,
            paidContentTypes: 1,
            pendingReviewTaskCount: 2,
        });
        expect(snapshot.targets.authoring[0]).toEqual(expect.objectContaining({
            id: 12,
            name: 'Editorial Article',
        }));
        expect(snapshot.targets.review[0]).toEqual(expect.objectContaining({
            id: 12,
            pendingReviewTaskCount: 2,
        }));
        expect(snapshot.targets.workflow[0]).toEqual(expect.objectContaining({
            id: 12,
            activeWorkflowCount: 1,
        }));
        expect(snapshot.targets.paid[0]).toEqual(expect.objectContaining({
            id: 13,
            activeTypeOfferCount: 1,
            reason: '1 active type offer(s), starting at 500 sats.',
        }));
    });
});
