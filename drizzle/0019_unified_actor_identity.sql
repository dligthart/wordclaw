ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actor_id" text;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actor_type" text;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actor_source" text;
--> statement-breakpoint
UPDATE "audit_logs"
SET
    "actor_id" = CONCAT('api_key:', "user_id"::text),
    "actor_type" = 'api_key',
    "actor_source" = 'db'
WHERE "user_id" IS NOT NULL
  AND "actor_id" IS NULL;
