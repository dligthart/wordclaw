import Fastify, { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import cors from '@fastify/cors';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import mercurius from 'mercurius';
import crypto from 'crypto';
import { sql } from 'drizzle-orm';
import { errorHandler } from './api/error-handler.js';
import { idempotencyPlugin } from './middleware/idempotency.js';
import { resolvers } from './graphql/resolvers.js';
import { schema } from './graphql/schema.js';
import { authenticateApiRequest } from './api/auth.js';
import apiRoutes from './api/routes.js';
import { supervisorAuthRoutes } from './api/supervisor-auth.js';
import { supervisorDashboardRoutes } from './api/supervisor-dashboard.js';
import { l402ReadinessRoutes } from './api/l402-readiness.js';
import { db } from './db/index.js';
import { auditEventBus, type AuditEventPayload } from './services/event-bus.js';
import { PolicyEngine } from './services/policy.js';
import { buildOperationContext } from './services/policy-adapters.js';
import { parseSupervisorDomainHeader } from './api/domain-context.js';
import { buildSupervisorPrincipal, type ActorPrincipal } from './services/actor-identity.js';
import { createServer as createMcpServer } from './mcp/server.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

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

function buildMcpAuthInfo(request: { headers: Record<string, unknown> }, principal: ActorPrincipal) {
    const authorization = typeof request.headers.authorization === 'string'
        ? request.headers.authorization
        : typeof request.headers['x-api-key'] === 'string'
            ? request.headers['x-api-key']
            : principal.actorId;

    return {
        token: authorization,
        clientId: principal.actorId,
        scopes: [...principal.scopes],
        extra: {
            wordclawPrincipal: principal
        }
    };
}

async function resolveInteractivePrincipal(request: {
    jwtVerify: (options?: Record<string, unknown>) => Promise<unknown>;
    headers: Record<string, unknown>;
    user?: unknown;
}) {
    let principal: ActorPrincipal | null = null;

    try {
        await request.jwtVerify({ onlyCookie: true });
        const user = request.user as { sub: number; role: string } | undefined;
        if (user && user.role === 'supervisor') {
            const domainContext = parseSupervisorDomainHeader(request.headers as IncomingHttpHeaders);
            if (!domainContext.ok) {
                const err = new Error(domainContext.payload.error) as Error & {
                    statusCode?: number;
                    code?: string;
                    remediation?: string;
                };
                err.statusCode = domainContext.statusCode;
                err.code = domainContext.payload.code;
                err.remediation = domainContext.payload.remediation;
                throw err;
            }
            principal = buildSupervisorPrincipal(user.sub, domainContext.domainId);
        }
    } catch (error) {
        if ((error as { code?: string }).code === 'FST_JWT_NO_AUTHORIZATION_IN_COOKIE') {
            // Fall through to API-key auth when no supervisor session is present.
        } else if ((error as { statusCode?: number }).statusCode) {
            throw error;
        }
    }

    if (principal) {
        return principal;
    }

    const auth = await authenticateApiRequest(request.headers as IncomingHttpHeaders);
    if (!auth.ok) {
        const err = new Error(auth.payload.error) as Error & {
            statusCode?: number;
            code?: string;
            remediation?: string;
        };
        err.statusCode = auth.statusCode;
        err.code = auth.payload.code;
        err.remediation = auth.payload.remediation;
        throw err;
    }

    return auth.principal;
}

export async function buildServer(): Promise<FastifyInstance> {
    const server: FastifyInstance = Fastify({
        logger: true,
        genReqId: (request) => readRequestIdHeader(request.headers['x-request-id']) || randomUUID()
    }).withTypeProvider<TypeBoxTypeProvider>();

    server.register(cors);
    server.register(idempotencyPlugin, { ttlMs: 5 * 60 * 1000 });
    server.setErrorHandler(errorHandler);

    const enableDocs = process.env.ENABLE_DOCS === 'true' || process.env.NODE_ENV !== 'production';
    const enableGraphiql = process.env.ENABLE_GRAPHIQL === 'true' || process.env.NODE_ENV !== 'production';

    if (enableDocs) {
        server.register(import('@fastify/swagger'));
        server.register(import('@fastify/swagger-ui'), {
            routePrefix: '/documentation',
        });
    }
    server.register(import('@fastify/websocket'));

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
        graphiql: enableGraphiql,
        path: '/graphql',
        context: async (request) => {
            const principal = await resolveInteractivePrincipal(request as typeof request & {
                headers: Record<string, unknown>;
            });
            return {
                requestId: request.id,
                authPrincipal: principal
            };
        }
    });

    server.post('/mcp', async (request, reply) => {
        const principal = await resolveInteractivePrincipal(request as typeof request & {
            headers: Record<string, unknown>;
        });

        const mcpServer = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true
        });

        const closeTransport = () => {
            void transport.close();
            void mcpServer.close();
        };

        reply.raw.once('close', closeTransport);

        (request.raw as IncomingMessage & {
            auth?: ReturnType<typeof buildMcpAuthInfo>;
        }).auth = buildMcpAuthInfo(request as { headers: Record<string, unknown> }, principal);

        try {
            await mcpServer.connect(transport);
            await transport.handleRequest(request.raw, reply.raw, request.body);
            return reply;
        } catch (error) {
            reply.raw.off('close', closeTransport);
            closeTransport();
            request.log.error({ err: error }, 'Failed to handle MCP HTTP request');
            if (!reply.sent) {
                return reply.status(500).send({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: 'Internal server error'
                    },
                    id: null
                });
            }
            return reply;
        }
    });

    server.get('/mcp', async (_request, reply) => {
        return reply.status(405).send({
            jsonrpc: '2.0',
            error: {
                code: -32000,
                message: 'Method not allowed.'
            },
            id: null
        });
    });

    server.delete('/mcp', async (_request, reply) => {
        return reply.status(405).send({
            jsonrpc: '2.0',
            error: {
                code: -32000,
                message: 'Method not allowed.'
            },
            id: null
        });
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
    server.register(l402ReadinessRoutes, { prefix: '/api/supervisors/l402-readiness' });

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

    return server;
}
