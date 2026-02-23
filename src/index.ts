import '@fastify/websocket';

import { randomUUID } from 'node:crypto';

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import mercurius from 'mercurius';
import { sql } from 'drizzle-orm';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import apiRoutes from './api/routes.js';
import { supervisorAuthRoutes } from './api/supervisor-auth.js';
import { supervisorDashboardRoutes } from './api/supervisor-dashboard.js';
import { authenticateApiRequest } from './api/auth.js';
import { PolicyEngine } from './services/policy.js';
import { buildOperationContext, resolveRestOperation, resolveRestResource } from './services/policy-adapters.js';
import { errorHandler } from './api/error-handler.js';
import { db } from './db/index.js';
import { resolvers } from './graphql/resolvers.js';
import { schema } from './graphql/schema.js';
import { idempotencyPlugin } from './middleware/idempotency.js';
import { type AuditEventPayload, auditEventBus } from './services/event-bus.js';

dotenv.config();

function readRequestIdHeader(raw: string | string[] | undefined): string | null {
    if (typeof raw === 'string' && raw.trim().length > 0) {
        return raw.trim();
    }

    if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].trim().length > 0) {
        return raw[0].trim();
    }

    return null;
}

function addRequestContextToErrorPayload(payload: unknown, requestId: string): unknown {
    let parsed: unknown = payload;

    if (Buffer.isBuffer(parsed)) {
        parsed = parsed.toString('utf8');
    }

    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed) as unknown;
        } catch {
            return payload;
        }
    }

    if (!parsed || typeof parsed !== 'object') {
        return payload;
    }

    const body = parsed as Record<string, unknown>;
    if (typeof body.error !== 'string' || typeof body.code !== 'string') {
        return payload;
    }

    const context = body.context;
    const normalizedContext = (context && typeof context === 'object')
        ? context as Record<string, unknown>
        : {};

    if (typeof normalizedContext.requestId === 'string' && normalizedContext.requestId.length > 0) {
        return body;
    }

    return {
        ...body,
        context: {
            ...normalizedContext,
            requestId
        }
    };
}

const server: FastifyInstance = Fastify({
    logger: true,
    genReqId: (request) => readRequestIdHeader(request.headers['x-request-id']) || randomUUID()
}).withTypeProvider<TypeBoxTypeProvider>();

server.register(cors);
server.register(idempotencyPlugin, { ttlMs: 5 * 60 * 1000 });
server.setErrorHandler(errorHandler);
server.register(import('@fastify/swagger'));
server.register(import('@fastify/swagger-ui'), {
    routePrefix: '/documentation',
});
server.register(import('@fastify/websocket'));
import crypto from 'crypto';

let jwtSecret = process.env.JWT_SECRET;
let cookieSecret = process.env.COOKIE_SECRET;

if (!jwtSecret || !cookieSecret) {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET and COOKIE_SECRET environment variables are strictly required in production.');
    } else {
        if (!jwtSecret) {
            jwtSecret = crypto.randomBytes(32).toString('hex');
            console.warn(`[WARNING] JWT_SECRET is not set. Generated ephemeral random secret for development: ${jwtSecret}`);
        }
        if (!cookieSecret) {
            cookieSecret = crypto.randomBytes(32).toString('hex');
            console.warn(`[WARNING] COOKIE_SECRET is not set. Generated ephemeral random secret for development: ${cookieSecret}`);
        }
    }
}

server.register(fastifyJwt, {
    secret: jwtSecret,
    cookie: {
        cookieName: 'supervisor_session',
        signed: false
    }
});
server.register(fastifyCookie, {
    secret: cookieSecret,
    hook: 'onRequest'
});

server.register(mercurius, {
    schema,
    resolvers,
    graphiql: true,
    path: '/graphql',
    context: async (request) => {
        let principal: any = null;
        try {
            await request.jwtVerify({ onlyCookie: true });
            const user = request.user as { sub: number, role: string };
            if (user && user.role === 'supervisor') {
                const headerDomain = request.headers['x-wordclaw-domain'];
                principal = {
                    keyId: `supervisor:${user.sub}`,
                    scopes: new Set(['admin']),
                    source: 'cookie',
                    ...(headerDomain ? { domainId: parseInt(headerDomain as string, 10) } : {})
                };
            }
        } catch { }

        if (!principal) {
            const auth = await authenticateApiRequest(request.headers);
            if (!auth.ok) {
                const err = new Error(auth.payload.error) as any;
                err.statusCode = auth.statusCode;
                err.code = auth.payload.code;
                throw err;
            }
            principal = auth.principal;
        }

        return {
            requestId: request.id,
            authPrincipal: principal
        };
    }
});

