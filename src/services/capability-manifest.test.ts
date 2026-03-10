import { afterEach, describe, expect, it } from 'vitest';

import { buildCapabilityManifest } from './capability-manifest.js';

const originalExperimentalRevenue = process.env.ENABLE_EXPERIMENTAL_REVENUE;
const originalExperimentalDelegation = process.env.ENABLE_EXPERIMENTAL_DELEGATION;
const originalExperimentalAgentRuns = process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS;
const originalNodeEnv = process.env.NODE_ENV;

function restoreEnv() {
    if (originalExperimentalRevenue === undefined) {
        delete process.env.ENABLE_EXPERIMENTAL_REVENUE;
    } else {
        process.env.ENABLE_EXPERIMENTAL_REVENUE = originalExperimentalRevenue;
    }

    if (originalExperimentalDelegation === undefined) {
        delete process.env.ENABLE_EXPERIMENTAL_DELEGATION;
    } else {
        process.env.ENABLE_EXPERIMENTAL_DELEGATION = originalExperimentalDelegation;
    }

    if (originalExperimentalAgentRuns === undefined) {
        delete process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS;
    } else {
        process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = originalExperimentalAgentRuns;
    }

    if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
    } else {
        process.env.NODE_ENV = originalNodeEnv;
    }
}

describe('buildCapabilityManifest', () => {
    afterEach(() => {
        restoreEnv();
    });

    it('reports discovery, protocol, and paid-content surfaces', () => {
        delete process.env.ENABLE_EXPERIMENTAL_REVENUE;
        delete process.env.ENABLE_EXPERIMENTAL_DELEGATION;
        process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = 'false';

        const manifest = buildCapabilityManifest();

        expect(manifest.discovery.restManifestPath).toBe('/api/capabilities');
        expect(manifest.discovery.mcpResourceUri).toBe('system://capabilities');
        expect(manifest.protocolSurfaces.mcp.transport).toBe('stdio');
        expect(manifest.protocolContract.required).toEqual(['rest', 'mcp']);
        expect(manifest.protocolContract.compatibility).toEqual(['graphql']);
        expect(manifest.paidContent.purchaseFlowSurface).toBe('rest');
        expect(
            manifest.capabilities.some((capability) => capability.id === 'create_content_item'),
        ).toBe(true);
    });

    it('reflects feature flag state for incubator modules', () => {
        process.env.ENABLE_EXPERIMENTAL_REVENUE = 'true';
        process.env.ENABLE_EXPERIMENTAL_DELEGATION = 'true';
        process.env.ENABLE_EXPERIMENTAL_AGENT_RUNS = 'true';

        const manifest = buildCapabilityManifest();
        const modules = Object.fromEntries(
            manifest.modules.map((module) => [module.id, module]),
        );

        expect(modules['revenue-reporting']?.enabled).toBe(true);
        expect(modules.delegation?.enabled).toBe(true);
        expect(modules['agent-runs']?.enabled).toBe(true);
    });
});
