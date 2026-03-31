import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from './server.js';

const originalNodeEnv = process.env.NODE_ENV;
const originalJwtSecret = process.env.JWT_SECRET;
const originalCookieSecret = process.env.COOKIE_SECRET;
const originalL402Secret = process.env.L402_SECRET;
const originalPaymentProvider = process.env.PAYMENT_PROVIDER;
const originalLnbitsBaseUrl = process.env.LNBITS_BASE_URL;
const originalLnbitsAdminKey = process.env.LNBITS_ADMIN_KEY;

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
});
