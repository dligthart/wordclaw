import crypto from 'node:crypto';

import { getAssetDirectUploadTtlSeconds, getAssetSigningSecret, type AssetStorageProviderName } from '../config/assets.js';
import type { AssetAccessMode, AssetEntitlementScopeType } from './assets.js';

type DirectAssetUploadTokenPayload = {
    version: 1;
    domainId: number;
    storageProvider: AssetStorageProviderName;
    storageKey: string;
    sourceAssetId: number | null;
    variantKey: string | null;
    transformSpec: Record<string, unknown> | null;
    filename: string;
    originalFilename: string;
    mimeType: string;
    accessMode: AssetAccessMode;
    entitlementScopeType: AssetEntitlementScopeType | null;
    entitlementScopeRef: number | null;
    metadata: Record<string, unknown>;
    expiresAt: number;
};

export type IssuedDirectAssetUploadToken = {
    token: string;
    expiresAt: Date;
    ttlSeconds: number;
};

export type VerifiedDirectAssetUploadToken =
    | ({
        ok: true;
        expiresAt: Date;
    } & Omit<DirectAssetUploadTokenPayload, 'version' | 'expiresAt'>)
    | {
        ok: false;
        code: 'INVALID_DIRECT_ASSET_UPLOAD_TOKEN' | 'DIRECT_ASSET_UPLOAD_TOKEN_EXPIRED';
        remediation: string;
    };

