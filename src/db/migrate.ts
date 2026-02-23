import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
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
        await migrate(db, { migrationsFolder: 'drizzle' });
        console.log("Migrations complete!");
    } catch (e) {
        console.error("Migration failed", e);
        process.exit(1);
    }

    await pool.end();
};

runMigration();
