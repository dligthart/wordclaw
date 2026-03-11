import { describe, expect, it } from 'vitest';

import { buildWorkspaceGuide } from './workspace-guide.js';

describe('buildWorkspaceGuide', () => {
    it('builds an actionable workspace guide from the current actor and workspace context', () => {
        const guide = buildWorkspaceGuide({
            currentActor: {
                actorId: 'api_key:12',
                actorType: 'api_key',
                actorSource: 'db',
                actorProfileId: 'api-key',
                domainId: 7,
                scopes: ['content:read', 'content:write'],
                assignmentRefs: ['api_key:12', '12'],
            },
            workspace: {
                generatedAt: '2026-03-11T12:00:00.000Z',
                currentActor: {
                    actorId: 'api_key:12',
                    actorType: 'api_key',
                    actorSource: 'db',
                    actorProfileId: 'api-key',
                    domainId: 7,
                    scopes: ['content:read', 'content:write'],
                    assignmentRefs: ['api_key:12', '12'],
                },
                currentDomain: {
                    id: 7,
                    name: 'Docs',
                    hostname: 'docs.example.com',
                    current: true,
                },
                accessibleDomains: [{
                    id: 7,
                    name: 'Docs',
                    hostname: 'docs.example.com',
                    current: true,
                }],
                summary: {
                    totalContentTypes: 2,
                    contentTypesWithContent: 1,
                    workflowEnabledContentTypes: 1,
                    paidContentTypes: 0,
                    pendingReviewTaskCount: 3,
                },
                targets: {
                    authoring: [{
                        id: 44,
                        name: 'Article',
                        slug: 'article',
                        itemCount: 12,
                        pendingReviewTaskCount: 3,
                        activeWorkflowCount: 1,
                        activeTypeOfferCount: 0,
                        reason: '12 stored item(s) and 1 active workflow(s) make this a strong authoring target.',
                        recommendedCommands: {
                            contentGuide: 'node dist/cli/index.js content guide --content-type-id 44',
                            listContent: 'node dist/cli/index.js content list --content-type-id 44',
                            workflowActive: 'node dist/cli/index.js workflow active --content-type-id 44',
                        },
                    }],
                    review: [{
                        id: 44,
                        name: 'Article',
                        slug: 'article',
                        itemCount: 12,
                        pendingReviewTaskCount: 3,
                        activeWorkflowCount: 1,
                        activeTypeOfferCount: 0,
                        reason: '3 pending review task(s) across 12 stored item(s).',
                        recommendedCommands: {
                            contentGuide: 'node dist/cli/index.js content guide --content-type-id 44',
                            listContent: 'node dist/cli/index.js content list --content-type-id 44',
                            workflowActive: 'node dist/cli/index.js workflow active --content-type-id 44',
                        },
                    }],
                    workflow: [{
                        id: 44,
                        name: 'Article',
                        slug: 'article',
                        itemCount: 12,
                        pendingReviewTaskCount: 3,
                        activeWorkflowCount: 1,
                        activeTypeOfferCount: 0,
                        reason: '1 active workflow(s) and 3 pending review task(s) are mapped to this schema.',
                        recommendedCommands: {
                            contentGuide: 'node dist/cli/index.js content guide --content-type-id 44',
                            listContent: 'node dist/cli/index.js content list --content-type-id 44',
                            workflowActive: 'node dist/cli/index.js workflow active --content-type-id 44',
                        },
                    }],
                    paid: [],
                },
                contentTypes: [{
                    id: 44,
                    name: 'Article',
                    slug: 'article',
                    description: 'Docs article',
                    fieldCount: 4,
                    requiredFieldCount: 2,
                    itemCount: 12,
                    hasContent: true,
                    pendingReviewTaskCount: 3,
                    lastItemUpdatedAt: '2026-03-11T11:00:00.000Z',
                    paid: {
                        basePrice: null,
                        activeTypeOfferCount: 0,
                        lowestTypeOfferSats: null,
                    },
                    workflow: {
                        activeWorkflowCount: 1,
                        activeWorkflows: [{
                            id: 9,
                            name: 'Editorial',
                            transitionCount: 2,
                        }],
                    },
                    recommendedCommands: {
                        contentGuide: 'node dist/cli/index.js content guide --content-type-id 44',
                        listContent: 'node dist/cli/index.js content list --content-type-id 44',
                        workflowActive: 'node dist/cli/index.js workflow active --content-type-id 44',
                    },
                }, {
                    id: 45,
                    name: 'Author',
                    slug: 'author',
                    description: null,
                    fieldCount: 2,
                    requiredFieldCount: 1,
                    itemCount: 0,
                    hasContent: false,
                    pendingReviewTaskCount: 0,
                    lastItemUpdatedAt: null,
                    paid: {
                        basePrice: null,
                        activeTypeOfferCount: 0,
                        lowestTypeOfferSats: null,
                    },
                    workflow: {
                        activeWorkflowCount: 0,
                        activeWorkflows: [],
                    },
                    recommendedCommands: {
                        contentGuide: 'node dist/cli/index.js content guide --content-type-id 45',
                        listContent: 'node dist/cli/index.js content list --content-type-id 45',
                        workflowActive: 'node dist/cli/index.js workflow active --content-type-id 45',
                    },
                }],
                warnings: [],
            },
        });

        expect(guide.taskId).toBe('discover-workspace');
        expect(guide.actorReadiness.status).toBe('ready');
        expect(guide.workspace?.summary.totalContentTypes).toBe(2);
        expect(guide.steps).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'read-workspace-context',
                status: 'completed',
                command: 'node dist/cli/index.js workspace guide',
            }),
            expect.objectContaining({
                id: 'choose-authoring-target',
                status: 'ready',
                command: 'node dist/cli/index.js content guide --content-type-id 44',
            }),
            expect.objectContaining({
                id: 'review-backlog',
                status: 'ready',
                command: 'node dist/cli/index.js workflow guide',
                notes: expect.arrayContaining([
                    'Highest-priority backlog target: Article. 3 pending review task(s) across 12 stored item(s).',
                ]),
            }),
        ]));
    });

    it('returns a blocked guide when no actor is configured yet', () => {
        const guide = buildWorkspaceGuide({});

        expect(guide.actorReadiness.status).toBe('blocked');
        expect(guide.workspace).toBeNull();
        expect(guide.steps[0]).toEqual(expect.objectContaining({
            id: 'confirm-actor',
            status: 'blocked',
        }));
    });
});
