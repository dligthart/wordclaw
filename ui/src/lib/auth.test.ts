import { describe, it, expect, vi, beforeEach } from 'vitest';
import { auth, checkAuth, logout } from './auth.svelte';
import * as api from './api';

// Mock the API module
vi.mock('./api', () => ({
    fetchApi: vi.fn()
}));

describe('Auth State Management', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubGlobal('localStorage', {
            setItem: vi.fn(),
        });
        // Reset auth state before each test
        auth.user = null;
        auth.loading = true;
        auth.error = null;
    });

    it('initial state is correct', () => {
        expect(auth.user).toBeNull();
        expect(auth.loading).toBe(true);
        expect(auth.error).toBeNull();
    });

    it('checkAuth sets user on success', async () => {
        const mockUser = { id: 1, email: 'admin@wordclaw.com', domainId: 7, scope: 'tenant' as const };
        vi.mocked(api.fetchApi).mockResolvedValueOnce(mockUser);

        await checkAuth();

        expect(api.fetchApi).toHaveBeenCalledWith('/supervisors/me');
        expect(auth.user).toEqual(mockUser);
        expect(localStorage.setItem).toHaveBeenCalledWith('__wc_domain_id', '7');
        expect(auth.loading).toBe(false);
        expect(auth.error).toBeNull();
    });

    it('checkAuth clears user on failure', async () => {
        vi.mocked(api.fetchApi).mockRejectedValueOnce(new Error('Unauthorized'));

        // Pre-set a user to ensure it gets cleared
        auth.user = { id: 1, email: 'admin@wordclaw.com' };

        await checkAuth();

        expect(api.fetchApi).toHaveBeenCalledWith('/supervisors/me');
        expect(auth.user).toBeNull();
        expect(auth.loading).toBe(false);
    });

    it('logout calls API and clears user', async () => {
        vi.mocked(api.fetchApi).mockResolvedValueOnce({ success: true });
        auth.user = { id: 1, email: 'admin@wordclaw.com' };

        await logout();

        expect(api.fetchApi).toHaveBeenCalledWith('/supervisors/logout', { method: 'POST' });
        expect(auth.user).toBeNull();
    });

    it('logout clears user even if API fails', async () => {
        vi.mocked(api.fetchApi).mockRejectedValueOnce(new Error('Network error'));
        auth.user = { id: 1, email: 'admin@wordclaw.com' };

        await expect(logout()).rejects.toThrow('Network error');

        expect(api.fetchApi).toHaveBeenCalledWith('/supervisors/logout', { method: 'POST' });
        expect(auth.user).toBeNull(); // Should still be null due to finally block
    });
});
