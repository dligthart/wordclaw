CREATE TABLE "policy_decision_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"principal_id" text,
	"operation" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"environment" text NOT NULL,
	"outcome" text NOT NULL,
	"remediation" text,
	"policy_version" text NOT NULL,
	"evaluation_duration_ms" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "policy_outcome_idx" ON "policy_decision_logs" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "policy_created_at_idx" ON "policy_decision_logs" USING btree ("created_at");