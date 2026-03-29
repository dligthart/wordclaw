import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { errorHandler } from './error-handler.js';

function buildRequest(id: string = 'req-123') {
    return {
        id,
        log: {
            error: vi.fn(),
        },
    } as unknown as FastifyRequest;
}

function buildReply() {
    const reply = {
        status: vi.fn(),
        send: vi.fn(),
    };

    reply.status.mockReturnValue(reply);
    return reply as unknown as FastifyReply & {
        status: ReturnType<typeof vi.fn>;
        send: ReturnType<typeof vi.fn>;
    };
}

describe('errorHandler', () => {
    it('serializes validation failures with a fixed validation error contract', () => {
        const request = buildRequest('req-validation');
        const reply = buildReply();
        const error = {
            statusCode: 400,
            code: 'FST_ERR_VALIDATION',
            message: 'body.title is required',
            validation: [{ instancePath: '/title', message: 'Required' }],
        } as FastifyError;

        errorHandler(error, request, reply);

        expect(request.log.error).toHaveBeenCalledWith(error);
        expect(reply.status).toHaveBeenCalledWith(400);
        expect(reply.send).toHaveBeenCalledWith({
            error: 'Bad Request',
            code: 'VALIDATION_ERROR',
            message: 'body.title is required',
            remediation: 'Review the provided JSON payload against the endpoint specification. Ensure all required fields are present and properly typed.',
            meta: {
                recommendedNextAction: 'Correct the payload and retry',
                actionPriority: 'high',
            },
            context: {
                validation: [{ instancePath: '/title', message: 'Required' }],
                requestId: 'req-validation',
            },
        });
    });

    it('uses resource-specific remediation for 404 responses', () => {
        const request = buildRequest('req-not-found');
        const reply = buildReply();
        const error = {
            statusCode: 404,
            code: 'NOT_FOUND',
            message: 'Domain not found',
        } as FastifyError;

        errorHandler(error, request, reply);

        expect(reply.status).toHaveBeenCalledWith(404);
        expect(reply.send).toHaveBeenCalledWith({
            error: 'Domain not found',
            code: 'NOT_FOUND',
            message: undefined,
            remediation: 'The requested resource was not found. Verify the ID or URL path.',
            meta: undefined,
            context: {
                requestId: 'req-not-found',
            },
        });
    });

    it('uses the generic invalid-payload remediation for non-validation 400 responses', () => {
        const request = buildRequest('req-bad-request');
        const reply = buildReply();
        const error = {
            statusCode: 400,
            code: 'BAD_INPUT',
            message: 'Bad request body',
        } as FastifyError;

        errorHandler(error, request, reply);

        expect(reply.status).toHaveBeenCalledWith(400);
        expect(reply.send).toHaveBeenCalledWith({
            error: 'Bad request body',
            code: 'BAD_INPUT',
            message: undefined,
            remediation: 'The request payload was invalid. Correct the structure and try again.',
            meta: undefined,
            context: {
                requestId: 'req-bad-request',
            },
        });
    });

    it('preserves custom rate-limit remediation text when present', () => {
        const request = buildRequest('req-rate-limit');
        const reply = buildReply();
        const error = {
            statusCode: 429,
            code: 'RATE_LIMITED',
            message: 'Too many requests',
            remediation: 'Retry after the upstream cool-down window.',
        } as FastifyError & { remediation: string };

        errorHandler(error, request, reply);

        expect(reply.status).toHaveBeenCalledWith(429);
        expect(reply.send).toHaveBeenCalledWith({
            error: 'Too many requests',
            code: 'RATE_LIMITED',
            message: undefined,
            remediation: 'Retry after the upstream cool-down window.',
            meta: undefined,
            context: {
                requestId: 'req-rate-limit',
            },
        });
    });

    it('falls back to a 500 response with internal error guidance', () => {
        const request = buildRequest('req-500');
        const reply = buildReply();
        const error = {
            message: 'Unexpected failure',
        } as FastifyError;

        errorHandler(error, request, reply);

        expect(reply.status).toHaveBeenCalledWith(500);
        expect(reply.send).toHaveBeenCalledWith({
            error: 'Unexpected failure',
            code: 'INTERNAL_SERVER_ERROR',
            message: undefined,
            remediation: 'An internal server error occurred. This may be a bug. Retry the request later or contact support.',
            meta: undefined,
            context: {
                requestId: 'req-500',
            },
        });
    });
});
