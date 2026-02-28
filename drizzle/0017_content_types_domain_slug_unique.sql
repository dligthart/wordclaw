ALTER TABLE "content_types" DROP CONSTRAINT IF EXISTS "content_types_slug_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "content_types_slug_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "content_types_domain_slug_unique" ON "content_types" USING btree ("domain_id","slug");
