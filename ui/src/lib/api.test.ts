import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchApi } from './api';

describe('fetchApi', () => {
    let storage = new Map<string, string>();

    beforeEach(() => {
        vi.restoreAllMocks();
        storage = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: vi.fn((key: string) => storage.get(key) ?? null),
            setItem: vi.fn((key: string, value: string) => {
                storage.set(key, value);
            }),
            removeItem: vi.fn((key: string) => {
                storage.delete(key);
            }),
            clear: vi.fn(() => {
                storage.clear();
            })
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('forwards the stored supervisor domain header', async () => {
        localStorage.setItem('__wc_domain_id', '7');
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        );
        vi.stubGlobal('fetch', fetchMock);

        await fetchApi('/domains');

        expect(fetchMock).toHaveBeenCalledWith('/api/domains', expect.objectContaining({
            credentials: 'include',
            headers: expect.objectContaining({
                Accept: 'application/json',
                'x-wordclaw-domain': '7'
            })
        }));
    });

    it('normalizes flat backend errors into ApiError instances', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(JSON.stringify({
                error: 'Invalid domain context',
                code: 'INVALID_DOMAIN_CONTEXT',
                remediation: 'Provide x-wordclaw-domain header with a positive integer domain ID.'
            }), {
                status: 400,
                headers: { 'content-type': 'application/json' }
            })
        ));

        await expect(fetchApi('/domains')).rejects.toEqual(expect.objectContaining({
            name: 'ApiError',
            message: 'Invalid domain context',
            code: 'INVALID_DOMAIN_CONTEXT',
            remediation: 'Provide x-wordclaw-domain header with a positive integer domain ID.'
        }));
    });
});
