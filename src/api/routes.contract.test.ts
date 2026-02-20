import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const dbMock = {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        transaction: vi.fn(),
    };

    return {
        dbMock,
        logAuditMock: vi.fn(),
    };
});

vi.mock('../db/index.js', () => ({
    db: mocks.dbMock,
}));

vi.mock('../services/audit.js', () => ({
    logAudit: mocks.logAuditMock,
}));

import { errorHandler } from './error-handler.js';
import apiRoutes from './routes.js';

type ApiErrorBody = {
    error: string;
    code: string;
    remediation: string;
};

async function buildServer(): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });
    app.setErrorHandler(errorHandler);
    await app.register(apiRoutes, { prefix: '/api' });
    return app;
}

function resetMocks() {
    mocks.dbMock.select.mockReset();
    mocks.dbMock.insert.mockReset();
    mocks.dbMock.update.mockReset();
    mocks.dbMock.delete.mockReset();
    mocks.dbMock.transaction.mockReset();
    mocks.logAuditMock.mockReset();
}

const originalAuthRequired = process.env.AUTH_REQUIRED;
const originalApiKeys = process.env.API_KEYS;

function restoreAuthEnv() {
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
}

describe('API Route Contracts', () => {
    beforeEach(() => {
        resetMocks();
        process.env.AUTH_REQUIRED = 'false';
        delete process.env.API_KEYS;
    });

    afterEach(() => {
        resetMocks();
        restoreAuthEnv();
    });

    it('returns EMPTY_UPDATE_BODY for content-type update with empty body', async () => {
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'PUT',
                url: '/api/content-types/1',
                payload: {}
            });

            expect(response.statusCode).toBe(400);

            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('EMPTY_UPDATE_BODY');
            expect(body.remediation).toContain('at least one field');
            expect(mocks.dbMock.update).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('returns EMPTY_UPDATE_BODY for content-item update with empty body', async () => {
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'PUT',
                url: '/api/content-items/1',
                payload: {}
            });

            expect(response.statusCode).toBe(400);

            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('EMPTY_UPDATE_BODY');
            expect(body.remediation).toContain('at least one field');
            expect(mocks.dbMock.transaction).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('returns INVALID_CONTENT_SCHEMA_JSON for content-type create with invalid schema JSON', async () => {
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-types',
                payload: {
                    name: 'Invalid Schema Type',
                    slug: 'invalid-schema-type',
                    schema: '{not-json'
                }
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('INVALID_CONTENT_SCHEMA_JSON');
            expect(mocks.dbMock.insert).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('maps missing rollback target version to 404 TARGET_VERSION_NOT_FOUND', async () => {
        const app = await buildServer();

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ id: 1, contentTypeId: 9, version: 3 }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([]),
                }),
            }));

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-items/1/rollback',
                payload: { version: 999 }
            });

            expect(response.statusCode).toBe(404);

            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('TARGET_VERSION_NOT_FOUND');
            expect(body.remediation).toContain('GET /api/content-items/1/versions');
            expect(mocks.dbMock.transaction).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('supports dry-run rollback without executing a transaction', async () => {
        const app = await buildServer();

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ id: 1, contentTypeId: 4, version: 3 }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ id: 10, version: 2, data: '{}', status: 'draft' }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 4,
                        schema: '{"type":"object"}'
                    }]),
                }),
            }));

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-items/1/rollback?mode=dry_run',
                payload: { version: 2 }
            });

            expect(response.statusCode).toBe(200);

            const body = response.json() as { meta?: { dryRun?: boolean } };
            expect(body.meta?.dryRun).toBe(true);
            expect(mocks.dbMock.transaction).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('returns CONTENT_ITEM_NOT_FOUND when rollback transaction returns null', async () => {
        const app = await buildServer();

        mocks.dbMock.select
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ id: 42, contentTypeId: 7, version: 4 }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{ id: 77, version: 1, data: '{"title":"ok"}', status: 'draft' }]),
                }),
            }))
            .mockImplementationOnce(() => ({
                from: () => ({
                    where: vi.fn().mockResolvedValue([{
                        id: 7,
                        schema: '{"type":"object"}'
                    }]),
                }),
            }));

        mocks.dbMock.transaction.mockResolvedValue(null);

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-items/42/rollback',
                payload: { version: 1 }
            });

            expect(response.statusCode).toBe(404);

            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('CONTENT_ITEM_NOT_FOUND');
            expect(mocks.logAuditMock).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('returns AUTH_MISSING_API_KEY when auth is required', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'writer=content:read|content:write|audit:read';
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/content-types'
            });

            expect(response.statusCode).toBe(401);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('AUTH_MISSING_API_KEY');
        } finally {
            await app.close();
        }
    });

    it('returns AUTH_INSUFFICIENT_SCOPE when write scope is missing', async () => {
        process.env.AUTH_REQUIRED = 'true';
        process.env.API_KEYS = 'reader=content:read|audit:read';
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-types',
                headers: {
                    'x-api-key': 'reader'
                },
                payload: {
                    name: 'Type',
                    slug: 'type',
                    schema: '{"type":"object"}'
                }
            });

            expect(response.statusCode).toBe(403);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('AUTH_INSUFFICIENT_SCOPE');
        } finally {
            await app.close();
        }
    });

    it('returns INVALID_CONTENT_DATA_JSON for content-item create with invalid JSON data', async () => {
        const app = await buildServer();

        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    id: 1,
                    schema: '{"type":"object"}'
                }]),
            }),
        }));

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-items',
                payload: {
                    contentTypeId: 1,
                    data: '{bad-json',
                    status: 'draft'
                }
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('INVALID_CONTENT_DATA_JSON');
            expect(mocks.dbMock.insert).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('returns CONTENT_SCHEMA_VALIDATION_FAILED for schema mismatch on content-item create', async () => {
        const app = await buildServer();

        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    id: 1,
                    schema: '{"type":"object","required":["title"],"properties":{"title":{"type":"string"}}}'
                }]),
            }),
        }));

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-items',
                payload: {
                    contentTypeId: 1,
                    data: '{"title":123}',
                    status: 'draft'
                }
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('CONTENT_SCHEMA_VALIDATION_FAILED');
            expect(mocks.dbMock.insert).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('returns INVALID_CREATED_AFTER for malformed content-item filter date', async () => {
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'GET',
                url: '/api/content-items?createdAfter=not-a-date'
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('INVALID_CREATED_AFTER');
        } finally {
            await app.close();
        }
    });

    it('returns INVALID_WEBHOOK_EVENTS when webhook registration has empty events', async () => {
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/webhooks',
                payload: {
                    url: 'https://example.com/hooks/wordclaw',
                    events: [],
                    secret: 'test-secret'
                }
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('INVALID_WEBHOOK_EVENTS');
            expect(mocks.dbMock.insert).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });

    it('returns EMPTY_UPDATE_BODY for webhook update with empty body', async () => {
        const app = await buildServer();

        try {
            const response = await app.inject({
                method: 'PUT',
                url: '/api/webhooks/1',
                payload: {}
            });

            expect(response.statusCode).toBe(400);
            const body = response.json() as ApiErrorBody;
            expect(body.code).toBe('EMPTY_UPDATE_BODY');
        } finally {
            await app.close();
        }
    });

    it('supports dry-run batch create without executing a transaction', async () => {
        const app = await buildServer();

        mocks.dbMock.select.mockImplementation(() => ({
            from: () => ({
                where: vi.fn().mockResolvedValue([{
                    id: 4,
                    schema: '{"type":"object"}'
                }]),
            }),
        }));

        try {
            const response = await app.inject({
                method: 'POST',
                url: '/api/content-items/batch?mode=dry_run&atomic=true',
                payload: {
                    items: [{
                        contentTypeId: 4,
                        data: '{"title":"ok"}',
                        status: 'draft'
                    }]
                }
            });

            expect(response.statusCode).toBe(200);
            const body = response.json() as { data?: { atomic?: boolean; results?: Array<{ ok?: boolean }> }; meta?: { dryRun?: boolean } };
            expect(body.data?.atomic).toBe(true);
            expect(body.data?.results?.[0]?.ok).toBe(true);
            expect(body.meta?.dryRun).toBe(true);
            expect(mocks.dbMock.transaction).not.toHaveBeenCalled();
        } finally {
            await app.close();
        }
    });
});
