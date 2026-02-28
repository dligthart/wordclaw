import { describe, expect, it } from 'vitest';

import { buildOperationContext, resolveRestOperation, resolveRestResource } from './policy-adapters.js';

describe('resolveRestOperation', () => {
    it('maps sandbox MCP bridge routes to content.read', () => {
        const operation = resolveRestOperation('POST', '/api/sandbox/mcp/execute');
        expect(operation).toBe('content.read');
    });
});

describe('resolveRestResource', () => {
    it('attaches domain context for tenant resources when provided', () => {
        const resource = resolveRestResource('/api/content-items/12', 3);
        expect(resource).toEqual({
            type: 'content_item',
            id: '12',
            domainId: 3
        });
    });

    it('resolves agent-run resource IDs with domain context', () => {
        const resource = resolveRestResource('/api/agent-runs/55/control', 9);
        expect(resource).toEqual({
            type: 'agent_run',
            id: '55',
            domainId: 9
        });
    });
});

describe('buildOperationContext', () => {
    it('normalizes tenant resource context with principal domain when missing', () => {
        const context = buildOperationContext(
            'graphql',
            { keyId: 7, domainId: 5, scopes: new Set(['content:write']), source: 'db' },
            'content.write',
            { type: 'content_item', id: '42' }
        );

        expect(context.resource).toEqual({
            type: 'content_item',
            id: '42',
            domainId: 5
        });
    });

    it('does not attach domain context to system resources', () => {
        const context = buildOperationContext(
            'rest',
            { keyId: 'system', domainId: 1, scopes: new Set(['admin']), source: 'db' },
            'policy.read',
            { type: 'system' }
        );

        expect(context.resource).toEqual({ type: 'system' });
    });
});
