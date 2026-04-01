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
    createWorkforceAgent,
    updateWorkforceAgent,
    WorkforceAgentError,
} from './workforce-agent.js';

describe('workforce agent service', () => {
    beforeEach(() => {
        mocks.dbMock.select.mockReset();
        mocks.dbMock.insert.mockReset();
        mocks.dbMock.update.mockReset();
        mocks.dbMock.delete.mockReset();
    });

    it('creates a tenant-managed workforce agent with provider defaults', async () => {
        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([]),
            }),
        }));

        mocks.dbMock.insert.mockReturnValue({
            values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{
                    id: 12,
                    domainId: 4,
                    name: 'Software Proposal Writer',
                    slug: 'software-proposal-writer',
                    purpose: 'Draft software proposals from inbound requirement forms.',
                    soul: 'You are a senior solution consultant.',
                    provider: {
                        type: 'openai',
                        model: 'gpt-4o',
                    },
                    active: true,
                    createdAt: new Date('2026-04-01T10:00:00.000Z'),
                    updatedAt: new Date('2026-04-01T10:00:00.000Z'),
                }]),
            }),
        });

        const created = await createWorkforceAgent({
            domainId: 4,
            name: 'Software Proposal Writer',
            slug: 'Software Proposal Writer',
            purpose: 'Draft software proposals from inbound requirement forms.',
            soul: 'You are a senior solution consultant.',
            provider: {
                type: 'openai',
                model: 'gpt-4o',
            },
        });

        expect(created).toEqual(expect.objectContaining({
            id: 12,
            domainId: 4,
            slug: 'software-proposal-writer',
            purpose: 'Draft software proposals from inbound requirement forms.',
            provider: {
                type: 'openai',
                model: 'gpt-4o',
            },
            active: true,
        }));
    });

    it('rejects unsupported workforce agent providers', async () => {
        await expect(createWorkforceAgent({
            domainId: 4,
            name: 'Software Proposal Writer',
            slug: 'software-proposal-writer',
            purpose: 'Draft software proposals from inbound requirement forms.',
            soul: 'You are a senior solution consultant.',
            provider: {
                type: 'xai',
            },
        })).rejects.toThrowError(WorkforceAgentError);
    });

    it('updates an existing workforce agent', async () => {
        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 12,
                        domainId: 4,
                        name: 'Software Proposal Writer',
                        slug: 'software-proposal-writer',
                        purpose: 'Draft software proposals from inbound requirement forms.',
                        soul: 'You are a senior solution consultant.',
                        provider: {
                            type: 'openai',
                            model: 'gpt-4o',
                        },
                        active: true,
                        createdAt: new Date('2026-04-01T10:00:00.000Z'),
                        updatedAt: new Date('2026-04-01T10:00:00.000Z'),
                    }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([]),
                }),
            }));

        mocks.dbMock.update.mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{
                        id: 12,
                        domainId: 4,
                        name: 'Proposal Closer',
                        slug: 'proposal-closer',
                        purpose: 'Finalize and refine proposals.',
                        soul: 'You are a senior deal closer.',
                        provider: {
                            type: 'openai',
                            model: 'gpt-4.1',
                            instructions: 'Focus on executive clarity.',
                        },
                        active: false,
                        createdAt: new Date('2026-04-01T10:00:00.000Z'),
                        updatedAt: new Date('2026-04-01T11:00:00.000Z'),
                    }]),
                }),
            }),
        });

        const updated = await updateWorkforceAgent(12, {
            domainId: 4,
            name: 'Proposal Closer',
            slug: 'proposal-closer',
            purpose: 'Finalize and refine proposals.',
            soul: 'You are a senior deal closer.',
            provider: {
                type: 'openai',
                model: 'gpt-4.1',
                instructions: 'Focus on executive clarity.',
            },
            active: false,
        });

        expect(updated).toEqual(expect.objectContaining({
            id: 12,
            slug: 'proposal-closer',
            active: false,
            provider: {
                type: 'openai',
                model: 'gpt-4.1',
                instructions: 'Focus on executive clarity.',
            },
        }));
    });
});
