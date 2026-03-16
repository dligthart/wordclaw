import { createHash, createHmac, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
    getAssetStorageProviderName,
    getAssetStorageRoot,
    getS3AssetStorageConfig,
    type AssetStorageProviderName,
    type S3AssetStorageConfig,
} from '../config/assets.js';

export type StoredAssetDescriptor = {
    provider: AssetStorageProviderName;
    storageKey: string;
    sizeBytes: number;
    byteHash: string;
};

export type AssetObjectStat = {
    sizeBytes: number;
    byteHash: string | null;
};

export type IssuedDirectAssetUpload = {
    provider: AssetStorageProviderName;
    storageKey: string;
    method: 'PUT';
    uploadUrl: string;
    uploadHeaders: Record<string, string>;
    expiresAt: Date;
};

export class AssetStorageError extends Error {
    code: string;
    remediation: string;
    statusCode: number;

    constructor(message: string, code: string, remediation: string, statusCode = 503) {
        super(message);
        this.name = 'AssetStorageError';
        this.code = code;
        this.remediation = remediation;
        this.statusCode = statusCode;
    }
}

export interface AssetStorageProvider {
    put(domainId: number, filename: string, bytes: Buffer): Promise<StoredAssetDescriptor>;
    read(storageKey: string): Promise<Buffer>;
    remove(storageKey: string): Promise<void>;
    stat(storageKey: string): Promise<AssetObjectStat>;
    issueDirectUpload(domainId: number, filename: string, mimeType: string, expiresAt: Date): Promise<IssuedDirectAssetUpload>;
}

