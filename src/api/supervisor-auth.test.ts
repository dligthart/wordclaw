import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    dbMock: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        transaction: vi.fn(),
    },
}));

vi.mock('../db/index.js', () => ({
    db: mocks.dbMock,
}));

import { supervisorAuthRoutes } from './supervisor-auth.js';

const originalAuthRequired = process.env.AUTH_REQUIRED;
const originalApiKeys = process.env.API_KEYS;

async function buildServer(): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });
    await app.register(fastifyJwt, {
        secret: 'test-supervisor-secret',
        cookie: {
            cookieName: 'supervisor_session',
            signed: false
        }
    });
    await app.register(fastifyCookie, {
        secret: 'test-cookie-secret',
        hook: 'onRequest'
    });
    await app.register(supervisorAuthRoutes, { prefix: '/api/supervisors' });
    await app.ready();
    return app;
}

function resetMocks() {
    mocks.dbMock.select.mockReset();
    mocks.dbMock.insert.mockReset();
    mocks.dbMock.update.mockReset();
    mocks.dbMock.delete.mockReset();
    mocks.dbMock.transaction.mockReset();
}

describe('supervisorAuthRoutes', () => {
    beforeEach(() => {
        resetMocks();
        process.env.AUTH_REQUIRED = 'true';
        delete process.env.API_KEYS;
    });

    afterEach(() => {
        resetMocks();
        if (originalAuthRequired === undefined) {
            delete process.env.AUTH_REQUIRED;
        } else {
            process.env.AUTH_REQUIRED = originalAuthRequired;
        }
        if (originalApiKeys === undefined) {
            delete process.env.API_KEYS;
        } else {
            process.env.API_KEYS = originalApiKeys;
        }
    });

    it('returns tenant scope and domain context at /me for scoped supervisors', async () => {
        const app = await buildServer();

        try {
            const token = app.jwt.sign({
                sub: 3,
                email: 'tenant-admin@example.com',
                role: 'supervisor',
                domainId: 7,
            });

            mocks.dbMock.select.mockReturnValueOnce({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 7,
                        name: 'Tenant A',
                        hostname: 'tenant-a.example.com',
                    }]),
                }),
            });

            const response = await app.inject({
                method: 'GET',
                url: '/api/supervisors/me',
                headers: {
                    cookie: `supervisor_session=${token}`,
                }
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({
                id: 3,
                email: 'tenant-admin@example.com',
                scope: 'tenant',
                domainId: 7,
                domain: {
                    id: 7,
                    name: 'Tenant A',
                    hostname: 'tenant-a.example.com',
                }
            });
        } finally {
            await app.close();
        }
    });

    it('rejects tenant-scoped supervisor sessions when creating additional supervisors', async () => {
        const app = await buildServer();

        try {
            const token = app.jwt.sign({
                sub: 4,
                email: 'tenant-admin@example.com',
                role: 'supervisor',
                domainId: 7,
            });

            const response = await app.inject({
                method: 'POST',
                url: '/api/supervisors',
                headers: {
                    cookie: `supervisor_session=${token}`,
                },
                payload: {
                    email: 'new-admin@example.com',
                    password: 'password123',
                    domainId: 7,
                }
            });

            expect(response.statusCode).toBe(403);
            expect(response.json()).toEqual({
                error: 'Platform admin required',
                code: 'PLATFORM_ADMIN_REQUIRED',
                remediation: 'Use a platform-scoped supervisor session or env-backed admin key to manage supervisor accounts.'
            });
        } finally {
            await app.close();
        }
    });

    it('creates tenant-scoped supervisors for platform-admin API keys', async () => {
        process.env.API_KEYS = 'platform-admin=admin|tenant:admin';
        const app = await buildServer();

        try {
            mocks.dbMock.select.mockReturnValueOnce({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 7,
                        name: 'Tenant A',
                        hostname: 'tenant-a.example.com',
                    }]),
                }),
            });
            mocks.dbMock.insert.mockReturnValueOnce({
                values: () => ({
                    returning: vi.fn().mockResolvedValue([{
                        id: 10,
                        email: 'tenant-admin@example.com',
                        domainId: 7,
                        passwordHash: 'hash',
                        createdAt: new Date('2026-03-31T16:00:00Z'),
                        lastLoginAt: null,
                    }]),
                }),
            });

            const response = await app.inject({
                method: 'POST',
                url: '/api/supervisors',
                headers: {
                    'x-api-key': 'platform-admin',
                },
                payload: {
                    email: 'tenant-admin@example.com',
                    password: 'password123',
                    domainId: 7,
                }
            });

            expect(response.statusCode).toBe(201);
            expect(response.json()).toEqual({
                id: 10,
                email: 'tenant-admin@example.com',
                scope: 'tenant',
                domainId: 7,
                domain: {
                    id: 7,
                    name: 'Tenant A',
                    hostname: 'tenant-a.example.com',
                },
                createdAt: '2026-03-31T16:00:00.000Z',
                lastLoginAt: null,
            });
        } finally {
            await app.close();
        }
    });

    it('allows authenticated supervisors to change their own password', async () => {
        const app = await buildServer();

        try {
            const token = app.jwt.sign({
                sub: 7,
                email: 'tenant-admin@example.com',
                role: 'supervisor',
                domainId: 7,
            });
            const currentPasswordHash = await bcrypt.hash('old-password', 10);
            const setMock = vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            });

            mocks.dbMock.select.mockReturnValueOnce({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 7,
                        passwordHash: currentPasswordHash,
                    }]),
                }),
            });
            mocks.dbMock.update.mockReturnValueOnce({
                set: setMock,
            });

            const response = await app.inject({
                method: 'PUT',
                url: '/api/supervisors/me/password',
                headers: {
                    cookie: `supervisor_session=${token}`,
                },
                payload: {
                    currentPassword: 'old-password',
                    newPassword: 'new-password-123',
                }
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({
                ok: true,
                message: 'Password updated successfully',
            });
            expect(mocks.dbMock.update).toHaveBeenCalledTimes(1);
            expect(setMock).toHaveBeenCalledTimes(1);
            expect(setMock.mock.calls[0][0]).toEqual({
                passwordHash: expect.any(String),
            });
            expect(setMock.mock.calls[0][0].passwordHash).not.toBe(currentPasswordHash);
            await expect(
                bcrypt.compare('new-password-123', setMock.mock.calls[0][0].passwordHash)
            ).resolves.toBe(true);
        } finally {
            await app.close();
        }
    });

    it('rejects password changes when the current password is wrong', async () => {
        const app = await buildServer();

        try {
            const token = app.jwt.sign({
                sub: 7,
                email: 'tenant-admin@example.com',
                role: 'supervisor',
                domainId: 7,
            });
            const currentPasswordHash = await bcrypt.hash('old-password', 10);

            mocks.dbMock.select.mockReturnValueOnce({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 7,
                        passwordHash: currentPasswordHash,
                    }]),
                }),
            });

            const response = await app.inject({
                method: 'PUT',
                url: '/api/supervisors/me/password',
                headers: {
                    cookie: `supervisor_session=${token}`,
                },
                payload: {
                    currentPassword: 'wrong-password',
                    newPassword: 'new-password-123',
                }
            });

            expect(response.statusCode).toBe(403);
            expect(response.json()).toEqual({
                error: 'Current password is incorrect',
                code: 'SUPERVISOR_PASSWORD_MISMATCH',
                remediation: 'Provide the current supervisor password and retry the password change.',
            });
            expect(mocks.dbMock.update).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('requires an authenticated supervisor session for password changes', async () => {
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'PUT',
                url: '/api/supervisors/me/password',
                payload: {
                    currentPassword: 'old-password',
                    newPassword: 'new-password-123',
                }
            });

            expect(response.statusCode).toBe(401);
            expect(response.json()).toEqual({
                error: 'Unauthorized',
            });
        } finally {
            await app.close();
        }
    });

    it('issues tenant-scoped invites for tenant supervisor sessions', async () => {
        const app = await buildServer();

        try {
            const token = app.jwt.sign({
                sub: 7,
                email: 'tenant-admin@example.com',
                role: 'supervisor',
                domainId: 12,
            });

            mocks.dbMock.select
                .mockReturnValueOnce({
                    from: () => ({
                        where: vi.fn().mockResolvedValue([]),
                    }),
                })
                .mockReturnValueOnce({
                    from: () => ({
                        where: vi.fn().mockResolvedValue([{
                            id: 12,
                            name: 'ACME Publishing',
                            hostname: 'acme.example.com',
                        }]),
                    }),
                });
            mocks.dbMock.insert.mockReturnValueOnce({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{
                        id: 33,
                        email: 'new-operator@example.com',
                        tokenHash: 'hashed-token',
                        domainId: 12,
                        invitedBySupervisorId: 7,
                        expiresAt: new Date('2026-04-03T16:00:00Z'),
                        acceptedAt: null,
                        createdAt: new Date('2026-03-31T16:00:00Z'),
                    }]),
                }),
            });

            const response = await app.inject({
                method: 'POST',
                url: '/api/supervisors/invite',
                headers: {
                    cookie: `supervisor_session=${token}`,
                    host: 'kb.lightheart.tech',
                    'x-forwarded-proto': 'https',
                },
                payload: {
                    email: 'new-operator@example.com',
                },
            });

            expect(response.statusCode).toBe(201);
            expect(response.json()).toEqual(expect.objectContaining({
                email: 'new-operator@example.com',
                scope: 'tenant',
                domainId: 12,
                domain: {
                    id: 12,
                    name: 'ACME Publishing',
                    hostname: 'acme.example.com',
                },
                invitePath: expect.stringMatching(/^\/ui\/invite\?token=/),
                inviteUrl: expect.stringMatching(/^https:\/\/kb\.lightheart\.tech\/ui\/invite\?token=/),
                token: expect.any(String),
                expiresAt: '2026-04-03T16:00:00.000Z',
            }));
        } finally {
            await app.close();
        }
    });

    it('rejects invite domain overrides for tenant-scoped supervisor sessions', async () => {
        const app = await buildServer();

        try {
            const token = app.jwt.sign({
                sub: 7,
                email: 'tenant-admin@example.com',
                role: 'supervisor',
                domainId: 12,
            });

            const response = await app.inject({
                method: 'POST',
                url: '/api/supervisors/invite',
                headers: {
                    cookie: `supervisor_session=${token}`,
                },
                payload: {
                    email: 'new-operator@example.com',
                    domainId: 44,
                },
            });

            expect(response.statusCode).toBe(403);
            expect(response.json()).toEqual({
                error: 'Supervisor invite scope mismatch',
                code: 'SUPERVISOR_INVITE_DOMAIN_SCOPE_MISMATCH',
                remediation: 'Tenant-scoped supervisors can only invite operators for domain 12. Omit domainId or use the bound domain.',
            });
            expect(mocks.dbMock.select).not.toHaveBeenCalled();
            expect(mocks.dbMock.insert).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('accepts valid supervisor invites and starts a supervisor session', async () => {
        const app = await buildServer();

        try {
            mocks.dbMock.transaction.mockImplementationOnce(async (callback: (tx: {
                select: typeof vi.fn;
                insert: typeof vi.fn;
                update: typeof vi.fn;
            }) => Promise<unknown>) => {
                const txSelect = vi.fn()
                    .mockReturnValueOnce({
                        from: () => ({
                            leftJoin: () => ({
                                where: vi.fn().mockResolvedValue([{
                                    id: 41,
                                    email: 'invited@example.com',
                                    domainId: 12,
                                    invitedBySupervisorId: 7,
                                    expiresAt: new Date('2026-04-03T16:00:00Z'),
                                    acceptedAt: null,
                                    createdAt: new Date('2026-03-31T16:00:00Z'),
                                    domainName: 'ACME Publishing',
                                    domainHostname: 'acme.example.com',
                                }]),
                            }),
                        }),
                    })
                    .mockReturnValueOnce({
                        from: () => ({
                            where: vi.fn().mockResolvedValue([{
                                id: 12,
                                name: 'ACME Publishing',
                                hostname: 'acme.example.com',
                            }]),
                        }),
                    });

                const txInsert = vi.fn().mockReturnValue({
                    values: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{
                            id: 18,
                            email: 'invited@example.com',
                            passwordHash: 'hashed-password',
                            domainId: 12,
                            createdAt: new Date('2026-03-31T16:05:00Z'),
                            lastLoginAt: null,
                        }]),
                    }),
                });

                const txUpdate = vi.fn().mockReturnValue({
                    set: vi.fn().mockReturnValue({
                        where: vi.fn().mockResolvedValue(undefined),
                    }),
                });

                return callback({
                    select: txSelect,
                    insert: txInsert,
                    update: txUpdate,
                });
            });

            const response = await app.inject({
                method: 'POST',
                url: '/api/supervisors/invite/accept',
                payload: {
                    token: 'invite-token-123',
                    password: 'super-secret-123',
                },
            });

            expect(response.statusCode).toBe(201);
            expect(response.json()).toEqual({
                ok: true,
                supervisor: {
                    id: 18,
                    email: 'invited@example.com',
                    scope: 'tenant',
                    domainId: 12,
                    domain: {
                        id: 12,
                        name: 'ACME Publishing',
                        hostname: 'acme.example.com',
                    },
                },
            });
            expect(response.headers['set-cookie']).toEqual(
                expect.stringContaining('supervisor_session='),
            );
        } finally {
            await app.close();
        }
    });

    it('deletes tenant-scoped supervisors for platform supervisor sessions', async () => {
        const app = await buildServer();

        try {
            const token = app.jwt.sign({
                sub: 1,
                email: 'platform@example.com',
                role: 'supervisor',
                domainId: null,
            });
            const deleteWhereMock = vi.fn().mockResolvedValue(undefined);

            mocks.dbMock.select.mockReturnValueOnce({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 7,
                        email: 'tenant-admin@example.com',
                        domainId: 12,
                    }]),
                }),
            });
            mocks.dbMock.delete.mockReturnValueOnce({
                where: deleteWhereMock,
            });

            const response = await app.inject({
                method: 'DELETE',
                url: '/api/supervisors/7',
                headers: {
                    cookie: `supervisor_session=${token}`,
                },
            });

            expect(response.statusCode).toBe(204);
            expect(mocks.dbMock.delete).toHaveBeenCalledTimes(1);
            expect(deleteWhereMock).toHaveBeenCalledTimes(1);
        } finally {
            await app.close();
        }
    });

    it('rejects self-delete for platform supervisor sessions', async () => {
        const app = await buildServer();

        try {
            const token = app.jwt.sign({
                sub: 1,
                email: 'platform@example.com',
                role: 'supervisor',
                domainId: null,
            });

            mocks.dbMock.select.mockReturnValueOnce({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 1,
                        email: 'platform@example.com',
                        domainId: null,
                    }]),
                }),
            });

            const response = await app.inject({
                method: 'DELETE',
                url: '/api/supervisors/1',
                headers: {
                    cookie: `supervisor_session=${token}`,
                },
            });

            expect(response.statusCode).toBe(409);
            expect(response.json()).toEqual({
                error: 'Supervisor cannot delete the current session account',
                code: 'SUPERVISOR_SELF_DELETE_FORBIDDEN',
                remediation: 'Use a different platform supervisor account to remove this operator, or sign out instead.',
            });
            expect(mocks.dbMock.delete).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('rejects deleting the last remaining platform supervisor', async () => {
        process.env.API_KEYS = 'platform-admin=admin|tenant:admin';
        const app = await buildServer();

        try {
            mocks.dbMock.select
                .mockReturnValueOnce({
                    from: () => ({
                        where: vi.fn().mockResolvedValue([{
                            id: 1,
                            email: 'platform@example.com',
                            domainId: null,
                        }]),
                    }),
                })
                .mockReturnValueOnce({
                    from: () => ({
                        where: vi.fn().mockResolvedValue([{
                            id: 1,
                        }]),
                    }),
                });

            const response = await app.inject({
                method: 'DELETE',
                url: '/api/supervisors/1',
                headers: {
                    'x-api-key': 'platform-admin',
                },
            });

            expect(response.statusCode).toBe(409);
            expect(response.json()).toEqual({
                error: 'Cannot remove the last platform supervisor',
                code: 'SUPERVISOR_LAST_PLATFORM_SUPERVISOR',
                remediation: 'Create another platform-scoped supervisor before deleting the final remaining platform admin account.',
            });
            expect(mocks.dbMock.delete).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('lists supervisors for platform-admin API keys', async () => {
        process.env.API_KEYS = 'platform-admin=admin|tenant:admin';
        const app = await buildServer();

        try {
            mocks.dbMock.select.mockReturnValueOnce({
                from: () => ({
                    leftJoin: () => ({
                        orderBy: vi.fn().mockResolvedValue([{
                            id: 1,
                            email: 'platform@example.com',
                            domainId: null,
                            createdAt: new Date('2026-03-31T15:00:00Z'),
                            lastLoginAt: new Date('2026-03-31T15:30:00Z'),
                            domainName: null,
                            domainHostname: null,
                        }, {
                            id: 2,
                            email: 'tenant@example.com',
                            domainId: 7,
                            createdAt: new Date('2026-03-31T15:05:00Z'),
                            lastLoginAt: null,
                            domainName: 'Tenant A',
                            domainHostname: 'tenant-a.example.com',
                        }]),
                    }),
                }),
            });

            const response = await app.inject({
                method: 'GET',
                url: '/api/supervisors',
                headers: {
                    'x-api-key': 'platform-admin',
                }
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual([{
                id: 1,
                email: 'platform@example.com',
                scope: 'platform',
                domainId: null,
                domain: null,
                createdAt: '2026-03-31T15:00:00.000Z',
                lastLoginAt: '2026-03-31T15:30:00.000Z',
            }, {
                id: 2,
                email: 'tenant@example.com',
                scope: 'tenant',
                domainId: 7,
                domain: {
                    id: 7,
                    name: 'Tenant A',
                    hostname: 'tenant-a.example.com',
                },
                createdAt: '2026-03-31T15:05:00.000Z',
                lastLoginAt: null,
            }]);
        } finally {
            await app.close();
        }
    });
});
