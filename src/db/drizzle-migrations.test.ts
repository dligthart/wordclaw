import { describe, expect, it } from 'vitest';

import {
    formatBaselineGuidance,
    resolveDrizzleMigrationTarget,
    type DrizzleMigrationRecord
} from './drizzle-migrations.js';

const migrations: DrizzleMigrationRecord[] = [
    {
        idx: 0,
        version: '7',
        when: 1,
        tag: '0000_public_magma',
        breakpoints: true,
        sql: 'select 1;',
        hash: 'hash-0'
    },
    {
        idx: 1,
        version: '7',
        when: 2,
        tag: '0001_third_photon',
        breakpoints: true,
        sql: 'select 2;',
        hash: 'hash-1'
    },
    {
        idx: 2,
        version: '7',
        when: 3,
        tag: '0019_unified_actor_identity',
        breakpoints: true,
        sql: 'select 3;',
        hash: 'hash-2'
    }
];

describe('drizzle migration helpers', () => {
    it('resolves through a specific migration tag', () => {
        expect(resolveDrizzleMigrationTarget(migrations, '0001_third_photon').map((entry) => entry.tag)).toEqual([
            '0000_public_magma',
            '0001_third_photon'
        ]);
    });

    it('throws on an unknown migration tag', () => {
        expect(() => resolveDrizzleMigrationTarget(migrations, '0099_missing')).toThrow(
            'Unknown migration tag "0099_missing"'
        );
    });

    it('formats baseline guidance with the latest tag by default', () => {
        expect(formatBaselineGuidance(migrations)).toContain(
            'npx tsx src/db/stamp-migrations.ts --through 0019_unified_actor_identity'
        );
    });
});
