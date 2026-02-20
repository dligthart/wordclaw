import { fetchApi } from './api';

export const auth = $state({
    user: null as { id: number; email: string } | null,
    loading: true,
    error: null as string | null
});

export async function checkAuth() {
    try {
        auth.loading = true;
        auth.error = null;
        const data = await fetchApi('/supervisors/me');
        auth.user = data;
    } catch (err: any) {
        auth.user = null;
    } finally {
        auth.loading = false;
    }
}

export async function logout() {
    try {
        await fetchApi('/supervisors/logout', { method: 'POST' });
    } finally {
        auth.user = null;
    }
}
