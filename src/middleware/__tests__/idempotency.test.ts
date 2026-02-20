import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { idempotencyPlugin } from '../idempotency.js';

describe('Idempotency Middleware', () => {
    let app: FastifyInstance;
    let callCount = 0;

    beforeEach(async () => {
        app = Fastify({ logger: false });
        callCount = 0;

        await app.register(idempotencyPlugin, { ttlMs: 5 * 60 * 1000 });
        app.post('/items', async () => {
            callCount += 1;
            return { callCount };
        });
    });

    afterEach(async () => {
        await app.close();
    });

    it('replays response for duplicate idempotency keys', async () => {
        const first = await app.inject({
            method: 'POST',
            url: '/items',
            headers: {
                'idempotency-key': 'abc123'
            }
        });

        const second = await app.inject({
            method: 'POST',
            url: '/items',
            headers: {
                'idempotency-key': 'abc123'
            }
        });

        expect(first.statusCode).toBe(200);
        expect(second.statusCode).toBe(200);
        expect(first.json()).toEqual({ callCount: 1 });
        expect(second.json()).toEqual({ callCount: 1 });
        expect(second.headers['x-idempotent-replayed']).toBe('true');
        expect(callCount).toBe(1);
    });

    it('treats different keys as separate write operations', async () => {
        await app.inject({
            method: 'POST',
            url: '/items',
            headers: {
                'idempotency-key': 'key-a'
            }
        });

        const second = await app.inject({
            method: 'POST',
            url: '/items',
            headers: {
                'idempotency-key': 'key-b'
            }
        });

        expect(second.statusCode).toBe(200);
        expect(second.json()).toEqual({ callCount: 2 });
        expect(second.headers['x-idempotent-replayed']).toBeUndefined();
        expect(callCount).toBe(2);
    });
});
