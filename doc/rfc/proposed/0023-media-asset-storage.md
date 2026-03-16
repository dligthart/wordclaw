---
title: Media Asset Storage
status: rolling-out
author: WordClaw Team
date: 2026-03-13
updated: 2026-03-16
---

# RFC 0023: Media Asset Storage

## 1. Objective

Add first-class media asset storage and delivery to WordClaw as a core-path capability.

Today many schemas still rely on plain string fields such as `imageUrl`, `thumbnailUrl`, `pdfUrl`, or `media`. That leaves a major gap in the product:

- assets are not first-class records
- agents must host binaries externally and manually inject URLs
- operators cannot safely manage lifecycle, delivery policy, or provenance
- rollback and historical versions can break when external files disappear

This RFC proposes a native asset system with schema-aware references, managed storage, and delivery modes that align with the current WordClaw runtime.

## 1.1 Current Status

As of 2026-03-16, RFC 0023 is actively rolling out and the core asset runtime is already live on `main`.

Implemented so far:

- first-class `assets` persistence with domain scoping and canonical actor attribution
- schema-aware asset references via `x-wordclaw-field-kind: "asset"` and `"asset-list"`
- REST asset routes for create, direct-upload issue/complete, list, get, offers, signed-access issuance, content delivery, soft delete, restore, and purge
- multipart, JSON/base64, and provider-issued direct upload paths
- local and S3-compatible object storage providers, with explicit fallback-to-local reporting when remote configuration is incomplete
- `public`, `signed`, and `entitled` delivery modes
- MCP asset tools and asset discovery resources
- capability/deployment discovery for asset provider, upload modes, delivery modes, and lifecycle support
- CLI asset commands for list/get/create/offers/access/delete/restore/purge
- supervisor UI asset inventory, inspector, upload, preview, signed access, and lifecycle controls

Still pending:

- optional asset derivatives
- additional remote providers beyond the current `local` + S3-compatible adapter if product demand justifies them

## 2. Motivation

WordClaw is already opinionated about:

1. schema-first content creation
2. actor-aware auditability
3. workflow and approval orchestration
4. L402 paid-content enforcement
5. REST and MCP-first agent integration

Media handling is now the main missing core capability. Without it, the system remains incomplete for real publishing paths because agents can create content records but cannot safely create, store, attach, and serve the binaries that content depends on.

## 3. Design Principles

### 3.1. Assets are first-class records

Assets must be stored and managed as domain-scoped records rather than loose URLs embedded into arbitrary string fields.

### 3.2. Asset references must be schema-aware

Content schemas must be able to declare that a field references an asset, so validation can enforce correct shape and domain ownership.

### 3.3. Delivery is policy-driven

The same stored asset may be delivered as:

- `public`
- `signed`
- `entitled`

WordClaw should derive delivery URLs or delivery endpoints from policy and deployment state instead of treating a canonical `public_url` as the source of truth.

### 3.4. Deletion must be safe for a versioned CMS

WordClaw already supports version history and rollback. Asset lifecycle must preserve historical references and prevent silent breakage.

### 3.5. Align with current platform standards

This RFC must follow existing WordClaw conventions for:

- integer identifiers and integer domain foreign keys
- canonical actor identity fields
- cursor pagination
- REST and MCP-first contracts
- current auth scopes and admin boundaries

## 4. Design Proposal

### 4.1. Schema-Level Asset References

WordClaw content schemas should be able to declare asset fields explicitly via a schema extension.

Example:

```json
{
  "type": "object",
  "properties": {
    "heroImage": {
      "type": "object",
      "x-wordclaw-field-kind": "asset",
      "properties": {
        "assetId": { "type": "integer" },
        "alt": { "type": "string" },
        "caption": { "type": "string" }
      },
      "required": ["assetId"]
    }
  }
}
```

Example gallery field:

```json
{
  "type": "array",
  "x-wordclaw-field-kind": "asset-list",
  "items": {
    "type": "object",
    "properties": {
      "assetId": { "type": "integer" },
      "alt": { "type": "string" },
      "caption": { "type": "string" }
    },
    "required": ["assetId"]
  }
}
```

