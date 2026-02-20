import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { supervisors } from '../db/schema.js';

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
        const { email, password } = request.body as any;

        const [supervisor] = await db
            .select()
            .from(supervisors)
            .where(eq(supervisors.email, email))
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
            role: 'supervisor'
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
    }, async (request, reply) => {
        reply.clearCookie('supervisor_session', { path: '/' });
        return { ok: true };
    });

    server.get('/me', {
        schema: {
            response: {
                200: Type.Object({
                    id: Type.Number(),
                    email: Type.String()
                }),
                401: Type.Object({
                    error: Type.String()
                })
            }
        }
    }, async (request, reply) => {
        try {
            await request.jwtVerify({ onlyCookie: true });
            const user = request.user as { sub: number, email: string };
            return {
                id: user.sub,
                email: user.email
            };
        } catch (err) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }
    });

    server.post('/setup-initial', {
        schema: {
            body: Type.Object({
                email: Type.String({ format: 'email' }),
                password: Type.String()
            })
        }
    }, async (request, reply) => {
        // Only allow if no supervisors exist
        const existing = await db.select({ id: supervisors.id }).from(supervisors).limit(1);
        if (existing.length > 0) {
            return reply.status(403).send({ error: 'Initial supervisor already exists' });
        }

        const { email, password } = request.body as any;
        const passwordHash = await bcrypt.hash(password, 10);

        const [created] = await db.insert(supervisors).values({
            email,
            passwordHash
        }).returning();

        return { ok: true, id: created.id };
    });
};
