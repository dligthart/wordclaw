ALTER TABLE "supervisors" ADD COLUMN IF NOT EXISTS "domain_id" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supervisors" ADD CONSTRAINT "supervisors_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supervisors_domain_idx" ON "supervisors" USING btree ("domain_id");
