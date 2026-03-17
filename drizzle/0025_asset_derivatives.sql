ALTER TABLE "assets"
    ADD COLUMN "source_asset_id" integer REFERENCES "assets"("id") ON DELETE SET NULL,
    ADD COLUMN "variant_key" text,
    ADD COLUMN "transform_spec" jsonb;

CREATE INDEX "asset_domain_source_idx"
    ON "assets" ("domain_id", "source_asset_id");
