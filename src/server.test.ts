import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { buildServer } from './server.js';

const originalNodeEnv = process.env.NODE_ENV;
const originalJwtSecret = process.env.JWT_SECRET;
const originalCookieSecret = process.env.COOKIE_SECRET;
const originalL402Secret = process.env.L402_SECRET;
const originalPaymentProvider = process.env.PAYMENT_PROVIDER;
const originalLnbitsBaseUrl = process.env.LNBITS_BASE_URL;
const originalLnbitsAdminKey = process.env.LNBITS_ADMIN_KEY;
const originalCorsAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS;
const originalRateLimitMax = process.env.RATE_LIMIT_MAX;
const originalSupervisorRateLimitMax = process.env.SUPERVISOR_RATE_LIMIT_MAX;
const originalRateLimitTimeWindow = process.env.RATE_LIMIT_TIME_WINDOW;

function restoreEnv() {
    if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
    } else {
        process.env.NODE_ENV = originalNodeEnv;
    }

    if (originalJwtSecret === undefined) {
        delete process.env.JWT_SECRET;
    } else {
        process.env.JWT_SECRET = originalJwtSecret;
    }

    if (originalCookieSecret === undefined) {
        delete process.env.COOKIE_SECRET;
    } else {
        process.env.COOKIE_SECRET = originalCookieSecret;
    }

    if (originalL402Secret === undefined) {
        delete process.env.L402_SECRET;
    } else {
        process.env.L402_SECRET = originalL402Secret;
    }

    if (originalPaymentProvider === undefined) {
        delete process.env.PAYMENT_PROVIDER;
    } else {
        process.env.PAYMENT_PROVIDER = originalPaymentProvider;
    }

    if (originalLnbitsBaseUrl === undefined) {
        delete process.env.LNBITS_BASE_URL;
    } else {
        process.env.LNBITS_BASE_URL = originalLnbitsBaseUrl;
    }

    if (originalLnbitsAdminKey === undefined) {
        delete process.env.LNBITS_ADMIN_KEY;
    } else {
        process.env.LNBITS_ADMIN_KEY = originalLnbitsAdminKey;
    }

    if (originalCorsAllowedOrigins === undefined) {
        delete process.env.CORS_ALLOWED_ORIGINS;
    } else {
        process.env.CORS_ALLOWED_ORIGINS = originalCorsAllowedOrigins;
    }

    if (originalRateLimitMax === undefined) {
        delete process.env.RATE_LIMIT_MAX;
    } else {
        process.env.RATE_LIMIT_MAX = originalRateLimitMax;
    }

    if (originalSupervisorRateLimitMax === undefined) {
        delete process.env.SUPERVISOR_RATE_LIMIT_MAX;
    } else {
        process.env.SUPERVISOR_RATE_LIMIT_MAX = originalSupervisorRateLimitMax;
    }

    if (originalRateLimitTimeWindow === undefined) {
        delete process.env.RATE_LIMIT_TIME_WINDOW;
    } else {
        process.env.RATE_LIMIT_TIME_WINDOW = originalRateLimitTimeWindow;
    }
}

