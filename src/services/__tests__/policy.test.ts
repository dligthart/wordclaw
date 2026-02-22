import { describe, it, expect } from 'vitest';
import { PolicyEngine, OperationContext } from '../policy.js';

describe('PolicyEngine Multi-Tenant Isolation', () => {
    it('allows access when principal and resource domainId match', async () => {
        const context: OperationContext = {
            principal: { id: 'user1', domainId: 2, scopes: ['content:read'], source: 'db' },
            operation: 'content.read',
            resource: { type: 'content_item', domainId: 2 },
            environment: { protocol: 'rest', timestamp: new Date() }
        };

        const result = await PolicyEngine.evaluate(context);
        expect(result.outcome).toBe('allow');
    });

    it('denies access when principal and resource domainId mismatch', async () => {
        const context: OperationContext = {
            principal: { id: 'user1', domainId: 2, scopes: ['content:read'], source: 'db' },
            operation: 'content.read',
            resource: { type: 'content_item', domainId: 3 },
            environment: { protocol: 'rest', timestamp: new Date() }
        };

        const result = await PolicyEngine.evaluate(context);
        expect(result.outcome).toBe('deny');
        expect(result.code).toBe('TENANT_ISOLATION_VIOLATION');
    });

    it('allows cross-tenant access if principal has tenant:admin scope', async () => {
        const context: OperationContext = {
            principal: { id: 'admin1', domainId: 1, scopes: ['content:read', 'tenant:admin'], source: 'db' },
            operation: 'content.read',
            resource: { type: 'content_item', domainId: 3 },
            environment: { protocol: 'rest', timestamp: new Date() }
        };

        const result = await PolicyEngine.evaluate(context);
        expect(result.outcome).toBe('allow');
    });

    it('denies execution if resource domainId is defined but principal domainId is undefined', async () => {
        const context: OperationContext = {
            principal: { id: 'user1', scopes: ['content:read'], source: 'db' } as any,
            operation: 'content.read',
            resource: { type: 'content_item', domainId: 2 },
            environment: { protocol: 'rest', timestamp: new Date() }
        };

        const result = await PolicyEngine.evaluate(context);
        expect(result.outcome).toBe('deny');
        expect(result.code).toBe('TENANT_ISOLATION_VIOLATION');
    });
});
