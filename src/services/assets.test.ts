import { describe, expect, it } from 'vitest';

import {
    decodeAssetContentBase64,
    decodeAssetsCursor,
    encodeAssetsCursor,
    getAssetEntitlementScope,
    AssetListError
} from './assets.js';

describe('decodeAssetContentBase64', () => {
    it('decodes valid base64 content', () => {
        const bytes = decodeAssetContentBase64(Buffer.from('hello').toString('base64'));
        expect(bytes.toString('utf8')).toBe('hello');
    });

    it('rejects malformed base64 content', () => {
        expect(() => decodeAssetContentBase64('bad!')).toThrowError(AssetListError);
    });
});

describe('asset cursor helpers', () => {
    it('round-trips an encoded cursor', () => {
        const createdAt = new Date('2026-03-13T10:00:00.000Z');
        const cursor = encodeAssetsCursor(createdAt, 42);

        expect(decodeAssetsCursor(cursor)).toEqual({
            createdAt,
            id: 42
        });
    });

    it('returns null for malformed cursor payload', () => {
        expect(decodeAssetsCursor('not-a-cursor')).toBeNull();
    });
});

describe('getAssetEntitlementScope', () => {
    it('returns a normalized subscription scope for entitled assets', () => {
        expect(getAssetEntitlementScope({
            accessMode: 'entitled',
            entitlementScopeType: 'subscription',
            entitlementScopeRef: null
        })).toEqual({
            type: 'subscription',
            ref: null
        });
    });

    it('returns null for non-entitled assets', () => {
        expect(getAssetEntitlementScope({
            accessMode: 'public',
            entitlementScopeType: null,
            entitlementScopeRef: null
        })).toBeNull();
    });
});
