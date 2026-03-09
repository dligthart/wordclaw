<script lang="ts">
    import { Info } from "lucide-svelte";
    import { Marked, Renderer } from "marked";

    const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

    function escapeHtml(value: string): string {
        return value
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }

    function isSafeHref(href: string): boolean {
        const value = href.trim();
        if (!value) {
            return false;
        }

        if (
            value.startsWith("/") ||
            value.startsWith("#") ||
            value.startsWith("?") ||
            value.startsWith("./") ||
            value.startsWith("../")
        ) {
            return true;
        }

        if (value.startsWith("//")) {
            return false;
        }

        try {
            return ALLOWED_LINK_PROTOCOLS.has(new URL(value).protocol);
        } catch {
            return false;
        }
    }

    const safeRenderer = new Renderer();
    safeRenderer.html = ({ raw, text }) => escapeHtml(raw || text);
    safeRenderer.image = ({ text }) => escapeHtml(text);

    const safeMarked = new Marked({
        breaks: true,
        gfm: true,
        renderer: safeRenderer,
        walkTokens(token) {
            if (
                (token.type === "link" || token.type === "image") &&
                token.href &&
                !isSafeHref(token.href)
            ) {
                token.href = "#";
            }
        },
    });

    let {
        title,
        narration,
    }: {
        title: string;
        narration: string;
    } = $props();

    let htmlContent = $derived(String(safeMarked.parse(narration || "")));
</script>

<div
    class="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 font-geist dark:border-slate-700 dark:bg-slate-950/30"
>
    <div class="flex items-start gap-3">
        <div
            class="mt-0.5 shrink-0 rounded-full bg-slate-200 p-1.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        >
            <Info class="w-4 h-4" />
        </div>
        <div>
            <h4
                class="mb-1 text-sm font-semibold text-slate-900 dark:text-slate-100"
            >
                {title}
            </h4>
            <div
                class="prose prose-sm max-w-none text-sm text-slate-700 dark:prose-invert dark:text-slate-300"
            >
                {@html htmlContent}
            </div>
        </div>
    </div>
</div>
