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

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toApiErrorPayload(value: unknown): {
    message: string;
    code: string;
    remediation?: string;
    meta?: Record<string, unknown>;
} | null {
    if (!isRecord(value)) {
        return null;
    }

    const nestedError = value.error;
    if (isRecord(nestedError) && typeof nestedError.code === 'string') {
        return {
            message:
                typeof nestedError.message === 'string'
                    ? nestedError.message
                    : typeof nestedError.error === 'string'
                        ? nestedError.error
                        : 'API request failed',
            code: nestedError.code,
            remediation:
                typeof nestedError.remediation === 'string'
                    ? nestedError.remediation
                    : undefined,
            meta: isRecord(nestedError.meta) ? nestedError.meta : undefined,
        };
    }

    if (typeof value.error === 'string' && typeof value.code === 'string') {
        return {
            message: value.error,
            code: value.code,
            remediation:
                typeof value.remediation === 'string'
                    ? value.remediation
                    : undefined,
            meta: isRecord(value.meta) ? value.meta : undefined,
        };
    }

    return null;
}

export async function fetchApi(endpoint: string, options: RequestInit = {}) {
    const defaultHeaders: Record<string, string> = {
        'Accept': 'application/json'
    };

    if (typeof window !== 'undefined') {
        const domainId = localStorage.getItem('__wc_domain_id');
        if (domainId) {
            defaultHeaders['x-wordclaw-domain'] = domainId;
        }
    }

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
        const apiError = toApiErrorPayload(data);
        if (apiError) {
            throw new ApiError(
                apiError.message,
                apiError.code,
                apiError.remediation,
                apiError.meta
            );
        }
        throw new Error(data?.error || data?.message || 'API request failed');
    }

    return data;
}
