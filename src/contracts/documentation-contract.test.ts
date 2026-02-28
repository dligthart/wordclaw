import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { capabilityMatrix, dryRunCapabilities } from './capability-matrix.js';

function readFeaturesDoc(): string {
    return fs.readFileSync(path.resolve(process.cwd(), 'doc/concepts/features.md'), 'utf8');
}

describe('Documentation Contract Alignment', () => {
    it('keeps protocol parity guarantees scoped to capability matrix coverage', () => {
        const featuresDoc = readFeaturesDoc();

        expect(featuresDoc.includes('Every operation is available through three interfaces:')).toBe(false);
        expect(featuresDoc).toContain('Core multi-protocol capabilities are defined in the');
        expect(featuresDoc).toContain('fails CI if any matrix capability falls behind');
    });

    it('keeps dry-run guarantees scoped to matrix dryRunCapabilities', () => {
        const featuresDoc = readFeaturesDoc();

        expect(featuresDoc.includes('All write operations support a dry-run flag')).toBe(false);
        expect(featuresDoc).toContain('Dry-run support is guaranteed for write capabilities listed in the capability matrix `dryRunCapabilities` contract set');

        expect(dryRunCapabilities.size).toBeGreaterThan(0);
        for (const capabilityId of dryRunCapabilities) {
            expect(
                capabilityMatrix.some((capability) => capability.id === capabilityId),
                `dryRunCapabilities includes unknown capability '${capabilityId}'`
            ).toBe(true);
        }
    });
});
