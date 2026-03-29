import { describe, expect, it } from 'vitest';

import { buildContentGuide } from './content-guide.js';

describe('buildContentGuide', () => {
    it('builds schema-design guidance when no content type id is provided', () => {
        const guide = buildContentGuide({
            currentActor: {
                actorId: 'api_key:11',
                actorType: 'api_key',
                actorSource: 'db',
                actorProfileId: 'api-key',
                domainId: 2,
                scopes: ['content:write'],
                assignmentRefs: ['api_key:11', '11'],
            },
        });

        expect(guide.mode).toBe('schema-design');
        expect(guide.contentTypeId).toBeNull();
        expect(guide.schemaDesignGuidance).toEqual(expect.objectContaining({
            available: true,
            recommendedSource: 'schemaManifest',
            patterns: expect.arrayContaining([
                expect.objectContaining({
                    id: 'memory',
                    searchableTextFields: ['summary', 'details'],
                }),
                expect.objectContaining({
                    id: 'task-log',
                }),
                expect.objectContaining({
                    id: 'checkpoint',
                }),
            ]),
            embeddingBehavior: expect.objectContaining({
                skippedTopLevelFields: expect.arrayContaining(['slug', 'coverImage', 'id']),
            }),
        }));
        expect(guide.steps).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'draft-schema-manifest',
                    status: 'ready',
                    command: null,
                }),
                expect.objectContaining({
                    id: 'validate-content-type',
                    status: 'ready',
                    command: 'node dist/cli/index.js content-types create --name AgentMemory --slug agent-memory --schema-manifest-file memory.manifest.json --dry-run',
                }),
            ]),
        );
    });

    it('builds a ready authoring plan with schema and workflow guidance', () => {
        const guide = buildContentGuide({
            contentTypeId: 12,
            contentType: {
                id: 12,
                name: 'Article',
                slug: 'article',
                description: 'Editorial article',
                schema: JSON.stringify({
                    type: 'object',
                    properties: {
                        title: { type: 'string' },
                        body: { type: 'string' },
                        published: { type: 'boolean' },
                    },
                    required: ['title', 'body'],
                }),
                basePrice: 500,
                createdAt: '2026-03-11T10:00:00.000Z',
                updatedAt: '2026-03-11T10:30:00.000Z',
            },
            workflow: {
                id: 21,
                name: 'Editorial Review',
                contentTypeId: 12,
                active: true,
                transitions: [
                    {
                        id: 31,
                        workflowId: 21,
                        fromState: 'draft',
                        toState: 'in_review',
                        requiredRoles: ['editor'],
                    },
                ],
            },
            currentActor: {
                actorId: 'api_key:11',
                actorType: 'api_key',
                actorSource: 'db',
                actorProfileId: 'api-key',
                domainId: 2,
                scopes: ['content:write'],
                assignmentRefs: ['api_key:11', '11'],
            },
        });

        expect(guide.actorReadiness).toEqual(expect.objectContaining({
            status: 'ready',
            supportedActorProfile: true,
            requiredScopesSatisfied: true,
        }));
        expect(guide.mode).toBe('content-authoring');
        expect(guide.schemaSummary).toEqual(expect.objectContaining({
            available: true,
            rootType: 'object',
            fieldCount: 3,
            requiredFieldCount: 2,
            requiredFields: ['title', 'body'],
            exampleDraft: {
                title: '<string>',
                body: '<string>',
            },
        }));
        expect(guide.workflow).toEqual(expect.objectContaining({
            status: 'active',
            id: 21,
            transitionCount: 1,
        }));
        expect(guide.steps).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'validate-draft',
                    status: 'ready',
                    command: 'node dist/cli/index.js content create --content-type-id 12 --data-file draft.json --dry-run',
                }),
                expect.objectContaining({
                    id: 'submit-review',
                    status: 'ready',
                    command: 'node dist/cli/index.js workflow submit --id <contentItemId> --transition 31',
                }),
            ]),
        );
    });

    it('builds a blocked plan when actor and schema access are unavailable', () => {
        const guide = buildContentGuide({
            contentTypeId: 44,
            contentType: null,
            currentActor: null,
        });

        expect(guide.actorReadiness).toEqual(expect.objectContaining({
            status: 'blocked',
            supportedActorProfile: false,
            requiredScopesSatisfied: false,
        }));
        expect(guide.contentType).toBeNull();
        expect(guide.schemaSummary.available).toBe(false);
        expect(guide.steps.find((step) => step.id === 'validate-draft')).toEqual(
            expect.objectContaining({
                status: 'blocked',
            }),
        );
    });

    it('warns when the actor uses an env-backed key profile and no workflow is attached', () => {
        const guide = buildContentGuide({
            contentTypeId: 12,
            contentType: {
                id: 12,
                name: 'Article',
                slug: 'article',
                schema: JSON.stringify({
                    type: 'object',
                    properties: {
                        title: { type: 'string' },
                    },
                    required: ['title'],
                }),
            },
            workflow: null,
            currentActor: {
                actorId: 'env_key:remote-admin',
                actorType: 'env_key',
                actorSource: 'env',
                actorProfileId: 'env-key',
                domainId: 1,
                scopes: ['admin'],
                assignmentRefs: ['env_key:remote-admin', 'remote-admin'],
            },
        });

        expect(guide.actorReadiness).toEqual(expect.objectContaining({
            status: 'warning',
            supportedActorProfile: true,
            requiredScopesSatisfied: true,
        }));
        expect(guide.workflow).toEqual(expect.objectContaining({
            status: 'none',
            id: null,
            transitionCount: 0,
        }));
        expect(guide.steps.find((step) => step.id === 'submit-review')).toEqual(
            expect.objectContaining({
                status: 'optional',
                command: null,
            }),
        );
    });
});