Validation rules:

- referenced `assetId` must exist
- asset must belong to the same domain
- asset must not be soft-deleted
- asset must be valid for the current content mutation path

This removes the need for agents to guess semantics from names like `imageUrl`.

### 4.2. Storage Provider Abstraction

WordClaw should implement a provider abstraction so storage can start local and expand later.

V1 providers:

- `LocalDiskStorage`

Future providers:

- `S3Storage`
- `R2Storage`
- `GCSStorage`

The active provider remains deployment-configured.

Current example:

```env
ASSET_STORAGE_PROVIDER=local
ASSET_STORAGE_ROOT=./storage/assets
```

Remote example:

```env
ASSET_STORAGE_PROVIDER=s3
ASSET_S3_BUCKET=my-wordclaw-assets
ASSET_S3_REGION=us-east-1
ASSET_S3_ACCESS_KEY_ID=...
ASSET_S3_SECRET_ACCESS_KEY=...
ASSET_S3_ENDPOINT=
ASSET_S3_FORCE_PATH_STYLE=false
```

`ASSET_STORAGE_PROVIDER=s3` activates the S3-compatible adapter when the bucket, region, and credentials are present. `ASSET_S3_ENDPOINT` and `ASSET_S3_FORCE_PATH_STYLE=true` support R2, MinIO, and similar gateways. If S3 is selected without a complete configuration, the runtime falls back to `local` and surfaces that fallback through `/api/capabilities` and `/api/deployment-status`.

Provider responsibilities:

- persist bytes
- return a durable provider storage key
- delete or archive underlying bytes when permitted
- generate public or signed delivery URLs when supported

### 4.3. Data Model

The asset schema must align with existing WordClaw database conventions.

Illustrative table:

```sql
create table assets (
  id serial primary key,
  domain_id integer not null references domains(id) on delete cascade,
  filename text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  byte_hash text,
  storage_provider text not null,
  storage_key text not null,
  access_mode text not null,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  uploader_actor_id text,
  uploader_actor_type text,
  uploader_actor_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
```

Supporting asset usage tracking:

```sql
create table asset_references (
  id serial primary key,
  domain_id integer not null references domains(id) on delete cascade,
  asset_id integer not null references assets(id) on delete cascade,
  content_item_id integer not null references content_items(id) on delete cascade,
  content_item_version_id integer references content_item_versions(id) on delete cascade,
  field_path text not null,
  created_at timestamptz not null default now()
);
```

Notes:

- `storage_key` is provider-internal location metadata
- `access_mode` is one of `public`, `signed`, or `entitled`
- `status` starts with `active` and `deleted`
- canonical actor identity is stored directly on the asset record
- the system should not treat a permanent `public_url` column as canonical truth

### 4.4. Delivery Modes

WordClaw must support all of the following as first-class delivery behavior.

#### Public

- stable public delivery URL
- suitable for public site media such as blog images

#### Signed

- short-lived URL minted by WordClaw or the backing provider
- suitable for private downloads and operator-only access

#### Entitled

- access checked by WordClaw before bytes are served
- suitable for paid downloads, premium media, and L402-protected asset delivery

The stored asset reference points to the asset record. The system resolves actual delivery according to current policy.

### 4.5. REST Contract

V1 REST endpoints:

- `POST /api/assets`
  - upload asset and create metadata
  - supports `multipart/form-data`
- `GET /api/assets`
  - cursor-paginated asset listing
- `GET /api/assets/:id`
  - return asset metadata and derived delivery information
- `GET /api/assets/:id/content`
  - stream or redirect according to access mode and caller permissions
- `POST /api/assets/:id/access`
  - issue short-lived signed access for `signed` assets
- `DELETE /api/assets/:id`
  - soft-delete the asset
- `POST /api/assets/:id/restore`
  - restore a soft-deleted asset
- `POST /api/assets/:id/purge`
  - admin-only hard purge after safety checks

### 4.6. Pagination Contract

Asset listing must follow the same current project standard used by content discovery:

- `limit`
- `cursor`
- deterministic ordering
- response envelope with `data` and `meta`
- `meta.hasMore`
- `meta.nextCursor`

