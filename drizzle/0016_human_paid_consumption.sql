ALTER TABLE "entitlements" ADD COLUMN "activated_at" timestamp;
--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "terminated_at" timestamp;
--> statement-breakpoint
ALTER TABLE "entitlements" ALTER COLUMN "status" SET DEFAULT 'pending_payment';
--> statement-breakpoint
CREATE INDEX "entitlements_domain_agent_status_expires_idx" ON "entitlements" USING btree ("domain_id","agent_profile_id","status","expires_at");
