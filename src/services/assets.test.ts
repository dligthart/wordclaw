import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/index.js', () => ({
    db: {},
}));

import {
    decodeAssetContentBase64,
    decodeAssetsCursor,
    encodeAssetsCursor,
    getAssetEntitlementScope,
    AssetListError,
    resolveAssetContentBytes
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

describe('resolveAssetContentBytes', () => {
    it('returns raw bytes when provided directly', () => {
        const bytes = resolveAssetContentBytes({
            contentBytes: Buffer.from('hello')
        });

        expect(bytes.toString('utf8')).toBe('hello');
    });

    it('rejects requests that provide both bytes and base64 content', () => {
        expect(() => resolveAssetContentBytes({
            contentBase64: Buffer.from('hello').toString('base64'),
            contentBytes: Buffer.from('hello')
        })).toThrowError(AssetListError);
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
