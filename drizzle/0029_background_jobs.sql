CREATE TABLE "jobs" (
    "id" serial PRIMARY KEY NOT NULL,
    "domain_id" integer NOT NULL REFERENCES "domains"("id") ON DELETE cascade,
    "kind" text NOT NULL,
    "queue" text NOT NULL DEFAULT 'default',
    "status" text NOT NULL DEFAULT 'queued',
    "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "result" jsonb,
    "run_at" timestamp NOT NULL DEFAULT now(),
    "attempts" integer NOT NULL DEFAULT 0,
    "max_attempts" integer NOT NULL DEFAULT 3,
    "last_error" text,
    "claimed_at" timestamp,
    "started_at" timestamp,
    "completed_at" timestamp,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "jobs_domain_status_run_at_idx"
    ON "jobs" ("domain_id", "status", "run_at");

CREATE INDEX "jobs_kind_run_at_idx"
    ON "jobs" ("kind", "run_at");

CREATE INDEX "jobs_queue_status_idx"
    ON "jobs" ("queue", "status");
