CREATE TABLE IF NOT EXISTS "ai_provider_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain_id" integer NOT NULL,
	"provider" text NOT NULL,
	"api_key" text NOT NULL,
	"default_model" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_provider_configs" ADD CONSTRAINT "ai_provider_configs_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_provider_configs_domain_provider_unique" ON "ai_provider_configs" USING btree ("domain_id","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_provider_configs_domain_idx" ON "ai_provider_configs" USING btree ("domain_id");--> statement-breakpoint
