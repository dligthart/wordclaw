import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
    request.log.error(error);

    const statusCode = error.statusCode || 500;

    // Default remediation message
    let remediation = 'Check the request parameters and try again.';

    let meta: Record<string, unknown> | undefined;

    if (error.validation) {
        remediation = 'Review the provided JSON payload against the endpoint specification. Ensure all required fields are present and properly typed.';
        meta = {
            recommendedNextAction: 'Correct the payload and retry',
            actionPriority: 'high'
        };
    } else if (statusCode === 400) {
        remediation = 'The request payload was invalid. Correct the structure and try again.';
    } else if (statusCode === 404) {
        remediation = 'The requested resource was not found. Verify the ID or URL path.';
    } else if (statusCode === 429) {
        remediation = (error as any).remediation || 'You have sent too many requests. Please wait a moment and try again.';
    } else if (statusCode === 500) {
        remediation = 'An internal server error occurred. This may be a bug. Retry the request later or contact support.';
    }

    const responsePayload: any = {
        error: error.validation ? 'Bad Request' : (error.message || 'Unknown Error'),
        code: error.validation ? 'VALIDATION_ERROR' : (error.code || 'INTERNAL_SERVER_ERROR'),
        message: error.validation ? error.message : undefined,
        remediation,
        meta,
        context: {
            ...(error.validation ? { validation: error.validation } : {}),
            requestId: request.id
        }
    };

    if (error.validation) {
        // Fastify 4 uses integer error code for validation? No, usually code is FST_ERR_VALIDATION
        responsePayload.code = 'VALIDATION_ERROR';
    }

    reply.status(statusCode).send(responsePayload);
}
