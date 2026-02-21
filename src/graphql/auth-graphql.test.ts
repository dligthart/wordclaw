import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import mercurius from 'mercurius';
import { schema } from './schema.js';
import { resolvers } from './resolvers.js';

const buildServer = (mockAuthResult: any) => {
    const server = Fastify();
    server.register(mercurius, {
        schema,
        resolvers,
        context: async () => {
            if (!mockAuthResult.ok) {
                const err = new Error(mockAuthResult.payload.error) as any;
                err.statusCode = mockAuthResult.statusCode;
                err.code = mockAuthResult.payload.code;
                throw err;
            }
            return {
                requestId: 'test-id',
                authPrincipal: mockAuthResult.principal
            };
        }
    });
    return server;
};

describe('GraphQL Auth Status Mapping', () => {
    it('returns 401 when API key is missing', async () => {
        const app = buildServer({
            ok: false,
            statusCode: 401,
            payload: {
                error: 'Missing API key',
                code: 'AUTH_MISSING_API_KEY',
                remediation: 'Provide x-api-key'
            }
        });

        const response = await app.inject({
            method: 'POST',
            url: '/graphql',
            payload: { query: 'query { contentTypes { id } }' }
        });

        if (response.statusCode === 500) {
            console.log(response.body);
        }

        expect(response.statusCode).toBe(401);
    });

    it('returns 401 when API key is invalid', async () => {
        const app = buildServer({
            ok: false,
            statusCode: 401,
            payload: {
                error: 'Invalid API key',
                code: 'AUTH_INVALID_API_KEY',
                remediation: 'Check key'
            }
        });

        const response = await app.inject({
            method: 'POST',
            url: '/graphql',
            payload: { query: 'query { contentTypes { id } }' }
        });

        expect(response.statusCode).toBe(401);
    });

    it('returns 403 when API key has insufficient scopes', async () => {
        const app = buildServer({
            ok: false,
            statusCode: 403,
            payload: {
                error: 'Insufficient scopes',
                code: 'AUTH_INSUFFICIENT_SCOPE',
                remediation: 'Request more scopes'
            }
        });

        const response = await app.inject({
            method: 'POST',
            url: '/graphql',
            payload: { query: 'query { contentTypes { id } }' }
        });

        expect(response.statusCode).toBe(403);
    });
});
