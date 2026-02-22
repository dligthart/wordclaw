import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const runRawMigration = async () => {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL must be defined");
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    console.log("Running raw SQL migration...");
    try {
        const sqlPath = path.join(process.cwd(), 'drizzle/0010_sloppy_praxagora.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        // Strip statement breakpoints used by drizzle
        const cleanSql = sql.split('--> statement-breakpoint').join(';');

        await pool.query(cleanSql);
        console.log("Migration 0010 applied successfully via raw pg pool!");
    } catch (e) {
        console.error("Migration failed", e);
        process.exit(1);
    }

    await pool.end();
};

runRawMigration();
