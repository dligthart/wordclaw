import type { IncomingHttpHeaders } from 'node:http';

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { authenticateApiRequest } from './auth.js';
import { db } from '../db/index.js';
import { domains, supervisors } from '../db/schema.js';
import { isPlatformAdminPrincipal } from '../services/actor-identity.js';
import {
    acceptSupervisorInvite,
    getSupervisorInviteByToken,
    issueSupervisorInvite,
    SupervisorInviteAlreadyAcceptedError,
    SupervisorInviteExpiredError,
    SupervisorInviteNotFoundError,
} from '../services/supervisor-invite.js';
import {
    changeSupervisorPassword,
    createSupervisorAccount,
    deleteSupervisorAccount,
    LastPlatformSupervisorError,
    listSupervisors,
    normalizeSupervisorEmail,
    SupervisorSelfDeleteForbiddenError,
    SupervisorDomainNotFoundError,
    SupervisorEmailConflictError,
    SupervisorNotFoundError,
    SupervisorPasswordMismatchError,
} from '../services/supervisor.js';
import { inferRuntimeOriginFromHeaders } from '../services/tenant-onboarding.js';
import { isPlatformSupervisorSession, type SupervisorSessionClaims } from './supervisor-session.js';

const SupervisorDomainSchema = Type.Object({
    id: Type.Number(),
    name: Type.String(),
    hostname: Type.String(),
});

const SupervisorScopeSchema = Type.Union([
    Type.Literal('platform'),
    Type.Literal('tenant'),
]);

const SupervisorSessionSchema = Type.Object({
    id: Type.Number(),
    email: Type.String(),
    scope: SupervisorScopeSchema,
    domainId: Type.Union([Type.Number(), Type.Null()]),
    domain: Type.Union([SupervisorDomainSchema, Type.Null()]),
});

const SupervisorListEntrySchema = Type.Object({
    id: Type.Number(),
    email: Type.String(),
    scope: SupervisorScopeSchema,
    domainId: Type.Union([Type.Number(), Type.Null()]),
    domain: Type.Union([SupervisorDomainSchema, Type.Null()]),
    createdAt: Type.String(),
    lastLoginAt: Type.Union([Type.String(), Type.Null()]),
});

const SupervisorInvitePreviewSchema = Type.Object({
    email: Type.String(),
    scope: SupervisorScopeSchema,
    domainId: Type.Union([Type.Number(), Type.Null()]),
    domain: Type.Union([SupervisorDomainSchema, Type.Null()]),
    expiresAt: Type.String(),
});

const SupervisorInviteIssuedSchema = Type.Object({
    token: Type.String(),
    invitePath: Type.String(),
    inviteUrl: Type.Union([Type.String(), Type.Null()]),
    email: Type.String(),
    scope: SupervisorScopeSchema,
    domainId: Type.Union([Type.Number(), Type.Null()]),
    domain: Type.Union([SupervisorDomainSchema, Type.Null()]),
    expiresAt: Type.String(),
});

function platformAdminRequiredPayload() {
    return {
        error: 'Platform admin required',
        code: 'PLATFORM_ADMIN_REQUIRED',
        remediation: 'Use a platform-scoped supervisor session or env-backed admin key to manage supervisor accounts.'
    };
}

function supervisorInviteIssuerRequiredPayload() {
    return {
        error: 'Supervisor session or platform admin required',
        code: 'SUPERVISOR_INVITE_ISSUER_REQUIRED',
        remediation: 'Sign in as a supervisor or use a platform-admin API key before issuing supervisor invites.',
    };
}

function supervisorEmailConflictPayload(
    email: string,
    existingSupervisor: { id: number; email: string; domainId: number | null } | null = null
) {
    return {
        error: 'Supervisor email already exists',
        code: 'SUPERVISOR_EMAIL_CONFLICT',
        remediation: existingSupervisor
            ? `Supervisor ${existingSupervisor.id} already uses email '${email}'. Use a different email or update that account instead of creating a duplicate.`
            : `A supervisor with email '${email}' already exists. Use a different email or update the existing account instead of creating a duplicate.`,
        ...(existingSupervisor ? {
            context: {
                existingSupervisor
            }
        } : {})
    };
}

