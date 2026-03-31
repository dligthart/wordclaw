import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    dbMock: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
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
