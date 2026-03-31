import Fastify, { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import cors from '@fastify/cors';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
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
import { type ActorPrincipal } from './services/actor-identity.js';
import { McpHttpSessionManager } from './mcp/http-session-manager.js';
import { getRateLimitTimeWindow, resolveRateLimitKey, resolveRateLimitMax } from './config/rate-limit.js';
import { assertValidRuntimeEnvironment } from './config/runtime-environment.js';
import { resolveSupervisorSessionPrincipal, type SupervisorSessionClaims } from './api/supervisor-session.js';

function readRequestIdHeader(raw: string | string[] | undefined): string | null {
    if (typeof raw === 'string' && raw.trim().length > 0) {
        return raw.trim();
    }

    if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].trim().length > 0) {
        return raw[0].trim();
    }

    return null;
}

function parseCorsAllowedOrigins(raw: string | undefined): string[] {
    if (!raw) {
        return [];
    }

    return Array.from(
        new Set(
            raw
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean)
        )
    );
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

function readMcpSessionIdHeader(raw: string | string[] | undefined): string | null {
    if (typeof raw === 'string' && raw.trim().length > 0) {
        return raw.trim();
    }

    if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].trim().length > 0) {
        return raw[0].trim();
    }

    return null;
}

function isInitializeRequestPayload(body: unknown): boolean {
    const messages = Array.isArray(body) ? body : [body];

    return messages.some((message) => (
        !!message
        && typeof message === 'object'
        && (message as { method?: unknown }).method === 'initialize'
    ));
}

function sendMcpJsonError(reply: {
    status: (code: number) => { send: (payload: unknown) => unknown };
}, statusCode: number, code: number, message: string) {
    return reply.status(statusCode).send({
        jsonrpc: '2.0',
        error: {
            code,
            message
        },
        id: null
    });
}

