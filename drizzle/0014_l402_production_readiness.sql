ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "provider" text DEFAULT 'mock' NOT NULL;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "provider_invoice_id" text;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "settled_at" timestamp;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "failure_reason" text;
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "last_event_id" text;
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_status_allowed_check";
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_allowed_check" CHECK ("payments"."status" IN ('pending', 'paid', 'consumed', 'expired', 'failed'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_provider_idx" ON "payments" USING btree ("provider");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_provider_events" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "payment_provider_events_provider_event_idx" ON "payment_provider_events" USING btree ("provider","event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_provider_events_payment_hash_idx" ON "payment_provider_events" USING btree ("payment_hash");
