---
title: Media Asset Storage
status: proposed
author: WordClaw Team
date: 2026-03-12
---

# RFC 0023: Media Asset Storage

## 1. Objective

Currently, WordClaw has no native facility to upload, store, or manage media assets (images, PDFs, videos). Content creators and agents are forced to host images externally (e.g., Unsplash, Cloudinary) and paste generic URL strings into Content Items.

This RFC proposes a native Media Asset Storage capability, complete with an extensible Storage Provider abstraction, an `assets` relational table for metadata tracking, and multi-tenant security bindings.

## 2. Motivation

1. **Self-Sufficiency**: A headless CMS must be able to securely host the assets attached to its content models.
2. **Actor Provenance**: We need to track *which* actor uploaded *which* file and ensure tenant (`domainId`) isolation.
3. **Agent Integration**: AI agents authoring content via MCP need a tool to upload generated artifacts (like diagrams or AI-generated images) directly into the WordClaw storage engine and receive an embeddable URL back in return.

## 3. Design Proposal

### 3.1. Storage Provider Abstraction
To support diverse deployment environments (Docker, bare metal, Edge), WordClaw will implement a `StorageAdapter` interface:

* **`LocalDiskStorage`**: Writes to `./uploads/` matching the current working directory. Served statically via Express/Fastify. Ideal for local Docker deployments.
* **`S3Storage` / `R2Storage`**: Uploads streams to AWS S3 or Cloudflare R2 bucket. Ideal for production deployments.

The active provider will be configured via `.env`:
\`\`\`env
STORAGE_PROVIDER=local # or s3, r2
STORAGE_S3_BUCKET=my-wordclaw-assets
STORAGE_S3_REGION=us-east-1
\`\`\`

### 3.2. Data Model

A new PostgreSQL table `assets` will be introduced to track metadata:

\`\`\`sql
CREATE TABLE "assets" (
    "id" varchar(255) PRIMARY KEY,
    "domain_id" varchar(255) NOT NULL REFERENCES "domains"("id"),
    "uploader_actor_id" varchar(255) NOT NULL,
    "storage_key" varchar(512) NOT NULL, -- The relative path or S3 key
    "public_url" varchar(1024) NOT NULL, -- The fully qualified URL
    "mime_type" varchar(128) NOT NULL,
    "size_bytes" integer NOT NULL,
    "metadata" jsonb, -- width, height, blurhash, etc
    "created_at" timestamp DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
);
\`\`\`

### 3.3. API Surface

**REST API**
* \`POST /api/assets/upload\`
  * Accepts \`multipart/form-data\`.
  * Returns the created Asset record.
* \`GET /api/assets\`
  * Returns a paginated list of assets belonging to the current \`domainId\`.
* \`DELETE /api/assets/:id\`
  * Removes from the database and calls the \`StorageAdapter\` to purge the physical file.

**MCP Surface**
* \`tool: assets_upload\` (Accepts base64 encoded payload)
* \`tool: assets_list\`

### 3.4. Security and Isolation
All endpoints will be gated by the standard WordClaw authentication layer, resolving the \`CurrentActorSnapshot\`. 
* \`domainId\` strict isolation: An actor cannot view or delete assets outside their authorized domain.
* \`scopes\`: Introduce \`assets:read\` and \`assets:write\` scopes to the API Key and Role permission trees.

## 4. Drawbacks
* **Operational Complexity**: Introducing storage management increases the complexity of self-hosted deployments (especially mapping Docker volumes for `LocalDiskStorage`).
* **Bandwidth Costs**: Serving media directly from WordClaw's HTTP layer (in `Local`) could increase CPU and bandwidth load compared to purely JSON API responses.

## 5. Alternatives
* **Bring-Your-Own-CDN only**: Do not handle uploads at all, but rather formally integrate with Cloudinary or Uploadcare via plugins. We lose native agent-upload capabilities unless we proxy those APIs.

## 6. Unresolved Questions
* Should WordClaw support automatic image resizing/optimization (e.g., using `sharp`) upon upload, or stick to raw pass-through storage for V1?
* How should we handle soft-deletion vs hard-deletion of physical files?
