CREATE TABLE IF NOT EXISTS "external_feedback_events" (
    "id" serial PRIMARY KEY NOT NULL,
    "domain_id" integer NOT NULL,
    "content_item_id" integer NOT NULL,
    "published_version" integer NOT NULL,
    "decision" text,
    "comment" text,
    "prompt" text,
    "refinement_mode" text DEFAULT 'human_supervised' NOT NULL,
    "actor_id" text NOT NULL,
    "actor_type" text DEFAULT 'external_requester' NOT NULL,
    "actor_source" text NOT NULL,
    "actor_display_name" text,
    "actor_email" text,
    "review_task_id" integer,
    "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_tasks" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'author_submit' NOT NULL;
--> statement-breakpoint
ALTER TABLE "review_tasks" ADD COLUMN IF NOT EXISTS "source_event_id" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "external_feedback_events"
    ADD CONSTRAINT "external_feedback_events_domain_id_domains_id_fk"
    FOREIGN KEY ("domain_id")
    REFERENCES "public"."domains"("id")
    ON DELETE cascade
    ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "external_feedback_events"
    ADD CONSTRAINT "external_feedback_events_content_item_id_content_items_id_fk"
    FOREIGN KEY ("content_item_id")
    REFERENCES "public"."content_items"("id")
    ON DELETE cascade
    ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "external_feedback_events"
    ADD CONSTRAINT "external_feedback_events_review_task_id_review_tasks_id_fk"
    FOREIGN KEY ("review_task_id")
    REFERENCES "public"."review_tasks"("id")
    ON DELETE set null
    ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_feedback_domain_content_idx"
    ON "external_feedback_events" USING btree ("domain_id", "content_item_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_feedback_domain_review_task_idx"
    ON "external_feedback_events" USING btree ("domain_id", "review_task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_tasks_domain_source_idx"
    ON "review_tasks" USING btree ("domain_id", "source", "status", "created_at");
