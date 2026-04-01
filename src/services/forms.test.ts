import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const dbMock = {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
    };

    return {
        dbMock,
        enqueueWebhookJobMock: vi.fn(),
        enqueueDraftGenerationJobMock: vi.fn(),
        isSafeWebhookUrlMock: vi.fn(async () => true),
    };
});

vi.mock('../db/index.js', () => ({
    db: mocks.dbMock,
}));

vi.mock('./jobs.js', () => ({
    enqueueWebhookJob: mocks.enqueueWebhookJobMock,
    enqueueDraftGenerationJob: mocks.enqueueDraftGenerationJobMock,
}));

vi.mock('./webhook.js', () => ({
    isSafeWebhookUrl: mocks.isSafeWebhookUrlMock,
}));

import { FormServiceError, createFormDefinition, submitFormDefinition } from './forms.js';

describe('forms service', () => {
    beforeEach(() => {
        mocks.dbMock.select.mockReset();
        mocks.dbMock.insert.mockReset();
        mocks.dbMock.update.mockReset();
        mocks.dbMock.delete.mockReset();
        mocks.enqueueWebhookJobMock.mockReset();
        mocks.enqueueDraftGenerationJobMock.mockReset();
        mocks.isSafeWebhookUrlMock.mockReset();
        mocks.isSafeWebhookUrlMock.mockImplementation(async () => true);
    });

    it('rejects unsupported relation form fields', async () => {
        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    id: 12,
                    domainId: 1,
                    name: 'Lead',
                    slug: 'lead',
                    basePrice: 0,
                    schema: JSON.stringify({
                        type: 'object',
                        properties: {
                            relatedEntry: {
                                type: 'object',
                                'x-wordclaw-field-kind': 'content-ref',
                                properties: {
                                    contentItemId: { type: 'integer' }
                                }
                            }
                        }
                    })
                }]),
            }),
        }));

        await expect(createFormDefinition({
            domainId: 1,
            name: 'Lead Form',
            slug: 'lead-form',
            contentTypeId: 12,
            fields: [{ name: 'relatedEntry' }],
        })).rejects.toMatchObject({
            code: 'FORM_FIELD_UNSUPPORTED',
        });
    });

    it('accepts asset-backed form fields', async () => {
        const assetSchema = JSON.stringify({
            type: 'object',
            properties: {
                title: { type: 'string' },
                attachment: {
                    type: 'object',
                    'x-wordclaw-field-kind': 'asset',
                    properties: {
                        assetId: { type: 'integer' }
                    },
                    required: ['assetId']
                },
                gallery: {
                    type: 'array',
                    'x-wordclaw-field-kind': 'asset-list',
                    items: {
                        type: 'object',
                        properties: {
                            assetId: { type: 'integer' }
                        },
                        required: ['assetId']
                    }
                }
            },
            required: ['title'],
        });

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 12,
                        domainId: 1,
                        name: 'Lead',
                        slug: 'lead',
                        basePrice: 0,
                        schema: assetSchema,
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 12,
                        domainId: 1,
                        name: 'Lead',
                        slug: 'lead',
                        basePrice: 0,
                        schema: assetSchema,
                    }]),
                }),
            }));

        mocks.dbMock.insert.mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{
                    id: 5,
                    domainId: 1,
                    name: 'Lead Form',
                    slug: 'lead-form',
                    description: null,
                    contentTypeId: 12,
                    fields: [
                        { name: 'title', type: 'text', required: true, label: 'Title' },
                        { name: 'attachment', type: 'asset', required: false, label: 'Attachment' },
                        { name: 'gallery', type: 'asset-list', required: false, label: 'Gallery' },
                    ],
                    defaultData: {},
                    active: true,
                    publicRead: true,
                    submissionStatus: 'draft',
                    workflowTransitionId: null,
                    requirePayment: false,
                    webhookUrl: null,
                    webhookSecret: null,
                    successMessage: null,
                    draftGeneration: null,
                    createdAt: new Date('2026-04-01T10:00:00.000Z'),
                    updatedAt: new Date('2026-04-01T10:00:00.000Z'),
                }]),
            }),
        });

        const created = await createFormDefinition({
            domainId: 1,
            name: 'Lead Form',
            slug: 'lead-form',
            contentTypeId: 12,
            fields: [
                { name: 'title', label: 'Title' },
                { name: 'attachment', label: 'Attachment', type: 'asset' },
                { name: 'gallery', label: 'Gallery', type: 'asset-list' },
            ],
        });

        expect(created.fields).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'title', type: 'text', required: true }),
            expect.objectContaining({ name: 'attachment', type: 'asset', required: false }),
            expect.objectContaining({ name: 'gallery', type: 'asset-list', required: false }),
        ]));
    });

    it('rejects draft generation field maps that reference unknown form fields', async () => {
        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 12,
                        domainId: 1,
                        name: 'Proposal Request',
                        slug: 'proposal-request',
                        basePrice: 0,
                        schema: JSON.stringify({
                            type: 'object',
                            properties: {
                                company: { type: 'string' },
                                requirements: { type: 'string' },
                            },
                            required: ['company', 'requirements'],
                        }),
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 13,
                        domainId: 1,
                        name: 'Proposal Draft',
                        slug: 'proposal-draft',
                        basePrice: 0,
                        schema: JSON.stringify({
                            type: 'object',
                            properties: {
                                brief: { type: 'string' },
                            },
                        }),
                    }]),
                }),
            }));

        await expect(createFormDefinition({
            domainId: 1,
            name: 'Proposal Request',
            slug: 'proposal-request',
            contentTypeId: 12,
            fields: [
                { name: 'company' },
                { name: 'requirements' },
            ],
            draftGeneration: {
                targetContentTypeId: 13,
                agentSoul: 'software-proposal-writer',
                fieldMap: {
                    summary: 'brief',
                },
            },
        })).rejects.toMatchObject({
            code: 'FORM_DRAFT_GENERATION_FIELD_MAP_SOURCE_INVALID',
        });
    });

    it('rejects unsupported draft generation providers', async () => {
        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    id: 12,
                    domainId: 1,
                    name: 'Proposal Request',
                    slug: 'proposal-request',
                    basePrice: 0,
                    schema: JSON.stringify({
                        type: 'object',
                        properties: {
                            company: { type: 'string' },
                        },
                        required: ['company'],
                    }),
                }]),
            }),
        }));

        await expect(createFormDefinition({
            domainId: 1,
            name: 'Proposal Request',
            slug: 'proposal-request',
            contentTypeId: 12,
            fields: [{ name: 'company' }],
            draftGeneration: {
                targetContentTypeId: 12,
                agentSoul: 'software-proposal-writer',
                provider: {
                    type: 'xai',
                },
            },
        })).rejects.toMatchObject({
            code: 'FORM_DRAFT_GENERATION_PROVIDER_UNSUPPORTED',
        });
    });

    it('queues draft generation jobs for configured form submissions', async () => {
        const formRow = {
            id: 5,
            domainId: 1,
            name: 'Proposal Request',
            slug: 'proposal-request',
            description: 'Inbound proposal request form',
            contentTypeId: 12,
            fields: [
                { name: 'company', type: 'text', required: true, label: 'Company' },
                { name: 'requirements', type: 'textarea', required: true, label: 'Requirements' },
                { name: 'attachment', type: 'asset', required: false, label: 'Attachment' },
            ],
            defaultData: {},
            active: true,
            publicRead: true,
            submissionStatus: 'draft',
            workflowTransitionId: null,
            requirePayment: false,
            webhookUrl: null,
            webhookSecret: null,
            successMessage: 'Thanks',
            draftGeneration: {
                targetContentTypeId: 13,
                agentSoul: 'software-proposal-writer',
                fieldMap: {
                    company: 'clientName',
                    requirements: 'brief',
                },
                defaultData: {
                    title: 'Draft proposal',
                },
                provider: {
                    type: 'openai',
                    model: 'gpt-4o',
                    instructions: 'Write a concise proposal draft.',
                },
                postGenerationWorkflowTransitionId: null,
            },
            createdAt: new Date('2026-03-31T10:00:00.000Z'),
            updatedAt: new Date('2026-03-31T10:00:00.000Z'),
        };
        const intakeTypeRow = {
            id: 12,
            domainId: 1,
            name: 'Proposal Request',
            slug: 'proposal-request',
            basePrice: 0,
            schema: JSON.stringify({
                type: 'object',
                properties: {
                    company: { type: 'string' },
                    requirements: { type: 'string' },
                    attachment: {
                        type: 'object',
                        'x-wordclaw-field-kind': 'asset',
                        properties: {
                            assetId: { type: 'integer' },
                        },
                        required: ['assetId'],
                    },
                },
                required: ['company', 'requirements'],
            }),
        };
        const draftTypeLookup = {
            id: 13,
            name: 'Proposal Draft',
            slug: 'proposal-draft',
        };

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([formRow]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([intakeTypeRow]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([draftTypeLookup]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([intakeTypeRow]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ webhookUrl: null, webhookSecret: null }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ id: 7 }]),
                }),
            }));

        mocks.dbMock.insert.mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{
                    id: 88,
                    domainId: 1,
                    contentTypeId: 12,
                    data: JSON.stringify({
                        company: 'Acme',
                        requirements: 'Need a proposal',
                        attachment: {
                            assetId: 7,
                        },
                    }),
                    status: 'draft',
                    version: 1,
                    createdAt: new Date('2026-03-31T10:01:00.000Z'),
                    updatedAt: new Date('2026-03-31T10:01:00.000Z'),
                }]),
            }),
        });
        mocks.enqueueDraftGenerationJobMock.mockResolvedValue({
            id: 21,
            kind: 'draft_generation',
            queue: 'drafts',
            status: 'queued',
        });

        const result = await submitFormDefinition(1, 'proposal-request', {
            data: {
                company: 'Acme',
                requirements: 'Need a proposal',
                attachment: {
                    assetId: 7,
                },
            },
            request: {},
        });

        expect(mocks.enqueueDraftGenerationJobMock).toHaveBeenCalledWith({
            domainId: 1,
            formId: 5,
            formSlug: 'proposal-request',
            intakeContentItemId: 88,
            intakeData: {
                company: 'Acme',
                requirements: 'Need a proposal',
                attachment: {
                    assetId: 7,
                },
            },
            intakeAssetReferences: [
                {
                    assetId: 7,
                    path: '/attachment',
                },
            ],
            targetContentTypeId: 13,
            workforceAgentId: null,
            workforceAgentSlug: null,
            workforceAgentName: null,
            workforceAgentPurpose: null,
            agentSoul: 'software-proposal-writer',
            fieldMap: {
                company: 'clientName',
                requirements: 'brief',
            },
            defaultData: {
                title: 'Draft proposal',
            },
            provider: {
                type: 'openai',
                model: 'gpt-4o',
                instructions: 'Write a concise proposal draft.',
            },
            postGenerationWorkflowTransitionId: null,
        });
        expect(result.draftGenerationJob).toMatchObject({
            id: 21,
            kind: 'draft_generation',
        });
    });
});
