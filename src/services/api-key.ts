import crypto from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import { apiKeys } from '../db/schema.js';

export const ALLOWED_SCOPES = ['content:read', 'content:write', 'audit:read', 'admin'] as const;
export type ApiScope = typeof ALLOWED_SCOPES[number];

export type ApiKeyRecord = typeof apiKeys.$inferSelect;

type CreateApiKeyInput = {
    name: string;
    scopes: string[];
    createdBy?: number | null;
    expiresAt?: Date | null;
};

export function hashApiKey(rawKey: string): string {
    return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export function parseScopes(scopesText: string): Set<string> {
    return new Set(
        scopesText
            .split('|')
            .map((scope) => scope.trim())
            .filter(Boolean)
    );
}

export function normalizeScopes(scopes: string[]): string[] {
    const unique = Array.from(
        new Set(scopes.map((scope) => scope.trim()).filter(Boolean))
    );
    const invalid = unique.filter((scope) => !ALLOWED_SCOPES.includes(scope as ApiScope));
    if (invalid.length > 0) {
        throw new Error(`Invalid scopes: ${invalid.join(', ')}`);
    }

    return unique;
}

export function serializeScopes(scopes: string[]): string {
    return normalizeScopes(scopes).join('|');
}

export function generatePlaintextApiKey(): string {
    return `wcak_${crypto.randomBytes(24).toString('hex')}`;
}

export function apiKeyPrefix(rawKey: string): string {
    return rawKey.slice(0, 12);
}

export function isKeyExpired(key: Pick<ApiKeyRecord, 'expiresAt'>): boolean {
    return key.expiresAt instanceof Date && key.expiresAt.getTime() <= Date.now();
}

export async function createApiKey(input: CreateApiKeyInput): Promise<{ key: ApiKeyRecord; plaintext: string }> {
    const plaintext = generatePlaintextApiKey();
    const keyHash = hashApiKey(plaintext);
    const scopes = serializeScopes(input.scopes);

    const [created] = await db.insert(apiKeys).values({
        name: input.name,
        keyPrefix: apiKeyPrefix(plaintext),
        keyHash,
        scopes,
        createdBy: input.createdBy ?? null,
        expiresAt: input.expiresAt ?? null
    }).returning();

    return { key: created, plaintext };
}

export async function listApiKeys() {
    return db.select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        createdBy: apiKeys.createdBy,
        createdAt: apiKeys.createdAt,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
        lastUsedAt: apiKeys.lastUsedAt
    }).from(apiKeys).orderBy(sql`${apiKeys.createdAt} desc`);
}

export async function getApiKeyByHash(hash: string): Promise<ApiKeyRecord | null> {
    const [key] = await db.select().from(apiKeys).where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)));
    return key || null;
}

export async function touchApiKeyUsage(id: number): Promise<void> {
    await db.update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, id));
}

export async function revokeApiKey(id: number): Promise<ApiKeyRecord | null> {
    const [updated] = await db.update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
        .returning();

    return updated || null;
}

export async function rotateApiKey(id: number, actorId?: number | null): Promise<{ oldKey: ApiKeyRecord; newKey: ApiKeyRecord; plaintext: string } | null> {
    return db.transaction(async (tx) => {
        const [existing] = await tx.select().from(apiKeys).where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)));
        if (!existing) {
            return null;
        }

        await tx.update(apiKeys)
            .set({ revokedAt: new Date() })
            .where(eq(apiKeys.id, id));

        const plaintext = generatePlaintextApiKey();
        const [created] = await tx.insert(apiKeys).values({
            name: `${existing.name} (rotated)`,
            keyPrefix: apiKeyPrefix(plaintext),
            keyHash: hashApiKey(plaintext),
            scopes: existing.scopes,
            createdBy: actorId ?? existing.createdBy ?? null,
            expiresAt: existing.expiresAt ?? null
        }).returning();

        return { oldKey: existing, newKey: created, plaintext };
    });
}
