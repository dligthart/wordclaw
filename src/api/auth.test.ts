import { afterEach, describe, expect, it } from 'vitest';

import { authenticateApiRequest, authorizeApiRequest } from './auth.js';

const originalAuthRequired = process.env.AUTH_REQUIRED;
const originalAllowInsecureLocalAdmin = process.env.ALLOW_INSECURE_LOCAL_ADMIN;
const originalNodeEnv = process.env.NODE_ENV;

function restoreEnv(name: string, value: string | undefined) {
    if (value === undefined) {
        delete process.env[name];
        return;
    }

    process.env[name] = value;
}

afterEach(() => {
    restoreEnv('AUTH_REQUIRED', originalAuthRequired);
    restoreEnv('ALLOW_INSECURE_LOCAL_ADMIN', originalAllowInsecureLocalAdmin);
    restoreEnv('NODE_ENV', originalNodeEnv);
});

describe('API auth guardrails', () => {
    it('fails closed when AUTH_REQUIRED is false but insecure local admin is not explicitly enabled', async () => {
        process.env.NODE_ENV = 'development';
        process.env.AUTH_REQUIRED = 'false';
        delete process.env.ALLOW_INSECURE_LOCAL_ADMIN;

        await expect(authenticateApiRequest({})).resolves.toMatchObject({
            ok: false,
            statusCode: 401,
            payload: {
                code: 'AUTH_MISSING_API_KEY'
            }
        });

        await expect(authorizeApiRequest('GET', '/api/content-types', {})).resolves.toMatchObject({
            ok: false,
            statusCode: 401,
            payload: {
                code: 'AUTH_MISSING_API_KEY'
            }
        });
    });

    it('allows anonymous local admin only when explicitly enabled outside production', async () => {
        process.env.NODE_ENV = 'development';
        process.env.AUTH_REQUIRED = 'false';
        process.env.ALLOW_INSECURE_LOCAL_ADMIN = 'true';

        await expect(authenticateApiRequest({})).resolves.toMatchObject({
            ok: true,
            principal: {
                actorRef: 'anonymous',
                domainId: 1,
                source: 'anonymous'
            }
        });

        await expect(authorizeApiRequest('POST', '/api/content-types', {})).resolves.toMatchObject({
            ok: true,
            principal: {
                actorRef: 'anonymous',
                domainId: 1,
                source: 'anonymous'
            }
        });
    });
});
