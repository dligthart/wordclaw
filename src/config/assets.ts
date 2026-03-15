import path from 'node:path';

export const ASSET_STORAGE_PROVIDER_ENV = 'ASSET_STORAGE_PROVIDER';
export const ASSET_STORAGE_ROOT_ENV = 'ASSET_STORAGE_ROOT';
export const ASSET_SIGNING_SECRET_ENV = 'ASSET_SIGNING_SECRET';
export const ASSET_SIGNED_TTL_SECONDS_ENV = 'ASSET_SIGNED_TTL_SECONDS';

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

export function getAssetSigningSecret(): string {
    const configuredSecret = process.env[ASSET_SIGNING_SECRET_ENV]?.trim();
    if (configuredSecret && configuredSecret.length > 0) {
        return configuredSecret;
    }

    const inheritedSecret = process.env.JWT_SECRET?.trim()
        || process.env.COOKIE_SECRET?.trim()
        || process.env.L402_SECRET?.trim();
    if (inheritedSecret && inheritedSecret.length > 0) {
        return inheritedSecret;
    }

    if (process.env.NODE_ENV !== 'production') {
        return 'wordclaw-dev-asset-signing-secret';
    }

    throw new Error(`${ASSET_SIGNING_SECRET_ENV}_NOT_CONFIGURED`);
}

export function getAssetSignedTtlSeconds(): number {
    const raw = Number(process.env[ASSET_SIGNED_TTL_SECONDS_ENV] || 300);
    if (!Number.isFinite(raw)) {
        return 300;
    }

    return Math.max(30, Math.min(Math.trunc(raw), 3600));
}
