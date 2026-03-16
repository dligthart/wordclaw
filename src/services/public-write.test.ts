import { afterEach, describe, expect, it } from 'vitest';

import { issuePublicWriteToken, verifyPublicWriteToken } from './public-write.js';

const originalPublicWriteSecret = process.env.PUBLIC_WRITE_SECRET;
const originalPublicWriteTtl = process.env.PUBLIC_WRITE_TTL_SECONDS;

function restoreEnv() {
    if (originalPublicWriteSecret === undefined) {
        delete process.env.PUBLIC_WRITE_SECRET;
    } else {
        process.env.PUBLIC_WRITE_SECRET = originalPublicWriteSecret;
    }

    if (originalPublicWriteTtl === undefined) {
        delete process.env.PUBLIC_WRITE_TTL_SECONDS;
    } else {
        process.env.PUBLIC_WRITE_TTL_SECONDS = originalPublicWriteTtl;
    }
}

describe('public write tokens', () => {
    afterEach(() => {
        restoreEnv();
    });

    it('issues and verifies a content public-write token', () => {
        process.env.PUBLIC_WRITE_SECRET = 'public-write-secret';
        process.env.PUBLIC_WRITE_TTL_SECONDS = '300';

        const issued = issuePublicWriteToken({
            domainId: 7,
            contentTypeId: 12,
            subjectField: 'sessionId',
            subject: 'session-123',
            allowedOperations: ['create', 'update'],
            requiredStatus: 'draft'
        });

        const verified = verifyPublicWriteToken(issued.token, 'update');
        expect(verified).toEqual(expect.objectContaining({
            ok: true,
            domainId: 7,
            contentTypeId: 12,
            subjectField: 'sessionId',
            subject: 'session-123',
            requiredStatus: 'draft',
            allowedOperations: ['create', 'update']
        }));
    });

    it('rejects a token when the requested operation is not allowed', () => {
        process.env.PUBLIC_WRITE_SECRET = 'public-write-secret';

        const issued = issuePublicWriteToken({
            domainId: 7,
            contentTypeId: 12,
            subjectField: 'sessionId',
            subject: 'session-123',
            allowedOperations: ['create'],
            requiredStatus: 'draft'
        });

        expect(verifyPublicWriteToken(issued.token, 'update')).toEqual({
            ok: false,
            code: 'PUBLIC_WRITE_OPERATION_FORBIDDEN',
            remediation: 'Issue a token that allows update or choose an allowed public write operation.'
        });
    });

    it('rejects malformed public write tokens', () => {
        process.env.PUBLIC_WRITE_SECRET = 'public-write-secret';

        expect(verifyPublicWriteToken('not-a-token', 'create')).toEqual({
            ok: false,
            code: 'INVALID_PUBLIC_WRITE_TOKEN',
            remediation: 'Provide a valid public write token issued by POST /api/content-types/:id/public-write-tokens.'
        });
    });
});
