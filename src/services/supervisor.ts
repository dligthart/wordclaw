import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { domains, supervisors } from '../db/schema.js';

const SUPERVISOR_EMAIL_CONSTRAINTS = new Set([
    'supervisors_email_key',
    'supervisors_email_unique',
]);

export type SupervisorDbExecutor = Pick<typeof db, 'insert' | 'select'>;
type SupervisorPasswordDbExecutor = Pick<typeof db, 'select' | 'update'>;

export type SupervisorDomainSummary = {
    id: number;
    name: string;
    hostname: string;
};

export type SupervisorEmailSummary = {
    id: number;
    email: string;
    domainId: number | null;
};

export type SupervisorListEntry = {
    id: number;
    email: string;
    domainId: number | null;
    createdAt: Date;
    lastLoginAt: Date | null;
    domain: SupervisorDomainSummary | null;
};

type CreateSupervisorInput = {
    email: string;
    password: string;
    domainId?: number | null;
};

function isUniqueViolation(error: unknown, constraints: Set<string>): boolean {
    const visited = new Set<unknown>();
    let candidate: unknown = error;

    while (candidate && typeof candidate === 'object' && !visited.has(candidate)) {
        visited.add(candidate);
        const maybeDbError = candidate as { code?: string; constraint?: string; cause?: unknown };
        if (
            maybeDbError.code === '23505'
            && typeof maybeDbError.constraint === 'string'
            && constraints.has(maybeDbError.constraint)
        ) {
            return true;
        }
        candidate = maybeDbError.cause;
    }

    return false;
}

export function normalizeSupervisorEmail(raw: string): string {
    return raw.trim().toLowerCase();
}

export class SupervisorEmailConflictError extends Error {
    readonly code = 'SUPERVISOR_EMAIL_CONFLICT';
    readonly email: string;
    readonly existingSupervisor: SupervisorEmailSummary | null;

    constructor(email: string, existingSupervisor: SupervisorEmailSummary | null, cause?: unknown) {
        super('SUPERVISOR_EMAIL_CONFLICT');
        this.name = 'SupervisorEmailConflictError';
        this.email = email;
        this.existingSupervisor = existingSupervisor;

        if (cause !== undefined) {
            (this as Error & { cause?: unknown }).cause = cause;
        }
    }
}

export class SupervisorDomainNotFoundError extends Error {
    readonly code = 'SUPERVISOR_DOMAIN_NOT_FOUND';
    readonly domainId: number;

    constructor(domainId: number) {
        super('SUPERVISOR_DOMAIN_NOT_FOUND');
        this.name = 'SupervisorDomainNotFoundError';
        this.domainId = domainId;
    }
}

export class SupervisorNotFoundError extends Error {
    readonly code = 'SUPERVISOR_NOT_FOUND';
    readonly supervisorId: number;

    constructor(supervisorId: number) {
        super('SUPERVISOR_NOT_FOUND');
        this.name = 'SupervisorNotFoundError';
        this.supervisorId = supervisorId;
    }
}

export class SupervisorPasswordMismatchError extends Error {
    readonly code = 'SUPERVISOR_PASSWORD_MISMATCH';

    constructor() {
        super('SUPERVISOR_PASSWORD_MISMATCH');
        this.name = 'SupervisorPasswordMismatchError';
    }
}

async function findSupervisorByEmail(
    email: string,
    executor: SupervisorDbExecutor = db
): Promise<SupervisorEmailSummary | null> {
    const [supervisor] = await executor
        .select({
            id: supervisors.id,
            email: supervisors.email,
            domainId: supervisors.domainId,
        })
        .from(supervisors)
        .where(eq(supervisors.email, email));

    return supervisor ?? null;
}

export async function createSupervisorAccount(
    input: CreateSupervisorInput,
    executor: SupervisorDbExecutor = db
): Promise<{ supervisor: typeof supervisors.$inferSelect; domain: SupervisorDomainSummary | null }> {
    const email = normalizeSupervisorEmail(input.email);
    const domainId = typeof input.domainId === 'number' && Number.isInteger(input.domainId) && input.domainId > 0
        ? input.domainId
        : null;

    let domain: SupervisorDomainSummary | null = null;
    if (domainId !== null) {
        const [resolvedDomain] = await executor
            .select({
                id: domains.id,
                name: domains.name,
                hostname: domains.hostname,
            })
            .from(domains)
            .where(eq(domains.id, domainId));

        if (!resolvedDomain) {
            throw new SupervisorDomainNotFoundError(domainId);
        }

        domain = resolvedDomain;
    }

    const passwordHash = await bcrypt.hash(input.password, 10);

    try {
        const [supervisor] = await executor.insert(supervisors).values({
            email,
            passwordHash,
            domainId,
        }).returning();

        return {
            supervisor,
            domain,
        };
    } catch (error) {
        if (!isUniqueViolation(error, SUPERVISOR_EMAIL_CONSTRAINTS)) {
            throw error;
        }

        let existingSupervisor: SupervisorEmailSummary | null = null;
        try {
            existingSupervisor = await findSupervisorByEmail(email, executor);
        } catch {
            existingSupervisor = null;
        }

        throw new SupervisorEmailConflictError(email, existingSupervisor, error);
    }
}

export async function listSupervisors(): Promise<SupervisorListEntry[]> {
    const rows = await db
        .select({
            id: supervisors.id,
            email: supervisors.email,
            domainId: supervisors.domainId,
            createdAt: supervisors.createdAt,
            lastLoginAt: supervisors.lastLoginAt,
            domainName: domains.name,
            domainHostname: domains.hostname,
        })
        .from(supervisors)
        .leftJoin(domains, eq(supervisors.domainId, domains.id))
        .orderBy(supervisors.id);

    return rows.map((row) => ({
        id: row.id,
        email: row.email,
        domainId: row.domainId,
        createdAt: row.createdAt,
        lastLoginAt: row.lastLoginAt,
        domain: row.domainId !== null && row.domainName && row.domainHostname
            ? {
                id: row.domainId,
                name: row.domainName,
                hostname: row.domainHostname,
            }
            : null,
    }));
}

export async function changeSupervisorPassword(
    input: {
        supervisorId: number;
        currentPassword: string;
        newPassword: string;
    },
    executor: SupervisorPasswordDbExecutor = db
): Promise<void> {
    const [supervisor] = await executor
        .select({
            id: supervisors.id,
            passwordHash: supervisors.passwordHash,
        })
        .from(supervisors)
        .where(eq(supervisors.id, input.supervisorId));

    if (!supervisor) {
        throw new SupervisorNotFoundError(input.supervisorId);
    }

    const passwordMatches = await bcrypt.compare(input.currentPassword, supervisor.passwordHash);
    if (!passwordMatches) {
        throw new SupervisorPasswordMismatchError();
    }

    const passwordHash = await bcrypt.hash(input.newPassword, 10);
    await executor
        .update(supervisors)
        .set({ passwordHash })
        .where(eq(supervisors.id, input.supervisorId));
}
