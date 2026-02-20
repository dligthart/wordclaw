CREATE TABLE "content_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_type_id" serial NOT NULL,
	"data" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"schema" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "content_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_content_type_id_content_types_id_fk" FOREIGN KEY ("content_type_id") REFERENCES "public"."content_types"("id") ON DELETE no action ON UPDATE no action;