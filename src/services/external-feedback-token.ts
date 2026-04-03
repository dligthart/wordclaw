import crypto from 'node:crypto';

type ExternalFeedbackTokenPayload = {
    version: 1;
    mode: 'content-external-feedback';
    domainId: number;
    contentItemId: number;
    actorId: string;
    actorType: 'external_requester';
    actorSource: string;
    actorDisplayName?: string;
    actorEmail?: string;
    allowAgentDirect: boolean;
    workflowTransitionId?: number;
    expiresAt: number;
};

export type IssueExternalFeedbackTokenInput = {
    domainId: number;
    contentItemId: number;
    actorId: string;
    actorType?: 'external_requester';
    actorSource: string;
    actorDisplayName?: string;
    actorEmail?: string;
    allowAgentDirect?: boolean;
    workflowTransitionId?: number;
    ttlSeconds?: number;
};

export type IssuedExternalFeedbackToken = {
    token: string;
    expiresAt: Date;
    ttlSeconds: number;
    domainId: number;
    contentItemId: number;
    actorId: string;
    actorType: 'external_requester';
    actorSource: string;
    actorDisplayName?: string;
    actorEmail?: string;
    allowAgentDirect: boolean;
    workflowTransitionId?: number;
};

export type VerifiedExternalFeedbackToken =
    | {
        ok: true;
        domainId: number;
        contentItemId: number;
        actorId: string;
        actorType: 'external_requester';
        actorSource: string;
        actorDisplayName?: string;
        actorEmail?: string;
        allowAgentDirect: boolean;
        workflowTransitionId?: number;
        expiresAt: Date;
    }
    | {
        ok: false;
        code: 'INVALID_EXTERNAL_FEEDBACK_TOKEN' | 'EXTERNAL_FEEDBACK_TOKEN_EXPIRED';
        remediation: string;
    };

let cachedExternalFeedbackSecret: string | null = null;

function getExternalFeedbackSigningSecret(): string {
    if (cachedExternalFeedbackSecret) {
        return cachedExternalFeedbackSecret;
    }

    const configured = process.env.EXTERNAL_FEEDBACK_TOKEN_SECRET?.trim();
    if (configured) {
        cachedExternalFeedbackSecret = configured;
        return configured;
    }

    if (process.env.NODE_ENV === 'production') {
        throw new Error('EXTERNAL_FEEDBACK_TOKEN_SECRET must be configured in production.');
    }

    cachedExternalFeedbackSecret = crypto.randomBytes(32).toString('hex');
    console.warn(`[WARNING] EXTERNAL_FEEDBACK_TOKEN_SECRET is not set. Generated ephemeral random secret for development: ${cachedExternalFeedbackSecret}`);
    return cachedExternalFeedbackSecret;
}

function getExternalFeedbackTokenTtlSeconds(): number {
    const parsed = Number.parseInt(process.env.EXTERNAL_FEEDBACK_TOKEN_TTL_SECONDS ?? `${7 * 24 * 60 * 60}`, 10);
    if (!Number.isFinite(parsed)) {
        return 7 * 24 * 60 * 60;
    }

    return Math.max(60, Math.min(parsed, 30 * 24 * 60 * 60));
}

