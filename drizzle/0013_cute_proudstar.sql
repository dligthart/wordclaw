CREATE TABLE "access_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain_id" integer NOT NULL,
	"entitlement_id" integer NOT NULL,
	"resource_path" text NOT NULL,
	"action" text NOT NULL,
	"granted" boolean NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain_id" integer NOT NULL,
	"api_key_id" integer NOT NULL,
	"payout_address" text
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain_id" integer NOT NULL,
	"offer_id" integer NOT NULL,
	"policy_id" integer NOT NULL,
	"policy_version" integer NOT NULL,
	"agent_profile_id" integer NOT NULL,
	"payment_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp,
	"remaining_reads" integer,
	"delegated_from" integer,
	CONSTRAINT "entitlements_payment_hash_unique" UNIQUE("payment_hash")
);
--> statement-breakpoint
CREATE TABLE "license_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain_id" integer NOT NULL,
	"offer_id" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"max_reads" integer,
	"expires_at" timestamp,
	"allowed_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allow_redistribution" boolean DEFAULT false NOT NULL,
	"terms_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain_id" integer NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_ref" integer,
	"price_sats" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_policy_id_license_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."license_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_agent_profile_id_agent_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_policies" ADD CONSTRAINT "license_policies_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_policies" ADD CONSTRAINT "license_policies_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;