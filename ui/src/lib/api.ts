const BASE_URL = '/api';

export class ApiError extends Error {
    code: string;
    remediation?: string;
    meta?: Record<string, unknown>;

    constructor(
        message: string,
        code: string,
        remediation?: string,
        meta?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.remediation = remediation;
        this.meta = meta;
    }
}

export async function fetchApi(endpoint: string, options: RequestInit = {}) {
    const defaultHeaders: Record<string, string> = {
        'Accept': 'application/json'
    };

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
        if (data?.error?.code) {
            throw new ApiError(
                data.error.message || 'API request failed',
                data.error.code,
                data.error.remediation,
                data.error.meta
            );
        }
        throw new Error(data?.error || data?.message || 'API request failed');
    }

    return data;
}
