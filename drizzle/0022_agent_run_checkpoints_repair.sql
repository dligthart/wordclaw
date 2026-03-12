CREATE TABLE IF NOT EXISTS "agent_run_checkpoints" (
    "id" serial PRIMARY KEY NOT NULL,
    "run_id" integer NOT NULL,
    "domain_id" integer NOT NULL,
    "checkpoint_key" text NOT NULL,
    "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'agent_run_checkpoints_run_id_agent_runs_id_fk'
    ) THEN
        ALTER TABLE "agent_run_checkpoints"
            ADD CONSTRAINT "agent_run_checkpoints_run_id_agent_runs_id_fk"
            FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id")
            ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'agent_run_checkpoints_domain_id_domains_id_fk'
    ) THEN
        ALTER TABLE "agent_run_checkpoints"
            ADD CONSTRAINT "agent_run_checkpoints_domain_id_domains_id_fk"
            FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id")
            ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_run_checkpoints_run_created_at_idx"
    ON "agent_run_checkpoints" USING btree ("run_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_run_checkpoints_domain_run_idx"
    ON "agent_run_checkpoints" USING btree ("domain_id","run_id");
