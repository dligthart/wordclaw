import path from 'node:path';

export const ASSET_STORAGE_PROVIDER_ENV = 'ASSET_STORAGE_PROVIDER';
export const ASSET_STORAGE_ROOT_ENV = 'ASSET_STORAGE_ROOT';
export const ASSET_S3_BUCKET_ENV = 'ASSET_S3_BUCKET';
export const ASSET_S3_REGION_ENV = 'ASSET_S3_REGION';
export const ASSET_S3_ACCESS_KEY_ID_ENV = 'ASSET_S3_ACCESS_KEY_ID';
export const ASSET_S3_SECRET_ACCESS_KEY_ENV = 'ASSET_S3_SECRET_ACCESS_KEY';
export const ASSET_S3_ENDPOINT_ENV = 'ASSET_S3_ENDPOINT';
export const ASSET_S3_FORCE_PATH_STYLE_ENV = 'ASSET_S3_FORCE_PATH_STYLE';
export const ASSET_SIGNING_SECRET_ENV = 'ASSET_SIGNING_SECRET';
export const ASSET_SIGNED_TTL_SECONDS_ENV = 'ASSET_SIGNED_TTL_SECONDS';

export const SUPPORTED_ASSET_STORAGE_PROVIDERS = ['local', 's3'] as const;
export const SUPPORTED_ASSET_UPLOAD_MODES = ['json-base64', 'multipart-form-data'] as const;
export const SUPPORTED_MCP_ASSET_UPLOAD_MODES = ['inline-base64'] as const;
export const SUPPORTED_ASSET_DELIVERY_MODES = ['public', 'signed', 'entitled'] as const;

export type AssetStorageProviderName = (typeof SUPPORTED_ASSET_STORAGE_PROVIDERS)[number];

export type S3AssetStorageConfig = {
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint: string | null;
    forcePathStyle: boolean;
};

export type AssetStorageProviderResolution = {
    configuredProvider: string;
    effectiveProvider: AssetStorageProviderName;
    fallbackApplied: boolean;
    supportedProviders: AssetStorageProviderName[];
    fallbackReason?: 'missing_s3_configuration' | 'unsupported_provider';
};

function readTrimmedEnv(name: string): string | null {
    const value = process.env[name]?.trim();
    return value && value.length > 0 ? value : null;
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
    const value = readTrimmedEnv(name);
    if (!value) {
        return fallback;
    }

    return value === 'true' || value === '1' || value === 'yes' || value === 'on';
}

export function getS3AssetStorageConfig(): S3AssetStorageConfig | null {
    const bucket = readTrimmedEnv(ASSET_S3_BUCKET_ENV);
    const region = readTrimmedEnv(ASSET_S3_REGION_ENV);
    const accessKeyId = readTrimmedEnv(ASSET_S3_ACCESS_KEY_ID_ENV);
    const secretAccessKey = readTrimmedEnv(ASSET_S3_SECRET_ACCESS_KEY_ENV);

    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
        return null;
    }

    return {
        bucket,
        region,
        accessKeyId,
        secretAccessKey,
        endpoint: readTrimmedEnv(ASSET_S3_ENDPOINT_ENV),
        forcePathStyle: parseBooleanEnv(ASSET_S3_FORCE_PATH_STYLE_ENV, Boolean(readTrimmedEnv(ASSET_S3_ENDPOINT_ENV))),
    };
}

export function resolveAssetStorageProviderConfig(): AssetStorageProviderResolution {
    const configuredProvider = (process.env[ASSET_STORAGE_PROVIDER_ENV] || 'local').trim().toLowerCase();
    if (configuredProvider === 'local') {
        return {
            configuredProvider,
            effectiveProvider: 'local',
            fallbackApplied: false,
            supportedProviders: [...SUPPORTED_ASSET_STORAGE_PROVIDERS]
        };
    }

    if (configuredProvider === 's3') {
        const s3Config = getS3AssetStorageConfig();
        return {
            configuredProvider,
            effectiveProvider: s3Config ? 's3' : 'local',
            fallbackApplied: !s3Config,
            supportedProviders: [...SUPPORTED_ASSET_STORAGE_PROVIDERS],
            ...(s3Config ? {} : { fallbackReason: 'missing_s3_configuration' })
        };
    }

    return {
        configuredProvider,
        effectiveProvider: 'local',
        fallbackApplied: true,
        supportedProviders: [...SUPPORTED_ASSET_STORAGE_PROVIDERS],
        fallbackReason: 'unsupported_provider'
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
