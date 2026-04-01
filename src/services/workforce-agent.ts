import { and, asc, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { workforceAgents } from '../db/schema.js';
import { type DraftGenerationProviderConfig } from './draft-generation.js';

type JsonObject = Record<string, unknown>;

export type WorkforceAgentRecord = typeof workforceAgents.$inferSelect;

export type WorkforceAgentSummary = {
    id: number;
    domainId: number;
    name: string;
    slug: string;
    purpose: string;
    soul: string;
    provider: DraftGenerationProviderConfig;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
};

export class WorkforceAgentError extends Error {
    code: string;
    remediation: string;
    statusCode: number;

    constructor(message: string, code: string, remediation: string, statusCode = 400) {
        super(message);
        this.name = 'WorkforceAgentError';
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

function normalizeRequiredString(value: unknown, message: string, code: string, remediation: string): string {
    const normalized = normalizeOptionalString(value);
    if (!normalized) {
        throw new WorkforceAgentError(message, code, remediation, 400);
    }

    return normalized;
}

function normalizeSlug(value: unknown): string {
    const normalized = normalizeRequiredString(
        value,
        'Workforce agent slug is required',
        'WORKFORCE_AGENT_SLUG_REQUIRED',
        'Provide slug as a non-empty string. Letters, numbers, and hyphens work best for stable API references.',
    )
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    if (!normalized) {
        throw new WorkforceAgentError(
            'Workforce agent slug is invalid',
            'WORKFORCE_AGENT_SLUG_INVALID',
            'Provide slug with at least one letter or number so it can be used as a stable API reference.',
            400,
        );
    }

    return normalized.slice(0, 80);
}

function normalizeProvider(value: unknown): DraftGenerationProviderConfig {
    if (value === undefined || value === null) {
        return {
            type: 'deterministic',
        };
    }

    if (!isObject(value)) {
        throw new WorkforceAgentError(
            'Invalid workforce agent provider config',
            'WORKFORCE_AGENT_PROVIDER_INVALID',
            'Provide provider as an object when configuring a workforce agent.',
            400,
        );
    }

    const type = normalizeOptionalString(value.type) ?? 'deterministic';
    if (type === 'deterministic') {
        return {
            type: 'deterministic',
        };
    }

    if (type === 'openai') {
        return {
            type: 'openai',
            ...(normalizeOptionalString(value.model) ? { model: normalizeOptionalString(value.model) as string } : {}),
            ...(normalizeOptionalString(value.instructions) ? { instructions: normalizeOptionalString(value.instructions) as string } : {}),
        };
    }

    if (type === 'anthropic') {
        return {
            type: 'anthropic',
            ...(normalizeOptionalString(value.model) ? { model: normalizeOptionalString(value.model) as string } : {}),
            ...(normalizeOptionalString(value.instructions) ? { instructions: normalizeOptionalString(value.instructions) as string } : {}),
        };
    }

    if (type === 'gemini') {
        return {
            type: 'gemini',
            ...(normalizeOptionalString(value.model) ? { model: normalizeOptionalString(value.model) as string } : {}),
            ...(normalizeOptionalString(value.instructions) ? { instructions: normalizeOptionalString(value.instructions) as string } : {}),
        };
    }

    throw new WorkforceAgentError(
        'Unsupported workforce agent provider',
        'WORKFORCE_AGENT_PROVIDER_UNSUPPORTED',
        'Use provider.type = deterministic, openai, anthropic, or gemini.',
        400,
    );
}

function serializeWorkforceAgent(row: WorkforceAgentRecord): WorkforceAgentSummary {
    return {
        id: row.id,
        domainId: row.domainId,
        name: row.name,
        slug: row.slug,
        purpose: row.purpose,
        soul: row.soul,
        provider: normalizeProvider(row.provider),
        active: row.active,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

async function ensureUniqueSlug(domainId: number, slug: string, existingId?: number) {
    const [conflict] = await db.select()
        .from(workforceAgents)
        .where(and(
            eq(workforceAgents.domainId, domainId),
            eq(workforceAgents.slug, slug),
        ));

    if (conflict && conflict.id !== existingId) {
        throw new WorkforceAgentError(
            'Workforce agent slug already exists',
            'WORKFORCE_AGENT_SLUG_CONFLICT',
            `A workforce agent with slug '${slug}' already exists for this tenant. Reuse that agent or choose a different slug.`,
            409,
        );
    }
}

export async function listWorkforceAgents(domainId: number): Promise<WorkforceAgentSummary[]> {
    const rows = await db.select()
        .from(workforceAgents)
        .where(eq(workforceAgents.domainId, domainId))
        .orderBy(asc(workforceAgents.slug), asc(workforceAgents.id));

    return rows.map((row) => serializeWorkforceAgent(row));
}

export async function getWorkforceAgentById(domainId: number, id: number): Promise<WorkforceAgentSummary | null> {
    const [row] = await db.select()
        .from(workforceAgents)
        .where(and(
            eq(workforceAgents.domainId, domainId),
            eq(workforceAgents.id, id),
        ));

    return row ? serializeWorkforceAgent(row) : null;
}

export async function getWorkforceAgentBySlug(domainId: number, slug: string): Promise<WorkforceAgentSummary | null> {
    const normalizedSlug = normalizeSlug(slug);
    const [row] = await db.select()
        .from(workforceAgents)
        .where(and(
            eq(workforceAgents.domainId, domainId),
            eq(workforceAgents.slug, normalizedSlug),
        ));

    return row ? serializeWorkforceAgent(row) : null;
}

export async function createWorkforceAgent(input: {
    domainId: number;
    name: unknown;
    slug: unknown;
    purpose: unknown;
    soul: unknown;
    provider?: unknown;
    active?: unknown;
}): Promise<WorkforceAgentSummary> {
    const name = normalizeRequiredString(
        input.name,
        'Workforce agent name is required',
        'WORKFORCE_AGENT_NAME_REQUIRED',
        'Provide name as a non-empty string.',
    );
    const slug = normalizeSlug(input.slug);
    const purpose = normalizeRequiredString(
        input.purpose,
        'Workforce agent purpose is required',
        'WORKFORCE_AGENT_PURPOSE_REQUIRED',
        'Provide purpose as a non-empty string describing what this agent is for.',
    );
    const soul = normalizeRequiredString(
        input.soul,
        'Workforce agent SOUL is required',
        'WORKFORCE_AGENT_SOUL_REQUIRED',
        'Provide soul as a non-empty string so the drafting runtime knows how this agent should behave.',
    );
    const provider = normalizeProvider(input.provider);
    const active = typeof input.active === 'boolean' ? input.active : true;

    await ensureUniqueSlug(input.domainId, slug);

    const [created] = await db.insert(workforceAgents)
        .values({
            domainId: input.domainId,
            name,
            slug,
            purpose,
            soul,
            provider,
            active,
        })
        .returning();

    return serializeWorkforceAgent(created);
}

export async function updateWorkforceAgent(id: number, input: {
    domainId: number;
    name?: unknown;
    slug?: unknown;
    purpose?: unknown;
    soul?: unknown;
    provider?: unknown;
    active?: unknown;
}): Promise<WorkforceAgentSummary> {
    const [existing] = await db.select()
        .from(workforceAgents)
        .where(and(
            eq(workforceAgents.domainId, input.domainId),
            eq(workforceAgents.id, id),
        ));

    if (!existing) {
        throw new WorkforceAgentError(
            'Workforce agent not found',
            'WORKFORCE_AGENT_NOT_FOUND',
            `No workforce agent with ID ${id} exists in the current tenant.`,
            404,
        );
    }

    const name = input.name === undefined
        ? existing.name
        : normalizeRequiredString(
            input.name,
            'Workforce agent name is required',
            'WORKFORCE_AGENT_NAME_REQUIRED',
            'Provide name as a non-empty string.',
        );
    const slug = input.slug === undefined ? existing.slug : normalizeSlug(input.slug);
    const purpose = input.purpose === undefined
        ? existing.purpose
        : normalizeRequiredString(
            input.purpose,
            'Workforce agent purpose is required',
            'WORKFORCE_AGENT_PURPOSE_REQUIRED',
            'Provide purpose as a non-empty string describing what this agent is for.',
        );
    const soul = input.soul === undefined
        ? existing.soul
        : normalizeRequiredString(
            input.soul,
            'Workforce agent SOUL is required',
            'WORKFORCE_AGENT_SOUL_REQUIRED',
            'Provide soul as a non-empty string so the drafting runtime knows how this agent should behave.',
        );
    const provider = input.provider === undefined ? normalizeProvider(existing.provider) : normalizeProvider(input.provider);
    const active = input.active === undefined ? existing.active : Boolean(input.active);

    await ensureUniqueSlug(input.domainId, slug, existing.id);

    const [updated] = await db.update(workforceAgents)
        .set({
            name,
            slug,
            purpose,
            soul,
            provider,
            active,
            updatedAt: new Date(),
        })
        .where(eq(workforceAgents.id, existing.id))
        .returning();

    if (!updated) {
        throw new WorkforceAgentError(
            'Workforce agent could not be updated',
            'WORKFORCE_AGENT_UPDATE_FAILED',
            'Retry the workforce agent update. If the problem persists, inspect database health.',
            500,
        );
    }

    return serializeWorkforceAgent(updated);
}

export async function deleteWorkforceAgent(domainId: number, id: number): Promise<WorkforceAgentSummary | null> {
    const [deleted] = await db.delete(workforceAgents)
        .where(and(
            eq(workforceAgents.domainId, domainId),
            eq(workforceAgents.id, id),
        ))
        .returning();

    return deleted ? serializeWorkforceAgent(deleted) : null;
}
