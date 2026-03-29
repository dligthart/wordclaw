import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    dbMock: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        transaction: vi.fn(),
    },
}));

vi.mock('../db/index.js', () => ({
    db: mocks.dbMock,
}));

import { LicensingService } from './licensing.js';

function queueSelectWhereResult<T>(result: T) {
    mocks.dbMock.select.mockImplementationOnce(() => ({
        from: () => ({
            where: vi.fn().mockResolvedValue(result),
        }),
    }));
}

function queueSelectWhereOrderByResult<T>(result: T) {
    mocks.dbMock.select.mockImplementationOnce(() => ({
        from: () => ({
            where: vi.fn(() => ({
                orderBy: vi.fn().mockResolvedValue(result),
            })),
        }),
    }));
}

function queueSelectInnerJoinWhereResult<T>(result: T) {
    mocks.dbMock.select.mockImplementationOnce(() => ({
        from: () => ({
            innerJoin: vi.fn(() => ({
                where: vi.fn().mockResolvedValue(result),
            })),
        }),
    }));
}

describe('LicensingService', () => {
    beforeEach(() => {
        mocks.dbMock.select.mockReset();
        mocks.dbMock.insert.mockReset();
        mocks.dbMock.update.mockReset();
        mocks.dbMock.transaction.mockReset();
    });

    it('supports offer and entitlement lookups for all read scope variants', async () => {
        queueSelectWhereResult([{ id: 1, scopeType: 'item', scopeRef: 42 }]);
        queueSelectWhereResult([{ id: 2, scopeType: 'item', scopeRef: 42 }]);
        queueSelectWhereResult([{ id: 3, scopeType: 'type', scopeRef: 7 }]);
        queueSelectWhereResult([{ id: 4, scopeType: 'subscription', scopeRef: null }]);
        queueSelectWhereResult([{ id: 5, scopeType: 'type', scopeRef: 7 }]);
        queueSelectWhereResult([{ id: 6, paymentHash: 'hash-1' }]);
        queueSelectWhereOrderByResult([{ id: 7, status: 'pending_payment' }]);
        queueSelectWhereOrderByResult([{ id: 8, agentProfileId: 9 }]);
        queueSelectWhereResult([{ id: 9, agentProfileId: 9 }]);
        queueSelectInnerJoinWhereResult([
            { entitlement: { id: 10, offerId: 2 } },
        ]);
        queueSelectInnerJoinWhereResult([
            { entitlement: { id: 11, offerId: 4 } },
        ]);

        await expect(LicensingService.getOffers(1, 'item', 42)).resolves.toEqual([
            { id: 1, scopeType: 'item', scopeRef: 42 },
        ]);
        await expect(
            LicensingService.getActiveOffersForReadScope(1, { scopeType: 'item', scopeRef: 42 })
        ).resolves.toEqual([{ id: 2, scopeType: 'item', scopeRef: 42 }]);
        await expect(
            LicensingService.getActiveOffersForReadScope(1, { scopeType: 'type', scopeRef: 7 })
        ).resolves.toEqual([{ id: 3, scopeType: 'type', scopeRef: 7 }]);
        await expect(
            LicensingService.getActiveOffersForReadScope(1, { scopeType: 'subscription', scopeRef: null })
        ).resolves.toEqual([{ id: 4, scopeType: 'subscription', scopeRef: null }]);
        await expect(LicensingService.getActiveOffersForItemRead(1, 42, 7)).resolves.toEqual([
            { id: 5, scopeType: 'type', scopeRef: 7 },
        ]);
        await expect(LicensingService.getEntitlementByPaymentHash(1, 'hash-1')).resolves.toEqual({
            id: 6,
            paymentHash: 'hash-1',
        });
        await expect(LicensingService.getPendingEntitlementsForOffer(1, 2, 9)).resolves.toEqual([
            { id: 7, status: 'pending_payment' },
        ]);
        await expect(LicensingService.getEntitlementsForAgent(1, 9)).resolves.toEqual([
            { id: 8, agentProfileId: 9 },
        ]);
        await expect(LicensingService.getEntitlementForAgentById(1, 9, 9)).resolves.toEqual({
            id: 9,
            agentProfileId: 9,
        });
        await expect(LicensingService.getEligibleEntitlementsForItemRead(1, 9, 42, 7)).resolves.toEqual([
            { id: 10, offerId: 2 },
        ]);
        await expect(
            LicensingService.getEligibleEntitlementsForReadScope(1, 9, { scopeType: 'subscription', scopeRef: null })
        ).resolves.toEqual([{ id: 11, offerId: 4 }]);
    });

    it('requires a policy before provisioning a sale entitlement', async () => {
        queueSelectWhereOrderByResult([]);

        await expect(
            LicensingService.provisionEntitlementForSale(1, 2, 3, 'hash-1')
        ).rejects.toThrow('OFFER_MISSING_POLICY');
        expect(mocks.dbMock.insert).not.toHaveBeenCalled();
    });

    it('provisions pending entitlements from the current offer policy', async () => {
        const policy = {
            id: 12,
            version: 3,
            expiresAt: new Date('2026-03-31T12:00:00.000Z'),
            maxReads: 5,
        };
        const returning = vi.fn().mockResolvedValue([{
            id: 91,
            policyId: 12,
            policyVersion: 3,
            status: 'pending_payment',
        }]);
        const values = vi.fn(() => ({ returning }));

        queueSelectWhereOrderByResult([policy]);
        mocks.dbMock.insert.mockReturnValue({
            values,
        });

        const entitlement = await LicensingService.provisionEntitlementForSale(1, 2, 3, 'hash-1');

        expect(values).toHaveBeenCalledWith(expect.objectContaining({
            domainId: 1,
            offerId: 2,
            policyId: 12,
            policyVersion: 3,
            agentProfileId: 3,
            paymentHash: 'hash-1',
            status: 'pending_payment',
            expiresAt: policy.expiresAt,
            remainingReads: 5,
        }));
        expect(entitlement).toMatchObject({
            id: 91,
            policyId: 12,
            policyVersion: 3,
            status: 'pending_payment',
        });
    });

    it('returns null when no entitlement exists for a payment hash', async () => {
        queueSelectWhereResult([]);

        await expect(LicensingService.activateEntitlementForPayment(1, 'missing')).resolves.toBeNull();
        expect(mocks.dbMock.update).not.toHaveBeenCalled();
    });

    it('returns already-active entitlements unchanged', async () => {
        const existing = {
            id: 20,
            domainId: 1,
            paymentHash: 'hash-2',
            status: 'active',
        };

        queueSelectWhereResult([existing]);

        await expect(LicensingService.activateEntitlementForPayment(1, 'hash-2')).resolves.toEqual(existing);
        expect(mocks.dbMock.update).not.toHaveBeenCalled();
    });

    it('activates pending entitlements when the matching payment settles', async () => {
        const pending = {
            id: 21,
            domainId: 1,
            paymentHash: 'hash-3',
            status: 'pending_payment',
        };
        const returning = vi.fn().mockResolvedValue([{
            ...pending,
            status: 'active',
        }]);
        const where = vi.fn(() => ({ returning }));
        const set = vi.fn(() => ({ where }));

        queueSelectWhereResult([pending]);
        mocks.dbMock.update.mockReturnValue({
            set,
        });

        const activated = await LicensingService.activateEntitlementForPayment(1, 'hash-3');

        expect(set).toHaveBeenCalledWith(expect.objectContaining({
            status: 'active',
            activatedAt: expect.any(Date),
            terminatedAt: null,
        }));
        expect(activated).toMatchObject({
            id: 21,
            status: 'active',
        });
    });

    it('leaves terminal non-pending entitlements unchanged during activation', async () => {
        const existing = {
            id: 22,
            domainId: 1,
            paymentHash: 'hash-4',
            status: 'expired',
        };

        queueSelectWhereResult([existing]);

        await expect(LicensingService.activateEntitlementForPayment(1, 'hash-4')).resolves.toEqual(existing);
        expect(mocks.dbMock.update).not.toHaveBeenCalled();
    });

    it('returns a not-found result when an entitlement cannot be loaded for decrement', async () => {
        const tx = {
            select: vi.fn(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([]),
                }),
            })),
            update: vi.fn(),
        };

        mocks.dbMock.transaction.mockImplementation(async (callback: (txArg: typeof tx) => Promise<unknown>) => {
            return callback(tx);
        });

        const result = await LicensingService.atomicallyDecrementRead(1, 30);

        expect(result).toEqual({
            granted: false,
            reason: 'entitlement_not_found_or_inactive',
        });
        expect(tx.update).not.toHaveBeenCalled();
    });

    it('returns stable denial reasons for already-inactive entitlements', async () => {
        const statuses = [
            { status: 'expired', reason: 'entitlement_expired' },
            { status: 'exhausted', reason: 'remaining_reads_exhausted' },
            { status: 'pending_payment', reason: 'entitlement_not_found_or_inactive' },
        ] as const;

        for (const entry of statuses) {
            const tx = {
                select: vi.fn(() => ({
                    from: () => ({
                        where: vi.fn().mockResolvedValue([{
                            id: 34,
                            domainId: 1,
                            status: entry.status,
                            expiresAt: null,
                            remainingReads: 1,
                        }]),
                    }),
                })),
                update: vi.fn(),
            };

            mocks.dbMock.transaction.mockImplementationOnce(async (callback: (txArg: typeof tx) => Promise<unknown>) => {
                return callback(tx);
            });

            const result = await LicensingService.atomicallyDecrementRead(1, 34);

            expect(result).toEqual({
                granted: false,
                reason: entry.reason,
            });
            expect(tx.update).not.toHaveBeenCalled();
        }
    });

    it('marks expired active entitlements during atomic decrement attempts', async () => {
        const current = {
            id: 31,
            domainId: 1,
            status: 'active',
            expiresAt: new Date('2026-03-29T12:00:00.000Z'),
            remainingReads: 3,
        };
        const whereSelect = vi.fn().mockResolvedValue([current]);
        const terminalWhere = vi.fn().mockResolvedValue(undefined);
        const terminalSet = vi.fn(() => ({ where: terminalWhere }));
        const tx = {
            select: vi.fn(() => ({
                from: () => ({
                    where: whereSelect,
                }),
            })),
            update: vi.fn(() => ({
                set: terminalSet,
            })),
        };

        mocks.dbMock.transaction.mockImplementation(async (callback: (txArg: typeof tx) => Promise<unknown>) => {
            return callback(tx);
        });

        const result = await LicensingService.atomicallyDecrementRead(1, 31);

        expect(result).toEqual({
            granted: false,
            reason: 'entitlement_expired',
        });
        expect(terminalSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'expired',
            terminatedAt: expect.any(Date),
        }));
    });

    it('exhausts the final remaining read when decrementing a metered entitlement', async () => {
        const current = {
            id: 32,
            domainId: 1,
            status: 'active',
            expiresAt: null,
            remainingReads: 1,
        };
        const whereSelect = vi.fn().mockResolvedValue([current]);
        const decrementReturning = vi.fn().mockResolvedValue([{
            ...current,
            remainingReads: 0,
        }]);
        const decrementWhere = vi.fn(() => ({ returning: decrementReturning }));
        const decrementSet = vi.fn(() => ({ where: decrementWhere }));
        const exhaustWhere = vi.fn().mockResolvedValue(undefined);
        const exhaustSet = vi.fn(() => ({ where: exhaustWhere }));
        const tx = {
            select: vi.fn(() => ({
                from: () => ({
                    where: whereSelect,
                }),
            })),
            update: vi.fn()
                .mockImplementationOnce(() => ({
                    set: decrementSet,
                }))
                .mockImplementationOnce(() => ({
                    set: exhaustSet,
                })),
        };

        mocks.dbMock.transaction.mockImplementation(async (callback: (txArg: typeof tx) => Promise<unknown>) => {
            return callback(tx);
        });

        const result = await LicensingService.atomicallyDecrementRead(1, 32);

        expect(result).toEqual({
            granted: true,
            entitlement: expect.objectContaining({
                id: 32,
                remainingReads: 0,
                status: 'exhausted',
                terminatedAt: expect.any(Date),
            }),
        });
    });

    it('leaves unlimited active entitlements unchanged when decrementing', async () => {
        const current = {
            id: 33,
            domainId: 1,
            status: 'active',
            expiresAt: null,
            remainingReads: null,
        };
        const tx = {
            select: vi.fn(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([current]),
                }),
            })),
            update: vi.fn(),
        };

        mocks.dbMock.transaction.mockImplementation(async (callback: (txArg: typeof tx) => Promise<unknown>) => {
            return callback(tx);
        });

        const result = await LicensingService.atomicallyDecrementRead(1, 33);

        expect(result).toEqual({
            granted: true,
            entitlement: current,
        });
        expect(tx.update).not.toHaveBeenCalled();
    });

    it('marks metered entitlements as exhausted when they already have no reads left', async () => {
        const current = {
            id: 35,
            domainId: 1,
            status: 'active',
            expiresAt: null,
            remainingReads: 0,
        };
        const exhaustWhere = vi.fn().mockResolvedValue(undefined);
        const exhaustSet = vi.fn(() => ({ where: exhaustWhere }));
        const tx = {
            select: vi.fn(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([current]),
                }),
            })),
            update: vi.fn(() => ({
                set: exhaustSet,
            })),
        };

        mocks.dbMock.transaction.mockImplementation(async (callback: (txArg: typeof tx) => Promise<unknown>) => {
            return callback(tx);
        });

        const result = await LicensingService.atomicallyDecrementRead(1, 35);

        expect(result).toEqual({
            granted: false,
            reason: 'remaining_reads_exhausted',
        });
        expect(exhaustSet).toHaveBeenCalledWith(expect.objectContaining({
            status: 'exhausted',
            terminatedAt: expect.any(Date),
        }));
    });

    it('returns race-condition exhaustion when the guarded decrement updates no rows', async () => {
        const current = {
            id: 36,
            domainId: 1,
            status: 'active',
            expiresAt: null,
            remainingReads: 2,
        };
        const decrementReturning = vi.fn().mockResolvedValue([]);
        const decrementWhere = vi.fn(() => ({ returning: decrementReturning }));
        const decrementSet = vi.fn(() => ({ where: decrementWhere }));
        const tx = {
            select: vi.fn(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([current]),
                }),
            })),
            update: vi.fn(() => ({
                set: decrementSet,
            })),
        };

        mocks.dbMock.transaction.mockImplementation(async (callback: (txArg: typeof tx) => Promise<unknown>) => {
            return callback(tx);
        });

        const result = await LicensingService.atomicallyDecrementRead(1, 36);

        expect(result).toEqual({
            granted: false,
            reason: 'race_condition_exhaustion',
        });
    });

    it('returns the updated entitlement when a decrement leaves reads remaining', async () => {
        const current = {
            id: 37,
            domainId: 1,
            status: 'active',
            expiresAt: null,
            remainingReads: 3,
        };
        const updated = {
            ...current,
            remainingReads: 2,
        };
        const decrementReturning = vi.fn().mockResolvedValue([updated]);
        const decrementWhere = vi.fn(() => ({ returning: decrementReturning }));
        const decrementSet = vi.fn(() => ({ where: decrementWhere }));
        const tx = {
            select: vi.fn(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([current]),
                }),
            })),
            update: vi.fn(() => ({
                set: decrementSet,
            })),
        };

        mocks.dbMock.transaction.mockImplementation(async (callback: (txArg: typeof tx) => Promise<unknown>) => {
            return callback(tx);
        });

        const result = await LicensingService.atomicallyDecrementRead(1, 37);

        expect(result).toEqual({
            granted: true,
            entitlement: updated,
        });
    });

    it('records access events with the supplied entitlement context', async () => {
        const values = vi.fn().mockResolvedValue(undefined);

        mocks.dbMock.insert.mockReturnValue({
            values,
        });

        await LicensingService.recordAccessEvent(1, 41, '/api/content/42', 'read', true, 'granted');

        expect(values).toHaveBeenCalledWith({
            domainId: 1,
            entitlementId: 41,
            resourcePath: '/api/content/42',
            action: 'read',
            granted: true,
            reason: 'granted',
        });
    });

    it('rejects delegation when the parent entitlement lacks enough remaining reads', async () => {
        const parent = {
            id: 51,
            domainId: 1,
            status: 'active',
            remainingReads: 1,
            delegatedFrom: null,
        };
        const tx = {
            select: vi.fn(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([parent]),
                }),
            })),
            update: vi.fn(),
            insert: vi.fn(),
        };

        mocks.dbMock.transaction.mockImplementation(async (callback: (txArg: typeof tx) => Promise<unknown>) => {
            return callback(tx);
        });

        await expect(
            LicensingService.delegateEntitlement(1, 51, 99, 2)
        ).rejects.toThrow('INSUFFICIENT_READS_TO_DELEGATE');
        expect(tx.insert).not.toHaveBeenCalled();
    });

    it('creates delegated entitlements after reserving reads on the parent entitlement', async () => {
        const parent = {
            id: 52,
            domainId: 1,
            offerId: 7,
            policyId: 8,
            policyVersion: 2,
            status: 'active',
            expiresAt: new Date('2026-04-05T12:00:00.000Z'),
            remainingReads: 5,
            delegatedFrom: null,
        };
        const delegated = {
            id: 61,
            domainId: 1,
            offerId: 7,
            policyId: 8,
            policyVersion: 2,
            agentProfileId: 88,
            status: 'active',
            remainingReads: 2,
            delegatedFrom: 52,
        };
        const updateReturning = vi.fn().mockResolvedValue([{
            ...parent,
            remainingReads: 3,
        }]);
        const updateWhere = vi.fn(() => ({ returning: updateReturning }));
        const updateSet = vi.fn(() => ({ where: updateWhere }));
        const insertReturning = vi.fn().mockResolvedValue([delegated]);
        const insertValues = vi.fn(() => ({ returning: insertReturning }));
        const tx = {
            select: vi.fn(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([parent]),
                }),
            })),
            update: vi.fn(() => ({
                set: updateSet,
            })),
            insert: vi.fn(() => ({
                values: insertValues,
            })),
        };

        mocks.dbMock.transaction.mockImplementation(async (callback: (txArg: typeof tx) => Promise<unknown>) => {
            return callback(tx);
        });

        const result = await LicensingService.delegateEntitlement(1, 52, 88, 2);

        expect(result).toEqual(delegated);
        expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
            domainId: 1,
            offerId: 7,
            policyId: 8,
            policyVersion: 2,
            agentProfileId: 88,
            status: 'active',
            expiresAt: parent.expiresAt,
            remainingReads: 2,
            delegatedFrom: 52,
            paymentHash: expect.stringMatching(/^delegation_52_/),
        }));
    });
});
