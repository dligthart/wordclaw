import crypto from 'node:crypto';

type PreviewTarget =
    | {
        kind: 'content_item';
        contentItemId: number;
    }
    | {
        kind: 'global';
        slug: string;
    };

type PreviewTokenPayload = {
    version: 1;
    mode: 'content-preview';
    domainId: number;
    draft: boolean;
    locale?: string;
    fallbackLocale?: string;
    expiresAt: number;
} & PreviewTarget;

export type IssuePreviewTokenInput = PreviewTarget & {
    domainId: number;
    draft?: boolean;
    locale?: string;
    fallbackLocale?: string;
    ttlSeconds?: number;
};

export type IssuedPreviewToken = PreviewTarget & {
    token: string;
    expiresAt: Date;
    ttlSeconds: number;
    domainId: number;
    draft: boolean;
    locale?: string;
    fallbackLocale?: string;
};

export type VerifiedPreviewToken =
    | (PreviewTarget & {
        ok: true;
        domainId: number;
        draft: boolean;
        locale?: string;
        fallbackLocale?: string;
        expiresAt: Date;
    })
    | {
        ok: false;
        code: 'INVALID_PREVIEW_TOKEN' | 'PREVIEW_TOKEN_EXPIRED';
        remediation: string;
    };

let cachedPreviewSecret: string | null = null;

function getPreviewSigningSecret(): string {
    if (cachedPreviewSecret) {
        return cachedPreviewSecret;
    }

    const configured = process.env.PREVIEW_TOKEN_SECRET?.trim();
    if (configured) {
        cachedPreviewSecret = configured;
        return configured;
    }

    if (process.env.NODE_ENV === 'production') {
        throw new Error('PREVIEW_TOKEN_SECRET must be configured in production.');
    }

    cachedPreviewSecret = crypto.randomBytes(32).toString('hex');
    console.warn(`[WARNING] PREVIEW_TOKEN_SECRET is not set. Generated ephemeral random secret for development: ${cachedPreviewSecret}`);
    return cachedPreviewSecret;
}

function getPreviewTokenTtlSeconds(): number {
    const parsed = Number.parseInt(process.env.PREVIEW_TOKEN_TTL_SECONDS ?? '900', 10);
    if (!Number.isFinite(parsed)) {
        return 900;
    }

    return Math.max(60, Math.min(parsed, 60 * 60));
}

function encodePayload(payload: PreviewTokenPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodePayload(rawPayload: string): PreviewTokenPayload | null {
    try {
        const decoded = JSON.parse(Buffer.from(rawPayload, 'base64url').toString('utf8')) as Partial<PreviewTokenPayload>;

        if (
            decoded.version !== 1
            || decoded.mode !== 'content-preview'
            || typeof decoded.domainId !== 'number'
            || !Number.isInteger(decoded.domainId)
            || decoded.domainId <= 0
            || typeof decoded.draft !== 'boolean'
            || typeof decoded.expiresAt !== 'number'
        ) {
            return null;
        }

        if (decoded.kind === 'content_item') {
            if (
                typeof decoded.contentItemId !== 'number'
                || !Number.isInteger(decoded.contentItemId)
                || decoded.contentItemId <= 0
            ) {
                return null;
            }

            return decoded as PreviewTokenPayload;
        }

        if (decoded.kind === 'global') {
            if (typeof decoded.slug !== 'string' || decoded.slug.trim().length === 0) {
                return null;
            }

            return {
                version: 1,
                mode: 'content-preview',
                domainId: decoded.domainId,
                draft: decoded.draft,
                locale: decoded.locale,
                fallbackLocale: decoded.fallbackLocale,
                expiresAt: decoded.expiresAt,
                kind: 'global',
                slug: decoded.slug.trim()
            };
        }

        return null;
    } catch {
        return null;
    }
}

function signPayload(payload: string): string {
    return crypto.createHmac('sha256', getPreviewSigningSecret()).update(payload).digest('base64url');
}

export function issuePreviewToken(input: IssuePreviewTokenInput): IssuedPreviewToken {
    const ttlSeconds = Math.max(60, Math.min(Math.trunc(input.ttlSeconds ?? getPreviewTokenTtlSeconds()), 60 * 60));
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const payload = encodePayload({
        version: 1,
        mode: 'content-preview',
        domainId: input.domainId,
        draft: input.draft !== false,
        locale: input.locale,
        fallbackLocale: input.fallbackLocale,
        expiresAt: expiresAt.getTime(),
        ...(input.kind === 'content_item'
            ? {
                kind: 'content_item' as const,
                contentItemId: input.contentItemId
            }
            : {
                kind: 'global' as const,
                slug: input.slug
            })
    });

    return {
        token: `${payload}.${signPayload(payload)}`,
        expiresAt,
        ttlSeconds,
        domainId: input.domainId,
        draft: input.draft !== false,
        locale: input.locale,
        fallbackLocale: input.fallbackLocale,
        ...(input.kind === 'content_item'
            ? {
                kind: 'content_item' as const,
                contentItemId: input.contentItemId
            }
            : {
                kind: 'global' as const,
                slug: input.slug
            })
    };
}

export function verifyPreviewToken(token: string): VerifiedPreviewToken {
    const [payload, signature, ...rest] = token.split('.');
    if (!payload || !signature || rest.length > 0) {
        return {
            ok: false,
            code: 'INVALID_PREVIEW_TOKEN',
            remediation: 'Provide a valid preview token issued by a preview-token endpoint.'
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
            code: 'INVALID_PREVIEW_TOKEN',
            remediation: 'Provide a valid preview token issued by a preview-token endpoint.'
        };
    }

    const decoded = decodePayload(payload);
    if (!decoded) {
        return {
            ok: false,
            code: 'INVALID_PREVIEW_TOKEN',
            remediation: 'Provide a valid preview token issued by a preview-token endpoint.'
        };
    }

    const expiresAt = new Date(decoded.expiresAt);
    if (expiresAt.getTime() <= Date.now()) {
        return {
            ok: false,
            code: 'PREVIEW_TOKEN_EXPIRED',
            remediation: 'Issue a new preview token and retry before it expires.'
        };
    }

    return {
        ok: true,
        domainId: decoded.domainId,
        draft: decoded.draft,
        locale: decoded.locale,
        fallbackLocale: decoded.fallbackLocale,
        expiresAt,
        ...(decoded.kind === 'content_item'
            ? {
                kind: 'content_item' as const,
                contentItemId: decoded.contentItemId
            }
            : {
                kind: 'global' as const,
                slug: decoded.slug
            })
    };
}
