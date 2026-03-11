CREATE TABLE "agent_run_checkpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"domain_id" integer NOT NULL,
	"checkpoint_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_run_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain_id" integer NOT NULL,
	"name" text NOT NULL,
	"run_type" text NOT NULL,
	"strategy_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_run_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"domain_id" integer NOT NULL,
	"step_index" integer DEFAULT 0 NOT NULL,
	"step_key" text NOT NULL,
	"action_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"request_snapshot" jsonb,
	"response_snapshot" jsonb,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain_id" integer NOT NULL,
	"definition_id" integer,
	"goal" text NOT NULL,
	"run_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_by" text,
	"metadata" jsonb,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_types" DROP CONSTRAINT "content_types_slug_unique";--> statement-breakpoint
ALTER TABLE "entitlements" ALTER COLUMN "status" SET DEFAULT 'pending_payment';--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_id" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_type" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "actor_source" text;--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "activated_at" timestamp;--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "terminated_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_run_checkpoints" ADD CONSTRAINT "agent_run_checkpoints_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_checkpoints" ADD CONSTRAINT "agent_run_checkpoints_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_definitions" ADD CONSTRAINT "agent_run_definitions_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_definition_id_agent_run_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."agent_run_definitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_run_checkpoints_run_created_at_idx" ON "agent_run_checkpoints" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_run_checkpoints_domain_run_idx" ON "agent_run_checkpoints" USING btree ("domain_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_definitions_domain_name_unique" ON "agent_run_definitions" USING btree ("domain_id","name");--> statement-breakpoint
CREATE INDEX "agent_run_definitions_domain_run_type_idx" ON "agent_run_definitions" USING btree ("domain_id","run_type");--> statement-breakpoint
CREATE INDEX "agent_run_steps_run_step_index_idx" ON "agent_run_steps" USING btree ("run_id","step_index");--> statement-breakpoint
CREATE INDEX "agent_run_steps_domain_run_idx" ON "agent_run_steps" USING btree ("domain_id","run_id");--> statement-breakpoint
CREATE INDEX "agent_runs_domain_status_idx" ON "agent_runs" USING btree ("domain_id","status");--> statement-breakpoint
CREATE INDEX "agent_runs_domain_created_at_idx" ON "agent_runs" USING btree ("domain_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_definition_idx" ON "agent_runs" USING btree ("definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_types_domain_slug_unique" ON "content_types" USING btree ("domain_id","slug");--> statement-breakpoint
CREATE INDEX "entitlements_domain_agent_status_expires_idx" ON "entitlements" USING btree ("domain_id","agent_profile_id","status","expires_at");