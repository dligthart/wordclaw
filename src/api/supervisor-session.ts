import type { IncomingHttpHeaders } from 'node:http';

import { buildSupervisorPrincipal, type ActorPrincipal } from '../services/actor-identity.js';
import {
    parseOptionalSupervisorDomainHeader,
    parseSupervisorDomainHeader,
    supervisorDomainScopeMismatch,
    type DomainContextPayload,
} from './domain-context.js';

export type SupervisorSessionClaims = {
    sub: number;
    role?: string;
    email?: string;
    domainId?: unknown;
};

type SupervisorSessionResolutionResult =
    | {
        ok: true;
        principal: ActorPrincipal;
        boundDomainId: number | null;
    }
    | {
        ok: false;
        statusCode: 400 | 403;
        payload: DomainContextPayload;
    };

function normalizeBoundDomainId(raw: unknown): number | null {
    const domainId = Number(raw);
    return Number.isInteger(domainId) && domainId > 0
        ? domainId
        : null;
}

export function isPlatformSupervisorSession(claims: SupervisorSessionClaims | null | undefined): boolean {
    return normalizeBoundDomainId(claims?.domainId) === null;
}

export function resolveSupervisorSessionPrincipal(
    claims: SupervisorSessionClaims,
    headers: IncomingHttpHeaders
): SupervisorSessionResolutionResult {
    const boundDomainId = normalizeBoundDomainId(claims.domainId);

    if (boundDomainId !== null) {
        const requestedDomain = parseOptionalSupervisorDomainHeader(headers);
        if (!requestedDomain.ok) {
            return requestedDomain;
        }

        if (requestedDomain.provided && requestedDomain.domainId !== boundDomainId) {
            return supervisorDomainScopeMismatch(boundDomainId);
        }

        return {
            ok: true,
            boundDomainId,
            principal: buildSupervisorPrincipal(claims.sub, boundDomainId, { platformAdmin: false })
        };
    }

    const requestedDomain = parseSupervisorDomainHeader(headers);
    if (!requestedDomain.ok) {
        return requestedDomain;
    }

    return {
        ok: true,
        boundDomainId: null,
        principal: buildSupervisorPrincipal(claims.sub, requestedDomain.domainId, { platformAdmin: true })
    };
}
