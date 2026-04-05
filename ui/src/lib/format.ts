/**
 * Shared formatting utilities for the Supervisor UI.
 *
 * Extracted from route-local duplicates across dashboard, assets, jobs,
 * keys, agents, content, approvals, forms, and schema routes.
 *
 * @see RFC 0033 Appendix A.1
 */

import type { BadgeVariant } from "$lib/types";

/* ------------------------------------------------------------------ */
/*  Date / time                                                       */
/* ------------------------------------------------------------------ */

/**
 * Format an ISO date string as a locale date (date only).
 * Returns `"Unknown"` for null / invalid input.
 */
export function formatDate(value: string | null | undefined): string {
    if (!value) return "Unknown";
    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp)) return "Unknown";
    return new Date(value).toLocaleDateString();
}

/**
 * Format an ISO date string as a locale date + time.
 * Returns `"Unknown"` for null / invalid input.
 */
export function formatDateTime(value: string | null | undefined): string {
    if (!value) return "Unknown";
    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp)) return "Unknown";
    return new Date(value).toLocaleString();
}

/**
 * Format an ISO date string as a human-readable relative label.
 * Returns `"Unknown"` for null / invalid input.
 *
 * - < 1 hour  → "Just now"
 * - < 24 hours → "3h ago"
 * - < 7 days   → "2d ago"
 * - otherwise  → locale date
 *
 * Future dates within 60 minutes display as "in Xm".
 */
export function formatRelativeDate(value: string | null | undefined): string {
    if (!value) return "Unknown";
    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp)) return "Unknown";

    const deltaMs = timestamp - Date.now();
    const deltaMinutes = Math.round(deltaMs / 60_000);

    // Future dates within the next hour
    if (deltaMinutes > 0 && deltaMinutes < 60) {
        return `in ${deltaMinutes}m`;
    }

    const deltaHours = Math.floor((Date.now() - timestamp) / 3_600_000);
    if (deltaHours < 1) return "Just now";
    if (deltaHours < 24) return `${deltaHours}h ago`;

    const deltaDays = Math.floor(deltaHours / 24);
    if (deltaDays < 7) return `${deltaDays}d ago`;

    return new Date(value).toLocaleDateString();
}

/**
 * Format an ISO date string as a relative time label for the dashboard.
 * Handles slightly different output phrasing ("No sweep yet" for null).
 *
 * @deprecated — Prefer `formatRelativeDate` and handle the null label
 * at the call site. This is kept temporarily for dashboard compatibility.
 */
export function formatRelativeTime(
    value: string | null | undefined,
): string {
    if (!value) return "No sweep yet";
    return formatRelativeDate(value);
}

/* ------------------------------------------------------------------ */
/*  Status / label                                                    */
/* ------------------------------------------------------------------ */

/**
 * Title-case a slug status label.
 * `"in_review"` → `"In Review"`, `"published"` → `"Published"`.
 */
export function formatStatusLabel(status: string): string {
    return status
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

/**
 * Resolve a `Badge` variant for a content lifecycle status.
 */
export function resolveStatusBadgeVariant(
    status: string,
): BadgeVariant {
    if (status === "published") return "success";
    if (status === "in_review") return "warning";
    if (status === "rejected" || status === "archived") return "danger";
    return "muted";
}

/* ------------------------------------------------------------------ */
/*  Field name humanization                                            */
/* ------------------------------------------------------------------ */

/**
 * Convert `camelCase`, `snake_case`, or `kebab-case` to title-cased words.
 * `"createdAt"` → `"Created At"`, `"last_name"` → `"Last Name"`.
 */
export function humanizeFieldName(value: string): string {
    return value
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
}
