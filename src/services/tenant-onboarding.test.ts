import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    dbMock: {
        execute: vi.fn(),
        transaction: vi.fn(),
        select: vi.fn(),
    },
    createSupervisorAccountMock: vi.fn(),
}));

vi.mock('../db/index.js', () => ({
    db: mocks.dbMock,
}));

vi.mock('./supervisor.js', async () => {
    const actual = await vi.importActual<typeof import('./supervisor.js')>('./supervisor.js');
    return {
        ...actual,
        createSupervisorAccount: mocks.createSupervisorAccountMock,
    };
});

import { onboardTenant } from './tenant-onboarding.js';

describe('tenant onboarding service', () => {
    beforeEach(() => {
        mocks.dbMock.execute.mockReset();
        mocks.dbMock.transaction.mockReset();
        mocks.dbMock.select.mockReset();
        mocks.createSupervisorAccountMock.mockReset();
    });

    it('fails the whole onboarding transaction when api key creation fails', async () => {
        const apiKeyInsertError = Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
            constraint: 'api_keys_key_hash_key',
        });

        mocks.dbMock.execute.mockResolvedValueOnce([{ total: 0 }]);
        mocks.dbMock.transaction.mockImplementationOnce(async (callback: (tx: {
            insert: ReturnType<typeof vi.fn>;
        }) => Promise<unknown>) => {
            const txInsert = vi.fn()
                .mockImplementationOnce(() => ({
                    values: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{
                            id: 2,
                            name: 'Epilomedia',
                            hostname: 'epilomedia.com',
                        }]),
                    }),
                }))
                .mockImplementationOnce(() => ({
                    values: vi.fn().mockReturnValue({
                        returning: vi.fn().mockRejectedValue(apiKeyInsertError),
                    }),
                }));

            return callback({
                insert: txInsert,
            });
        });

        await expect(onboardTenant({
            tenantName: 'Epilomedia',
            hostname: 'epilomedia.com',
        })).rejects.toBe(apiKeyInsertError);

        expect(mocks.dbMock.transaction).toHaveBeenCalledTimes(1);
        expect(mocks.createSupervisorAccountMock).not.toHaveBeenCalled();
    });
});
