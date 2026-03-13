import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalDiskAssetStorage } from './asset-storage.js';

describe('LocalDiskAssetStorage', () => {
    const tempRoots: string[] = [];

    afterEach(() => {
        while (tempRoots.length > 0) {
            const root = tempRoots.pop();
            if (root) {
                rmSync(root, { recursive: true, force: true });
            }
        }
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

    it('rejects storage path escapes on read', async () => {
        const root = mkdtempSync(path.join(os.tmpdir(), 'wordclaw-assets-'));
        tempRoots.push(root);
        const storage = new LocalDiskAssetStorage(root);

        await expect(storage.read('../escape.txt')).rejects.toThrow('ASSET_STORAGE_PATH_ESCAPE');
    });
});
