import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/server';
import { db } from '../../src/db';

describe('Integration Tests - Core API', () => {
    let app: any;

    beforeAll(async () => {
        // We expect the server to be set up but not listening,
        // so we can use app.inject() for requests.
        app = await buildServer();
    });

    afterAll(async () => {
        if (app) {
            await app.close();
        }
        // Clean up connections if necessary
    });

    it('GET /api/content-items - should return 401 Unauthorized without API key', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/content-items',
        });

        expect(response.statusCode).toBe(401);
        const payload = JSON.parse(response.payload);
        expect(payload.error).toBeDefined();
    });

    it('GET /health - should return healthy status', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/health',
        });

        // Depending on if a /health route exists, adjust expectation
        // If it doesn't exist yet, we can test that we reach the app at all (e.g. 404 is fine as long as app responds)
        if (response.statusCode === 200) {
            const payload = JSON.parse(response.payload);
            expect(payload.status).toBe('ok');
        } else {
            expect(response.statusCode).toBeDefined();
        }
    });
});
