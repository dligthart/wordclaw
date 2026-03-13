import path from 'node:path';

export const ASSET_STORAGE_PROVIDER_ENV = 'ASSET_STORAGE_PROVIDER';
export const ASSET_STORAGE_ROOT_ENV = 'ASSET_STORAGE_ROOT';

export type AssetStorageProviderName = 'local';

export function getAssetStorageProviderName(): AssetStorageProviderName {
    const provider = (process.env[ASSET_STORAGE_PROVIDER_ENV] || 'local').trim().toLowerCase();
    return provider === 'local' ? 'local' : 'local';
}

export function getAssetStorageRoot(): string {
    const configuredRoot = process.env[ASSET_STORAGE_ROOT_ENV]?.trim();
    return configuredRoot && configuredRoot.length > 0
        ? path.resolve(configuredRoot)
        : path.resolve(process.cwd(), 'storage/assets');
}
