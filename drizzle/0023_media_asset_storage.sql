CREATE TABLE IF NOT EXISTS "assets" (
    "id" serial PRIMARY KEY NOT NULL,
    "domain_id" integer NOT NULL,
    "filename" text NOT NULL,
    "original_filename" text NOT NULL,
    "mime_type" text NOT NULL,
    "size_bytes" integer NOT NULL,
    "byte_hash" text,
    "storage_provider" text NOT NULL,
    "storage_key" text NOT NULL,
    "access_mode" text DEFAULT 'public' NOT NULL,
    "status" text DEFAULT 'active' NOT NULL,
    "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "uploader_actor_id" text,
    "uploader_actor_type" text,
    "uploader_actor_source" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "deleted_at" timestamp
);
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assets_domain_id_domains_id_fk'
    ) THEN
        ALTER TABLE "assets"
            ADD CONSTRAINT "assets_domain_id_domains_id_fk"
            FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id")
            ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_domain_created_at_idx"
    ON "assets" USING btree ("domain_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_domain_status_idx"
    ON "assets" USING btree ("domain_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "asset_storage_key_unique"
    ON "assets" USING btree ("storage_key");
