import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

const IDEMPOTENCY_HEADER = 'idempotency-key';
const REPLAY_HEADER = 'x-idempotent-replayed';
const CACHEABLE_METHODS = new Set(['POST', 'PUT', 'DELETE']);

type IdempotencyOptions = {
    ttlMs?: number;
};

type CachedResponse = {
    statusCode: number;
    payload: string;
    headers: Record<string, string>;
    expiresAt: number;
};

declare module 'fastify' {
    interface FastifyRequest {
        idempotencyCacheKey?: string;
        idempotencyReplay?: boolean;
    }
}

function readIdempotencyKey(raw: string | string[] | undefined): string | null {
    if (typeof raw === 'string' && raw.trim().length > 0) {
        return raw.trim();
    }

    if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].trim().length > 0) {
        return raw[0].trim();
    }

    return null;
}

function toPayloadString(payload: unknown): string {
    if (typeof payload === 'string') {
        return payload;
    }

    if (Buffer.isBuffer(payload)) {
        return payload.toString('utf8');
    }

    if (payload === undefined) {
        return '';
    }

    return JSON.stringify(payload);
}

const plugin: FastifyPluginAsync<IdempotencyOptions> = async (server, options) => {
    const ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    const cache = new Map<string, CachedResponse>();

    const purgeExpired = () => {
        const now = Date.now();
        for (const [key, entry] of cache.entries()) {
            if (entry.expiresAt <= now) {
                cache.delete(key);
            }
        }
    };

    server.addHook('onRequest', async (request, reply) => {
        const method = request.method.toUpperCase();
        if (!CACHEABLE_METHODS.has(method)) {
            return;
        }

        const idempotencyKey = readIdempotencyKey(request.headers[IDEMPOTENCY_HEADER]);
        if (!idempotencyKey) {
            return;
        }

        purgeExpired();

        const path = request.url.split('?')[0];
        const cacheKey = `${method}:${path}:${idempotencyKey}`;
        request.idempotencyCacheKey = cacheKey;

        const cached = cache.get(cacheKey);
        if (!cached || cached.expiresAt <= Date.now()) {
            if (cached) {
                cache.delete(cacheKey);
            }

            return;
        }

        request.idempotencyReplay = true;
        reply.header(REPLAY_HEADER, 'true');
        for (const [headerName, headerValue] of Object.entries(cached.headers)) {
            reply.header(headerName, headerValue);
        }

        return reply.status(cached.statusCode).send(cached.payload);
    });

    server.addHook('onSend', async (request, reply, payload) => {
        const cacheKey = request.idempotencyCacheKey;
        if (!cacheKey || request.idempotencyReplay) {
            return payload;
        }

        if (reply.statusCode >= 500) {
            return payload;
        }

        const contentType = reply.getHeader('content-type');
        const headers: Record<string, string> = {};
        if (typeof contentType === 'string') {
            headers['content-type'] = contentType;
        }

        cache.set(cacheKey, {
            statusCode: reply.statusCode,
            payload: toPayloadString(payload),
            headers,
            expiresAt: Date.now() + ttlMs
        });

        return payload;
    });
};

export const idempotencyPlugin = fp(plugin, {
    name: 'wordclaw-idempotency'
});
