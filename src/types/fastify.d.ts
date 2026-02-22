import 'fastify';
import { AuthPrincipal } from '../api/auth.js';

declare module 'fastify' {
    export interface FastifyRequest {
        authPrincipal?: AuthPrincipal;
    }
}
