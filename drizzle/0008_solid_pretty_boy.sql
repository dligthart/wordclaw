ALTER TABLE "payments" ADD COLUMN "actor_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "details" jsonb;--> statement-breakpoint
CREATE INDEX "payment_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_created_at_idx" ON "payments" USING btree ("created_at");