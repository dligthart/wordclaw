import { afterEach, describe, expect, it, vi } from 'vitest';

import { db } from '../db/index.js';
import { getWorkspaceContextSnapshot, resolveWorkspaceTarget } from './workspace-context.js';

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

    it('supports intent-scoped and search-filtered workspace views', async () => {
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
                            name: 'Author Profile',
                            slug: 'author-profile',
                            description: null,
                            schema: JSON.stringify({ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }),
                            basePrice: null,
                        },
                        {
                            id: 12,
                            domainId: 7,
                            name: 'Editorial Article',
                            slug: 'editorial-article',
                            description: 'Reviewed content',
                            schema: JSON.stringify({ type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }),
                            basePrice: null,
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
                            status: 'in_review',
                            updatedAt: new Date('2026-03-11T11:00:00Z'),
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
                    where: vi.fn().mockResolvedValue([{ workflowId: 20 }]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ contentItemId: 100 }]),
                }),
            }) as unknown as ReturnType<typeof db.select>);

        const snapshot = await getWorkspaceContextSnapshot({
            actorId: 'api_key:12',
            actorType: 'api_key',
            actorSource: 'db',
            actorProfileId: 'api-key',
            domainId: 7,
            scopes: ['content:read'],
            assignmentRefs: ['api_key:12', '12'],
        }, {
            intent: 'review',
            search: 'editorial',
            limit: 1,
        });

        expect(snapshot.filter).toEqual({
            intent: 'review',
            search: 'editorial',
            limit: 1,
            totalContentTypesBeforeFilter: 2,
            totalContentTypesAfterSearch: 1,
            returnedContentTypes: 1,
        });
        expect(snapshot.contentTypes).toHaveLength(1);
        expect(snapshot.contentTypes[0]).toEqual(expect.objectContaining({
            id: 12,
            slug: 'editorial-article',
        }));
        expect(snapshot.targets.review[0]).toEqual(expect.objectContaining({
            id: 12,
        }));
    });

    it('resolves the single best target for a task intent', async () => {
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
                            name: 'Author Profile',
                            slug: 'author-profile',
                            description: null,
                            schema: JSON.stringify({ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }),
                            basePrice: null,
                        },
                        {
                            id: 12,
                            domainId: 7,
                            name: 'Editorial Article',
                            slug: 'editorial-article',
                            description: 'Reviewed content',
                            schema: JSON.stringify({ type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }),
                            basePrice: null,
                        },
                        {
                            id: 13,
                            domainId: 7,
                            name: 'Premium Brief',
                            slug: 'premium-brief',
                            description: 'Paid content',
                            schema: JSON.stringify({ type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }),
                            basePrice: 250,
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
                            status: 'in_review',
                            updatedAt: new Date('2026-03-11T11:00:00Z'),
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
                    where: vi.fn().mockResolvedValue([{ workflowId: 20 }]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        scopeRef: 13,
                        priceSats: 250,
                    }]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ contentItemId: 100 }]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([
                        {
                            id: 100,
                            contentTypeId: 12,
                            data: JSON.stringify({
                                title: 'Editorial draft',
                                slug: 'editorial-draft',
                            }),
                            status: 'in_review',
                            version: 2,
                            createdAt: new Date('2026-03-11T10:30:00Z'),
                            updatedAt: new Date('2026-03-11T11:00:00Z'),
                        },
                    ]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 20,
                        name: 'Editorial Flow',
                        contentTypeId: 12,
                    }]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 40,
                        workflowId: 20,
                        fromState: 'draft',
                        toState: 'in_review',
                    }]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 88,
                        contentItemId: 100,
                        workflowTransitionId: 40,
                        status: 'pending',
                        assignee: 'api_key:12',
                        createdAt: new Date('2026-03-11T11:05:00Z'),
                        updatedAt: new Date('2026-03-11T11:05:00Z'),
                    }]),
                }),
            }) as unknown as ReturnType<typeof db.select>);

        const resolution = await resolveWorkspaceTarget({
            actorId: 'api_key:12',
            actorType: 'api_key',
            actorSource: 'db',
            actorProfileId: 'api-key',
            domainId: 7,
            scopes: ['content:read', 'content:write'],
            assignmentRefs: ['api_key:12', '12'],
        }, {
            intent: 'review',
            search: 'editorial',
        });

        expect(resolution.intent).toBe('review');
        expect(resolution.search).toBe('editorial');
        expect(resolution.availableTargetCount).toBe(1);
        expect(resolution.target).toEqual(expect.objectContaining({
            id: 12,
            rank: 1,
            reason: '1 pending review task(s) across 1 stored item(s).',
            contentType: expect.objectContaining({
                id: 12,
                slug: 'editorial-article',
            }),
            workTarget: expect.objectContaining({
                kind: 'review-task',
                status: 'ready',
                label: 'Editorial draft (draft → in_review)',
                reviewTask: expect.objectContaining({
                    id: 88,
                    actionable: true,
                }),
                contentItem: expect.objectContaining({
                    id: 100,
                    label: 'Editorial draft',
                    slug: 'editorial-draft',
                }),
            }),
        }));
        expect(resolution.alternatives).toEqual([]);
    });

    it('prioritizes the best actionable work target across the workspace, not just the busiest schema', async () => {
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
                            id: 12,
                            domainId: 7,
                            name: 'Editorial Article',
                            slug: 'editorial-article',
                            description: 'Reviewed content',
                            schema: JSON.stringify({ type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }),
                            basePrice: null,
                        },
                        {
                            id: 13,
                            domainId: 7,
                            name: 'News Brief',
                            slug: 'news-brief',
                            description: 'Faster review lane',
                            schema: JSON.stringify({ type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }),
                            basePrice: null,
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
                            status: 'in_review',
                            updatedAt: new Date('2026-03-11T11:00:00Z'),
                        },
                        {
                            id: 101,
                            contentTypeId: 12,
                            status: 'in_review',
                            updatedAt: new Date('2026-03-11T10:00:00Z'),
                        },
                        {
                            id: 200,
                            contentTypeId: 13,
                            status: 'in_review',
                            updatedAt: new Date('2026-03-11T12:00:00Z'),
                        },
                    ]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([
                        {
                            id: 20,
                            domainId: 7,
                            name: 'Editorial Flow',
                            contentTypeId: 12,
                            active: true,
                        },
                        {
                            id: 21,
                            domainId: 7,
                            name: 'Brief Flow',
                            contentTypeId: 13,
                            active: true,
                        },
                    ]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([
                        { workflowId: 20 },
                        { workflowId: 21 },
                    ]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([
                        { contentItemId: 100 },
                        { contentItemId: 101 },
                        { contentItemId: 200 },
                    ]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([
                        {
                            id: 100,
                            contentTypeId: 12,
                            data: JSON.stringify({ title: 'Blocked editorial review', slug: 'blocked-editorial-review' }),
                            status: 'in_review',
                            version: 3,
                            createdAt: new Date('2026-03-11T09:30:00Z'),
                            updatedAt: new Date('2026-03-11T11:00:00Z'),
                        },
                        {
                            id: 101,
                            contentTypeId: 12,
                            data: JSON.stringify({ title: 'Second blocked review', slug: 'second-blocked-review' }),
                            status: 'in_review',
                            version: 2,
                            createdAt: new Date('2026-03-11T09:00:00Z'),
                            updatedAt: new Date('2026-03-11T10:00:00Z'),
                        },
                    ]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 20,
                        name: 'Editorial Flow',
                        contentTypeId: 12,
                    }]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 40,
                        workflowId: 20,
                        fromState: 'draft',
                        toState: 'in_review',
                    }]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([
                        {
                            id: 88,
                            contentItemId: 100,
                            workflowTransitionId: 40,
                            status: 'pending',
                            assignee: 'api_key:99',
                            createdAt: new Date('2026-03-11T11:05:00Z'),
                            updatedAt: new Date('2026-03-11T11:05:00Z'),
                        },
                        {
                            id: 89,
                            contentItemId: 101,
                            workflowTransitionId: 40,
                            status: 'pending',
                            assignee: 'api_key:99',
                            createdAt: new Date('2026-03-11T11:10:00Z'),
                            updatedAt: new Date('2026-03-11T11:10:00Z'),
                        },
                    ]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([
                        {
                            id: 200,
                            contentTypeId: 13,
                            data: JSON.stringify({ title: 'Actionable brief review', slug: 'actionable-brief-review' }),
                            status: 'in_review',
                            version: 1,
                            createdAt: new Date('2026-03-11T11:30:00Z'),
                            updatedAt: new Date('2026-03-11T12:00:00Z'),
                        },
                    ]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 21,
                        name: 'Brief Flow',
                        contentTypeId: 13,
                    }]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 41,
                        workflowId: 21,
                        fromState: 'draft',
                        toState: 'in_review',
                    }]),
                }),
            }) as unknown as ReturnType<typeof db.select>)
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 90,
                        contentItemId: 200,
                        workflowTransitionId: 41,
                        status: 'pending',
                        assignee: 'api_key:12',
                        createdAt: new Date('2026-03-11T12:05:00Z'),
                        updatedAt: new Date('2026-03-11T12:05:00Z'),
                    }]),
                }),
            }) as unknown as ReturnType<typeof db.select>);

        const resolution = await resolveWorkspaceTarget({
            actorId: 'api_key:12',
            actorType: 'api_key',
            actorSource: 'db',
            actorProfileId: 'api-key',
            domainId: 7,
            scopes: ['content:read', 'content:write'],
            assignmentRefs: ['api_key:12', '12'],
        }, {
            intent: 'review',
        });

        expect(resolution.availableTargetCount).toBe(2);
        expect(resolution.target).toEqual(expect.objectContaining({
            id: 13,
            rank: 1,
            workTarget: expect.objectContaining({
                kind: 'review-task',
                status: 'ready',
                reviewTask: expect.objectContaining({
                    id: 90,
                    actionable: true,
                }),
                contentItem: expect.objectContaining({
                    label: 'Actionable brief review',
                    slug: 'actionable-brief-review',
                }),
            }),
        }));
        expect(resolution.alternatives[0]).toEqual(expect.objectContaining({
            id: 12,
            rank: 2,
            workTarget: expect.objectContaining({
                kind: 'review-task',
                status: 'blocked',
                reviewTask: expect.objectContaining({
                    id: 88,
                    actionable: false,
                }),
            }),
        }));
    });
});
