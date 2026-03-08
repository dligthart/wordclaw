import { describe, expect, it } from 'vitest';

import { parseSupervisorDomainHeader } from './domain-context.js';

describe('parseSupervisorDomainHeader', () => {
    it('returns a valid domain id for a positive integer header', () => {
        expect(parseSupervisorDomainHeader({
            'x-wordclaw-domain': '7'
        })).toEqual({
            ok: true,
            domainId: 7
        });
    });

    it('returns a structured error when the header is missing', () => {
        expect(parseSupervisorDomainHeader({})).toEqual({
            ok: false,
            statusCode: 400,
            payload: {
                error: 'Invalid domain context',
                code: 'INVALID_DOMAIN_CONTEXT',
                remediation: 'Provide x-wordclaw-domain header with a positive integer domain ID.'
            }
        });
    });

    it('returns a structured error when the header is invalid', () => {
        expect(parseSupervisorDomainHeader({
            'x-wordclaw-domain': 'zero'
        })).toEqual({
            ok: false,
            statusCode: 400,
            payload: {
                error: 'Invalid domain context',
                code: 'INVALID_DOMAIN_CONTEXT',
                remediation: 'Provide x-wordclaw-domain header with a positive integer domain ID.'
            }
        });
    });
});
