import { IncomingHttpHeaders } from 'node:http';

type Scope = 'content:read' | 'content:write' | 'audit:read' | 'admin';

type AuthPrincipal = {
    keyId: string;
    scopes: Set<string>;
};

type AuthSuccess = {
    ok: true;
    principal: AuthPrincipal;
};

type AuthFailure = {
    ok: false;
    statusCode: number;
    payload: {
        error: string;
        code: string;
        remediation: string;
        context?: Record<string, unknown>;
    };
};

type AuthResult = AuthSuccess | AuthFailure;

const ENV_AUTH_REQUIRED = 'AUTH_REQUIRED';
const ENV_API_KEYS = 'API_KEYS';
const HEADER_API_KEY = 'x-api-key';

function isAuthRequired(): boolean {
    return (process.env[ENV_AUTH_REQUIRED] || 'false').toLowerCase() === 'true';
}

function parseApiKeyConfig(raw: string | undefined): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    if (!raw) {
        return result;
    }

    const entries = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
    for (const entry of entries) {
        const [key, scopesRaw] = entry.split('=');
        const normalizedKey = key?.trim();
        if (!normalizedKey || !scopesRaw) {
            continue;
        }

        const scopes = scopesRaw
            .split('|')
            .map((scope) => scope.trim())
            .filter(Boolean);

        result.set(normalizedKey, new Set(scopes));
    }

    return result;
}

function getApiKey(headers: IncomingHttpHeaders): string | null {
    const keyHeader = headers[HEADER_API_KEY];
    if (typeof keyHeader === 'string' && keyHeader.trim().length > 0) {
        return keyHeader.trim();
    }

    const authorization = headers.authorization;
    if (typeof authorization !== 'string') {
        return null;
    }

    const [scheme, token] = authorization.split(' ');
    if (scheme?.toLowerCase() === 'bearer' && token) {
        return token.trim();
    }

    return null;
}

function requiredScope(method: string, routePath: string): Scope {
    const upperMethod = method.toUpperCase();

    if (routePath.startsWith('/api/audit-logs')) {
        return 'audit:read';
    }

    if (upperMethod === 'GET' || upperMethod === 'HEAD' || upperMethod === 'OPTIONS') {
        return 'content:read';
    }

    return 'content:write';
}

function authError(
    statusCode: number,
    error: string,
    code: string,
    remediation: string,
    context?: Record<string, unknown>
): AuthFailure {
    return {
        ok: false,
        statusCode,
        payload: { error, code, remediation, ...(context ? { context } : {}) }
    };
}

export function authorizeApiRequest(method: string, routePath: string, headers: IncomingHttpHeaders): AuthResult {
    const required = requiredScope(method, routePath);
    const configuredKeys = parseApiKeyConfig(process.env[ENV_API_KEYS]);
    const key = getApiKey(headers);
    const mustAuthenticate = isAuthRequired();

    if (mustAuthenticate && configuredKeys.size === 0) {
        return authError(
            500,
            'API authentication is enabled but no API keys are configured',
            'AUTH_CONFIGURATION_INVALID',
            `Set ${ENV_API_KEYS} with key-to-scope mappings such as 'writer=content:read|content:write|audit:read'.`
        );
    }

    if (!mustAuthenticate && configuredKeys.size === 0) {
        return {
            ok: true,
            principal: {
                keyId: 'anonymous',
                scopes: new Set(['admin'])
            }
        };
    }

    if (!key) {
        return authError(
            401,
            'Missing API key',
            'AUTH_MISSING_API_KEY',
            `Provide ${HEADER_API_KEY} header or Authorization: Bearer <key>. Required scope: ${required}.`
        );
    }

    const scopes = configuredKeys.get(key);
    if (!scopes) {
        return authError(
            401,
            'Invalid API key',
            'AUTH_INVALID_API_KEY',
            'Use a valid API key configured in server environment.'
        );
    }

    if (!scopes.has('admin') && !scopes.has(required)) {
        return authError(
            403,
            'Insufficient API key scope',
            'AUTH_INSUFFICIENT_SCOPE',
            `Use an API key with scope '${required}' or 'admin'.`,
            {
                requiredScope: required,
                keyId: key.slice(0, 6) + '...'
            }
        );
    }

    return {
        ok: true,
        principal: {
            keyId: key.slice(0, 6) + '...',
            scopes
        }
    };
}