server.register(import('@fastify/rate-limit'), {
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: (request, context) => ({
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Too Many Requests',
        code: 'RATE_LIMIT_EXCEEDED',
        remediation: `You have exceeded the rate limit of ${context.max} requests per minute. Please wait before retrying.`,
        context: {
            requestId: request.id
        },
        meta: {
            recommendedNextAction: 'Wait for the rate limit window to reset',
            availableActions: [],
            actionPriority: 'high',
            max: context.max,
            timeWindow: '1 minute'
        }
    })
});

server.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);

    if (reply.statusCode < 400) {
        return payload;
    }

    const withRequestId = addRequestContextToErrorPayload(payload, request.id);
    if (withRequestId === payload) {
        return payload;
    }

    if (typeof payload === 'string' || Buffer.isBuffer(payload)) {
        return JSON.stringify(withRequestId);
    }

    return withRequestId;
});

server.get('/ws/events', { websocket: true }, (connection, request) => {
    void (async () => {
        const auth = await authenticateApiRequest(request.headers);
        if (!auth.ok) {
            connection.socket.send(JSON.stringify(auth.payload));
            connection.socket.close(1008, 'Unauthorized');
            return;
        }

        const operationContext = buildOperationContext(
            'rest',
            auth.principal as any,
            'audit.read',
            { type: 'system' }
        );

        const decision = await PolicyEngine.evaluate(operationContext);
        if (decision.outcome !== 'allow') {
            connection.socket.send(JSON.stringify(decision));
            connection.socket.close(1008, 'Access Denied');
            return;
        }

        const sendAuditEvent = (event: AuditEventPayload) => {
            if (connection.socket.readyState !== 1) {
                return;
            }

            connection.socket.send(JSON.stringify({
                event: 'audit',
                data: event
            }));
        };

        auditEventBus.on('audit', sendAuditEvent);
        connection.socket.on('close', () => {
            auditEventBus.off('audit', sendAuditEvent);
        });
        connection.socket.on('error', () => {
            auditEventBus.off('audit', sendAuditEvent);
        });

        connection.socket.send(JSON.stringify({
            event: 'ready',
            requestId: request.id
        }));
    })().catch((error) => {
        request.log.error({ err: error }, 'Failed to initialize websocket stream');
        connection.socket.close(1011, 'Internal server error');
    });
});

server.register(apiRoutes, { prefix: '/api' });
server.register(supervisorAuthRoutes, { prefix: '/api/supervisors' });
server.register(supervisorDashboardRoutes, { prefix: '/api/supervisors' });

// Serve SvelteKit UI
server.register(fastifyStatic, {
    root: path.join(__dirname, '../ui/build'),
    prefix: '/ui/',
    wildcard: false
});

server.get('/ui/*', (request, reply) => {
    return reply.sendFile('index.html');
});

server.get('/health', async (_request, reply) => {
    const timestamp = new Date().toISOString();

    try {
        await db.execute(sql`SELECT 1`);
        return {
            status: 'ok',
            services: {
                database: 'ok'
            },
            timestamp
        };
    } catch {
        return reply.status(503).send({
            status: 'degraded',
            services: {
                database: 'down'
            },
            timestamp
        });
    }
});

const start = async () => {
    try {
        const port = parseInt(process.env.PORT || '4000', 10);
        const host = '0.0.0.0';
        await server.listen({ port, host });
        console.log(`Server listening at http://${host}:${port}`);
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

start();

const shutdown = async (signal: string) => {
    server.log.info(`Received ${signal}, shutting down gracefully...`);
    try {
        await server.close();
        process.exit(0);
    } catch (err) {
        server.log.error(err, 'Error during shutdown');
        process.exit(1);
    }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