function encodePayload(payload: DirectAssetUploadTokenPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodePayload(payload: string): DirectAssetUploadTokenPayload | null {
    try {
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<DirectAssetUploadTokenPayload>;
        if (
            decoded.version !== 1
            || typeof decoded.domainId !== 'number'
            || !Number.isInteger(decoded.domainId)
            || decoded.domainId <= 0
            || (decoded.storageProvider !== 'local' && decoded.storageProvider !== 's3')
            || typeof decoded.storageKey !== 'string'
            || decoded.storageKey.length === 0
            || (decoded.sourceAssetId !== null
                && decoded.sourceAssetId !== undefined
                && (typeof decoded.sourceAssetId !== 'number' || !Number.isInteger(decoded.sourceAssetId) || decoded.sourceAssetId <= 0))
            || (decoded.variantKey !== null
                && decoded.variantKey !== undefined
                && (typeof decoded.variantKey !== 'string' || decoded.variantKey.length === 0))
            || (decoded.transformSpec !== null
                && decoded.transformSpec !== undefined
                && (typeof decoded.transformSpec !== 'object' || Array.isArray(decoded.transformSpec)))
            || typeof decoded.filename !== 'string'
            || decoded.filename.length === 0
            || typeof decoded.originalFilename !== 'string'
            || decoded.originalFilename.length === 0
            || typeof decoded.mimeType !== 'string'
            || decoded.mimeType.length === 0
            || (decoded.accessMode !== 'public' && decoded.accessMode !== 'signed' && decoded.accessMode !== 'entitled')
            || (decoded.entitlementScopeType !== null
                && decoded.entitlementScopeType !== undefined
                && decoded.entitlementScopeType !== 'item'
                && decoded.entitlementScopeType !== 'type'
                && decoded.entitlementScopeType !== 'subscription')
            || (decoded.entitlementScopeRef !== null
                && decoded.entitlementScopeRef !== undefined
                && (typeof decoded.entitlementScopeRef !== 'number' || !Number.isInteger(decoded.entitlementScopeRef) || decoded.entitlementScopeRef <= 0))
            || typeof decoded.metadata !== 'object'
            || decoded.metadata === null
            || Array.isArray(decoded.metadata)
            || typeof decoded.expiresAt !== 'number'
        ) {
            return null;
        }

        return {
            version: 1,
            domainId: decoded.domainId,
            storageProvider: decoded.storageProvider,
            storageKey: decoded.storageKey,
            sourceAssetId: decoded.sourceAssetId ?? null,
            variantKey: decoded.variantKey ?? null,
            transformSpec: decoded.transformSpec ?? null,
            filename: decoded.filename,
            originalFilename: decoded.originalFilename,
            mimeType: decoded.mimeType,
            accessMode: decoded.accessMode,
            entitlementScopeType: decoded.entitlementScopeType ?? null,
            entitlementScopeRef: decoded.entitlementScopeRef ?? null,
            metadata: decoded.metadata as Record<string, unknown>,
            expiresAt: decoded.expiresAt,
        };
    } catch {
        return null;
    }
}

function signPayload(payload: string): string {
    return crypto.createHmac('sha256', getAssetSigningSecret()).update(payload).digest('base64url');
}

export function issueDirectAssetUploadToken(input: Omit<DirectAssetUploadTokenPayload, 'version' | 'expiresAt'> & {
    ttlSeconds?: number;
}): IssuedDirectAssetUploadToken {
    const ttlSeconds = Math.max(60, Math.min(Math.trunc(input.ttlSeconds ?? getAssetDirectUploadTtlSeconds()), 3600));
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const payload = encodePayload({
        version: 1,
        domainId: input.domainId,
        storageProvider: input.storageProvider,
        storageKey: input.storageKey,
        sourceAssetId: input.sourceAssetId ?? null,
        variantKey: input.variantKey ?? null,
        transformSpec: input.transformSpec ?? null,
        filename: input.filename,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        accessMode: input.accessMode,
        entitlementScopeType: input.entitlementScopeType,
        entitlementScopeRef: input.entitlementScopeRef,
        metadata: input.metadata,
        expiresAt: expiresAt.getTime(),
    });

    return {
        token: `${payload}.${signPayload(payload)}`,
        expiresAt,
        ttlSeconds,
    };
}

export function verifyDirectAssetUploadToken(token: string, expectedDomainId?: number): VerifiedDirectAssetUploadToken {
    const [payload, signature, ...rest] = token.split('.');
    if (!payload || !signature || rest.length > 0) {
        return {
            ok: false,
            code: 'INVALID_DIRECT_ASSET_UPLOAD_TOKEN',
            remediation: 'Provide a valid direct-upload completion token issued by POST /api/assets/direct-upload.',
        };
    }

    const expectedSignature = signPayload(payload);
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (
        signatureBuffer.length !== expectedBuffer.length
        || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
        return {
            ok: false,
            code: 'INVALID_DIRECT_ASSET_UPLOAD_TOKEN',
            remediation: 'Provide a valid direct-upload completion token issued by POST /api/assets/direct-upload.',
        };
    }

    const decoded = decodePayload(payload);
    if (!decoded || (expectedDomainId !== undefined && decoded.domainId !== expectedDomainId)) {
        return {
            ok: false,
            code: 'INVALID_DIRECT_ASSET_UPLOAD_TOKEN',
            remediation: 'Provide a token that matches the active domain and the issued direct upload session.',
        };
    }

    const expiresAt = new Date(decoded.expiresAt);
    if (expiresAt.getTime() <= Date.now()) {
        return {
            ok: false,
            code: 'DIRECT_ASSET_UPLOAD_TOKEN_EXPIRED',
            remediation: 'Issue a new direct upload via POST /api/assets/direct-upload and retry the upload/finalize flow.',
        };
    }

    return {
        ok: true,
        domainId: decoded.domainId,
        storageProvider: decoded.storageProvider,
        storageKey: decoded.storageKey,
        sourceAssetId: decoded.sourceAssetId,
        variantKey: decoded.variantKey,
        transformSpec: decoded.transformSpec,
        filename: decoded.filename,
        originalFilename: decoded.originalFilename,
        mimeType: decoded.mimeType,
        accessMode: decoded.accessMode,
        entitlementScopeType: decoded.entitlementScopeType,
        entitlementScopeRef: decoded.entitlementScopeRef,
        metadata: decoded.metadata,
        expiresAt,
    };
}
