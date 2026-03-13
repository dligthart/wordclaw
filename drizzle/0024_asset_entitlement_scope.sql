ALTER TABLE "assets"
    ADD COLUMN "entitlement_scope_type" text,
    ADD COLUMN "entitlement_scope_ref" integer;

CREATE INDEX "asset_domain_entitlement_scope_idx"
    ON "assets" ("domain_id", "entitlement_scope_type", "entitlement_scope_ref");
