import { describe, expect, it } from 'vitest';

import { issueDirectAssetUploadToken, verifyDirectAssetUploadToken } from './asset-direct-upload.js';

describe('asset direct upload token helpers', () => {
    it('issues and verifies a valid direct upload token', () => {
        const issued = issueDirectAssetUploadToken({
            domainId: 7,
            storageProvider: 's3',
            storageKey: '7/demo.png',
            filename: 'demo.png',
            originalFilename: 'demo-original.png',
            mimeType: 'image/png',
            accessMode: 'signed',
            entitlementScopeType: null,
            entitlementScopeRef: null,
            metadata: { alt: 'Demo image' },
            ttlSeconds: 300,
        });

        const verified = verifyDirectAssetUploadToken(issued.token, 7);
        expect(verified).toMatchObject({
            ok: true,
            domainId: 7,
            storageProvider: 's3',
            storageKey: '7/demo.png',
            filename: 'demo.png',
            originalFilename: 'demo-original.png',
            mimeType: 'image/png',
            accessMode: 'signed',
            entitlementScopeType: null,
            entitlementScopeRef: null,
            metadata: { alt: 'Demo image' },
        });
    });

    it('rejects a token for the wrong domain', () => {
        const issued = issueDirectAssetUploadToken({
            domainId: 7,
            storageProvider: 's3',
            storageKey: '7/demo.png',
            filename: 'demo.png',
            originalFilename: 'demo.png',
            mimeType: 'image/png',
            accessMode: 'public',
            entitlementScopeType: null,
            entitlementScopeRef: null,
            metadata: {},
            ttlSeconds: 300,
        });

        expect(verifyDirectAssetUploadToken(issued.token, 8)).toEqual({
            ok: false,
            code: 'INVALID_DIRECT_ASSET_UPLOAD_TOKEN',
            remediation: 'Provide a token that matches the active domain and the issued direct upload session.',
        });
    });
});
