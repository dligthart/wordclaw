import { describe, expect, it } from 'vitest';

import { resolveApiUrl } from './rest-client.js';

describe('resolveApiUrl', () => {
    it('appends /api when base url is root', () => {
        expect(resolveApiUrl('http://localhost:4000', '/content-types')).toBe(
            'http://localhost:4000/api/content-types',
        );
    });

    it('does not duplicate /api when base url already includes it', () => {
        expect(resolveApiUrl('http://localhost:4000/api', '/content-types')).toBe(
            'http://localhost:4000/api/content-types',
        );
    });

    it('applies query parameters', () => {
        expect(
            resolveApiUrl('http://localhost:4000', '/content-items', {
                status: 'draft',
                limit: 5,
            }),
        ).toBe('http://localhost:4000/api/content-items?status=draft&limit=5');
    });
});
