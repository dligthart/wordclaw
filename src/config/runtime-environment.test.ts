import { afterEach, describe, expect, it } from 'vitest';

import {
    assertValidRuntimeEnvironment,
    collectRuntimeEnvironmentIssues,
} from './runtime-environment.js';

const originalNodeEnv = process.env.NODE_ENV;
const originalJwtSecret = process.env.JWT_SECRET;
const originalCookieSecret = process.env.COOKIE_SECRET;
const originalL402Secret = process.env.L402_SECRET;
const originalPaymentProvider = process.env.PAYMENT_PROVIDER;
const originalLnbitsBaseUrl = process.env.LNBITS_BASE_URL;
const originalLnbitsAdminKey = process.env.LNBITS_ADMIN_KEY;
const originalAllowMockProviderInProduction = process.env.ALLOW_MOCK_PROVIDER_IN_PRODUCTION;

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

    if (originalAllowMockProviderInProduction === undefined) {
        delete process.env.ALLOW_MOCK_PROVIDER_IN_PRODUCTION;
    } else {
        process.env.ALLOW_MOCK_PROVIDER_IN_PRODUCTION = originalAllowMockProviderInProduction;
    }
}

describe('runtime environment validation', () => {
    afterEach(() => {
        restoreEnv();
    });

    it('reports all production blockers in one pass when production secrets are missing', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.JWT_SECRET;
        delete process.env.COOKIE_SECRET;
        delete process.env.L402_SECRET;
        delete process.env.PAYMENT_PROVIDER;
        delete process.env.LNBITS_BASE_URL;
        delete process.env.LNBITS_ADMIN_KEY;

        const issues = collectRuntimeEnvironmentIssues();

        expect(issues.map((issue) => issue.envVar)).toEqual([
            'JWT_SECRET',
            'COOKIE_SECRET',
        ]);

        expect(() => assertValidRuntimeEnvironment()).toThrowError(
            /JWT_SECRET[\s\S]*COOKIE_SECRET/
        );
    });

    it('requires an explicit mock override in production', () => {
        process.env.NODE_ENV = 'production';
        process.env.JWT_SECRET = 'jwt-secret';
        process.env.COOKIE_SECRET = 'cookie-secret';
        process.env.L402_SECRET = 'l402-secret';
        process.env.PAYMENT_PROVIDER = 'mock';
        delete process.env.ALLOW_MOCK_PROVIDER_IN_PRODUCTION;

        expect(collectRuntimeEnvironmentIssues()).toEqual([
            expect.objectContaining({
                envVar: 'ALLOW_MOCK_PROVIDER_IN_PRODUCTION',
            })
        ]);
    });

    it('allows a production deployment to start with payments disabled', () => {
        process.env.NODE_ENV = 'production';
        process.env.JWT_SECRET = 'jwt-secret';
        process.env.COOKIE_SECRET = 'cookie-secret';
        delete process.env.L402_SECRET;
        delete process.env.PAYMENT_PROVIDER;
        delete process.env.LNBITS_BASE_URL;
        delete process.env.LNBITS_ADMIN_KEY;

        expect(collectRuntimeEnvironmentIssues()).toEqual([]);
        expect(() => assertValidRuntimeEnvironment()).not.toThrow();
    });

    it('accepts a fully configured production environment', () => {
        process.env.NODE_ENV = 'production';
        process.env.JWT_SECRET = 'jwt-secret';
        process.env.COOKIE_SECRET = 'cookie-secret';
        process.env.L402_SECRET = 'l402-secret';
        process.env.PAYMENT_PROVIDER = 'lnbits';
        process.env.LNBITS_BASE_URL = 'https://lnbits.example.test';
        process.env.LNBITS_ADMIN_KEY = 'lnbits-admin-key';

        expect(collectRuntimeEnvironmentIssues()).toEqual([]);
        expect(() => assertValidRuntimeEnvironment()).not.toThrow();
    });
});
