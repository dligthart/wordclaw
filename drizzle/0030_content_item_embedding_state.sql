ALTER TABLE "content_items"
ADD COLUMN "embedding_status" text DEFAULT 'disabled' NOT NULL;
--> statement-breakpoint
ALTER TABLE "content_items"
ADD COLUMN "embedding_chunks" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "content_items"
ADD COLUMN "embedding_updated_at" timestamp;
--> statement-breakpoint
ALTER TABLE "content_items"
ADD COLUMN "embedding_error_code" text;
