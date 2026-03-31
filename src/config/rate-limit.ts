import { createHash } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

const DEFAULT_RATE_LIMIT_MAX = 100;
const DEFAULT_SUPERVISOR_RATE_LIMIT_MAX = 500;
const DEFAULT_RATE_LIMIT_TIME_WINDOW = '1 minute';
const SUPERVISOR_SESSION_COOKIE = 'supervisor_session';
const HEADER_API_KEY = 'x-api-key';

type RateLimitRequestLike = {
    headers: IncomingHttpHeaders;
    ip?: string;
};

function parsePositiveInteger(raw: string | undefined): number | null {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return null;
    }

    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function fingerprint(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function readCookie(headers: IncomingHttpHeaders, cookieName: string): string | null {
    const rawCookieHeader = headers.cookie;
    if (typeof rawCookieHeader !== 'string' || rawCookieHeader.trim().length === 0) {
        return null;
    }

    const cookies = rawCookieHeader.split(';');
    for (const cookie of cookies) {
        const separatorIndex = cookie.indexOf('=');
        if (separatorIndex === -1) {
            continue;
        }

        const name = cookie.slice(0, separatorIndex).trim();
        if (name !== cookieName) {
            continue;
        }

        const value = cookie.slice(separatorIndex + 1).trim();
        return value.length > 0 ? value : null;
    }

    return null;
}

function readBearerToken(headers: IncomingHttpHeaders): string | null {
    const authorization = headers.authorization;
    if (typeof authorization !== 'string') {
        return null;
    }

    const [scheme, token] = authorization.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || typeof token !== 'string') {
        return null;
    }

    const normalized = token.trim();
    return normalized.length > 0 ? normalized : null;
}

function readApiCredential(headers: IncomingHttpHeaders): string | null {
    const explicitApiKey = headers[HEADER_API_KEY];
    if (typeof explicitApiKey === 'string' && explicitApiKey.trim().length > 0) {
        return explicitApiKey.trim();
    }

    return readBearerToken(headers);
}

export function getRateLimitMax(env: NodeJS.ProcessEnv = process.env): number {
    return parsePositiveInteger(env.RATE_LIMIT_MAX) ?? DEFAULT_RATE_LIMIT_MAX;
}

export function getSupervisorRateLimitMax(env: NodeJS.ProcessEnv = process.env): number {
    const baseLimit = getRateLimitMax(env);
    return parsePositiveInteger(env.SUPERVISOR_RATE_LIMIT_MAX) ?? Math.max(baseLimit, DEFAULT_SUPERVISOR_RATE_LIMIT_MAX);
}

export function getRateLimitTimeWindow(env: NodeJS.ProcessEnv = process.env): string {
    const configured = env.RATE_LIMIT_TIME_WINDOW?.trim();
    return configured && configured.length > 0 ? configured : DEFAULT_RATE_LIMIT_TIME_WINDOW;
}

export function resolveRateLimitKey(request: RateLimitRequestLike): string {
    const supervisorSession = readCookie(request.headers, SUPERVISOR_SESSION_COOKIE);
    if (supervisorSession) {
        return `supervisor:${fingerprint(supervisorSession)}`;
    }

    const apiCredential = readApiCredential(request.headers);
    if (apiCredential) {
        return `credential:${fingerprint(apiCredential)}`;
    }

    const ip = typeof request.ip === 'string' && request.ip.trim().length > 0
        ? request.ip.trim()
        : 'unknown';

    return `ip:${ip}`;
}

export function resolveRateLimitMax(key: string | number, env: NodeJS.ProcessEnv = process.env): number {
    return String(key).startsWith('supervisor:')
        ? getSupervisorRateLimitMax(env)
        : getRateLimitMax(env);
}
