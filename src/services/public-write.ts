import crypto from 'node:crypto';

import type { PublicWriteOperation } from './content-schema.js';

type PublicWriteTokenPayload = {
    version: 1;
    mode: 'content-public-write';
    domainId: number;
    contentTypeId: number;
    subjectField: string;
    subject: string;
    allowedOperations: PublicWriteOperation[];
    requiredStatus: string;
    expiresAt: number;
};

export type IssuedPublicWriteToken = {
    token: string;
    expiresAt: Date;
    ttlSeconds: number;
    domainId: number;
    contentTypeId: number;
    subjectField: string;
    subject: string;
    allowedOperations: PublicWriteOperation[];
    requiredStatus: string;
};

export type VerifiedPublicWriteToken =
    | {
        ok: true;
        domainId: number;
        contentTypeId: number;
        subjectField: string;
        subject: string;
        allowedOperations: PublicWriteOperation[];
        requiredStatus: string;
        expiresAt: Date;
    }
    | {
        ok: false;
        code: 'INVALID_PUBLIC_WRITE_TOKEN' | 'PUBLIC_WRITE_TOKEN_EXPIRED' | 'PUBLIC_WRITE_OPERATION_FORBIDDEN';
        remediation: string;
    };

let cachedPublicWriteSecret: string | null = null;

function getPublicWriteSigningSecret(): string {
    if (cachedPublicWriteSecret) {
        return cachedPublicWriteSecret;
    }

    const configured = process.env.PUBLIC_WRITE_SECRET?.trim();
    if (configured) {
        cachedPublicWriteSecret = configured;
        return configured;
    }

    if (process.env.NODE_ENV === 'production') {
        throw new Error('PUBLIC_WRITE_SECRET must be configured in production.');
    }

    cachedPublicWriteSecret = crypto.randomBytes(32).toString('hex');
    console.warn(`[WARNING] PUBLIC_WRITE_SECRET is not set. Generated ephemeral random secret for development: ${cachedPublicWriteSecret}`);
    return cachedPublicWriteSecret;
}

function getPublicWriteTtlSeconds(): number {
    const parsed = Number.parseInt(process.env.PUBLIC_WRITE_TTL_SECONDS ?? '900', 10);
    if (!Number.isFinite(parsed)) {
        return 900;
    }

    return Math.max(60, Math.min(parsed, 24 * 60 * 60));
}

function encodePayload(payload: PublicWriteTokenPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodePayload(payload: string): PublicWriteTokenPayload | null {
    try {
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<PublicWriteTokenPayload>;
        if (
            decoded.version !== 1
            || decoded.mode !== 'content-public-write'
            || typeof decoded.domainId !== 'number'
            || !Number.isInteger(decoded.domainId)
            || decoded.domainId <= 0
            || typeof decoded.contentTypeId !== 'number'
            || !Number.isInteger(decoded.contentTypeId)
            || decoded.contentTypeId <= 0
            || typeof decoded.subjectField !== 'string'
            || decoded.subjectField.trim().length === 0
            || typeof decoded.subject !== 'string'
            || decoded.subject.trim().length === 0
            || !Array.isArray(decoded.allowedOperations)
            || decoded.allowedOperations.some((entry) => entry !== 'create' && entry !== 'update')
            || typeof decoded.requiredStatus !== 'string'
            || decoded.requiredStatus.trim().length === 0
            || typeof decoded.expiresAt !== 'number'
        ) {
            return null;
        }

        return decoded as PublicWriteTokenPayload;
    } catch {
        return null;
    }
}

function signPayload(payload: string): string {
    return crypto.createHmac('sha256', getPublicWriteSigningSecret()).update(payload).digest('base64url');
}

export function issuePublicWriteToken(input: {
    domainId: number;
    contentTypeId: number;
    subjectField: string;
    subject: string;
    allowedOperations: PublicWriteOperation[];
    requiredStatus: string;
    ttlSeconds?: number;
}): IssuedPublicWriteToken {
    const ttlSeconds = Math.max(60, Math.min(Math.trunc(input.ttlSeconds ?? getPublicWriteTtlSeconds()), 24 * 60 * 60));
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const allowedOperations = [...new Set(input.allowedOperations)];
    const payload = encodePayload({
        version: 1,
        mode: 'content-public-write',
        domainId: input.domainId,
        contentTypeId: input.contentTypeId,
        subjectField: input.subjectField,
        subject: input.subject,
        allowedOperations,
        requiredStatus: input.requiredStatus,
        expiresAt: expiresAt.getTime()
    });

    return {
        token: `${payload}.${signPayload(payload)}`,
        expiresAt,
        ttlSeconds,
        domainId: input.domainId,
        contentTypeId: input.contentTypeId,
        subjectField: input.subjectField,
        subject: input.subject,
        allowedOperations,
        requiredStatus: input.requiredStatus
    };
}

export function verifyPublicWriteToken(token: string, operation: PublicWriteOperation): VerifiedPublicWriteToken {
    const [payload, signature, ...rest] = token.split('.');
    if (!payload || !signature || rest.length > 0) {
        return {
            ok: false,
            code: 'INVALID_PUBLIC_WRITE_TOKEN',
            remediation: 'Provide a valid public write token issued by POST /api/content-types/:id/public-write-tokens.'
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
            code: 'INVALID_PUBLIC_WRITE_TOKEN',
            remediation: 'Provide a valid public write token issued by POST /api/content-types/:id/public-write-tokens.'
        };
    }

    const decoded = decodePayload(payload);
    if (!decoded) {
        return {
            ok: false,
            code: 'INVALID_PUBLIC_WRITE_TOKEN',
            remediation: 'Provide a valid public write token issued by POST /api/content-types/:id/public-write-tokens.'
        };
    }

    const expiresAt = new Date(decoded.expiresAt);
    if (expiresAt.getTime() <= Date.now()) {
        return {
            ok: false,
            code: 'PUBLIC_WRITE_TOKEN_EXPIRED',
            remediation: 'Issue a new public write token and retry the session write before it expires.'
        };
    }

    if (!decoded.allowedOperations.includes(operation)) {
        return {
            ok: false,
            code: 'PUBLIC_WRITE_OPERATION_FORBIDDEN',
            remediation: `Issue a token that allows ${operation} or choose an allowed public write operation.`
        };
    }

    return {
        ok: true,
        domainId: decoded.domainId,
        contentTypeId: decoded.contentTypeId,
        subjectField: decoded.subjectField,
        subject: decoded.subject,
        allowedOperations: decoded.allowedOperations,
        requiredStatus: decoded.requiredStatus,
        expiresAt
    };
}
