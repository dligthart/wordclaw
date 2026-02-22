CREATE TABLE "domains" (
	"id" serial PRIMARY KEY NOT NULL,
	"hostname" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "domains_hostname_unique" UNIQUE("hostname")
);
--> statement-breakpoint
-- Seed initial domain
INSERT INTO "domains" ("id", "hostname", "name") VALUES (1, 'default.local', 'Default Workspace') ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "domain_id" integer;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "domain_id" integer;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "domain_id" integer;--> statement-breakpoint
ALTER TABLE "content_types" ADD COLUMN "domain_id" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "domain_id" integer;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "domain_id" integer;--> statement-breakpoint

-- Backfill existing records
UPDATE "api_keys" SET "domain_id" = 1 WHERE "domain_id" IS NULL;--> statement-breakpoint
UPDATE "audit_logs" SET "domain_id" = 1 WHERE "domain_id" IS NULL;--> statement-breakpoint
UPDATE "content_items" SET "domain_id" = 1 WHERE "domain_id" IS NULL;--> statement-breakpoint
UPDATE "content_types" SET "domain_id" = 1 WHERE "domain_id" IS NULL;--> statement-breakpoint
UPDATE "payments" SET "domain_id" = 1 WHERE "domain_id" IS NULL;--> statement-breakpoint
UPDATE "webhooks" SET "domain_id" = 1 WHERE "domain_id" IS NULL;--> statement-breakpoint

-- Enforce constraints
ALTER TABLE "api_keys" ALTER COLUMN "domain_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "domain_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "content_items" ALTER COLUMN "domain_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "content_types" ALTER COLUMN "domain_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "domain_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "webhooks" ALTER COLUMN "domain_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_types" ADD CONSTRAINT "content_types_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;