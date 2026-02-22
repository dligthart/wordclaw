import { IncomingHttpHeaders } from 'node:http';

import { getApiKeyByHash, hashApiKey, isKeyExpired, parseScopes, touchApiKeyUsage, ApiScope } from '../services/api-key.js';

type Scope = ApiScope;

export type AuthPrincipal = {
    keyId: number | string;
    domainId: number;
    scopes: Set<string>;
    source: 'db' | 'env' | 'anonymous';
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

    if (routePath.startsWith('/api/auth/keys') || routePath.startsWith('/api/webhooks')) {
        return 'admin';
    }

    if (routePath.startsWith('/ws/events')) {
        return 'audit:read';
    }

    if (routePath.startsWith('/api/audit-logs') || routePath.startsWith('/api/payments')) {
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

function hasScope(scopes: Set<string>, required: Scope): boolean {
    return scopes.has('admin') || scopes.has(required);
}

function isAuthFailure(value: AuthPrincipal | AuthFailure): value is AuthFailure {
    return (value as AuthFailure).ok === false;
}

async function resolvePrincipalFromKey(rawKey: string, envKeys: Map<string, Set<string>>): Promise<AuthPrincipal | AuthFailure> {
    const envScopes = envKeys.get(rawKey);
    if (envScopes) {
        return {
            keyId: rawKey.slice(0, 6) + '...',
            domainId: 1, // Fallback default tenant for ancient .env keys
            scopes: envScopes,
            source: 'env'
        };
    }

    const dbKey = await getApiKeyByHash(hashApiKey(rawKey));
    if (!dbKey) {
        return authError(
            401,
            'Invalid API key',
            'AUTH_INVALID_API_KEY',
            'Use a valid API key configured in server environment.'
        );
    }

    if (isKeyExpired(dbKey)) {
        return authError(
            401,
            'Expired API key',
            'AUTH_KEY_EXPIRED',
            'Rotate the API key and retry with a non-expired key.',
            {
                keyId: dbKey.id
            }
        );
    }

    await touchApiKeyUsage(dbKey.id);

    return {
        keyId: dbKey.id,
        domainId: dbKey.domainId,
        scopes: parseScopes(dbKey.scopes),
        source: 'db'
    };
}

export async function authorizeApiRequest(method: string, routePath: string, headers: IncomingHttpHeaders): Promise<AuthResult> {
    const required = requiredScope(method, routePath);
    const configuredKeys = parseApiKeyConfig(process.env[ENV_API_KEYS]);
    const key = getApiKey(headers);
    const mustAuthenticate = isAuthRequired();

    if (!key) {
        if (mustAuthenticate) {
            return authError(
                401,
                'Missing API key',
                'AUTH_MISSING_API_KEY',
                `Provide ${HEADER_API_KEY} header or Authorization: Bearer <key>. Required scope: ${required}.`
            );
        }

        return {
            ok: true,
            principal: {
                keyId: 'anonymous',
                domainId: 1, // Default unprotected local execution tenant
                scopes: new Set(['admin']),
                source: 'anonymous'
            }
        };
    }

    const resolved = await resolvePrincipalFromKey(key, configuredKeys);
    if (isAuthFailure(resolved)) {
        return resolved;
    }

    if (!hasScope(resolved.scopes, required)) {
        return authError(
            403,
            'Insufficient API key scope',
            'AUTH_INSUFFICIENT_SCOPE',
            `Use an API key with scope '${required}' or 'admin'.`,
            {
                requiredScope: required,
                keyId: resolved.keyId
            }
        );
    }

    return {
        ok: true,
        principal: resolved
    };
}

export async function authenticateApiRequest(headers: IncomingHttpHeaders): Promise<AuthResult> {
    const configuredKeys = parseApiKeyConfig(process.env[ENV_API_KEYS]);
    const key = getApiKey(headers);
    const mustAuthenticate = isAuthRequired();

    if (!key) {
        if (mustAuthenticate) {
            return authError(
                401,
                'Missing API key',
                'AUTH_MISSING_API_KEY',
                `Provide ${HEADER_API_KEY} header or Authorization: Bearer <key>.`
            );
        }

        return {
            ok: true,
            principal: {
                keyId: 'anonymous',
                domainId: 1, // Default local fallback tenant
                scopes: new Set(['admin']),
                source: 'anonymous'
            }
        };
    }

    const resolved = await resolvePrincipalFromKey(key, configuredKeys);
    if (isAuthFailure(resolved)) {
        return resolved;
    }

    return {
        ok: true,
        principal: resolved
    };
}

export function getDomainId(ctx: unknown): number {
    if (!ctx || typeof ctx !== 'object') {
        const err = new Error('Invalid Context') as any;
        err.statusCode = 401;
        err.code = 'UNAUTHENTICATED';
        err.remediation = 'The request context is missing or invalid.';
        throw err;
    }

    if ('domainId' in ctx && typeof ctx.domainId === 'number') {
        return ctx.domainId;
    }
    if ('principal' in ctx && ctx.principal && typeof (ctx.principal as any).domainId === 'number') {
        return (ctx.principal as any).domainId;
    }
    if ('authPrincipal' in ctx && ctx.authPrincipal && typeof (ctx.authPrincipal as any).domainId === 'number') {
        return (ctx.authPrincipal as any).domainId;
    }

    const err = new Error('Missing Domain Context') as any;
    err.statusCode = 401;
    err.code = 'UNAUTHENTICATED';
    err.remediation = 'The authenticated context is missing a valid domain ID bounds constraint.';
    throw err;
}
