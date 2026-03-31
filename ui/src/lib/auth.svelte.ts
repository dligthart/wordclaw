import { fetchApi } from './api';

type AuthUser = {
    id: number;
    email: string;
    scope?: 'platform' | 'tenant';
    domainId?: number | null;
    domain?: {
        id: number;
        name: string;
        hostname: string;
    } | null;
};

export const auth = $state({
    user: null as AuthUser | null,
    loading: true,
    error: null as string | null
});

export async function checkAuth() {
    try {
        auth.loading = true;
        auth.error = null;
        const data = await fetchApi('/supervisors/me') as AuthUser;
        auth.user = data;
        if (typeof window !== 'undefined' && typeof data.domainId === 'number') {
            localStorage.setItem('__wc_domain_id', String(data.domainId));
        }
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
