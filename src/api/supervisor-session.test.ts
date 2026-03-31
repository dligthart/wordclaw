import { describe, expect, it } from 'vitest';

import { resolveSupervisorSessionPrincipal } from './supervisor-session.js';

describe('resolveSupervisorSessionPrincipal', () => {
    it('treats legacy/global supervisor sessions as platform admins scoped by the requested domain', () => {
        const result = resolveSupervisorSessionPrincipal({
            sub: 7,
            role: 'supervisor',
        }, {
            'x-wordclaw-domain': '4'
        });

        expect(result).toEqual({
            ok: true,
            boundDomainId: null,
            principal: expect.objectContaining({
                actorId: 'supervisor:7',
                domainId: 4,
                scopes: new Set(['admin', 'tenant:admin']),
            }),
        });
    });

    it('defaults tenant-scoped supervisors to their bound domain when the header is omitted', () => {
        const result = resolveSupervisorSessionPrincipal({
            sub: 8,
            role: 'supervisor',
            domainId: 12,
        }, {});

        expect(result).toEqual({
            ok: true,
            boundDomainId: 12,
            principal: expect.objectContaining({
                actorId: 'supervisor:8',
                domainId: 12,
                scopes: new Set(['admin']),
            }),
        });
    });

    it('rejects tenant-scoped supervisors that request a different domain', () => {
        const result = resolveSupervisorSessionPrincipal({
            sub: 9,
            role: 'supervisor',
            domainId: 12,
        }, {
            'x-wordclaw-domain': '99'
        });

        expect(result).toEqual({
            ok: false,
            statusCode: 403,
            payload: {
                error: 'Supervisor domain scope mismatch',
                code: 'SUPERVISOR_DOMAIN_SCOPE_MISMATCH',
                remediation: 'Use x-wordclaw-domain: 12 or sign in with a platform-scoped supervisor session.'
            }
        });
    });
});
