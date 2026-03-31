CREATE TABLE IF NOT EXISTS "supervisor_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"domain_id" integer,
	"invited_by_supervisor_id" integer,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supervisor_invites" ADD CONSTRAINT "supervisor_invites_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supervisor_invites" ADD CONSTRAINT "supervisor_invites_invited_by_supervisor_id_supervisors_id_fk" FOREIGN KEY ("invited_by_supervisor_id") REFERENCES "public"."supervisors"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supervisor_invites_domain_idx" ON "supervisor_invites" USING btree ("domain_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supervisor_invites_email_idx" ON "supervisor_invites" USING btree ("email");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "supervisor_invites_token_hash_unique" ON "supervisor_invites" USING btree ("token_hash");
