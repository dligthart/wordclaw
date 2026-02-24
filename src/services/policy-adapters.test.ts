import { describe, expect, it } from 'vitest';

import { resolveRestOperation } from './policy-adapters.js';

describe('resolveRestOperation', () => {
    it('maps sandbox MCP bridge routes to content.read', () => {
        const operation = resolveRestOperation('POST', '/api/sandbox/mcp/execute');
        expect(operation).toBe('content.read');
    });
});
