import { Pool } from 'pg';
import { formatBaselineGuidance, readDrizzleMigrations } from '../src/db/drizzle-migrations.js';
import { applyVitestEnvDefaults } from './vitest.env.js';

const dbBackedTargetMatchers = [
    /^src\/__tests__\//,
    /^src\/api\/routes\.contract\.test\.ts$/,
    /^src\/graphql\//,
    /^src\/mcp\//,
    /^tests\/integration\//
];

const normalizeTarget = (target: string) => target.replace(/^\.?\//, '').replaceAll('\\', '/');

const extractExplicitTargets = (argv: string[]) =>
    argv
        .filter((arg) => {
            if (!arg || arg.startsWith('-')) {
                return false;
            }

            if (arg === 'run' || arg === 'watch' || arg === 'vitest') {
                return false;
            }

            if (arg.endsWith('/vitest.mjs') || arg.endsWith('/vitest.js')) {
                return false;
            }

            return arg.includes('.test.') || arg.includes('.spec.') || arg.includes('/') || arg.includes('\\');
        })
        .map(normalizeTarget);

const shouldRunDatabasePreflight = () => {
    if (process.env.VITEST_SKIP_DB_PREFLIGHT === '1') {
        return false;
    }

    const argv = process.argv.slice(2);
    const explicitTargets = extractExplicitTargets(argv);

    if (explicitTargets.length > 0) {
        return explicitTargets.some((target) =>
            dbBackedTargetMatchers.some((matcher) => matcher.test(target))
        );
    }

    return true;
};

const buildMigrateMessage = (details: string[]) =>
    [
        'Vitest database preflight failed: the configured test database is not aligned with repo migrations.',
        ...details,
        'Run `npm run db:migrate` and rerun the suite.',
        'Set `VITEST_SKIP_DB_PREFLIGHT=1` only for file-targeted non-DB unit tests.'
    ].join('\n');

export default async () => {
    applyVitestEnvDefaults();

    if (!shouldRunDatabasePreflight()) {
        return;
    }

    const migrations = readDrizzleMigrations();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    try {
        await pool.query('create schema if not exists drizzle');

        const publicTableState = await pool.query<{ count: string }>(`
            select count(*)::text as count
            from information_schema.tables
            where table_schema = 'public'
              and table_type = 'BASE TABLE'
              and table_name != '__drizzle_migrations'
        `);
        const publicTableCount = Number(publicTableState.rows[0]?.count ?? '0');

        const journalTableState = await pool.query<{ count: string }>(`
            select count(*)::text as count
            from information_schema.tables
            where table_schema = 'drizzle'
              and table_name = '__drizzle_migrations'
        `);
        const journalTableExists = Number(journalTableState.rows[0]?.count ?? '0') > 0;

        if (!journalTableExists) {
            if (publicTableCount > 0) {
                throw new Error(
                    [
                        'Vitest database preflight failed: existing schema detected without a Drizzle migration journal.',
                        formatBaselineGuidance(migrations)
                    ].join('\n')
                );
            }

            throw new Error(
                buildMigrateMessage([
                    `No Drizzle migration journal exists for ${process.env.DATABASE_URL}.`
                ])
            );
        }

        const appliedState = await pool.query<{ count: string }>(
            'select count(*)::text as count from drizzle.__drizzle_migrations'
        );
        const appliedMigrationCount = Number(appliedState.rows[0]?.count ?? '0');
        const expectedMigrationCount = migrations.length;

        if (appliedMigrationCount === 0) {
            if (publicTableCount > 0) {
                throw new Error(
                    [
                        'Vitest database preflight failed: existing schema detected with an empty Drizzle migration journal.',
                        formatBaselineGuidance(migrations)
                    ].join('\n')
                );
            }

            throw new Error(
                buildMigrateMessage([
                    `No migrations have been applied to ${process.env.DATABASE_URL}.`
                ])
            );
        }

        if (appliedMigrationCount < expectedMigrationCount) {
            throw new Error(
                buildMigrateMessage([
                    `Applied migrations: ${appliedMigrationCount}/${expectedMigrationCount}.`,
                    `Next missing migration: ${migrations[appliedMigrationCount]?.tag ?? 'latest'}.`
                ])
            );
        }

        if (appliedMigrationCount > expectedMigrationCount) {
            throw new Error(
                buildMigrateMessage([
                    `Database has ${appliedMigrationCount} applied migrations, but the repo only defines ${expectedMigrationCount}.`
                ])
            );
        }
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('Vitest database preflight failed:')) {
            throw error;
        }

        const originalMessage = error instanceof Error ? error.message : String(error);
        throw new Error(
            [
                'Vitest database preflight could not inspect the configured Postgres instance.',
                `DATABASE_URL=${process.env.DATABASE_URL}`,
                `Original error: ${originalMessage}`,
                'Start Postgres or set `VITEST_SKIP_DB_PREFLIGHT=1` for file-targeted non-DB unit tests.'
            ].join('\n')
        );
    } finally {
        await pool.end();
    }
};
