const BASE_URL = '/api';

export async function fetchApi(endpoint: string, options: RequestInit = {}) {
    const defaultHeaders: Record<string, string> = {};

    if (options.body && typeof options.body === 'string') {
        defaultHeaders['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${BASE_URL}${endpoint}`, {
        ...options,
        credentials: 'include',
        headers: {
            ...defaultHeaders,
            ...options.headers,
        }
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(data?.error || data?.message || 'API request failed');
    }

    return data;
}
