CREATE TABLE "form_definitions" (
    "id" serial PRIMARY KEY NOT NULL,
    "domain_id" integer NOT NULL REFERENCES "domains"("id") ON DELETE cascade,
    "name" text NOT NULL,
    "slug" text NOT NULL,
    "description" text,
    "content_type_id" integer NOT NULL REFERENCES "content_types"("id") ON DELETE cascade,
    "fields" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "default_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "active" boolean NOT NULL DEFAULT true,
    "public_read" boolean NOT NULL DEFAULT true,
    "submission_status" text NOT NULL DEFAULT 'draft',
    "workflow_transition_id" integer REFERENCES "workflow_transitions"("id") ON DELETE set null,
    "require_payment" boolean NOT NULL DEFAULT false,
    "webhook_url" text,
    "webhook_secret" text,
    "success_message" text,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "form_definitions_domain_slug_unique"
    ON "form_definitions" ("domain_id", "slug");

CREATE INDEX "form_definitions_domain_content_type_idx"
    ON "form_definitions" ("domain_id", "content_type_id");
