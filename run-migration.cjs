const { drizzle } = require('drizzle-orm/node-postgres');
const { migrate } = require('drizzle-orm/node-postgres/migrator');
const { Client } = require('pg');
require('dotenv').config();

async function main() {
    console.log("Starting script...");
    console.log("Connecting database...");
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    console.log("DB connected");

    const db = drizzle(client);

    console.log("Running migrations...");
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log("Migrations complete!");

    await client.end();
    console.log("DB connection closed");
}

main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});
