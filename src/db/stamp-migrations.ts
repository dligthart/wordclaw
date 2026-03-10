import { Pool } from 'pg';
import * as dotenv from 'dotenv';

import {
    formatBaselineGuidance,
    readDrizzleMigrations,
    resolveDrizzleMigrationTarget
} from './drizzle-migrations.js';

dotenv.config();

const parseArgs = () => {
    const args = process.argv.slice(2);
    let throughTag: string | undefined;

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];

        if (arg === '--through') {
            if (!args[index + 1]) {
                throw new Error('Missing value for --through');
            }
            throughTag = args[index + 1];
            index += 1;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return { throughTag };
};

const run = async () => {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL must be defined');
    }

    const { throughTag } = parseArgs();
    const allMigrations = readDrizzleMigrations();
    const migrations = resolveDrizzleMigrationTarget(allMigrations, throughTag);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    try {
        await pool.query('create schema if not exists drizzle');
        await pool.query(`
            create table if not exists drizzle.__drizzle_migrations (
                id serial primary key,
                hash text not null,
                created_at bigint
            )
        `);

        const journalCountResult = await pool.query<{ count: string }>(
            'select count(*)::text as count from drizzle.__drizzle_migrations'
        );
        const publicTableCountResult = await pool.query<{ count: string }>(`
            select count(*)::text as count
            from information_schema.tables
            where table_schema = 'public'
              and table_type = 'BASE TABLE'
              and table_name != '__drizzle_migrations'
        `);

        const journalCount = Number(journalCountResult.rows[0]?.count ?? '0');
        const publicTableCount = Number(publicTableCountResult.rows[0]?.count ?? '0');

        if (journalCount > 0) {
            throw new Error('Drizzle migration journal already has entries. Refusing to stamp a non-empty journal.');
        }

        if (publicTableCount === 0) {
            throw new Error(
                'Database has no existing public tables. Refusing to stamp an empty schema; run the normal migrator instead.'
            );
        }

        await pool.query('begin');

        for (const migration of migrations) {
            await pool.query(
                'insert into drizzle.__drizzle_migrations ("hash", "created_at") values ($1, $2)',
                [migration.hash, migration.when]
            );
        }

        await pool.query('commit');

        console.log(
            `Stamped ${migrations.length} Drizzle migration(s) through ${migrations[migrations.length - 1].tag}.`
        );
        console.log('You can now run: npx tsx src/db/migrate.ts');
    } catch (error) {
        await pool.query('rollback').catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        console.error('Failed to stamp Drizzle migrations.');
        console.error(message);
        console.error('');
        console.error(formatBaselineGuidance(allMigrations, throughTag));
        process.exit(1);
    } finally {
        await pool.end();
    }
};

run();
