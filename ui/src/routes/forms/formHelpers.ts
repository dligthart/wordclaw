import { formatJson } from "$lib/utils";
import type { FormDefinition, FormEditorState } from "./formTypes";

export const EMPTY_FIELDS_JSON = formatJson(
    [
        {
            name: "email",
            label: "Email",
            type: "text",
            required: true,
        },
    ],
    2,
);

export function emptyEditorState(): FormEditorState {
    return {
        id: null,
        name: "",
        slug: "",
        description: "",
        contentTypeId: "",
        active: true,
        publicRead: true,
        submissionStatus: "draft",
        workflowTransitionId: "",
        requirePayment: false,
        webhookUrl: "",
        webhookSecret: "",
        successMessage: "",
    };
}

export function currentDomainId(): number | null {
    if (typeof window === "undefined") {
        return null;
    }

    const raw = window.localStorage.getItem("__wc_domain_id");
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function formatDate(value: string | null): string {
    if (!value) return "Unknown";
    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp)) return "Unknown";
    return new Date(value).toLocaleString();
}

export function formatRelativeDate(value: string | null): string {
    if (!value) return "Unknown";
    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp)) return "Unknown";

    const deltaHours = Math.floor((Date.now() - timestamp) / 3_600_000);
    if (deltaHours < 1) return "Just now";
    if (deltaHours < 24) return `${deltaHours}h ago`;

    const deltaDays = Math.floor(deltaHours / 24);
    if (deltaDays < 7) return `${deltaDays}d ago`;

    return new Date(value).toLocaleDateString();
}

export function formVisibilityBadges(form: FormDefinition): string[] {
    return [
        form.active ? "Active" : "Inactive",
        form.publicRead ? "Public contract" : "Private contract",
        form.requirePayment ? "L402 gated" : "No payment",
    ];
}

export function parseJsonInput(value: string, label: string): unknown {
    try {
        return JSON.parse(value);
    } catch (err) {
        throw new Error(
            `${label} must be valid JSON: ${
                err instanceof Error ? err.message : String(err)
            }`,
        );
    }
}

export function parseObjectJsonInput(
    value: string,
    label: string,
): Record<string, unknown> {
    const parsed = parseJsonInput(value, label);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${label} must be a JSON object.`);
    }

    return parsed as Record<string, unknown>;
}

export const configurableDraftProviders = [
    {
        type: "deterministic" as const,
        label: "Deterministic",
        description:
            "No external model call. Only mapped and default data is used.",
        placeholderModel: "",
    },
    {
        type: "openai" as const,
        label: "OpenAI",
        description:
            "Responses API structured output with native image input.",
        placeholderModel: "gpt-4o",
    },
    {
        type: "anthropic" as const,
        label: "Claude",
        description:
            "Tool-schema output with native image content blocks.",
        placeholderModel: "claude-sonnet-4-20250514",
    },
    {
        type: "gemini" as const,
        label: "Gemini",
        description:
            "JSON-schema output with native inline image parts.",
        placeholderModel: "gemini-2.5-flash",
    },
];