describe('buildServer', () => {
    afterEach(() => {
        restoreEnv();
    });

    it('fails with aggregated production environment validation errors', async () => {
        process.env.NODE_ENV = 'production';
        delete process.env.JWT_SECRET;
        delete process.env.COOKIE_SECRET;
        delete process.env.L402_SECRET;
        delete process.env.PAYMENT_PROVIDER;
        delete process.env.LNBITS_BASE_URL;
        delete process.env.LNBITS_ADMIN_KEY;

        await expect(buildServer()).rejects.toThrowError(
            /JWT_SECRET[\s\S]*COOKIE_SECRET/
        );
    });

    it('adds baseline security headers and disables wildcard CORS by default', async () => {
        process.env.NODE_ENV = 'development';
        delete process.env.CORS_ALLOWED_ORIGINS;

        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/capabilities',
                headers: {
                    origin: 'https://evil.example'
                }
            });

            expect(response.statusCode).toBe(200);
            expect(response.headers['x-content-type-options']).toBe('nosniff');
            expect(response.headers['x-frame-options']).toBe('DENY');
            expect(response.headers['referrer-policy']).toBe('no-referrer');
            expect(response.headers['x-xss-protection']).toBe('0');
            expect(response.headers['access-control-allow-origin']).toBeUndefined();
            expect(response.headers['strict-transport-security']).toBeUndefined();
        } finally {
            await app.close();
        }
    });

    it('allows configured CORS origins and sets hsts in production', async () => {
        process.env.NODE_ENV = 'production';
        process.env.JWT_SECRET = 'jwt-secret-for-tests';
        process.env.COOKIE_SECRET = 'cookie-secret-for-tests';
        process.env.CORS_ALLOWED_ORIGINS = 'https://kb.lightheart.tech';
        delete process.env.L402_SECRET;
        delete process.env.PAYMENT_PROVIDER;
        delete process.env.LNBITS_BASE_URL;
        delete process.env.LNBITS_ADMIN_KEY;

        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/capabilities',
                headers: {
                    origin: 'https://kb.lightheart.tech'
                }
            });

            expect(response.statusCode).toBe(200);
            expect(response.headers['access-control-allow-origin']).toBe('https://kb.lightheart.tech');
            expect(response.headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains; preload');
        } finally {
            await app.close();
        }
    });

    it('isolates rate-limit buckets per api credential', async () => {
        process.env.NODE_ENV = 'development';
        process.env.RATE_LIMIT_MAX = '2';
        process.env.SUPERVISOR_RATE_LIMIT_MAX = '4';
        process.env.RATE_LIMIT_TIME_WINDOW = '1 minute';

        const app = await buildServer();

        try {
            const first = await app.inject({
                method: 'GET',
                url: '/api/capabilities',
                headers: {
                    'x-api-key': 'writer-a',
                }
            });
            const second = await app.inject({
                method: 'GET',
                url: '/api/capabilities',
                headers: {
                    'x-api-key': 'writer-a',
                }
            });
            const blocked = await app.inject({
                method: 'GET',
                url: '/api/capabilities',
                headers: {
                    'x-api-key': 'writer-a',
                }
            });
            const separateBucket = await app.inject({
                method: 'GET',
                url: '/api/capabilities',
                headers: {
                    'x-api-key': 'writer-b',
                }
            });

            expect(first.statusCode).toBe(200);
            expect(second.statusCode).toBe(200);
            expect(blocked.statusCode).toBe(429);
            expect(separateBucket.statusCode).toBe(200);
        } finally {
            await app.close();
        }
    });

    it('applies the higher supervisor-session limit to supervisor buckets', async () => {
        process.env.NODE_ENV = 'development';
        process.env.RATE_LIMIT_MAX = '2';
        process.env.SUPERVISOR_RATE_LIMIT_MAX = '4';
        process.env.RATE_LIMIT_TIME_WINDOW = '1 minute';

        const app = await buildServer();

        try {
            const requests = [];

            requests.push(await app.inject({
                method: 'GET',
                url: '/api/capabilities',
                headers: {
                    cookie: 'supervisor_session=tenant-1-session'
                }
            }));
            requests.push(await app.inject({
                method: 'GET',
                url: '/api/capabilities',
                headers: {
                    cookie: 'supervisor_session=tenant-1-session'
                }
            }));
            requests.push(await app.inject({
                method: 'GET',
                url: '/api/capabilities',
                headers: {
                    cookie: 'supervisor_session=tenant-1-session'
                }
            }));
            requests.push(await app.inject({
                method: 'GET',
                url: '/api/capabilities',
                headers: {
                    cookie: 'supervisor_session=tenant-1-session'
                }
            }));
            requests.push(await app.inject({
                method: 'GET',
                url: '/api/capabilities',
                headers: {
                    cookie: 'supervisor_session=tenant-1-session'
                }
            }));

            expect(requests.slice(0, 4).every((response) => response.statusCode === 200)).toBe(true);
            expect(requests[4].statusCode).toBe(429);
        } finally {
            await app.close();
        }
    });

    it('serves built supervisor assets instead of falling back to index.html', async () => {
        process.env.NODE_ENV = 'development';

        const assetDir = path.join(process.cwd(), 'ui/build/_app/test-assets');
        const assetPath = path.join(assetDir, 'server-test.js');
        fs.mkdirSync(assetDir, { recursive: true });
        fs.writeFileSync(assetPath, 'console.log("server test asset");\n', 'utf8');

        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/ui/_app/test-assets/server-test.js',
            });

            expect(response.statusCode).toBe(200);
            expect(response.headers['content-type']).toContain('application/javascript');
            expect(response.body).toContain('server test asset');
        } finally {
            await app.close();
            fs.rmSync(assetPath, { force: true });
        }
    });

    it('falls back to index.html for supervisor app routes', async () => {
        process.env.NODE_ENV = 'development';

        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/ui/approvals',
            });

            expect(response.statusCode).toBe(200);
            expect(response.headers['content-type']).toContain('text/html');
            expect(response.body).toContain('<!doctype html>');
        } finally {
            await app.close();
        }
    });
});
