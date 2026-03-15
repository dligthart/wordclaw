import path from 'node:path';

export const ASSET_STORAGE_PROVIDER_ENV = 'ASSET_STORAGE_PROVIDER';
export const ASSET_STORAGE_ROOT_ENV = 'ASSET_STORAGE_ROOT';
export const ASSET_SIGNING_SECRET_ENV = 'ASSET_SIGNING_SECRET';
export const ASSET_SIGNED_TTL_SECONDS_ENV = 'ASSET_SIGNED_TTL_SECONDS';

export const SUPPORTED_ASSET_STORAGE_PROVIDERS = ['local'] as const;
export const SUPPORTED_ASSET_UPLOAD_MODES = ['json-base64', 'multipart-form-data'] as const;
export const SUPPORTED_MCP_ASSET_UPLOAD_MODES = ['inline-base64'] as const;
export const SUPPORTED_ASSET_DELIVERY_MODES = ['public', 'signed', 'entitled'] as const;

export type AssetStorageProviderName = (typeof SUPPORTED_ASSET_STORAGE_PROVIDERS)[number];

export type AssetStorageProviderResolution = {
    configuredProvider: string;
    effectiveProvider: AssetStorageProviderName;
    fallbackApplied: boolean;
    supportedProviders: AssetStorageProviderName[];
};

export function resolveAssetStorageProviderConfig(): AssetStorageProviderResolution {
    const configuredProvider = (process.env[ASSET_STORAGE_PROVIDER_ENV] || 'local').trim().toLowerCase();
    const effectiveProvider: AssetStorageProviderName = configuredProvider === 'local' ? 'local' : 'local';

    return {
        configuredProvider,
        effectiveProvider,
        fallbackApplied: configuredProvider !== effectiveProvider,
        supportedProviders: [...SUPPORTED_ASSET_STORAGE_PROVIDERS]
    };
}

export function getAssetStorageProviderName(): AssetStorageProviderName {
    return resolveAssetStorageProviderConfig().effectiveProvider;
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
