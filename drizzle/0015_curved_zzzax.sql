CREATE TABLE "allocation_status_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain_id" integer NOT NULL,
	"allocation_id" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contribution_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain_id" integer NOT NULL,
	"content_item_id" integer NOT NULL,
	"agent_profile_id" integer NOT NULL,
	"role" text NOT NULL,
	"weight" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "l402_operator_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain_id" integer NOT NULL,
	"architecture" text DEFAULT 'mock' NOT NULL,
	"webhook_endpoint" text,
	"secret_manager_path" text,
	"checklist_approvals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "l402_operator_configs_domain_id_unique" UNIQUE("domain_id")
);
--> statement-breakpoint
CREATE TABLE "payment_provider_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"payment_hash" text NOT NULL,
	"status" text NOT NULL,
	"signature" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain_id" integer NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain_id" integer NOT NULL,
	"batch_id" integer NOT NULL,
	"agent_profile_id" integer NOT NULL,
	"amount_sats" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenue_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain_id" integer NOT NULL,
	"revenue_event_id" integer NOT NULL,
	"agent_profile_id" integer NOT NULL,
	"amount_sats" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenue_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain_id" integer NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text NOT NULL,
	"gross_sats" integer NOT NULL,
	"fee_sats" integer NOT NULL,
	"net_sats" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider" text DEFAULT 'mock' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider_invoice_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "settled_at" timestamp;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "last_event_id" text;--> statement-breakpoint
ALTER TABLE "allocation_status_events" ADD CONSTRAINT "allocation_status_events_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_status_events" ADD CONSTRAINT "allocation_status_events_allocation_id_revenue_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."revenue_allocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_events" ADD CONSTRAINT "contribution_events_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_events" ADD CONSTRAINT "contribution_events_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_events" ADD CONSTRAINT "contribution_events_agent_profile_id_agent_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "l402_operator_configs" ADD CONSTRAINT "l402_operator_configs_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_transfers" ADD CONSTRAINT "payout_transfers_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_transfers" ADD CONSTRAINT "payout_transfers_batch_id_payout_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payout_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_transfers" ADD CONSTRAINT "payout_transfers_agent_profile_id_agent_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_allocations" ADD CONSTRAINT "revenue_allocations_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_allocations" ADD CONSTRAINT "revenue_allocations_revenue_event_id_revenue_events_id_fk" FOREIGN KEY ("revenue_event_id") REFERENCES "public"."revenue_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_allocations" ADD CONSTRAINT "revenue_allocations_agent_profile_id_agent_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_events" ADD CONSTRAINT "revenue_events_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_events_provider_event_idx" ON "payment_provider_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "payment_provider_events_payment_hash_idx" ON "payment_provider_events" USING btree ("payment_hash");--> statement-breakpoint
CREATE INDEX "payment_provider_idx" ON "payments" USING btree ("provider");