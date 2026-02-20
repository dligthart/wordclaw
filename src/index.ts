import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

import apiRoutes from './api/routes.js';
import { errorHandler } from './api/error-handler.js';

dotenv.config();

const server: FastifyInstance = Fastify({
    logger: true
}).withTypeProvider<TypeBoxTypeProvider>();


// Register plugins
server.register(cors);
server.setErrorHandler(errorHandler);
server.register(import('@fastify/swagger'));
server.register(import('@fastify/swagger-ui'), {
    routePrefix: '/documentation',
});

import mercurius from 'mercurius';
import { schema } from './graphql/schema.js';
import { resolvers } from './graphql/resolvers.js';

server.register(mercurius, {
    schema,
    resolvers,
    graphiql: true,
    path: '/graphql'
});

server.register(import('@fastify/rate-limit'), {
    max: 100,
    timeWindow: '1 minute',

    errorResponseBuilder: (request, context) => {
        return {
            statusCode: 429,
            error: 'Too Many Requests',
            message: 'Too Many Requests',
            code: 'RATE_LIMIT_EXCEEDED',
            remediation: `You have exceeded the rate limit of ${context.max} requests per minute. Please wait before retrying.`,
            meta: {
                recommendedNextAction: 'Wait for the rate limit window to reset',
                availableActions: [],
                actionPriority: 'high',
                max: context.max,
                timeWindow: '1 minute'
            }
        };
    }
});

// Register routes
server.register(apiRoutes, { prefix: '/api' });

// Health check route
server.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
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