async function resolveInteractivePrincipal(request: {
    jwtVerify: (options?: Record<string, unknown>) => Promise<unknown>;
    headers: Record<string, unknown>;
    user?: unknown;
}) {
    let principal: ActorPrincipal | null = null;

    try {
        await request.jwtVerify({ onlyCookie: true });
        const user = request.user as SupervisorSessionClaims | undefined;
        if (user && user.role === 'supervisor') {
            const resolved = resolveSupervisorSessionPrincipal(user, request.headers as IncomingHttpHeaders);
            if (!resolved.ok) {
                const err = new Error(resolved.payload.error) as Error & {
                    statusCode?: number;
                    code?: string;
                    remediation?: string;
                };
                err.statusCode = resolved.statusCode;
                err.code = resolved.payload.code;
                err.remediation = resolved.payload.remediation;
                throw err;
            }
            principal = resolved.principal;
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
    assertValidRuntimeEnvironment();

    const server: FastifyInstance = Fastify({
        logger: true,
        genReqId: (request) => readRequestIdHeader(request.headers['x-request-id']) || randomUUID()
    }).withTypeProvider<TypeBoxTypeProvider>();

    const corsAllowedOrigins = parseCorsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);

    server.register(cors, {
        origin: corsAllowedOrigins.length === 0
            ? false
            : (origin, callback) => {
                if (!origin) {
                    callback(null, false);
                    return;
                }

                callback(null, corsAllowedOrigins.includes(origin));
            }
    });
    server.register(idempotencyPlugin, { ttlMs: 5 * 60 * 1000 });
    server.register(fastifyMultipart, {
        limits: {
            files: 1
        }
    });
    server.setErrorHandler(errorHandler);

    server.addHook('onSend', async (_request, reply, payload) => {
        reply.header('x-content-type-options', 'nosniff');
        reply.header('x-frame-options', 'DENY');
        reply.header('referrer-policy', 'no-referrer');
        reply.header('x-xss-protection', '0');

        if (process.env.NODE_ENV === 'production') {
            reply.header('strict-transport-security', 'max-age=63072000; includeSubDomains; preload');
        }

        return payload;
    });

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

    const mcpSessionManager = new McpHttpSessionManager();

    server.addHook('onClose', async () => {
        await mcpSessionManager.close();
    });

    server.post('/mcp', async (request, reply) => {
        const principal = await resolveInteractivePrincipal(request as typeof request & {
            headers: Record<string, unknown>;
        });
        const sessionId = readMcpSessionIdHeader(request.headers['mcp-session-id'] as string | string[] | undefined);
        const isInitializeRequest = isInitializeRequestPayload(request.body);
        let session = sessionId ? mcpSessionManager.get(sessionId) : null;

        if (sessionId) {
            if (!session || !session.matchesPrincipal(principal)) {
                return sendMcpJsonError(reply, 404, -32001, 'Session not found');
            }
        } else if (isInitializeRequest) {
            session = await mcpSessionManager.createSession(principal);
        } else {
            return sendMcpJsonError(reply, 400, -32000, 'Bad Request: Mcp-Session-Id header is required');
        }

        (request.raw as IncomingMessage & {
            auth?: ReturnType<typeof buildMcpAuthInfo>;
        }).auth = buildMcpAuthInfo(request as { headers: Record<string, unknown> }, principal);

        try {
            await session.handleRequest(
                request.raw as IncomingMessage & {
                    auth?: ReturnType<typeof buildMcpAuthInfo>;
                },
                reply.raw,
                request.body
            );
            return reply;
        } catch (error) {
            if (!sessionId && !session.sessionId) {
                await session.close();
            }
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

    server.get('/mcp', async (request, reply) => {
        const principal = await resolveInteractivePrincipal(request as typeof request & {
            headers: Record<string, unknown>;
        });
        const sessionId = readMcpSessionIdHeader(request.headers['mcp-session-id'] as string | string[] | undefined);

        if (!sessionId) {
            return sendMcpJsonError(reply, 400, -32000, 'Bad Request: Mcp-Session-Id header is required');
        }

        const session = mcpSessionManager.get(sessionId);
        if (!session || !session.matchesPrincipal(principal)) {
            return sendMcpJsonError(reply, 404, -32001, 'Session not found');
        }

        (request.raw as IncomingMessage & {
            auth?: ReturnType<typeof buildMcpAuthInfo>;
        }).auth = buildMcpAuthInfo(request as { headers: Record<string, unknown> }, principal);

        await session.handleRequest(
            request.raw as IncomingMessage & {
                auth?: ReturnType<typeof buildMcpAuthInfo>;
            },
            reply.raw
        );

        return reply;
    });

    server.delete('/mcp', async (request, reply) => {
        const principal = await resolveInteractivePrincipal(request as typeof request & {
            headers: Record<string, unknown>;
        });
        const sessionId = readMcpSessionIdHeader(request.headers['mcp-session-id'] as string | string[] | undefined);

        if (!sessionId) {
            return sendMcpJsonError(reply, 400, -32000, 'Bad Request: Mcp-Session-Id header is required');
        }

        const session = mcpSessionManager.get(sessionId);
        if (!session || !session.matchesPrincipal(principal)) {
            return sendMcpJsonError(reply, 404, -32001, 'Session not found');
        }

        (request.raw as IncomingMessage & {
            auth?: ReturnType<typeof buildMcpAuthInfo>;
        }).auth = buildMcpAuthInfo(request as { headers: Record<string, unknown> }, principal);

        await session.handleRequest(
            request.raw as IncomingMessage & {
                auth?: ReturnType<typeof buildMcpAuthInfo>;
            },
            reply.raw
        );

        return reply;
    });

    server.register(import('@fastify/rate-limit'), {
        keyGenerator: (request) => resolveRateLimitKey({
            headers: request.headers as IncomingHttpHeaders,
            ip: request.ip,
        }),
        max: (_request, key) => resolveRateLimitMax(key),
        timeWindow: getRateLimitTimeWindow(),
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
                timeWindow: getRateLimitTimeWindow()
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
        try {
            await db.execute(sql`SELECT 1`);
            return {
                status: 'ok'
            };
        } catch {
            return reply.status(503).send({
                status: 'degraded'
            });
        }
    });

    return server;
}
