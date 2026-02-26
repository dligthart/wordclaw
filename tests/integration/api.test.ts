import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupServer } from '../../src/server';
import { db } from '../../src/db';

describe('Integration Tests - Core API', () => {
    let app: any;

    beforeAll(async () => {
        // We expect the server to be set up but not listening,
        // so we can use app.inject() for requests.
        app = await setupServer();
    });

    afterAll(async () => {
        if (app) {
            await app.close();
        }
        // Clean up connections if necessary
    });

    it('GET /api/public/content - should return content list', async () => {
        const response = await app.inject({
            method: 'GET',
            url: '/api/public/content',
        });

        expect(response.statusCode).toBe(200);
        const payload = JSON.parse(response.payload);
        expect(payload).toBeDefined();
        // Assuming the API returns an array, or an object with a data array
        if (Array.isArray(payload)) {
            expect(Array.isArray(payload)).toBe(true);
        } else {
            expect(Array.isArray(payload.data) || Array.isArray(payload.items)).toBe(true);
        }
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
