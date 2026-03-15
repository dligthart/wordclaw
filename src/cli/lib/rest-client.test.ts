import { afterEach, describe, expect, it, vi } from 'vitest';

import { RestCliClient, resolveApiUrl } from './rest-client.js';

afterEach(() => {
    vi.restoreAllMocks();
});

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

    it('rejects explicit domain overrides for API-key flows', () => {
        expect(() => new RestCliClient({
            domainId: 7
        })).toThrow('WORDCLAW_DOMAIN_ID and --domain-id are not supported');
    });

    it('passes multipart form data bodies through without forcing JSON headers', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
            JSON.stringify({ data: { id: 1 } }),
            {
                status: 201,
                headers: {
                    'content-type': 'application/json'
                }
            }
        ));
        const client = new RestCliClient({
            baseUrl: 'http://localhost:4000',
            apiKey: 'writer'
        });
        const form = new FormData();
        form.append('filename', 'hero.png');
        form.append('file', new Blob(['image-bytes'], { type: 'image/png' }), 'hero.png');

        await client.request({
            method: 'POST',
            path: '/assets',
            body: form,
            acceptStatuses: [201]
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, init] = fetchMock.mock.calls[0] ?? [];
        expect(init?.headers).toEqual(expect.objectContaining({
            accept: 'application/json',
            'x-api-key': 'writer'
        }));
        expect((init?.headers as Record<string, string>)['content-type']).toBeUndefined();
        expect(init?.body).toBe(form);
    });
});
