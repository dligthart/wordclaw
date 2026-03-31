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
    createSupervisorAccount,
    listSupervisors,
    normalizeSupervisorEmail,
    SupervisorDomainNotFoundError,
    SupervisorEmailConflictError,
} from '../services/supervisor.js';
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

function platformAdminRequiredPayload() {
    return {
        error: 'Platform admin required',
        code: 'PLATFORM_ADMIN_REQUIRED',
        remediation: 'Use a platform-scoped supervisor session or env-backed admin key to manage supervisor accounts.'
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
    | { ok: true }
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

            return { ok: true as const };
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

    return { ok: true as const };
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

        reply.setCookie('supervisor_session', token, {
            path: '/',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 86400 // 1 day
        });

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
