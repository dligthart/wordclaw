import { sql } from 'drizzle-orm';
import { db } from './src/db/index';

async function main() {
  console.log("Altering payments table directly...");
  await db.execute(sql`
    ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "actor_id" text;
    ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "details" jsonb;
  `);
  console.log("Table altered!");
  process.exit(0);
}

main().catch(console.error);
