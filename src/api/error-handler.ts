import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
    request.log.error(error);

    const statusCode = error.statusCode || 500;

    // Default remediation message
    let remediation = 'Check the request parameters and try again.';

    if (statusCode === 400) {
        remediation = 'The request payload was invalid. Check the "validation" field for details and correct the JSON structure.';
    } else if (statusCode === 404) {
        remediation = 'The requested resource was not found. Verify the ID or URL path.';
    } else if (statusCode === 429) {
        remediation = (error as any).remediation || 'You have sent too many requests. Please wait a moment and try again.';
    } else if (statusCode === 500) {
        remediation = 'An internal server error occurred. This may be a bug. Retry the request later or contact support.';
    }

    reply.status(statusCode).send({
        error: error.message || 'Unknown Error',
        code: error.code || 'INTERNAL_SERVER_ERROR',
        remediation,
        context: error.validation // Include validation errors if present
    });
}
