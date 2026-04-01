CREATE TABLE IF NOT EXISTS "workforce_agents" (
    "id" serial PRIMARY KEY NOT NULL,
    "domain_id" integer NOT NULL,
    "name" text NOT NULL,
    "slug" text NOT NULL,
    "purpose" text NOT NULL,
    "soul" text NOT NULL,
    "provider" jsonb DEFAULT '{"type":"deterministic"}'::jsonb NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workforce_agents"
    ADD CONSTRAINT "workforce_agents_domain_id_domains_id_fk"
    FOREIGN KEY ("domain_id")
    REFERENCES "public"."domains"("id")
    ON DELETE cascade
    ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workforce_agents_domain_slug_unique" ON "workforce_agents" USING btree ("domain_id","slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workforce_agents_domain_idx" ON "workforce_agents" USING btree ("domain_id");
