import { afterEach, describe, expect, it, vi } from 'vitest';

const originalExperimentalAgentRuns = process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS;

async function loadGraphQLSurface(flag: 'true' | 'false') {
    process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = flag;
    vi.resetModules();

    const [{ schema }, { resolvers }] = await Promise.all([
        import('./schema.js'),
        import('./resolvers.js')
    ]);

    return { schema, resolvers };
}

afterEach(() => {
    if (originalExperimentalAgentRuns === undefined) {
        delete process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS;
    } else {
        process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = originalExperimentalAgentRuns;
    }

    vi.resetModules();
});

describe('Experimental Agent Run GraphQL Surface', () => {
    it('removes agent-run schema and resolvers when explicitly disabled', async () => {
        const { schema, resolvers } = await loadGraphQLSurface('false');

        expect(schema).not.toContain('agentRuns(');
        expect(schema).not.toContain('createAgentRun(');
        expect(resolvers.Query).not.toHaveProperty('agentRuns');
        expect(resolvers.Query).not.toHaveProperty('agentRunDefinitions');
        expect(resolvers.Mutation).not.toHaveProperty('createAgentRun');
        expect(resolvers.Mutation).not.toHaveProperty('controlAgentRun');
    });

    it('exposes agent-run schema and resolvers when explicitly enabled', async () => {
        const { schema, resolvers } = await loadGraphQLSurface('true');

        expect(schema).toContain('agentRuns(');
        expect(schema).toContain('createAgentRun(');
        expect(resolvers.Query).toHaveProperty('agentRuns');
        expect(resolvers.Query).toHaveProperty('agentRunDefinitions');
        expect(resolvers.Mutation).toHaveProperty('createAgentRun');
        expect(resolvers.Mutation).toHaveProperty('controlAgentRun');
    });
});
