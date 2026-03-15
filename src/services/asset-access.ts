import crypto from 'node:crypto';

import { getAssetSignedTtlSeconds, getAssetSigningSecret } from '../config/assets.js';

type SignedAssetTokenPayload = {
    version: 1;
    assetId: number;
    domainId: number;
    accessMode: 'signed';
    expiresAt: number;
};

export type IssuedSignedAssetAccess = {
    token: string;
    expiresAt: Date;
    ttlSeconds: number;
};

export type VerifiedSignedAssetAccess =
    | {
        ok: true;
        assetId: number;
        domainId: number;
        expiresAt: Date;
    }
    | {
        ok: false;
        code: 'INVALID_ASSET_ACCESS_TOKEN' | 'ASSET_ACCESS_TOKEN_EXPIRED';
        remediation: string;
    };

function encodePayload(payload: SignedAssetTokenPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodePayload(payload: string): SignedAssetTokenPayload | null {
    try {
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<SignedAssetTokenPayload>;
        if (
            decoded.version !== 1
            || decoded.accessMode !== 'signed'
            || typeof decoded.assetId !== 'number'
            || !Number.isInteger(decoded.assetId)
            || decoded.assetId <= 0
            || typeof decoded.domainId !== 'number'
            || !Number.isInteger(decoded.domainId)
            || decoded.domainId <= 0
            || typeof decoded.expiresAt !== 'number'
        ) {
            return null;
        }

        return decoded as SignedAssetTokenPayload;
    } catch {
        return null;
    }
}

function signPayload(payload: string): string {
    return crypto.createHmac('sha256', getAssetSigningSecret()).update(payload).digest('base64url');
}

export function issueSignedAssetAccess(input: {
    assetId: number;
    domainId: number;
    ttlSeconds?: number;
}): IssuedSignedAssetAccess {
    const ttlSeconds = Math.max(30, Math.min(Math.trunc(input.ttlSeconds ?? getAssetSignedTtlSeconds()), 3600));
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const payload = encodePayload({
        version: 1,
        assetId: input.assetId,
        domainId: input.domainId,
        accessMode: 'signed',
        expiresAt: expiresAt.getTime()
    });

    return {
        token: `${payload}.${signPayload(payload)}`,
        expiresAt,
        ttlSeconds
    };
}

export function verifySignedAssetAccess(token: string, expected: {
    assetId: number;
    domainId: number;
}): VerifiedSignedAssetAccess {
    const [payload, signature, ...rest] = token.split('.');
    if (!payload || !signature || rest.length > 0) {
        return {
            ok: false,
            code: 'INVALID_ASSET_ACCESS_TOKEN',
            remediation: 'Provide a valid signed asset token issued by POST /api/assets/:id/access or issue_asset_access.'
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
            code: 'INVALID_ASSET_ACCESS_TOKEN',
            remediation: 'Provide a valid signed asset token issued by POST /api/assets/:id/access or issue_asset_access.'
        };
    }

    const decoded = decodePayload(payload);
    if (!decoded || decoded.assetId !== expected.assetId || decoded.domainId !== expected.domainId) {
        return {
            ok: false,
            code: 'INVALID_ASSET_ACCESS_TOKEN',
            remediation: 'Provide a token that matches the requested signed asset and active domain.'
        };
    }

    const expiresAt = new Date(decoded.expiresAt);
    if (expiresAt.getTime() <= Date.now()) {
        return {
            ok: false,
            code: 'ASSET_ACCESS_TOKEN_EXPIRED',
            remediation: 'Issue a new token via POST /api/assets/:id/access or issue_asset_access and retry the asset read.'
        };
    }

    return {
        ok: true,
        assetId: decoded.assetId,
        domainId: decoded.domainId,
        expiresAt
    };
}
