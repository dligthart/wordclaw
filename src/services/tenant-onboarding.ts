import { type IncomingHttpHeaders } from 'node:http';

import { sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import { apiKeys, domains } from '../db/schema.js';
import { apiKeyPrefix, generatePlaintextApiKey, hashApiKey, normalizeScopes, serializeScopes } from './api-key.js';

export const DEFAULT_TENANT_ONBOARDING_SCOPES = ['admin'] as const;

type OnboardTenantInput = {
    tenantName: string;
    hostname: string;
    apiKeyName?: string;
    scopes?: string[];
    createdBy?: number | null;
    expiresAt?: Date | null;
};

function extractNumericCell(result: unknown, keys: string[]) {
    const firstRow = Array.isArray(result)
        ? result[0]
        : Array.isArray((result as { rows?: unknown[] } | null | undefined)?.rows)
            ? (result as { rows: unknown[] }).rows[0]
            : null;

    if (!firstRow || typeof firstRow !== 'object') {
        return 0;
    }

    for (const key of keys) {
        const candidate = (firstRow as Record<string, unknown>)[key];
        const numeric = Number(candidate);
        if (Number.isFinite(numeric)) {
            return numeric;
        }
    }

    return 0;
}

function readSingleHeaderValue(raw: string | string[] | undefined): string | null {
    if (typeof raw === 'string' && raw.trim().length > 0) {
        return raw.trim();
    }

    if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].trim().length > 0) {
        return raw[0].trim();
    }

    return null;
}

export function normalizePublicBaseUrl(raw: string | null | undefined): string | null {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return null;
    }

    let parsed: URL;
    try {
        parsed = new URL(raw.trim());
    } catch {
        throw new Error('INVALID_PUBLIC_BASE_URL');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('INVALID_PUBLIC_BASE_URL');
    }

    return parsed.origin;
}

export function inferRuntimeOriginFromHeaders(headers: IncomingHttpHeaders): string | null {
    const forwardedHost = readSingleHeaderValue(headers['x-forwarded-host']);
    const host = forwardedHost?.split(',')[0]?.trim() || readSingleHeaderValue(headers.host);
    if (!host) {
        return null;
    }

    const forwardedProto = readSingleHeaderValue(headers['x-forwarded-proto']);
    const protocol = forwardedProto?.split(',')[0]?.trim() || 'http';

    return `${protocol}://${host}`;
}

export function buildRuntimeEndpoints(origin: string | null) {
    return {
        api: origin ? `${origin}/api` : null,
        mcp: origin ? `${origin}/mcp` : null
    };
}

export async function onboardTenant(input: OnboardTenantInput) {
    const tenantName = input.tenantName.trim();
    const hostname = input.hostname.trim();
    const apiKeyName = input.apiKeyName?.trim() || `${tenantName} Admin`;
    const scopes = input.scopes === undefined
        ? [...DEFAULT_TENANT_ONBOARDING_SCOPES]
        : normalizeScopes(input.scopes);

    if (scopes.length === 0) {
        throw new Error('EMPTY_ONBOARDING_SCOPES');
    }

    const countResult = await db.execute(sql`SELECT COUNT(*)::int AS total FROM domains`);
    const bootstrap = extractNumericCell(countResult, ['total', 'count', '?column?']) === 0;

    return db.transaction(async (tx) => {
        const [domain] = await tx.insert(domains).values({
            name: tenantName,
            hostname
        }).returning();

        const plaintext = generatePlaintextApiKey();
        const [apiKey] = await tx.insert(apiKeys).values({
            domainId: domain.id,
            name: apiKeyName,
            keyPrefix: apiKeyPrefix(plaintext),
            keyHash: hashApiKey(plaintext),
            scopes: serializeScopes(scopes),
            createdBy: input.createdBy ?? null,
            expiresAt: input.expiresAt ?? null
        }).returning();

        return {
            bootstrap,
            domain,
            apiKey,
            plaintext,
            scopes
        };
    });
}
