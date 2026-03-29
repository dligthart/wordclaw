import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import {
    assessDrizzleDatabaseState,
    getDefaultMigrationsFolder,
    readDrizzleMigrations,
    type DrizzleDatabaseAssessment,
    type DrizzleDatabaseInspection,
} from './drizzle-migrations.js';

type QueryableClient = Pick<Pool, 'query'>;

export type RunDrizzleMigrationsOptions = {
    connectionString: string;
    migrationsFolder?: string;
    pool?: Pool;
};

export type RunDrizzleMigrationsResult = {
    assessment: DrizzleDatabaseAssessment;
    migrated: boolean;
    expectedMigrationCount: number;
    appliedMigrationCountBefore: number;
};

export async function inspectDrizzleDatabaseState(client: QueryableClient): Promise<DrizzleDatabaseInspection> {
    const publicTableState = await client.query<{ count: string }>(`
        select count(*)::text as count
        from information_schema.tables
        where table_schema = 'public'
          and table_type = 'BASE TABLE'
          and table_name != '__drizzle_migrations'
    `);
    const journalTableState = await client.query<{ count: string }>(`
        select count(*)::text as count
        from information_schema.tables
        where table_schema = 'drizzle'
          and table_name = '__drizzle_migrations'
    `);
    const journalTableExists = Number(journalTableState.rows[0]?.count ?? '0') > 0;

    let appliedMigrationCount = 0;
    if (journalTableExists) {
        const appliedMigrationState = await client.query<{ count: string }>(
            'select count(*)::text as count from drizzle.__drizzle_migrations'
        );
        appliedMigrationCount = Number(appliedMigrationState.rows[0]?.count ?? '0');
    }

    return {
        publicTableCount: Number(publicTableState.rows[0]?.count ?? '0'),
        journalTableExists,
        appliedMigrationCount,
    };
}

export async function runDrizzleMigrations(options: RunDrizzleMigrationsOptions): Promise<RunDrizzleMigrationsResult> {
    const migrationsFolder = options.migrationsFolder ?? getDefaultMigrationsFolder();
    const migrations = readDrizzleMigrations(migrationsFolder);
    const pool = options.pool ?? new Pool({ connectionString: options.connectionString });
    const ownsPool = !options.pool;
    const db = drizzle(pool);

    try {
        await pool.query('CREATE EXTENSION IF NOT EXISTS vector;');
        await pool.query('CREATE SCHEMA IF NOT EXISTS drizzle;');

        const inspection = await inspectDrizzleDatabaseState(pool);
        const assessment = assessDrizzleDatabaseState(migrations, inspection);

        if (assessment.kind === 'baseline-required') {
            throw new Error(assessment.guidance);
        }

        if (assessment.kind === 'ahead-of-repo') {
            throw new Error(
                `Database has ${assessment.appliedMigrationCount} applied migrations, but the repo only defines ${assessment.expectedMigrationCount}.`
            );
        }

        if (assessment.kind === 'safe-to-migrate') {
            await migrate(db, { migrationsFolder });
        }

        return {
            assessment,
            migrated: assessment.kind === 'safe-to-migrate',
            expectedMigrationCount: assessment.expectedMigrationCount,
            appliedMigrationCountBefore: assessment.appliedMigrationCount,
        };
    } finally {
        if (ownsPool) {
            await pool.end();
        }
    }
}
