import { and, asc, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { aiProviderConfigs } from '../db/schema.js';

type JsonObject = Record<string, unknown>;

export const CONFIGURABLE_AI_PROVIDER_TYPES = ['openai', 'anthropic', 'gemini'] as const;
export type ConfigurableAiProviderType = typeof CONFIGURABLE_AI_PROVIDER_TYPES[number];

export type AiProviderConfigRecord = typeof aiProviderConfigs.$inferSelect;

export type AiProviderConfigSummary = {
    id: number;
    domainId: number;
    provider: ConfigurableAiProviderType;
    configured: true;
    maskedApiKey: string;
    defaultModel: string | null;
    settings: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
};

export class AiProviderConfigError extends Error {
    code: string;
    remediation: string;
    statusCode: number;

    constructor(message: string, code: string, remediation: string, statusCode = 400) {
        super(message);
        this.name = 'AiProviderConfigError';
        this.code = code;
        this.remediation = remediation;
        this.statusCode = statusCode;
    }
}

function isObject(value: unknown): value is JsonObject {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function normalizeAiProviderType(value: unknown): ConfigurableAiProviderType {
    const normalized = normalizeOptionalString(value);
    if (
        normalized === 'openai'
        || normalized === 'anthropic'
        || normalized === 'gemini'
    ) {
        return normalized;
    }

    throw new AiProviderConfigError(
        'Unsupported AI provider',
        'AI_PROVIDER_UNSUPPORTED',
        `Use one of: ${CONFIGURABLE_AI_PROVIDER_TYPES.join(', ')}.`,
        400,
    );
}

function normalizeApiKey(value: unknown): string {
    const normalized = normalizeOptionalString(value);
    if (!normalized) {
        throw new AiProviderConfigError(
            'AI provider API key is required',
            'AI_PROVIDER_API_KEY_REQUIRED',
            'Provide apiKey as a non-empty string.',
            400,
        );
    }

    return normalized;
}

function normalizeSettings(value: unknown): Record<string, unknown> {
    if (value === undefined || value === null) {
        return {};
    }

    if (!isObject(value)) {
        throw new AiProviderConfigError(
            'Invalid AI provider settings',
            'AI_PROVIDER_SETTINGS_INVALID',
            'Provide settings as a JSON object when configured.',
            400,
        );
    }

    return value;
}

export function maskSecret(secret: string): string {
    const normalized = secret.trim();
    if (normalized.length <= 8) {
        return `${normalized.slice(0, 2)}...${normalized.slice(-2)}`;
    }

    return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

function serializeConfig(row: AiProviderConfigRecord): AiProviderConfigSummary {
    return {
        id: row.id,
        domainId: row.domainId,
        provider: normalizeAiProviderType(row.provider),
        configured: true,
        maskedApiKey: maskSecret(row.apiKey),
        defaultModel: normalizeOptionalString(row.defaultModel),
        settings: isObject(row.settings) ? row.settings : {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

export async function listAiProviderConfigs(domainId: number): Promise<AiProviderConfigSummary[]> {
    const rows = await db.select()
        .from(aiProviderConfigs)
        .where(eq(aiProviderConfigs.domainId, domainId))
        .orderBy(asc(aiProviderConfigs.provider), asc(aiProviderConfigs.id));

    return rows.map((row) => serializeConfig(row));
}

export async function getAiProviderConfig(domainId: number, provider: unknown): Promise<AiProviderConfigSummary | null> {
    const normalizedProvider = normalizeAiProviderType(provider);
    const [row] = await db.select()
        .from(aiProviderConfigs)
        .where(and(
            eq(aiProviderConfigs.domainId, domainId),
            eq(aiProviderConfigs.provider, normalizedProvider),
        ));

    return row ? serializeConfig(row) : null;
}

export async function getAiProviderSecretConfig(domainId: number, provider: unknown): Promise<AiProviderConfigRecord | null> {
    const normalizedProvider = normalizeAiProviderType(provider);
    const [row] = await db.select()
        .from(aiProviderConfigs)
        .where(and(
            eq(aiProviderConfigs.domainId, domainId),
            eq(aiProviderConfigs.provider, normalizedProvider),
        ));

    return row ?? null;
}

export async function upsertAiProviderConfig(input: {
    domainId: number;
    provider: unknown;
    apiKey: unknown;
    defaultModel?: unknown;
    settings?: unknown;
}): Promise<AiProviderConfigSummary> {
    const provider = normalizeAiProviderType(input.provider);
    const apiKey = normalizeApiKey(input.apiKey);
    const defaultModel = normalizeOptionalString(input.defaultModel);
    const settings = normalizeSettings(input.settings);

    const [existing] = await db.select()
        .from(aiProviderConfigs)
        .where(and(
            eq(aiProviderConfigs.domainId, input.domainId),
            eq(aiProviderConfigs.provider, provider),
        ));

    if (existing) {
        const [updated] = await db.update(aiProviderConfigs)
            .set({
                apiKey,
                defaultModel,
                settings,
                updatedAt: new Date(),
            })
            .where(eq(aiProviderConfigs.id, existing.id))
            .returning();

        if (!updated) {
            throw new AiProviderConfigError(
                'AI provider config could not be updated',
                'AI_PROVIDER_CONFIG_UPDATE_FAILED',
                'Retry the provider update. If the problem persists, inspect database health.',
                500,
            );
        }

        return serializeConfig(updated);
    }

    const [created] = await db.insert(aiProviderConfigs)
        .values({
            domainId: input.domainId,
            provider,
            apiKey,
            defaultModel,
            settings,
        })
        .returning();

    return serializeConfig(created);
}

export async function deleteAiProviderConfig(domainId: number, provider: unknown): Promise<AiProviderConfigSummary | null> {
    const normalizedProvider = normalizeAiProviderType(provider);
    const [deleted] = await db.delete(aiProviderConfigs)
        .where(and(
            eq(aiProviderConfigs.domainId, domainId),
            eq(aiProviderConfigs.provider, normalizedProvider),
        ))
        .returning();

    return deleted ? serializeConfig(deleted) : null;
}
