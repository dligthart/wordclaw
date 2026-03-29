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
        isSafeWebhookUrlMock: vi.fn(async () => true),
    };
});

vi.mock('../db/index.js', () => ({
    db: mocks.dbMock,
}));

vi.mock('./jobs.js', () => ({
    enqueueWebhookJob: mocks.enqueueWebhookJobMock,
}));

vi.mock('./webhook.js', () => ({
    isSafeWebhookUrl: mocks.isSafeWebhookUrlMock,
}));

import { FormServiceError, createFormDefinition } from './forms.js';

describe('forms service', () => {
    beforeEach(() => {
        mocks.dbMock.select.mockReset();
        mocks.dbMock.insert.mockReset();
        mocks.dbMock.update.mockReset();
        mocks.dbMock.delete.mockReset();
        mocks.enqueueWebhookJobMock.mockReset();
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
});
