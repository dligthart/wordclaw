import crypto from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { domains, supervisorInvites, supervisors } from '../db/schema.js';
import {
    createSupervisorAccount,
    normalizeSupervisorEmail,
    SupervisorDomainNotFoundError,
    SupervisorEmailConflictError,
    type SupervisorDomainSummary,
} from './supervisor.js';

export const DEFAULT_SUPERVISOR_INVITE_TTL_HOURS = 72;

type SupervisorInviteExecutor = Pick<typeof db, 'select' | 'insert' | 'update'>;

export type SupervisorInviteSummary = {
    id: number;
    email: string;
    domainId: number | null;
    invitedBySupervisorId: number | null;
    expiresAt: Date;
    acceptedAt: Date | null;
    createdAt: Date;
    domain: SupervisorDomainSummary | null;
};

export type IssuedSupervisorInvite = {
    invite: SupervisorInviteSummary;
    token: string;
};

type IssueSupervisorInviteInput = {
    email: string;
    domainId?: number | null;
    invitedBySupervisorId?: number | null;
    expiresInHours?: number;
};

type AcceptSupervisorInviteInput = {
    token: string;
    password: string;
};

export class SupervisorInviteNotFoundError extends Error {
    readonly code = 'SUPERVISOR_INVITE_NOT_FOUND';

    constructor() {
        super('SUPERVISOR_INVITE_NOT_FOUND');
        this.name = 'SupervisorInviteNotFoundError';
    }
}

export class SupervisorInviteExpiredError extends Error {
    readonly code = 'SUPERVISOR_INVITE_EXPIRED';
    readonly inviteId: number;

    constructor(inviteId: number) {
        super('SUPERVISOR_INVITE_EXPIRED');
        this.name = 'SupervisorInviteExpiredError';
        this.inviteId = inviteId;
    }
}

export class SupervisorInviteAlreadyAcceptedError extends Error {
    readonly code = 'SUPERVISOR_INVITE_ALREADY_ACCEPTED';
    readonly inviteId: number;

    constructor(inviteId: number) {
        super('SUPERVISOR_INVITE_ALREADY_ACCEPTED');
        this.name = 'SupervisorInviteAlreadyAcceptedError';
        this.inviteId = inviteId;
    }
}

function normalizeInviteDomainId(raw: number | null | undefined): number | null {
    return typeof raw === 'number' && Number.isInteger(raw) && raw > 0
        ? raw
        : null;
}

function hashSupervisorInviteToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function generateSupervisorInviteToken(): string {
    return crypto.randomBytes(24).toString('base64url');
}

function toSupervisorInviteSummary(row: {
    id: number;
    email: string;
    domainId: number | null;
    invitedBySupervisorId: number | null;
    expiresAt: Date;
    acceptedAt: Date | null;
    createdAt: Date;
    domainName: string | null;
    domainHostname: string | null;
}): SupervisorInviteSummary {
    return {
        id: row.id,
        email: row.email,
        domainId: row.domainId,
        invitedBySupervisorId: row.invitedBySupervisorId,
        expiresAt: row.expiresAt,
        acceptedAt: row.acceptedAt,
        createdAt: row.createdAt,
        domain: row.domainId !== null && row.domainName && row.domainHostname
            ? {
                id: row.domainId,
                name: row.domainName,
                hostname: row.domainHostname,
            }
            : null,
    };
}

async function findDomainSummary(
    domainId: number | null,
    executor: SupervisorInviteExecutor = db
): Promise<SupervisorDomainSummary | null> {
    if (domainId === null) {
        return null;
    }

    const [domain] = await executor
        .select({
            id: domains.id,
            name: domains.name,
            hostname: domains.hostname,
        })
        .from(domains)
        .where(eq(domains.id, domainId));

    return domain ?? null;
}

async function findExistingSupervisorByEmail(
    email: string,
    executor: SupervisorInviteExecutor = db
): Promise<{ id: number; email: string; domainId: number | null } | null> {
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

export async function issueSupervisorInvite(
    input: IssueSupervisorInviteInput,
    executor: SupervisorInviteExecutor = db
): Promise<IssuedSupervisorInvite> {
    const email = normalizeSupervisorEmail(input.email);
    const domainId = normalizeInviteDomainId(input.domainId);
    const ttlHours = typeof input.expiresInHours === 'number'
        && Number.isFinite(input.expiresInHours)
        && input.expiresInHours > 0
        ? Math.floor(input.expiresInHours)
        : DEFAULT_SUPERVISOR_INVITE_TTL_HOURS;
    const invitedBySupervisorId = typeof input.invitedBySupervisorId === 'number' && input.invitedBySupervisorId > 0
        ? input.invitedBySupervisorId
        : null;

    const existingSupervisor = await findExistingSupervisorByEmail(email, executor);
    const domain = await findDomainSummary(domainId, executor);

    if (domainId !== null && !domain) {
        throw new SupervisorDomainNotFoundError(domainId);
    }

    if (existingSupervisor) {
        throw new SupervisorEmailConflictError(email, existingSupervisor);
    }

    const token = generateSupervisorInviteToken();
    const expiresAt = new Date(Date.now() + (ttlHours * 60 * 60 * 1000));

    const [invite] = await executor
        .insert(supervisorInvites)
        .values({
            email,
            tokenHash: hashSupervisorInviteToken(token),
            domainId,
            invitedBySupervisorId,
            expiresAt,
        })
        .returning();

    return {
        token,
        invite: {
            id: invite.id,
            email: invite.email,
            domainId: invite.domainId,
            invitedBySupervisorId: invite.invitedBySupervisorId,
            expiresAt: invite.expiresAt,
            acceptedAt: invite.acceptedAt,
            createdAt: invite.createdAt,
            domain,
        },
    };
}

export async function getSupervisorInviteByToken(
    token: string,
    executor: SupervisorInviteExecutor = db
): Promise<SupervisorInviteSummary> {
    if (typeof token !== 'string' || token.trim().length === 0) {
        throw new SupervisorInviteNotFoundError();
    }

    const [invite] = await executor
        .select({
            id: supervisorInvites.id,
            email: supervisorInvites.email,
            domainId: supervisorInvites.domainId,
            invitedBySupervisorId: supervisorInvites.invitedBySupervisorId,
            expiresAt: supervisorInvites.expiresAt,
            acceptedAt: supervisorInvites.acceptedAt,
            createdAt: supervisorInvites.createdAt,
            domainName: domains.name,
            domainHostname: domains.hostname,
        })
        .from(supervisorInvites)
        .leftJoin(domains, eq(supervisorInvites.domainId, domains.id))
        .where(eq(supervisorInvites.tokenHash, hashSupervisorInviteToken(token)));

    if (!invite) {
        throw new SupervisorInviteNotFoundError();
    }

    if (invite.acceptedAt) {
        throw new SupervisorInviteAlreadyAcceptedError(invite.id);
    }

    if (invite.expiresAt.getTime() <= Date.now()) {
        throw new SupervisorInviteExpiredError(invite.id);
    }

    return toSupervisorInviteSummary(invite);
}

export async function acceptSupervisorInvite(input: AcceptSupervisorInviteInput) {
    return db.transaction(async (tx) => {
        const invite = await getSupervisorInviteByToken(input.token, tx);
        const created = await createSupervisorAccount({
            email: invite.email,
            password: input.password,
            domainId: invite.domainId,
        }, tx);

        await tx
            .update(supervisorInvites)
            .set({ acceptedAt: new Date() })
            .where(eq(supervisorInvites.id, invite.id));

        return {
            invite,
            supervisor: created.supervisor,
            domain: created.domain,
        };
    });
}