function sha256Hex(value: Buffer | string): string {
    return createHash('sha256').update(value).digest('hex');
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

function hmacBuffer(key: Buffer | string, value: string): Buffer {
    return createHmac('sha256', key).update(value, 'utf8').digest();
}

function formatAmzDate(timestamp: Date): { amzDate: string; dateStamp: string } {
    const iso = timestamp.toISOString().replace(/[:-]|\.\d{3}/g, '');
    return {
        amzDate: iso,
        dateStamp: iso.slice(0, 8),
    };
}

function encodeS3PathSegment(segment: string): string {
    return encodeURIComponent(segment).replace(/[!*'()]/g, (char) =>
        `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}

function buildS3ObjectUrl(config: S3AssetStorageConfig, storageKey: string): URL {
    const base = new URL(config.endpoint ?? `https://s3.${config.region}.amazonaws.com`);
    const encodedKey = storageKey
        .split('/')
        .filter((segment) => segment.length > 0)
        .map(encodeS3PathSegment)
        .join('/');
    const basePath = base.pathname.replace(/\/$/, '');

    if (config.forcePathStyle) {
        base.pathname = `${basePath}/${encodeS3PathSegment(config.bucket)}/${encodedKey}`;
        return base;
    }

    base.hostname = `${config.bucket}.${base.hostname}`;
    base.pathname = `${basePath || ''}/${encodedKey}`;
    return base;
}

function encodeS3QueryComponent(value: string): string {
    return encodeURIComponent(value).replace(/[!*'()]/g, (char) =>
        `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}

function buildS3PresignedPutUrl(
    config: S3AssetStorageConfig,
    storageKey: string,
    expiresAt: Date,
    timestamp = new Date(),
): string {
    const url = buildS3ObjectUrl(config, storageKey);
    const { amzDate, dateStamp } = formatAmzDate(timestamp);
    const expiresInSeconds = Math.max(1, Math.min(Math.trunc((expiresAt.getTime() - timestamp.getTime()) / 1000), 3600));
    const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
    const queryEntries = Object.entries({
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': `${config.accessKeyId}/${credentialScope}`,
        'X-Amz-Date': amzDate,
        'X-Amz-Expires': String(expiresInSeconds),
        'X-Amz-SignedHeaders': 'host',
    }).sort(([left], [right]) => left.localeCompare(right));
    const canonicalQuery = queryEntries
        .map(([key, value]) => `${encodeS3QueryComponent(key)}=${encodeS3QueryComponent(value)}`)
        .join('&');
    const canonicalRequest = [
        'PUT',
        url.pathname,
        canonicalQuery,
        `host:${url.host}\n`,
        'host',
        'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest),
    ].join('\n');
    const signingKey = hmacBuffer(
        hmacBuffer(
            hmacBuffer(
                hmacBuffer(`AWS4${config.secretAccessKey}`, dateStamp),
                config.region,
            ),
            's3',
        ),
        'aws4_request',
    );
    const signature = createHmac('sha256', signingKey)
        .update(stringToSign, 'utf8')
        .digest('hex');

    url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
    return url.toString();
}

function buildSignedS3Headers(
    config: S3AssetStorageConfig,
    method: 'PUT' | 'GET' | 'DELETE' | 'HEAD',
    url: URL,
    payload: Buffer,
    timestamp = new Date(),
): Record<string, string> {
    const { amzDate, dateStamp } = formatAmzDate(timestamp);
    const payloadHash = sha256Hex(payload);
    const canonicalHeaders = {
        host: url.host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
    };
    const signedHeaders = Object.keys(canonicalHeaders).sort().join(';');
    const canonicalHeaderString = Object.entries(canonicalHeaders)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}:${value}\n`)
        .join('');
    const canonicalRequest = [
        method,
        url.pathname,
        '',
        canonicalHeaderString,
        signedHeaders,
        payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = hmacBuffer(
        hmacBuffer(
            hmacBuffer(
                hmacBuffer(`AWS4${config.secretAccessKey}`, dateStamp),
                config.region,
            ),
            's3',
        ),
        'aws4_request',
    );
    const signature = createHmac('sha256', signingKey)
        .update(stringToSign, 'utf8')
        .digest('hex');

    return {
        authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
    };
}

async function readResponseBuffer(response: Response): Promise<Buffer> {
    return Buffer.from(await response.arrayBuffer());
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
            byteHash: sha256Hex(bytes),
        };
    }

    async read(storageKey: string): Promise<Buffer> {
        return fs.readFile(this.toAbsolutePath(storageKey));
    }

    async remove(storageKey: string): Promise<void> {
        const absolutePath = this.toAbsolutePath(storageKey);
        await fs.rm(absolutePath, { force: true });
    }

    async stat(storageKey: string): Promise<AssetObjectStat> {
        const absolutePath = this.toAbsolutePath(storageKey);
        const bytes = await fs.readFile(absolutePath);
        return {
            sizeBytes: bytes.byteLength,
            byteHash: sha256Hex(bytes),
        };
    }

    async issueDirectUpload(_domainId: number, _filename: string, _mimeType: string, _expiresAt: Date): Promise<IssuedDirectAssetUpload> {
        throw new AssetStorageError(
            'Direct provider upload is not supported for the local asset storage provider',
            'ASSET_DIRECT_UPLOAD_UNSUPPORTED',
            'Use POST /api/assets with multipart/form-data or switch the runtime to the s3 asset provider before requesting direct uploads.',
            409,
        );
    }
}

export class S3AssetStorage implements AssetStorageProvider {
    constructor(private readonly config: S3AssetStorageConfig) {}

    private buildStorageKey(domainId: number, filename: string): string {
        const safeFilename = sanitizeFilename(filename);
        return path.posix.join(String(domainId), `${randomUUID()}-${safeFilename}`);
    }

    private async perform(
        method: 'PUT' | 'GET' | 'DELETE' | 'HEAD',
        storageKey: string,
        payload: Buffer,
    ): Promise<Response> {
        const url = buildS3ObjectUrl(this.config, storageKey);
        const headers = buildSignedS3Headers(this.config, method, url, payload);
        const response = await fetch(url, {
            method,
            headers,
            body: method === 'PUT' ? payload : undefined,
        });

        if (response.ok) {
            return response;
        }

        if ((method === 'GET' || method === 'HEAD') && response.status === 404) {
            throw new AssetStorageError(
                'Asset content not found in S3 storage',
                'ASSET_CONTENT_NOT_FOUND',
                'The asset metadata exists, but the object is missing from the configured S3 bucket.',
                404,
            );
        }

        if (method === 'DELETE' && response.status === 404) {
            return response;
        }

        throw new AssetStorageError(
            `S3 asset storage request failed with status ${response.status}`,
            'ASSET_STORAGE_PROVIDER_REQUEST_FAILED',
            'Verify the configured S3 bucket, credentials, endpoint, and network reachability before retrying asset storage operations.',
            503,
        );
    }

    async put(domainId: number, filename: string, bytes: Buffer): Promise<StoredAssetDescriptor> {
        const storageKey = this.buildStorageKey(domainId, filename);
        await this.perform('PUT', storageKey, bytes);

        return {
            provider: 's3',
            storageKey,
            sizeBytes: bytes.byteLength,
            byteHash: sha256Hex(bytes),
        };
    }

    async read(storageKey: string): Promise<Buffer> {
        const response = await this.perform('GET', storageKey, Buffer.alloc(0));
        return readResponseBuffer(response);
    }

    async remove(storageKey: string): Promise<void> {
        await this.perform('DELETE', storageKey, Buffer.alloc(0));
    }

    async stat(storageKey: string): Promise<AssetObjectStat> {
        const response = await this.perform('HEAD', storageKey, Buffer.alloc(0));
        const sizeHeader = response.headers.get('content-length');
        const sizeBytes = Number(sizeHeader ?? 0);

        return {
            sizeBytes: Number.isFinite(sizeBytes) && sizeBytes >= 0 ? sizeBytes : 0,
            byteHash: null,
        };
    }

    async issueDirectUpload(domainId: number, filename: string, mimeType: string, expiresAt: Date): Promise<IssuedDirectAssetUpload> {
        const storageKey = this.buildStorageKey(domainId, filename);
        return {
            provider: 's3',
            storageKey,
            method: 'PUT',
            uploadUrl: buildS3PresignedPutUrl(this.config, storageKey, expiresAt),
            uploadHeaders: {
                'content-type': mimeType,
            },
            expiresAt,
        };
    }
}

const providerInstances = new Map<AssetStorageProviderName, AssetStorageProvider>();

function createProvider(providerName: AssetStorageProviderName): AssetStorageProvider {
    if (providerName === 'local') {
        return new LocalDiskAssetStorage(getAssetStorageRoot());
    }

    const s3Config = getS3AssetStorageConfig();
    if (!s3Config) {
        throw new AssetStorageError(
            'S3 asset storage is not configured',
            'ASSET_STORAGE_PROVIDER_NOT_CONFIGURED',
            'Configure ASSET_S3_BUCKET, ASSET_S3_REGION, ASSET_S3_ACCESS_KEY_ID, and ASSET_S3_SECRET_ACCESS_KEY before using the s3 asset provider.',
            503,
        );
    }

    return new S3AssetStorage(s3Config);
}

export function getAssetStorageProvider(providerName?: string): AssetStorageProvider {
    const targetProvider = providerName ?? getAssetStorageProviderName();
    if (targetProvider !== 'local' && targetProvider !== 's3') {
        throw new AssetStorageError(
            `Unsupported asset storage provider "${targetProvider}"`,
            'ASSET_STORAGE_PROVIDER_UNSUPPORTED',
            'Use a supported asset storage provider such as "local" or "s3".',
            503,
        );
    }

    if (!providerInstances.has(targetProvider)) {
        providerInstances.set(targetProvider, createProvider(targetProvider));
    }

    return providerInstances.get(targetProvider)!;
}

export function resetAssetStorageProviderForTests() {
    providerInstances.clear();
}
