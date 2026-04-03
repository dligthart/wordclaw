/**
 * Shared utility for resolving human-readable labels from content item data.
 *
 * Used by the content browser and approval queue to display identifying
 * information from arbitrary schema types without hard-coding field names.
 *
 * The field lists are ordered by priority — the first non-empty string match wins.
 */

import { deepParseJson } from "$lib/utils";

/* ─── Field lists ─── */

/** Fields tried (in order) to resolve the primary display label. */
const LABEL_FIELDS = [
  "title",
  "name",
  "headline",
  "subject",
  "projectName",
  "displayName",
  "label",
  "heading",
] as const;

/** Fields tried (in order) to resolve a secondary subtitle/identifier. */
const SUBTITLE_FIELDS = [
  "projectName",
  "companyName",
  "accountName",
  "author",
  "owner",
  "email",
  "accountEmail",
  "company",
  "client",
  "category",
  "type",
  "budgetRange",
] as const;

/** Fields tried (in order) to resolve a summary/excerpt. */
const SUMMARY_FIELDS = [
  "summary",
  "excerpt",
  "description",
  "content",
  "body",
  "text",
  "executiveSummary",
  "requestedOutcome",
  "overview",
] as const;

/** Fields tried (in order) to resolve a slug. */
const SLUG_FIELDS = ["slug"] as const;

/** Fields tried (in order) to resolve an attribution. */
const ATTRIBUTION_FIELDS = [
  "author",
  "owner",
  "editor",
  "accountName",
  "accountEmail",
] as const;

/* ─── Parsing ─── */

function parseStructuredData(
  payload: unknown,
): Record<string, unknown> | null {
  const parsed = deepParseJson(payload);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

function pickFirstString(
  record: Record<string, unknown> | null,
  keys: readonly string[],
): string | null {
  if (!record) return null;

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function truncate(value: string, max = 160): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/* ─── Public API ─── */

export interface ContentItemData {
  id: number;
  data: unknown;
}

export interface ContentTypeInfo {
  name: string;
}

/**
 * Resolve the primary display label for a content item.
 *
 * Tries common label fields in priority order. Falls back to
 * `{contentTypeName} #{id}` if nothing matches.
 */
export function resolveContentLabel(
  item: ContentItemData,
  contentType?: ContentTypeInfo,
): string {
  const structured = parseStructuredData(item.data);
  const label = pickFirstString(structured, LABEL_FIELDS);

  if (label) {
    return truncate(label, 120);
  }

  const typeName = contentType?.name ?? "Item";
  return `${typeName} #${item.id}`;
}

/**
 * Resolve a subtitle / secondary identifier for a content item.
 *
 * Returns a string like "Acme Corp" or "dave@example.com" that helps
 * distinguish items with the same primary label. Returns null if no
 * secondary identifier is found in the data.
 *
 * The subtitle is guaranteed to differ from the primary label.
 */
export function resolveContentSubtitle(
  item: ContentItemData,
  contentType?: ContentTypeInfo,
): string | null {
  const structured = parseStructuredData(item.data);
  if (!structured) return null;

  const primaryLabel = resolveContentLabel(item, contentType);

  // Walk subtitle fields, return the first that differs from the label
  for (const key of SUBTITLE_FIELDS) {
    const value = structured[key];
    if (typeof value === "string" && value.trim().length > 0) {
      const candidate = value.trim();
      if (candidate !== primaryLabel) {
        return truncate(candidate, 100);
      }
    }
  }

  return null;
}

/**
 * Resolve a summary/excerpt for the content item.
 */
export function resolveContentSummary(item: ContentItemData): string | null {
  const structured = parseStructuredData(item.data);
  const preferred = pickFirstString(structured, SUMMARY_FIELDS);

  if (preferred) {
    return truncate(preferred, 180);
  }

  return null;
}

/**
 * Resolve a slug from the content item data.
 */
export function resolveContentSlug(item: ContentItemData): string | null {
  return pickFirstString(parseStructuredData(item.data), SLUG_FIELDS);
}

/**
 * Resolve an attribution (author/owner) from the content item data.
 */
export function resolveContentAttribution(
  item: ContentItemData,
): string | null {
  return pickFirstString(parseStructuredData(item.data), ATTRIBUTION_FIELDS);
}

/**
 * Count the number of structured fields in the content item data.
 */
export function resolveStructuredFieldCount(
  item: ContentItemData,
): number | null {
  const structured = parseStructuredData(item.data);
  return structured ? Object.keys(structured).length : null;
}

/**
 * Resolve a full task summary for the approval queue.
 */
export function resolveContentTaskSummary(item: ContentItemData): string {
  const summary = resolveContentSummary(item);
  if (summary) return summary;

  const fieldCount = resolveStructuredFieldCount(item);
  if (fieldCount && fieldCount > 0) {
    return `${fieldCount} structured ${fieldCount === 1 ? "field" : "fields"} submitted. Open the payload only if you need the raw content.`;
  }

  return "Review the submitted payload before moving this item through the workflow.";
}

// Re-export for backward compat — these were inlined in page files before
export { parseStructuredData, pickFirstString, truncate };
