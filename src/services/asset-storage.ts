import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { getAssetStorageRoot, type AssetStorageProviderName } from '../config/assets.js';

export type StoredAssetDescriptor = {
    provider: AssetStorageProviderName;
    storageKey: string;
    sizeBytes: number;
    byteHash: string;
};

export interface AssetStorageProvider {
    put(domainId: number, filename: string, bytes: Buffer): Promise<StoredAssetDescriptor>;
    read(storageKey: string): Promise<Buffer>;
    remove(storageKey: string): Promise<void>;
}

function sanitizeFilename(filename: string): string {
    const normalized = path.basename(filename || 'asset.bin').trim();
    const safe = normalized.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return safe.length > 0 ? safe : 'asset.bin';
}

function ensureInsideRoot(root: string, target: string): string {
    const resolvedRoot = path.resolve(root);
    const resolvedTarget = path.resolve(target);

    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error('ASSET_STORAGE_PATH_ESCAPE');
    }

    return resolvedTarget;
}

export class LocalDiskAssetStorage implements AssetStorageProvider {
    constructor(private readonly root: string) {}

    private toAbsolutePath(storageKey: string): string {
        return ensureInsideRoot(this.root, path.join(this.root, storageKey));
    }

    async put(domainId: number, filename: string, bytes: Buffer): Promise<StoredAssetDescriptor> {
        const safeFilename = sanitizeFilename(filename);
        const storageKey = path.posix.join(String(domainId), `${randomUUID()}-${safeFilename}`);
        const absolutePath = this.toAbsolutePath(storageKey);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, bytes);

        return {
            provider: 'local',
            storageKey,
            sizeBytes: bytes.byteLength,
            byteHash: createHash('sha256').update(bytes).digest('hex')
        };
    }

    async read(storageKey: string): Promise<Buffer> {
        return fs.readFile(this.toAbsolutePath(storageKey));
    }

    async remove(storageKey: string): Promise<void> {
        const absolutePath = this.toAbsolutePath(storageKey);
        await fs.rm(absolutePath, { force: true });
    }
}

let providerInstance: AssetStorageProvider | null = null;

export function getAssetStorageProvider(): AssetStorageProvider {
    if (!providerInstance) {
        providerInstance = new LocalDiskAssetStorage(getAssetStorageRoot());
    }

    return providerInstance;
}

export function resetAssetStorageProviderForTests() {
    providerInstance = null;
}