function supervisorDomainNotFoundPayload(domainId: number) {
    return {
        error: 'Supervisor domain not found',
        code: 'SUPERVISOR_DOMAIN_NOT_FOUND',
        remediation: `Provision domain ${domainId} first or use an existing tenant ID before assigning a scoped supervisor.`,
    };
}

function supervisorNotFoundPayload(supervisorId: number) {
    return {
        error: 'Supervisor not found',
        code: 'SUPERVISOR_NOT_FOUND',
        remediation: `Refresh the current session and retry. Supervisor ${supervisorId} no longer exists.`,
    };
}

function supervisorPasswordMismatchPayload() {
    return {
        error: 'Current password is incorrect',
        code: 'SUPERVISOR_PASSWORD_MISMATCH',
        remediation: 'Provide the current supervisor password and retry the password change.',
    };
}

function supervisorSelfDeleteForbiddenPayload() {
    return {
        error: 'Supervisor cannot delete the current session account',
        code: 'SUPERVISOR_SELF_DELETE_FORBIDDEN',
        remediation: 'Use a different platform supervisor account to remove this operator, or sign out instead.',
    };
}

function lastPlatformSupervisorPayload() {
    return {
        error: 'Cannot remove the last platform supervisor',
        code: 'SUPERVISOR_LAST_PLATFORM_SUPERVISOR',
        remediation: 'Create another platform-scoped supervisor before deleting the final remaining platform admin account.',
    };
}

function supervisorInviteScopeMismatchPayload(domainId: number) {
    return {
        error: 'Supervisor invite scope mismatch',
        code: 'SUPERVISOR_INVITE_DOMAIN_SCOPE_MISMATCH',
        remediation: `Tenant-scoped supervisors can only invite operators for domain ${domainId}. Omit domainId or use the bound domain.`,
    };
}

function supervisorInviteNotFoundPayload() {
    return {
        error: 'Supervisor invite not found',
        code: 'SUPERVISOR_INVITE_NOT_FOUND',
        remediation: 'Request a fresh invite link from an authorized supervisor and retry with that token.',
    };
}

function supervisorInviteExpiredPayload() {
    return {
        error: 'Supervisor invite expired',
        code: 'SUPERVISOR_INVITE_EXPIRED',
        remediation: 'Request a new supervisor invite because this link has expired.',
    };
}

function supervisorInviteAlreadyAcceptedPayload() {
    return {
        error: 'Supervisor invite already accepted',
        code: 'SUPERVISOR_INVITE_ALREADY_ACCEPTED',
        remediation: 'Sign in with the created supervisor account or request a fresh invite if access still fails.',
    };
}

function serializeSupervisorSession(input: {
    id: number;
    email: string;
    domainId: number | null;
    domain: { id: number; name: string; hostname: string } | null;
}) {
    return {
        id: input.id,
        email: input.email,
        scope: input.domainId === null ? 'platform' : 'tenant',
        domainId: input.domainId,
        domain: input.domain,
    } as const;
}

function serializeSupervisorInvite(input: {
    email: string;
    domainId: number | null;
    domain: { id: number; name: string; hostname: string } | null;
    expiresAt: Date;
}) {
    return {
        email: input.email,
        scope: input.domainId === null ? 'platform' : 'tenant',
        domainId: input.domainId,
        domain: input.domain,
        expiresAt: input.expiresAt.toISOString(),
    } as const;
}

function serializeIssuedSupervisorInvite(
    input: {
        token: string;
        invite: {
            email: string;
            domainId: number | null;
            domain: { id: number; name: string; hostname: string } | null;
            expiresAt: Date;
        };
    },
    invitePath: string,
    inviteUrl: string | null
) {
    return {
        token: input.token,
        invitePath,
        inviteUrl,
        ...serializeSupervisorInvite(input.invite),
    } as const;
}

function normalizeSupervisorDomainId(raw: unknown): number | null {
    const domainId = Number(raw);
    return Number.isInteger(domainId) && domainId > 0
        ? domainId
        : null;
}

function buildSupervisorInvitePath(token: string): string {
    return `/ui/invite?token=${encodeURIComponent(token)}`;
}

function buildSupervisorInviteUrl(headers: IncomingHttpHeaders, token: string): {
    invitePath: string;
    inviteUrl: string | null;
} {
    const invitePath = buildSupervisorInvitePath(token);
    const origin = inferRuntimeOriginFromHeaders(headers);
    return {
        invitePath,
        inviteUrl: origin ? `${origin}${invitePath}` : null,
    };
}

