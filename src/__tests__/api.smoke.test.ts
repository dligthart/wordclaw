import { describe, it, expect } from 'vitest';

const API_URL = process.env.API_URL || 'http://localhost:4000/api';
const RUN_INTEGRATION = process.env.RUN_INTEGRATION === '1';
const integrationDescribe = RUN_INTEGRATION ? describe : describe.skip;

type ApiListResponse<T> = {
    data: T[];
};

type ApiEntityResponse<T> = {
    data: T;
    meta: {
        recommendedNextAction?: string;
        dryRun?: boolean;
    };
};

type ContentType = {
    id: number;
    slug: string;
    description?: string;
};

type ContentItem = {
    id: number;
    version: number;
};

type ApiError = {
    code: string;
    remediation?: string;
};

async function json<T>(res: Response): Promise<T> {
    return (await res.json()) as T;
}

integrationDescribe('WordClaw API Smoke Tests', () => {
    let typeId: number;
    let itemId: number;

    it('GET /health returns ok', async () => {
        const res = await fetch(`${API_URL.replace('/api', '')}/health`);
        expect(res.status).toBe(200);
        const body = await json<{ status: string }>(res);
        expect(body.status).toBe('ok');
    });

    describe('Content Types CRUD', () => {
        it('POST /content-types creates a new type', async () => {
            const res = await fetch(`${API_URL}/content-types`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'Test Type',
                    slug: `test-type-${Date.now()}`,
                    schema: JSON.stringify({ type: 'object' }),
                }),
            });
            expect(res.status).toBe(201);

            const body = await json<ApiEntityResponse<{ id: number }>>(res);
            expect(body.data.id).toBeDefined();
            expect(body.meta.recommendedNextAction).toBeDefined();
            typeId = body.data.id;
        });

        it('GET /content-types lists types', async () => {
            const res = await fetch(`${API_URL}/content-types`);
            expect(res.status).toBe(200);
            const body = await json<ApiListResponse<ContentType>>(res);
            expect(Array.isArray(body.data)).toBe(true);
        });

        it('GET /content-types/:id returns the type', async () => {
            const res = await fetch(`${API_URL}/content-types/${typeId}`);
            expect(res.status).toBe(200);
            const body = await json<ApiEntityResponse<ContentType>>(res);
            expect(body.data.id).toBe(typeId);
        });

        it('PUT /content-types/:id with empty body returns 400', async () => {
            const res = await fetch(`${API_URL}/content-types/${typeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);
            const body = await json<ApiError>(res);
            expect(body.code).toBe('EMPTY_UPDATE_BODY');
            expect(body.remediation).toBeDefined();
        });

        it('PUT /content-types/:id updates a type', async () => {
            const res = await fetch(`${API_URL}/content-types/${typeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ description: 'Updated via test' }),
            });
            expect(res.status).toBe(200);
            const body = await json<ApiEntityResponse<ContentType>>(res);
            expect(body.data.description).toBe('Updated via test');
        });
    });

    describe('Content Items CRUD', () => {
        it('POST /content-items creates a new item', async () => {
            const res = await fetch(`${API_URL}/content-items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contentTypeId: typeId,
                    data: JSON.stringify({ title: 'Test Item' }),
                }),
            });
            expect(res.status).toBe(201);
            const body = await json<ApiEntityResponse<ContentItem>>(res);
            expect(body.data.id).toBeDefined();
            expect(body.data.version).toBe(1);
            itemId = body.data.id;
        });

        it('GET /content-items/:id returns the item', async () => {
            const res = await fetch(`${API_URL}/content-items/${itemId}`);
            expect(res.status).toBe(200);
            const body = await json<ApiEntityResponse<ContentItem>>(res);
            expect(body.data.id).toBe(itemId);
        });

        it('PUT /content-items/:id with empty body returns 400', async () => {
            const res = await fetch(`${API_URL}/content-items/${itemId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);
            const body = await json<ApiError>(res);
            expect(body.code).toBe('EMPTY_UPDATE_BODY');
        });

        it('PUT /content-items/:id updates and increments version', async () => {
            const res = await fetch(`${API_URL}/content-items/${itemId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    data: JSON.stringify({ title: 'Test Item v2' }),
                    status: 'published',
                }),
            });
            expect(res.status).toBe(200);
            const body = await json<ApiEntityResponse<ContentItem>>(res);
            expect(body.data.version).toBe(2);
        });
    });

    describe('Dry-Run Mode', () => {
        it('POST /content-types?mode=dry_run does not persist', async () => {
            const slug = `dry-run-${Date.now()}`;
            const res = await fetch(`${API_URL}/content-types?mode=dry_run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'Dry Run Type',
                    slug,
                    schema: '{}',
                }),
            });
            expect(res.status).toBe(200);
            const body = await json<ApiEntityResponse<{ id: number }>>(res);
            expect(body.meta.dryRun).toBe(true);

            const listRes = await fetch(`${API_URL}/content-types`);
            const listBody = await json<ApiListResponse<ContentType>>(listRes);
            const found = listBody.data.find((type) => type.slug === slug);
            expect(found).toBeUndefined();
        });
    });

    describe('Versioning & Rollback', () => {
        it('GET /content-items/:id/versions returns version history', async () => {
            const res = await fetch(`${API_URL}/content-items/${itemId}/versions`);
            expect(res.status).toBe(200);
            const body = await json<ApiListResponse<{ version: number }>>(res);
            expect(body.data.length).toBeGreaterThanOrEqual(1);
        });

        it('POST /content-items/:id/rollback to invalid version returns 404', async () => {
            const res = await fetch(`${API_URL}/content-items/${itemId}/rollback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ version: 99999 }),
            });
            expect(res.status).toBe(404);
            const body = await json<ApiError>(res);
            expect(body.code).toBe('TARGET_VERSION_NOT_FOUND');
            expect(body.remediation).toBeDefined();
        });

        it('POST /content-items/:id/rollback to valid version succeeds', async () => {
            const res = await fetch(`${API_URL}/content-items/${itemId}/rollback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ version: 1 }),
            });
            expect(res.status).toBe(200);
            const body = await json<ApiEntityResponse<ContentItem>>(res);
            expect(body.data.version).toBe(3);
        });
    });

    describe('Audit Logs', () => {
        it('GET /audit-logs returns logs', async () => {
            const res = await fetch(`${API_URL}/audit-logs?limit=10`);
            expect(res.status).toBe(200);
            const body = await json<ApiListResponse<{ id: number }>>(res);
            expect(Array.isArray(body.data)).toBe(true);
            expect(body.data.length).toBeGreaterThan(0);
        });
    });

    describe('Cleanup', () => {
        it('DELETE /content-items/:id removes the item and its versions (cascade)', async () => {
            const res = await fetch(`${API_URL}/content-items/${itemId}`, {
                method: 'DELETE',
            });
            expect(res.status).toBe(200);
        });

        it('DELETE /content-types/:id removes the type', async () => {
            const res = await fetch(`${API_URL}/content-types/${typeId}`, {
                method: 'DELETE',
            });
            expect(res.status).toBe(200);
        });
    });
});
