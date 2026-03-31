import { IncomingHttpHeaders } from 'node:http';

export type DomainContextPayload = {
    error: string;
    code: string;
    remediation: string;
};

type OptionalDomainContextResult =
    | { ok: true; provided: boolean; domainId: number | null }
    | { ok: false; statusCode: 400; payload: DomainContextPayload };

type DomainContextResult =
    | { ok: true; domainId: number }
    | { ok: false; statusCode: 400; payload: DomainContextPayload };

function invalidDomainContextPayload(): DomainContextPayload {
    return {
        error: 'Invalid domain context',
        code: 'INVALID_DOMAIN_CONTEXT',
        remediation: 'Provide x-wordclaw-domain header with a positive integer domain ID.'
    };
}

export function parseOptionalSupervisorDomainHeader(headers: IncomingHttpHeaders): OptionalDomainContextResult {
    const rawHeader = headers['x-wordclaw-domain'];
    const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (typeof headerValue !== 'string' || headerValue.trim().length === 0) {
        return {
            ok: true,
            provided: false,
            domainId: null,
        };
    }

    const domainId = Number.parseInt(headerValue ?? '', 10);

    if (!Number.isInteger(domainId) || domainId <= 0) {
        return {
            ok: false,
            statusCode: 400,
            payload: invalidDomainContextPayload()
        };
    }

    return {
        ok: true,
        provided: true,
        domainId
    };
}

export function parseSupervisorDomainHeader(headers: IncomingHttpHeaders): DomainContextResult {
    const parsed = parseOptionalSupervisorDomainHeader(headers);
    if (!parsed.ok) {
        return parsed;
    }

    if (!parsed.provided || parsed.domainId === null) {
        return {
            ok: false,
            statusCode: 400,
            payload: invalidDomainContextPayload()
        };
    }

    return {
        ok: true,
        domainId: parsed.domainId
    };
}

export function supervisorDomainScopeMismatch(expectedDomainId: number) {
    return {
        ok: false as const,
        statusCode: 403 as const,
        payload: {
            error: 'Supervisor domain scope mismatch',
            code: 'SUPERVISOR_DOMAIN_SCOPE_MISMATCH',
            remediation: `Use x-wordclaw-domain: ${expectedDomainId} or sign in with a platform-scoped supervisor session.`
        }
    };
}
