import { describe, expect, it } from 'vitest';

import {
    assessDrizzleDatabaseState,
    formatBaselineGuidance,
    resolveDrizzleMigrationTarget,
    type DrizzleDatabaseAssessment,
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

    it('marks a fresh empty database as safe to migrate', () => {
        const assessment = assessDrizzleDatabaseState(migrations, {
            publicTableCount: 0,
            journalTableExists: false,
            appliedMigrationCount: 0,
        });

        expect(assessment).toEqual<DrizzleDatabaseAssessment>({
            kind: 'safe-to-migrate',
            reason: 'fresh-empty',
            expectedMigrationCount: 3,
            appliedMigrationCount: 0,
            nextMissingMigrationTag: '0000_public_magma',
        });
    });

    it('marks a journaled database that is behind as safe to migrate', () => {
        const assessment = assessDrizzleDatabaseState(migrations, {
            publicTableCount: 12,
            journalTableExists: true,
            appliedMigrationCount: 2,
        });

        expect(assessment).toEqual<DrizzleDatabaseAssessment>({
            kind: 'safe-to-migrate',
            reason: 'pending-migrations',
            expectedMigrationCount: 3,
            appliedMigrationCount: 2,
            nextMissingMigrationTag: '0019_unified_actor_identity',
        });
    });

    it('requires manual baselining when app tables exist without a journal', () => {
        const assessment = assessDrizzleDatabaseState(migrations, {
            publicTableCount: 12,
            journalTableExists: false,
            appliedMigrationCount: 0,
        });

        expect(assessment.kind).toBe('baseline-required');
        expect(assessment).toMatchObject({
            reason: 'missing-journal',
            expectedMigrationCount: 3,
            appliedMigrationCount: 0,
        });
    });

    it('fails when the database is ahead of the repo journal', () => {
        const assessment = assessDrizzleDatabaseState(migrations, {
            publicTableCount: 12,
            journalTableExists: true,
            appliedMigrationCount: 4,
        });

        expect(assessment).toEqual<DrizzleDatabaseAssessment>({
            kind: 'ahead-of-repo',
            expectedMigrationCount: 3,
            appliedMigrationCount: 4,
        });
    });
});
