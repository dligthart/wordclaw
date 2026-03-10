import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { formatBaselineGuidance, readDrizzleMigrations } from './drizzle-migrations.js';
dotenv.config();

const runMigration = async () => {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL must be defined");
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    const db = drizzle(pool);

    console.log("Running migrations with pg driver...");
    try {
        await pool.query("CREATE EXTENSION IF NOT EXISTS vector;");
        await pool.query("CREATE SCHEMA IF NOT EXISTS drizzle;");

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

        let appliedMigrationCount = 0;
        if (journalTableExists) {
            const appliedMigrationState = await pool.query<{ count: string }>(
                'select count(*)::text as count from drizzle.__drizzle_migrations'
            );
            appliedMigrationCount = Number(appliedMigrationState.rows[0]?.count ?? '0');
        }

        if (publicTableCount > 0 && appliedMigrationCount === 0) {
            throw new Error(formatBaselineGuidance(readDrizzleMigrations()));
        }

        await migrate(db, { migrationsFolder: 'drizzle' });
        console.log("Migrations complete!");
    } catch (e) {
        console.error("Migration failed", e);
        process.exit(1);
    }

    await pool.end();
};

runMigration();
