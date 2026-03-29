import { afterEach, describe, expect, it, vi } from 'vitest';

import { issuePreviewToken, verifyPreviewToken } from './content-preview.js';

describe('content preview tokens', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('round-trips scoped content item preview tokens', () => {
        const issued = issuePreviewToken({
            domainId: 1,
            kind: 'content_item',
            contentItemId: 42,
            draft: false,
            locale: 'nl',
            fallbackLocale: 'en',
            ttlSeconds: 120
        });

        expect(verifyPreviewToken(issued.token)).toMatchObject({
            ok: true,
            kind: 'content_item',
            contentItemId: 42,
            domainId: 1,
            draft: false,
            locale: 'nl',
            fallbackLocale: 'en'
        });
    });

    it('expires preview tokens after their TTL', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-29T12:00:00.000Z'));

        const issued = issuePreviewToken({
            domainId: 1,
            kind: 'global',
            slug: 'site-settings',
            ttlSeconds: 60
        });

        vi.setSystemTime(new Date('2026-03-29T12:01:01.000Z'));

        expect(verifyPreviewToken(issued.token)).toMatchObject({
            ok: false,
            code: 'PREVIEW_TOKEN_EXPIRED'
        });
    });
});
