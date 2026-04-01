import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    dbMock: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
    },
}));

vi.mock('../db/index.js', () => ({
    db: mocks.dbMock,
}));

import {
    AiProviderConfigError,
    maskSecret,
    normalizeAiProviderType,
    upsertAiProviderConfig,
} from './ai-provider-config.js';

describe('ai provider config service', () => {
    beforeEach(() => {
        mocks.dbMock.select.mockReset();
        mocks.dbMock.insert.mockReset();
        mocks.dbMock.update.mockReset();
        mocks.dbMock.delete.mockReset();
    });

    it('masks provider secrets for read surfaces', () => {
        expect(maskSecret('sk-test-1234567890')).toBe('sk-t...7890');
    });

    it('normalizes supported provider types', () => {
        expect(normalizeAiProviderType('anthropic')).toBe('anthropic');
        expect(normalizeAiProviderType('gemini')).toBe('gemini');
    });

    it('rejects unsupported provider types', () => {
        expect(() => normalizeAiProviderType('xai')).toThrowError(AiProviderConfigError);
    });

    it('creates a new tenant-scoped provider config', async () => {
        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([]),
            }),
        }));

        mocks.dbMock.insert.mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{
                    id: 18,
                    domainId: 4,
                    provider: 'openai',
                    apiKey: 'sk-openai-1234567890',
                    defaultModel: 'gpt-4o',
                    settings: {},
                    createdAt: new Date('2026-04-01T10:00:00.000Z'),
                    updatedAt: new Date('2026-04-01T10:00:00.000Z'),
                }]),
            }),
        });

        const configured = await upsertAiProviderConfig({
            domainId: 4,
            provider: 'openai',
            apiKey: 'sk-openai-1234567890',
            defaultModel: 'gpt-4o',
        });

        expect(configured).toEqual(expect.objectContaining({
            id: 18,
            domainId: 4,
            provider: 'openai',
            configured: true,
            maskedApiKey: 'sk-o...7890',
            defaultModel: 'gpt-4o',
        }));
    });
});
