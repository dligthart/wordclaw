ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "actor_type" text;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "actor_source" text;
--> statement-breakpoint
ALTER TABLE "review_tasks" ADD COLUMN IF NOT EXISTS "assignee_actor_id" text;
--> statement-breakpoint
ALTER TABLE "review_tasks" ADD COLUMN IF NOT EXISTS "assignee_actor_type" text;
--> statement-breakpoint
ALTER TABLE "review_tasks" ADD COLUMN IF NOT EXISTS "assignee_actor_source" text;
--> statement-breakpoint
ALTER TABLE "review_comments" ADD COLUMN IF NOT EXISTS "author_actor_id" text;
--> statement-breakpoint
ALTER TABLE "review_comments" ADD COLUMN IF NOT EXISTS "author_actor_type" text;
--> statement-breakpoint
ALTER TABLE "review_comments" ADD COLUMN IF NOT EXISTS "author_actor_source" text;
--> statement-breakpoint
UPDATE "payments"
SET
    "actor_type" = CASE
        WHEN "actor_id" = 'anonymous' THEN 'anonymous'
        WHEN "actor_id" = 'mcp-local' THEN 'mcp'
        WHEN "actor_id" = 'system' THEN 'system'
        WHEN "actor_id" LIKE 'api_key:%' THEN 'api_key'
        WHEN "actor_id" LIKE 'env_key:%' THEN 'env_key'
        WHEN "actor_id" LIKE 'supervisor:%' THEN 'supervisor'
        WHEN "actor_id" ~ '^[0-9]+$' THEN 'api_key'
        ELSE "actor_type"
    END,
    "actor_source" = CASE
        WHEN "actor_id" = 'anonymous' THEN 'anonymous'
        WHEN "actor_id" = 'mcp-local' THEN 'local'
        WHEN "actor_id" = 'system' THEN 'system'
        WHEN "actor_id" LIKE 'api_key:%' THEN 'db'
        WHEN "actor_id" LIKE 'env_key:%' THEN 'env'
        WHEN "actor_id" LIKE 'supervisor:%' THEN 'cookie'
        WHEN "actor_id" ~ '^[0-9]+$' THEN 'db'
        ELSE "actor_source"
    END
WHERE "actor_id" IS NOT NULL
  AND ("actor_type" IS NULL OR "actor_source" IS NULL);
--> statement-breakpoint
UPDATE "review_tasks"
SET
    "assignee_actor_id" = CASE
        WHEN "assignee" = 'anonymous' THEN 'anonymous'
        WHEN "assignee" = 'mcp-local' THEN 'mcp-local'
        WHEN "assignee" = 'system' THEN 'system'
        WHEN "assignee" LIKE 'api_key:%' THEN "assignee"
        WHEN "assignee" LIKE 'env_key:%' THEN "assignee"
        WHEN "assignee" LIKE 'supervisor:%' THEN "assignee"
        WHEN "assignee" ~ '^[0-9]+$' THEN CONCAT('api_key:', "assignee")
        ELSE "assignee_actor_id"
    END,
    "assignee_actor_type" = CASE
        WHEN "assignee" = 'anonymous' THEN 'anonymous'
        WHEN "assignee" = 'mcp-local' THEN 'mcp'
        WHEN "assignee" = 'system' THEN 'system'
        WHEN "assignee" LIKE 'api_key:%' THEN 'api_key'
        WHEN "assignee" LIKE 'env_key:%' THEN 'env_key'
        WHEN "assignee" LIKE 'supervisor:%' THEN 'supervisor'
        WHEN "assignee" ~ '^[0-9]+$' THEN 'api_key'
        ELSE "assignee_actor_type"
    END,
    "assignee_actor_source" = CASE
        WHEN "assignee" = 'anonymous' THEN 'anonymous'
        WHEN "assignee" = 'mcp-local' THEN 'local'
        WHEN "assignee" = 'system' THEN 'system'
        WHEN "assignee" LIKE 'api_key:%' THEN 'db'
        WHEN "assignee" LIKE 'env_key:%' THEN 'env'
        WHEN "assignee" LIKE 'supervisor:%' THEN 'cookie'
        WHEN "assignee" ~ '^[0-9]+$' THEN 'db'
        ELSE "assignee_actor_source"
    END
WHERE "assignee" IS NOT NULL
  AND (
    "assignee_actor_id" IS NULL
    OR "assignee_actor_type" IS NULL
    OR "assignee_actor_source" IS NULL
  );
--> statement-breakpoint
UPDATE "review_comments"
SET
    "author_actor_id" = CASE
        WHEN "author_id" = 'anonymous' THEN 'anonymous'
        WHEN "author_id" = 'mcp-local' THEN 'mcp-local'
        WHEN "author_id" = 'system' THEN 'system'
        WHEN "author_id" LIKE 'api_key:%' THEN "author_id"
        WHEN "author_id" LIKE 'env_key:%' THEN "author_id"
        WHEN "author_id" LIKE 'supervisor:%' THEN "author_id"
        WHEN "author_id" ~ '^[0-9]+$' THEN CONCAT('api_key:', "author_id")
        ELSE "author_actor_id"
    END,
    "author_actor_type" = CASE
        WHEN "author_id" = 'anonymous' THEN 'anonymous'
        WHEN "author_id" = 'mcp-local' THEN 'mcp'
        WHEN "author_id" = 'system' THEN 'system'
        WHEN "author_id" LIKE 'api_key:%' THEN 'api_key'
        WHEN "author_id" LIKE 'env_key:%' THEN 'env_key'
        WHEN "author_id" LIKE 'supervisor:%' THEN 'supervisor'
        WHEN "author_id" ~ '^[0-9]+$' THEN 'api_key'
        ELSE "author_actor_type"
    END,
    "author_actor_source" = CASE
        WHEN "author_id" = 'anonymous' THEN 'anonymous'
        WHEN "author_id" = 'mcp-local' THEN 'local'
        WHEN "author_id" = 'system' THEN 'system'
        WHEN "author_id" LIKE 'api_key:%' THEN 'db'
        WHEN "author_id" LIKE 'env_key:%' THEN 'env'
        WHEN "author_id" LIKE 'supervisor:%' THEN 'cookie'
        WHEN "author_id" ~ '^[0-9]+$' THEN 'db'
        ELSE "author_actor_source"
    END
WHERE "author_id" IS NOT NULL
  AND (
    "author_actor_id" IS NULL
    OR "author_actor_type" IS NULL
    OR "author_actor_source" IS NULL
  );
