import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    getAssetStorageProvider,
    LocalDiskAssetStorage,
    resetAssetStorageProviderForTests,
    S3AssetStorage,
} from './asset-storage.js';
import { getS3AssetStorageConfig, resolveAssetStorageProviderConfig } from '../config/assets.js';

describe('LocalDiskAssetStorage', () => {
    const tempRoots: string[] = [];
    const originalFetch = global.fetch;
    const originalAssetStorageProvider = process.env.ASSET_STORAGE_PROVIDER;
    const originalS3Bucket = process.env.ASSET_S3_BUCKET;
    const originalS3Region = process.env.ASSET_S3_REGION;
    const originalS3AccessKeyId = process.env.ASSET_S3_ACCESS_KEY_ID;
    const originalS3SecretAccessKey = process.env.ASSET_S3_SECRET_ACCESS_KEY;
    const originalS3Endpoint = process.env.ASSET_S3_ENDPOINT;
    const originalS3ForcePathStyle = process.env.ASSET_S3_FORCE_PATH_STYLE;

    afterEach(() => {
        while (tempRoots.length > 0) {
            const root = tempRoots.pop();
            if (root) {
                rmSync(root, { recursive: true, force: true });
            }
        }

        if (originalAssetStorageProvider === undefined) {
            delete process.env.ASSET_STORAGE_PROVIDER;
        } else {
            process.env.ASSET_STORAGE_PROVIDER = originalAssetStorageProvider;
        }
        if (originalS3Bucket === undefined) {
            delete process.env.ASSET_S3_BUCKET;
        } else {
            process.env.ASSET_S3_BUCKET = originalS3Bucket;
        }
        if (originalS3Region === undefined) {
            delete process.env.ASSET_S3_REGION;
        } else {
            process.env.ASSET_S3_REGION = originalS3Region;
        }
        if (originalS3AccessKeyId === undefined) {
            delete process.env.ASSET_S3_ACCESS_KEY_ID;
        } else {
            process.env.ASSET_S3_ACCESS_KEY_ID = originalS3AccessKeyId;
        }
        if (originalS3SecretAccessKey === undefined) {
            delete process.env.ASSET_S3_SECRET_ACCESS_KEY;
        } else {
            process.env.ASSET_S3_SECRET_ACCESS_KEY = originalS3SecretAccessKey;
        }
        if (originalS3Endpoint === undefined) {
            delete process.env.ASSET_S3_ENDPOINT;
        } else {
            process.env.ASSET_S3_ENDPOINT = originalS3Endpoint;
        }
        if (originalS3ForcePathStyle === undefined) {
            delete process.env.ASSET_S3_FORCE_PATH_STYLE;
        } else {
            process.env.ASSET_S3_FORCE_PATH_STYLE = originalS3ForcePathStyle;
        }

        global.fetch = originalFetch;
        resetAssetStorageProviderForTests();
        vi.restoreAllMocks();
    });

    it('writes, reads, and removes asset bytes', async () => {
        const root = mkdtempSync(path.join(os.tmpdir(), 'wordclaw-assets-'));
        tempRoots.push(root);
        const storage = new LocalDiskAssetStorage(root);

        const stored = await storage.put(3, 'hero image.png', Buffer.from('asset bytes'));
        expect(stored.provider).toBe('local');
        expect(stored.storageKey).toContain('3/');
        expect(stored.sizeBytes).toBe(11);
        expect(stored.byteHash).toMatch(/^[a-f0-9]{64}$/);

        const content = await storage.read(stored.storageKey);
        expect(content.toString('utf8')).toBe('asset bytes');

        await storage.remove(stored.storageKey);
        await expect(storage.read(stored.storageKey)).rejects.toThrow();
    });

    it('returns object stats for local assets and rejects direct uploads', async () => {
        const root = mkdtempSync(path.join(os.tmpdir(), 'wordclaw-assets-'));
        tempRoots.push(root);
        const storage = new LocalDiskAssetStorage(root);

        const stored = await storage.put(3, 'hero image.png', Buffer.from('asset bytes'));
        const stats = await storage.stat(stored.storageKey);
        expect(stats).toEqual({
            sizeBytes: 11,
            byteHash: stored.byteHash,
        });

        await expect(
            storage.issueDirectUpload(3, 'hero image.png', 'image/png', new Date(Date.now() + 300_000))
        ).rejects.toMatchObject({
            code: 'ASSET_DIRECT_UPLOAD_UNSUPPORTED',
            statusCode: 409,
        });
    });

    it('rejects storage path escapes on read', async () => {
        const root = mkdtempSync(path.join(os.tmpdir(), 'wordclaw-assets-'));
        tempRoots.push(root);
        const storage = new LocalDiskAssetStorage(root);

        await expect(storage.read('../escape.txt')).rejects.toThrow('ASSET_STORAGE_PATH_ESCAPE');
    });

    it('falls back to local when s3 is configured without required credentials', () => {
        process.env.ASSET_STORAGE_PROVIDER = 's3';
        delete process.env.ASSET_S3_BUCKET;
        delete process.env.ASSET_S3_REGION;
        delete process.env.ASSET_S3_ACCESS_KEY_ID;
        delete process.env.ASSET_S3_SECRET_ACCESS_KEY;

        expect(resolveAssetStorageProviderConfig()).toEqual({
            configuredProvider: 's3',
            effectiveProvider: 'local',
            fallbackApplied: true,
            supportedProviders: ['local', 's3'],
            fallbackReason: 'missing_s3_configuration',
        });
    });

    it('uses the s3 provider when required configuration is present', async () => {
        process.env.ASSET_STORAGE_PROVIDER = 's3';
        process.env.ASSET_S3_BUCKET = 'wordclaw-assets';
        process.env.ASSET_S3_REGION = 'eu-west-1';
        process.env.ASSET_S3_ACCESS_KEY_ID = 'test-access-key';
        process.env.ASSET_S3_SECRET_ACCESS_KEY = 'test-secret-key';
        process.env.ASSET_S3_ENDPOINT = 'https://storage.example.com';
        process.env.ASSET_S3_FORCE_PATH_STYLE = 'true';

        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(null, { status: 200 }))
            .mockResolvedValueOnce(new Response('asset bytes', { status: 200 }))
            .mockResolvedValueOnce(new Response(null, { status: 204 }));
        global.fetch = fetchMock;

        const storage = getAssetStorageProvider();
        expect(storage).toBeInstanceOf(S3AssetStorage);
        expect(getS3AssetStorageConfig()).toMatchObject({
            bucket: 'wordclaw-assets',
            region: 'eu-west-1',
            endpoint: 'https://storage.example.com',
            forcePathStyle: true,
        });

        const stored = await storage.put(7, 'hero image.png', Buffer.from('asset bytes'));
        expect(stored.provider).toBe('s3');
        expect(stored.storageKey).toContain('7/');
        expect(stored.byteHash).toMatch(/^[a-f0-9]{64}$/);

        const putCall = fetchMock.mock.calls[0];
        expect(String(putCall[0])).toContain('https://storage.example.com/wordclaw-assets/7/');
        expect((putCall[1] as RequestInit).method).toBe('PUT');
        expect((putCall[1] as RequestInit).headers).toMatchObject({
            authorization: expect.stringContaining('AWS4-HMAC-SHA256 Credential=test-access-key/'),
            'x-amz-content-sha256': expect.stringMatching(/^[a-f0-9]{64}$/),
            'x-amz-date': expect.stringMatching(/^\d{8}T\d{6}Z$/),
        });

        const content = await storage.read(stored.storageKey);
        expect(content.toString('utf8')).toBe('asset bytes');
        expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('GET');

        await storage.remove(stored.storageKey);
        expect((fetchMock.mock.calls[2][1] as RequestInit).method).toBe('DELETE');
    });

    it('issues direct upload urls and object stats for the s3 provider', async () => {
        process.env.ASSET_STORAGE_PROVIDER = 's3';
        process.env.ASSET_S3_BUCKET = 'wordclaw-assets';
        process.env.ASSET_S3_REGION = 'eu-west-1';
        process.env.ASSET_S3_ACCESS_KEY_ID = 'test-access-key';
        process.env.ASSET_S3_SECRET_ACCESS_KEY = 'test-secret-key';
        process.env.ASSET_S3_ENDPOINT = 'https://storage.example.com';
        process.env.ASSET_S3_FORCE_PATH_STYLE = 'true';

        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(null, {
                status: 200,
                headers: {
                    'content-length': '42',
                },
            }));
        global.fetch = fetchMock;

        const storage = getAssetStorageProvider();
        const expiresAt = new Date('2026-03-16T12:05:00.000Z');
        const issued = await storage.issueDirectUpload(9, 'hero image.png', 'image/png', expiresAt);

        expect(issued).toMatchObject({
            provider: 's3',
            method: 'PUT',
            expiresAt,
            uploadHeaders: {
                'content-type': 'image/png',
            },
        });
        expect(issued.storageKey).toContain('9/');
        expect(issued.uploadUrl).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
        expect(issued.uploadUrl).toContain('X-Amz-Signature=');

        const stats = await storage.stat(issued.storageKey);
        expect(stats).toEqual({
            sizeBytes: 42,
            byteHash: null,
        });
        expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('HEAD');
    });
});
