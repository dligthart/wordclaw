import { OperationContext } from './policy.js';

export interface AuthPrincipalData {
    keyId?: string | number;
    domainId?: number;
    scopes?: Set<string> | string[];
    source?: string;
}

export function buildOperationContext(
    protocol: 'rest' | 'graphql' | 'mcp',
    principal: AuthPrincipalData | null | undefined,
    operation: string,
    resource: OperationContext['resource']
): OperationContext {
    let scopesArray: string[] = [];
    if (principal?.scopes instanceof Set) {
        scopesArray = Array.from(principal.scopes);
    } else if (Array.isArray(principal?.scopes)) {
        scopesArray = principal.scopes;
    }

    return {
        principal: {
            id: principal?.keyId?.toString() || 'anonymous',
            domainId: principal?.domainId ?? 1, // Fallback to 1 (default domain)
            scopes: scopesArray,
            source: principal?.source || 'anonymous'
        },
        operation,
        resource,
        environment: {
            protocol,
            timestamp: new Date()
        }
    };
}

export function resolveRestOperation(method: string, routePath: string): string {
    const upperMethod = method.toUpperCase();

    if (routePath.startsWith('/api/auth/keys')) {
        return upperMethod === 'GET' ? 'apikey.list' : 'apikey.write';
    }
    if (routePath.startsWith('/api/webhooks')) {
        return upperMethod === 'GET' ? 'webhook.list' : 'webhook.write';
    }
    if (routePath.startsWith('/ws/events') || routePath.startsWith('/api/audit-logs')) {
        return 'audit.read';
    }
    if (routePath.startsWith('/api/payments')) {
        return 'payment.read';
    }
    if (routePath.startsWith('/api/policy/evaluate')) {
        return 'policy.read';
    }

    if (upperMethod === 'GET' || upperMethod === 'HEAD' || upperMethod === 'OPTIONS') {
        return 'content.read';
    }

    return 'content.write';
}

export function resolveRestResource(routePath: string): OperationContext['resource'] {
    const segments = routePath.split('/').filter(Boolean);

    if (segments[1] === 'content-types') {
        return { type: 'content_type', id: segments[2] };
    }
    if (segments[1] === 'content-items') {
        return { type: 'content_item', id: segments[2] };
    }

    return { type: 'system' };
}
