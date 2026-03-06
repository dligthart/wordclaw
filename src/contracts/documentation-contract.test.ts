import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    capabilityMatrix,
    compatibilityProtocolSurfaces,
    dryRunCapabilities,
    requiredProtocolSurfaces
} from './capability-matrix.js';

function readFeaturesDoc(): string {
    return fs.readFileSync(path.resolve(process.cwd(), 'doc/concepts/features.md'), 'utf8');
}

describe('Documentation Contract Alignment', () => {
    it('documents REST and MCP as required surfaces and GraphQL as compatibility-only', () => {
        const featuresDoc = readFeaturesDoc();

        expect(featuresDoc.includes('Every operation is available through three interfaces:')).toBe(false);
        expect(featuresDoc).toContain('REST API');
        expect(featuresDoc).toContain('MCP Server');
        expect(featuresDoc).toContain('GraphQL Compatibility Surface');
        expect(requiredProtocolSurfaces).toEqual(['rest', 'mcp']);
        expect(compatibilityProtocolSurfaces).toEqual(['graphql']);
    });

    it('keeps dry-run guarantees scoped to supported write paths', () => {
        const featuresDoc = readFeaturesDoc();

        expect(featuresDoc.includes('All write operations support a dry-run flag')).toBe(false);
        expect(featuresDoc).toContain('Supported write paths can be simulated before mutation');
        expect(featuresDoc).toContain('GraphQL/MCP where implemented');

        expect(dryRunCapabilities.size).toBeGreaterThan(0);
        for (const capabilityId of dryRunCapabilities) {
            expect(
                capabilityMatrix.some((capability) => capability.id === capabilityId),
                `dryRunCapabilities includes unknown capability '${capabilityId}'`
            ).toBe(true);
        }
    });
});
