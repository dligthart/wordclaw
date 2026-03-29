import * as dotenv from 'dotenv';
import { runDrizzleMigrations } from './migration-runner.js';
dotenv.config();

const runMigration = async () => {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL must be defined");
    }

    console.log("Running migrations with pg driver...");
    try {
        const result = await runDrizzleMigrations({
            connectionString: process.env.DATABASE_URL,
        });

        if (result.migrated) {
            if (result.assessment.kind === 'safe-to-migrate' && result.assessment.reason === 'pending-migrations') {
                console.log(
                    `Applied pending migrations (${result.appliedMigrationCountBefore}/${result.expectedMigrationCount} before run).`
                );
            } else {
                console.log(`Initialized schema with ${result.expectedMigrationCount} repo migration(s).`);
            }
        } else {
            console.log("Migrations already up to date.");
        }

        console.log("Migrations complete!");
    } catch (e) {
        console.error("Migration failed", e);
        process.exit(1);
    }
};

runMigration();