function setSupervisorSessionCookie(
    reply: {
        setCookie: (name: string, value: string, options: Record<string, unknown>) => unknown;
    },
    token: string
) {
    reply.setCookie('supervisor_session', token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 86400,
    });
}

function serializeSupervisorListEntry(input: {
    id: number;
    email: string;
    domainId: number | null;
    createdAt: Date;
    lastLoginAt: Date | null;
    domain: { id: number; name: string; hostname: string } | null;
}) {
    return {
        ...serializeSupervisorSession(input),
        createdAt: input.createdAt.toISOString(),
        lastLoginAt: input.lastLoginAt ? input.lastLoginAt.toISOString() : null,
    };
}

async function requirePlatformAdminActor(request: {
    jwtVerify: (options?: Record<string, unknown>) => Promise<unknown>;
    headers: Record<string, unknown>;
    user?: unknown;
}): Promise<
    | { ok: true; currentSupervisorId: number | null }
    | {
        ok: false;
        statusCode: 401 | 403;
        payload: {
            error: string;
            code: string;
            remediation?: string;
            context?: Record<string, unknown>;
        };
    }
> {
    try {
        await request.jwtVerify({ onlyCookie: true });
        const user = request.user as SupervisorSessionClaims | undefined;
        if (user?.role === 'supervisor') {
            if (!isPlatformSupervisorSession(user)) {
                return {
                    ok: false as const,
                    statusCode: 403,
                    payload: platformAdminRequiredPayload(),
                };
            }

            return {
                ok: true as const,
                currentSupervisorId: user.sub,
            };
        }
    } catch {
        // Ignore JWT errors and fall back to API-key auth.
    }

    const auth = await authenticateApiRequest(request.headers as IncomingHttpHeaders);
    if (!auth.ok) {
        return {
            ok: false,
            statusCode: auth.statusCode === 403 ? 403 : 401,
            payload: auth.payload,
        };
    }

    if (!isPlatformAdminPrincipal(auth.principal)) {
        return {
            ok: false as const,
            statusCode: 403,
            payload: platformAdminRequiredPayload(),
        };
    }

    return {
        ok: true as const,
        currentSupervisorId: null,
    };
}

async function requireSupervisorInviteIssuer(request: {
    jwtVerify: (options?: Record<string, unknown>) => Promise<unknown>;
    headers: Record<string, unknown>;
    user?: unknown;
}): Promise<
    | {
        ok: true;
        invitedBySupervisorId: number | null;
        enforcedDomainId: number | null;
        canChooseDomain: boolean;
    }
    | {
        ok: false;
        statusCode: 401 | 403;
        payload: {
            error: string;
            code: string;
            remediation?: string;
            context?: Record<string, unknown>;
        };
    }
> {
    try {
        await request.jwtVerify({ onlyCookie: true });
        const user = request.user as SupervisorSessionClaims | undefined;
        if (user?.role === 'supervisor') {
            const domainId = normalizeSupervisorDomainId(user.domainId);
            return {
                ok: true as const,
                invitedBySupervisorId: user.sub,
                enforcedDomainId: domainId,
                canChooseDomain: domainId === null,
            };
        }
    } catch {
        // Ignore JWT errors and fall back to API-key auth.
    }

    const auth = await authenticateApiRequest(request.headers as IncomingHttpHeaders);
    if (!auth.ok) {
        return {
            ok: false,
            statusCode: auth.statusCode === 403 ? 403 : 401,
            payload: auth.payload,
        };
    }

    if (!isPlatformAdminPrincipal(auth.principal)) {
        return {
            ok: false as const,
            statusCode: 403,
            payload: supervisorInviteIssuerRequiredPayload(),
        };
    }

    return {
        ok: true as const,
        invitedBySupervisorId: null,
        enforcedDomainId: null,
        canChooseDomain: true,
    };
}

