import { sql } from 'drizzle-orm';
import { db } from './src/db/index';

async function main() {
    console.log("Creating payments table directly...");
    await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "payments" (
        "id" serial PRIMARY KEY NOT NULL,
        "payment_hash" text NOT NULL,
        "payment_request" text NOT NULL,
        "amount_satoshis" integer NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "resource_path" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "payments_payment_hash_unique" UNIQUE("payment_hash")
    );
  `);
    console.log("Table created!");
    process.exit(0);
}

main().catch(console.error);
