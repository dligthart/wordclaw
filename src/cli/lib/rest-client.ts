export type RestCliConfig = {
    baseUrl?: string;
    apiKey?: string;
    domainId?: number;
};

export type RestCliResponse = {
    transport: 'rest';
    method: string;
    url: string;
    status: number;
    ok: boolean;
    headers: Record<string, string>;
    body: unknown;
};

export class RestCliError extends Error {
    response: RestCliResponse;

    constructor(response: RestCliResponse) {
        const body =
            typeof response.body === 'string'
                ? response.body
                : JSON.stringify(response.body);
        super(`REST request failed (${response.status}): ${body}`);
        this.response = response;
    }
}

function normalizeBaseUrl(rawBaseUrl: string): string {
    const withoutTrailingSlash = rawBaseUrl.replace(/\/+$/, '');
    return withoutTrailingSlash.endsWith('/api')
        ? withoutTrailingSlash
        : `${withoutTrailingSlash}/api`;
}

function maybeParseJson(raw: string): unknown {
    if (!raw) {
        return null;
    }

    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

export function resolveApiUrl(
    rawBaseUrl: string,
    path: string,
    query: Record<string, string | number | boolean | undefined> = {},
): string {
    if (/^https?:\/\//i.test(path)) {
        const url = new URL(path);
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined) {
                url.searchParams.set(key, String(value));
            }
        }
        return url.toString();
    }

    const baseUrl = normalizeBaseUrl(rawBaseUrl);
    const normalizedPath = path.startsWith('/api/')
        ? path.slice('/api'.length)
        : path.startsWith('/')
            ? path
            : `/${path}`;
    const url = new URL(`${baseUrl}${normalizedPath}`);

    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
            url.searchParams.set(key, String(value));
        }
    }

    return url.toString();
}

export class RestCliClient {
    private readonly baseUrl: string;
    private readonly apiKey?: string;

    constructor(config: RestCliConfig = {}) {
        this.baseUrl = config.baseUrl ?? process.env.WORDCLAW_BASE_URL ?? 'http://localhost:4000';
        this.apiKey = config.apiKey ?? process.env.WORDCLAW_API_KEY;
        const requestedDomainId = config.domainId ?? (
            process.env.WORDCLAW_DOMAIN_ID
                ? Number(process.env.WORDCLAW_DOMAIN_ID)
                : undefined
        );

        if (requestedDomainId !== undefined && !Number.isFinite(requestedDomainId)) {
            throw new Error('WORDCLAW_DOMAIN_ID must be a number when set.');
        }
        if (requestedDomainId !== undefined) {
            throw new Error('WORDCLAW_DOMAIN_ID and --domain-id are not supported for API-key CLI calls. Use a domain-scoped API key instead.');
        }
    }

    async request(options: {
        method: string;
        path: string;
        query?: Record<string, string | number | boolean | undefined>;
        body?: unknown;
        headers?: Record<string, string>;
        acceptStatuses?: number[];
    }): Promise<RestCliResponse> {
        const method = options.method.toUpperCase();
        const url = resolveApiUrl(this.baseUrl, options.path, options.query);
        const requestHeaders: Record<string, string> = {
            accept: 'application/json',
            ...(options.headers ?? {}),
        };

        if (this.apiKey) {
            requestHeaders['x-api-key'] = this.apiKey;
        }

        let body: unknown;
        if (options.body !== undefined) {
            if (
                typeof options.body === 'string'
                || options.body instanceof URLSearchParams
                || options.body instanceof FormData
                || options.body instanceof Blob
                || options.body instanceof ArrayBuffer
                || ArrayBuffer.isView(options.body)
            ) {
                body = options.body;
            } else {
                requestHeaders['content-type'] = requestHeaders['content-type'] ?? 'application/json';
                body = JSON.stringify(options.body);
            }
        }

        const response = await fetch(url, {
            method,
            headers: requestHeaders,
            body: body as never,
        });
        const rawBody = await response.text();
        const payload: RestCliResponse = {
            transport: 'rest',
            method,
            url,
            status: response.status,
            ok: response.ok,
            headers: Object.fromEntries(response.headers.entries()),
            body: maybeParseJson(rawBody),
        };

        const acceptedStatuses = new Set([...(options.acceptStatuses ?? []), ...(
            response.ok ? [response.status] : []
        )]);
        if (!acceptedStatuses.has(response.status)) {
            throw new RestCliError(payload);
        }

        return payload;
    }
}
