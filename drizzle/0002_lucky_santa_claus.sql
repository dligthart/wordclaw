CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"user_id" integer,
	"details" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "content_item_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_item_id" integer NOT NULL,
	"version" integer NOT NULL,
	"data" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'content_items'
    AND column_name = 'content_type_id'
    AND data_type != 'integer'
  ) THEN
    ALTER TABLE "content_items" ALTER COLUMN "content_type_id" SET DATA TYPE integer;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'content_items'
    AND column_name = 'version'
  ) THEN
    ALTER TABLE "content_items" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "content_items" ALTER COLUMN "content_type_id" DROP DEFAULT;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'content_item_versions_content_item_id_content_items_id_fk'
  ) THEN
    ALTER TABLE "content_item_versions" ADD CONSTRAINT "content_item_versions_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DROP SEQUENCE IF EXISTS "content_items_content_type_id_seq";