function encodePayload(payload: ExternalFeedbackTokenPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodePayload(payload: string): ExternalFeedbackTokenPayload | null {
    try {
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<ExternalFeedbackTokenPayload>;
        if (
            decoded.version !== 1
            || decoded.mode !== 'content-external-feedback'
            || typeof decoded.domainId !== 'number'
            || !Number.isInteger(decoded.domainId)
            || decoded.domainId <= 0
            || typeof decoded.contentItemId !== 'number'
            || !Number.isInteger(decoded.contentItemId)
            || decoded.contentItemId <= 0
            || typeof decoded.actorId !== 'string'
            || decoded.actorId.trim().length === 0
            || decoded.actorType !== 'external_requester'
            || typeof decoded.actorSource !== 'string'
            || decoded.actorSource.trim().length === 0
            || typeof decoded.allowAgentDirect !== 'boolean'
            || typeof decoded.expiresAt !== 'number'
        ) {
            return null;
        }

        if (
            decoded.workflowTransitionId !== undefined
            && (
                typeof decoded.workflowTransitionId !== 'number'
                || !Number.isInteger(decoded.workflowTransitionId)
                || decoded.workflowTransitionId <= 0
            )
        ) {
            return null;
        }

        return {
            version: 1,
            mode: 'content-external-feedback',
            domainId: decoded.domainId,
            contentItemId: decoded.contentItemId,
            actorId: decoded.actorId.trim(),
            actorType: 'external_requester',
            actorSource: decoded.actorSource.trim(),
            actorDisplayName: typeof decoded.actorDisplayName === 'string' ? decoded.actorDisplayName.trim() || undefined : undefined,
            actorEmail: typeof decoded.actorEmail === 'string' ? decoded.actorEmail.trim() || undefined : undefined,
            allowAgentDirect: decoded.allowAgentDirect,
            workflowTransitionId: decoded.workflowTransitionId,
            expiresAt: decoded.expiresAt,
        };
    } catch {
        return null;
    }
}

function signPayload(payload: string): string {
    return crypto.createHmac('sha256', getExternalFeedbackSigningSecret()).update(payload).digest('base64url');
}

export function issueExternalFeedbackToken(input: IssueExternalFeedbackTokenInput): IssuedExternalFeedbackToken {
    const ttlSeconds = Math.max(60, Math.min(Math.trunc(input.ttlSeconds ?? getExternalFeedbackTokenTtlSeconds()), 30 * 24 * 60 * 60));
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const payload = encodePayload({
        version: 1,
        mode: 'content-external-feedback',
        domainId: input.domainId,
        contentItemId: input.contentItemId,
        actorId: input.actorId.trim(),
        actorType: 'external_requester',
        actorSource: input.actorSource.trim(),
        actorDisplayName: input.actorDisplayName?.trim() || undefined,
        actorEmail: input.actorEmail?.trim() || undefined,
        allowAgentDirect: input.allowAgentDirect !== false,
        workflowTransitionId: input.workflowTransitionId,
        expiresAt: expiresAt.getTime(),
    });

    return {
        token: `${payload}.${signPayload(payload)}`,
        expiresAt,
        ttlSeconds,
        domainId: input.domainId,
        contentItemId: input.contentItemId,
        actorId: input.actorId.trim(),
        actorType: 'external_requester',
        actorSource: input.actorSource.trim(),
        actorDisplayName: input.actorDisplayName?.trim() || undefined,
        actorEmail: input.actorEmail?.trim() || undefined,
        allowAgentDirect: input.allowAgentDirect !== false,
        workflowTransitionId: input.workflowTransitionId,
    };
}

export function verifyExternalFeedbackToken(token: string): VerifiedExternalFeedbackToken {
    const [payload, signature, ...rest] = token.split('.');
    if (!payload || !signature || rest.length > 0) {
        return {
            ok: false,
            code: 'INVALID_EXTERNAL_FEEDBACK_TOKEN',
            remediation: 'Provide a valid external feedback token issued by POST /api/content-items/:id/external-feedback-token.'
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
            code: 'INVALID_EXTERNAL_FEEDBACK_TOKEN',
            remediation: 'Provide a valid external feedback token issued by POST /api/content-items/:id/external-feedback-token.'
        };
    }

    const decoded = decodePayload(payload);
    if (!decoded) {
        return {
            ok: false,
            code: 'INVALID_EXTERNAL_FEEDBACK_TOKEN',
            remediation: 'Provide a valid external feedback token issued by POST /api/content-items/:id/external-feedback-token.'
        };
    }

    const expiresAt = new Date(decoded.expiresAt);
    if (expiresAt.getTime() <= Date.now()) {
        return {
            ok: false,
            code: 'EXTERNAL_FEEDBACK_TOKEN_EXPIRED',
            remediation: 'Issue a new external feedback token and retry before it expires.'
        };
    }

    return {
        ok: true,
        domainId: decoded.domainId,
        contentItemId: decoded.contentItemId,
        actorId: decoded.actorId,
        actorType: decoded.actorType,
        actorSource: decoded.actorSource,
        actorDisplayName: decoded.actorDisplayName,
        actorEmail: decoded.actorEmail,
        allowAgentDirect: decoded.allowAgentDirect,
        workflowTransitionId: decoded.workflowTransitionId,
        expiresAt,
    };
}