export const supervisorAuthRoutes: FastifyPluginAsync = async (server: FastifyInstance) => {
    server.post('/login', {
        schema: {
            body: Type.Object({
                email: Type.String({ format: 'email' }),
                password: Type.String()
            }),
            response: {
                200: Type.Object({
                    ok: Type.Literal(true),
                    message: Type.String()
                }),
                401: Type.Object({
                    ok: Type.Literal(false),
                    error: Type.String()
                })
            }
        }
    }, async (request, reply) => {
        const { email, password } = request.body as { email: string; password: string };
        const normalizedEmail = normalizeSupervisorEmail(email);

        const [supervisor] = await db
            .select()
            .from(supervisors)
            .where(eq(supervisors.email, normalizedEmail))
            .limit(1);

        if (!supervisor) {
            return reply.status(401).send({ ok: false, error: 'Invalid credentials' });
        }

        const isValid = await bcrypt.compare(password, supervisor.passwordHash);
        if (!isValid) {
            return reply.status(401).send({ ok: false, error: 'Invalid credentials' });
        }

        const token = server.jwt.sign({
            sub: supervisor.id,
            email: supervisor.email,
            role: 'supervisor',
            domainId: supervisor.domainId ?? null,
        });

        await db
            .update(supervisors)
            .set({ lastLoginAt: new Date() })
            .where(eq(supervisors.id, supervisor.id));

        setSupervisorSessionCookie(reply, token);

        return { ok: true, message: 'Logged in successfully' };
    });

    server.post('/logout', {
        schema: {
            response: {
                200: Type.Object({
                    ok: Type.Literal(true)
                })
            }
        }
    }, async (_request, reply) => {
        reply.clearCookie('supervisor_session', { path: '/' });
        return { ok: true };
    });

    server.get('/me', {
        schema: {
            response: {
                200: SupervisorSessionSchema,
                401: Type.Object({
                    error: Type.String()
                })
            }
        }
    }, async (request, reply) => {
        try {
            await request.jwtVerify({ onlyCookie: true });
            const user = request.user as SupervisorSessionClaims;
            const domainId = typeof user.domainId === 'number' && Number.isInteger(user.domainId) && user.domainId > 0
                ? user.domainId
                : null;

            let domain: { id: number; name: string; hostname: string } | null = null;
            if (domainId !== null) {
                const [resolvedDomain] = await db
                    .select({
                        id: domains.id,
                        name: domains.name,
                        hostname: domains.hostname,
                    })
                    .from(domains)
                    .where(eq(domains.id, domainId));

                domain = resolvedDomain ?? null;
            }

            return serializeSupervisorSession({
                id: user.sub,
                email: user.email ?? '',
                domainId,
                domain,
            });
        } catch {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
    });

    server.put('/me/password', {
        schema: {
            body: Type.Object({
                currentPassword: Type.String({ minLength: 1 }),
                newPassword: Type.String({ minLength: 8 }),
            }),
            response: {
                200: Type.Object({
                    ok: Type.Literal(true),
                    message: Type.String(),
                }),
                401: Type.Object({
                    error: Type.String(),
                }),
                403: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.String(),
                }),
                404: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.String(),
                }),
            }
        }
    }, async (request, reply) => {
        try {
            await request.jwtVerify({ onlyCookie: true });
            const user = request.user as SupervisorSessionClaims;
            const supervisorId = Number(user.sub);
            if (!Number.isInteger(supervisorId) || supervisorId <= 0) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            const { currentPassword, newPassword } = request.body as {
                currentPassword: string;
                newPassword: string;
            };

            await changeSupervisorPassword({
                supervisorId,
                currentPassword,
                newPassword,
            });

            return {
                ok: true,
                message: 'Password updated successfully',
            };
        } catch (error) {
            if (error instanceof SupervisorPasswordMismatchError) {
                return reply.status(403).send(supervisorPasswordMismatchPayload());
            }
            if (error instanceof SupervisorNotFoundError) {
                return reply.status(404).send(supervisorNotFoundPayload(error.supervisorId));
            }
            if ((error as { code?: string }).code?.startsWith('FST_JWT')) {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            throw error;
        }
    });

    server.post('/invite', {
        schema: {
            body: Type.Object({
                email: Type.String({ format: 'email' }),
                domainId: Type.Optional(Type.Number({ minimum: 1 })),
                expiresInHours: Type.Optional(Type.Number({ minimum: 1, maximum: 168 })),
            }),
            response: {
                201: SupervisorInviteIssuedSchema,
                401: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.Optional(Type.String()),
                }),
                403: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.String(),
                }),
                404: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.String(),
                }),
                409: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.String(),
                }),
            }
        }
    }, async (request, reply) => {
        const auth = await requireSupervisorInviteIssuer(request);
        if (!auth.ok) {
            return reply.status(auth.statusCode).send(auth.payload);
        }

        const body = request.body as {
            email: string;
            domainId?: number;
            expiresInHours?: number;
        };

        const requestedDomainId = body.domainId ?? null;
        if (!auth.canChooseDomain && requestedDomainId !== null && requestedDomainId !== auth.enforcedDomainId) {
            return reply.status(403).send(supervisorInviteScopeMismatchPayload(auth.enforcedDomainId!));
        }

        const domainId = auth.canChooseDomain
            ? requestedDomainId
            : auth.enforcedDomainId;

        try {
            const issued = await issueSupervisorInvite({
                email: body.email,
                domainId,
                invitedBySupervisorId: auth.invitedBySupervisorId,
                expiresInHours: body.expiresInHours,
            });
            const { invitePath, inviteUrl } = buildSupervisorInviteUrl(request.headers as IncomingHttpHeaders, issued.token);
            return reply.status(201).send(serializeIssuedSupervisorInvite(issued, invitePath, inviteUrl));
        } catch (error) {
            if (error instanceof SupervisorDomainNotFoundError) {
                return reply.status(404).send(supervisorDomainNotFoundPayload(error.domainId));
            }
            if (error instanceof SupervisorEmailConflictError) {
                return reply.status(409).send(supervisorEmailConflictPayload(error.email, error.existingSupervisor));
            }
            throw error;
        }
    });

    server.get('/invite/:token', {
        schema: {
            params: Type.Object({
                token: Type.String({ minLength: 1 }),
            }),
            response: {
                200: SupervisorInvitePreviewSchema,
                404: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.String(),
                }),
                410: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.String(),
                }),
            }
        }
    }, async (request, reply) => {
        const params = request.params as { token: string };

        try {
            const invite = await getSupervisorInviteByToken(params.token);
            return serializeSupervisorInvite(invite);
        } catch (error) {
            if (error instanceof SupervisorInviteNotFoundError) {
                return reply.status(404).send(supervisorInviteNotFoundPayload());
            }
            if (error instanceof SupervisorInviteExpiredError) {
                return reply.status(410).send(supervisorInviteExpiredPayload());
            }
            if (error instanceof SupervisorInviteAlreadyAcceptedError) {
                return reply.status(410).send(supervisorInviteAlreadyAcceptedPayload());
            }
            throw error;
        }
    });

    server.post('/invite/accept', {
        schema: {
            body: Type.Object({
                token: Type.String({ minLength: 1 }),
                password: Type.String({ minLength: 8 }),
            }),
            response: {
                201: Type.Object({
                    ok: Type.Literal(true),
                    supervisor: SupervisorSessionSchema,
                }),
                404: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.String(),
                }),
                409: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.String(),
                }),
                410: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.String(),
                }),
            }
        }
    }, async (request, reply) => {
        const body = request.body as {
            token: string;
            password: string;
        };

        try {
            const accepted = await acceptSupervisorInvite({
                token: body.token,
                password: body.password,
            });

            const token = server.jwt.sign({
                sub: accepted.supervisor.id,
                email: accepted.supervisor.email,
                role: 'supervisor',
                domainId: accepted.supervisor.domainId ?? null,
            });

            setSupervisorSessionCookie(reply, token);

            return reply.status(201).send({
                ok: true,
                supervisor: serializeSupervisorSession({
                    id: accepted.supervisor.id,
                    email: accepted.supervisor.email,
                    domainId: accepted.supervisor.domainId,
                    domain: accepted.domain,
                }),
            });
        } catch (error) {
            if (error instanceof SupervisorInviteNotFoundError) {
                return reply.status(404).send(supervisorInviteNotFoundPayload());
            }
            if (error instanceof SupervisorDomainNotFoundError) {
                return reply.status(404).send(supervisorDomainNotFoundPayload(error.domainId));
            }
            if (error instanceof SupervisorInviteExpiredError) {
                return reply.status(410).send(supervisorInviteExpiredPayload());
            }
            if (error instanceof SupervisorInviteAlreadyAcceptedError) {
                return reply.status(410).send(supervisorInviteAlreadyAcceptedPayload());
            }
            if (error instanceof SupervisorEmailConflictError) {
                return reply.status(409).send(supervisorEmailConflictPayload(error.email, error.existingSupervisor));
            }
            throw error;
        }
    });

    server.get('/', {
        schema: {
            response: {
                200: Type.Array(SupervisorListEntrySchema),
                401: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.Optional(Type.String()),
                }),
                403: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.String(),
                }),
            }
        }
    }, async (request, reply) => {
        const auth = await requirePlatformAdminActor(request);
        if (!auth.ok) {
            return reply.status(auth.statusCode).send(auth.payload);
        }

        const entries = await listSupervisors();
        return entries.map((entry) => serializeSupervisorListEntry(entry));
    });

    server.post('/', {
        schema: {
            body: Type.Object({
                email: Type.String({ format: 'email' }),
                password: Type.String({ minLength: 8 }),
                domainId: Type.Optional(Type.Number({ minimum: 1 })),
            }),
            response: {
                201: SupervisorListEntrySchema,
                401: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.Optional(Type.String()),
                }),
                403: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.String(),
                }),
                404: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.String(),
                }),
                409: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.String(),
                }),
            }
        }
    }, async (request, reply) => {
        const auth = await requirePlatformAdminActor(request);
        if (!auth.ok) {
            return reply.status(auth.statusCode).send(auth.payload);
        }

        const body = request.body as {
            email: string;
            password: string;
            domainId?: number;
        };

        try {
            const created = await createSupervisorAccount({
                email: body.email,
                password: body.password,
                domainId: body.domainId ?? null,
            });

            return reply.status(201).send(serializeSupervisorListEntry({
                id: created.supervisor.id,
                email: created.supervisor.email,
                domainId: created.supervisor.domainId,
                createdAt: created.supervisor.createdAt,
                lastLoginAt: created.supervisor.lastLoginAt,
                domain: created.domain,
            }));
        } catch (error) {
            if (error instanceof SupervisorDomainNotFoundError) {
                return reply.status(404).send(supervisorDomainNotFoundPayload(error.domainId));
            }
            if (error instanceof SupervisorEmailConflictError) {
                return reply.status(409).send(supervisorEmailConflictPayload(error.email, error.existingSupervisor));
            }
            throw error;
        }
    });

    server.delete('/:id', {
        schema: {
            params: Type.Object({
                id: Type.Number({ minimum: 1 }),
            }),
            response: {
                204: Type.Null(),
                401: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.Optional(Type.String()),
                }),
                403: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.String(),
                }),
                404: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.String(),
                }),
                409: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.String(),
                }),
            }
        }
    }, async (request, reply) => {
        const auth = await requirePlatformAdminActor(request);
        if (!auth.ok) {
            return reply.status(auth.statusCode).send(auth.payload);
        }

        const params = request.params as { id: number };

        try {
            await deleteSupervisorAccount({
                supervisorId: params.id,
                currentSupervisorId: auth.currentSupervisorId,
            });

            return reply.status(204).send(null);
        } catch (error) {
            if (error instanceof SupervisorNotFoundError) {
                return reply.status(404).send(supervisorNotFoundPayload(error.supervisorId));
            }
            if (error instanceof SupervisorSelfDeleteForbiddenError) {
                return reply.status(409).send(supervisorSelfDeleteForbiddenPayload());
            }
            if (error instanceof LastPlatformSupervisorError) {
                return reply.status(409).send(lastPlatformSupervisorPayload());
            }
            throw error;
        }
    });

    server.post('/setup-initial', {
        schema: {
            headers: Type.Object({
                'x-setup-token': Type.Optional(Type.String())
            }),
            body: Type.Object({
                email: Type.String({ format: 'email' }),
                password: Type.String({ minLength: 8 })
            })
        }
    }, async (request, reply) => {
        const setupToken = process.env.SETUP_TOKEN;
        if (process.env.NODE_ENV === 'production') {
            const providedToken = (request.headers as { 'x-setup-token'?: string })['x-setup-token'];
            if (!setupToken || providedToken !== setupToken) {
                return reply.status(403).send({ error: 'Invalid or missing SETUP_TOKEN' });
            }
        }

        const existing = await db.select({ id: supervisors.id }).from(supervisors).limit(1);
        if (existing.length > 0) {
            return reply.status(403).send({ error: 'Initial supervisor already exists' });
        }

        const { email, password } = request.body as { email: string; password: string };
        const created = await createSupervisorAccount({
            email,
            password,
            domainId: null,
        });

        return { ok: true, id: created.supervisor.id };
    });
};
