import { Pool } from 'pg';
import { assessDrizzleDatabaseState, readDrizzleMigrations } from '../src/db/drizzle-migrations.js';
import { inspectDrizzleDatabaseState, runDrizzleMigrations } from '../src/db/migration-runner.js';
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
        const inspection = await inspectDrizzleDatabaseState(pool);
        const assessment = assessDrizzleDatabaseState(migrations, inspection);

        if (assessment.kind === 'baseline-required') {
            const heading = assessment.reason === 'missing-journal'
                ? 'Vitest database preflight failed: existing schema detected without a Drizzle migration journal.'
                : 'Vitest database preflight failed: existing schema detected with an empty Drizzle migration journal.';

            throw new Error(
                [
                    heading,
                    assessment.guidance
                ].join('\n')
            );
        }

        if (assessment.kind === 'ahead-of-repo') {
            throw new Error(
                buildMigrateMessage([
                    `Database has ${assessment.appliedMigrationCount} applied migrations, but the repo only defines ${assessment.expectedMigrationCount}.`
                ])
            );
        }

        if (assessment.kind === 'safe-to-migrate') {
            const autoFixMessage = assessment.reason === 'pending-migrations'
                ? `applying pending repo migrations (${assessment.appliedMigrationCount}/${assessment.expectedMigrationCount} before run)`
                : `initializing the database with ${assessment.expectedMigrationCount} repo migration(s)`;

            console.log(`Vitest database preflight: ${autoFixMessage}.`);

            await runDrizzleMigrations({
                connectionString: process.env.DATABASE_URL!,
                pool,
            });
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
