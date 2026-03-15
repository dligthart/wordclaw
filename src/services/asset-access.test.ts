import { describe, expect, it, vi } from 'vitest';

import { issueSignedAssetAccess, verifySignedAssetAccess } from './asset-access.js';

describe('signed asset access tokens', () => {
    it('issues and verifies a signed asset token', () => {
        const issued = issueSignedAssetAccess({
            assetId: 42,
            domainId: 7,
            ttlSeconds: 300
        });

        const verification = verifySignedAssetAccess(issued.token, {
            assetId: 42,
            domainId: 7
        });

        expect(verification).toEqual(expect.objectContaining({
            ok: true,
            assetId: 42,
            domainId: 7
        }));
    });

    it('rejects tokens for the wrong asset', () => {
        const issued = issueSignedAssetAccess({
            assetId: 42,
            domainId: 7,
            ttlSeconds: 300
        });

        expect(verifySignedAssetAccess(issued.token, {
            assetId: 43,
            domainId: 7
        })).toEqual(expect.objectContaining({
            ok: false,
            code: 'INVALID_ASSET_ACCESS_TOKEN'
        }));
    });

    it('rejects expired tokens', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-14T10:00:00.000Z'));

        const issued = issueSignedAssetAccess({
            assetId: 42,
            domainId: 7,
            ttlSeconds: 30
        });

        vi.setSystemTime(new Date('2026-03-14T10:00:31.000Z'));

        expect(verifySignedAssetAccess(issued.token, {
            assetId: 42,
            domainId: 7
        })).toEqual(expect.objectContaining({
            ok: false,
            code: 'ASSET_ACCESS_TOKEN_EXPIRED'
        }));

        vi.useRealTimers();
    });
});