The asset API must not introduce a separate pagination pattern when the rest of the runtime has already converged on cursor-based discovery.

### 4.7. Auth and Actor Model

V1 should align with the current auth system instead of inventing unsupported new scopes prematurely.

Recommended initial mapping:

- `content:write`
  - upload assets
  - soft-delete assets
  - restore assets
- `content:read`
  - list asset metadata
  - inspect asset metadata
  - access allowed public or signed assets
  - inspect offer metadata for entitled assets
- `admin`
  - hard purge assets
  - provider configuration and operational override paths

Future dedicated scopes such as `assets:read` or `assets:write` should only be introduced when the full auth, REST, MCP, CLI, and policy surfaces are updated together.

All asset mutations must record canonical actor identity:

- `uploaderActorId`
- `uploaderActorType`
- `uploaderActorSource`

### 4.8. MCP and Agent Contract

Assets are part of the agent runtime and must be discoverable via MCP.

V1 MCP tools should include:

- `create_asset`
- `issue_direct_asset_upload`
- `complete_direct_asset_upload`
- `list_assets`
- `get_asset`
- `delete_asset`
- `restore_asset`
- `purge_asset`
- `issue_asset_access`

Current MCP resources:

- `content://assets`
- `content://assets/{id}`

The capability manifest and deployment status surfaces should advertise:

- whether asset storage is enabled
- which delivery modes are supported
- which storage provider is configured
- whether entitlement-gated asset delivery is enabled

### 4.9. Deletion and Retention Rules

Asset deletion must be safe for versioned content.

Rules:

- `DELETE /api/assets/:id` is a soft delete by default
- soft-deleted assets cannot be newly referenced
- historical references remain inspectable for rollback and audit
- hard purge is allowed only when:
  - the asset is not referenced by any current or historical content version, or
  - an explicit retention policy allows purge after export or archive safeguards
- purge must remove both provider bytes and database state

This prevents rollback and historical renders from silently breaking.

### 4.10. Content Integration Rules

Content item create, update, publish, and rollback flows must:

- validate asset references against the current domain
- reject deleted or inaccessible assets
- record asset usage for current content and versions
- preserve historical asset linkage in `content_item_versions`

Because content versions point to durable asset records instead of raw URLs, rollback remains safe and predictable.

## 5. Example Use Cases

- An agent uploads a screenshot and attaches it to a blog post hero image field
- An operator uploads a PDF and sells it through entitlement-gated delivery
- A workflow publishes a public image while keeping a source download signed-only
- An AI toolchain uploads generated media and later references it from a gallery field

## 6. Rollout Plan

### Phase 1

- local storage provider
- asset upload and metadata records
- schema-level asset field support
- cursor-paginated REST listing
- public and signed delivery
- MCP upload/list/get/delete support
- Status: shipped

### Phase 2

- entitlement-gated delivery integrated with L402
- asset reference tracking across content versions
- restore and purge safety flow
- CLI and demo coverage
- supervisor UI coverage
- Status: shipped

### Phase 3

- S3-compatible remote object storage providers
- direct signed upload flows
- optional derivatives and transformations
- Status: in progress; S3-compatible storage and direct uploads are shipped, while derivatives remain open

## 7. Drawbacks

- Adds another core subsystem to operate
- Requires reference tracking to avoid unsafe deletion
- Expands validation and policy complexity
- Introduces delivery-mode-aware behavior into content operations

## 8. Alternatives

### 8.1. Keep assets external

Rejected because it keeps a critical part of content production outside WordClaw and weakens the agent story.

### 8.2. Store only public URLs

Rejected because it cannot support signed or entitlement-gated delivery as first-class behavior and gives WordClaw no control over lifecycle.

### 8.3. Make asset storage optional-only

Rejected because media handling is required for real publishing workflows and should be part of the supported core runtime path.

## 9. Open Questions

- Should asset references support optional crop or focal-point metadata in v1 or in a follow-up RFC?
- Should entitled asset delivery reuse the same payment session records as paid content items or introduce an asset-specific entitlement record?
- Should direct browser uploads via provider-issued presigned upload URLs be part of phase 2 or phase 3?
