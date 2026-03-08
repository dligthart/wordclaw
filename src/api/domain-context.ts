import { IncomingHttpHeaders } from 'node:http';

export type DomainContextPayload = {
    error: string;
    code: string;
    remediation: string;
};

type DomainContextResult =
    | { ok: true; domainId: number }
    | { ok: false; statusCode: 400; payload: DomainContextPayload };

export function parseSupervisorDomainHeader(headers: IncomingHttpHeaders): DomainContextResult {
    const rawHeader = headers['x-wordclaw-domain'];
    const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const domainId = Number.parseInt(headerValue ?? '', 10);

    if (!Number.isInteger(domainId) || domainId <= 0) {
        return {
            ok: false,
            statusCode: 400,
            payload: {
                error: 'Invalid domain context',
                code: 'INVALID_DOMAIN_CONTEXT',
                remediation: 'Provide x-wordclaw-domain header with a positive integer domain ID.'
            }
        };
    }

    return {
        ok: true,
        domainId
    };
}
