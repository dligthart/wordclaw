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

    it('rejects unsupported non-scalar form fields', async () => {
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
                            attachment: {
                                type: 'object',
                                'x-wordclaw-field-kind': 'asset',
                                properties: {
                                    assetId: { type: 'integer' }
                                },
                                required: ['assetId']
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
            fields: [{ name: 'attachment' }],
        })).rejects.toMatchObject({
            code: 'FORM_FIELD_UNSUPPORTED',
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
                defaultData: {
                    title: 'Draft proposal',
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
            },
            targetContentTypeId: 13,
            agentSoul: 'software-proposal-writer',
            defaultData: {
                title: 'Draft proposal',
            },
            postGenerationWorkflowTransitionId: null,
        });
        expect(result.draftGenerationJob).toMatchObject({
            id: 21,
            kind: 'draft_generation',
        });
    });
});
