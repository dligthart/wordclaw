import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from './server.js';

const originalNodeEnv = process.env.NODE_ENV;
const originalJwtSecret = process.env.JWT_SECRET;
const originalCookieSecret = process.env.COOKIE_SECRET;
const originalL402Secret = process.env.L402_SECRET;
const originalPaymentProvider = process.env.PAYMENT_PROVIDER;
const originalLnbitsBaseUrl = process.env.LNBITS_BASE_URL;
const originalLnbitsAdminKey = process.env.LNBITS_ADMIN_KEY;
const originalCorsAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS;

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
});
