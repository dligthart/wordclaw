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
    class="bg-blue-50/50 border border-blue-100 rounded-lg p-5 dark:bg-blue-950/20 dark:border-blue-900/50 mb-6 font-geist"
>
    <div class="flex items-start gap-3">
        <div
            class="bg-blue-100 text-blue-600 rounded-full p-1.5 mt-0.5 dark:bg-blue-900/50 dark:text-blue-400 shrink-0"
        >
            <Info class="w-4 h-4" />
        </div>
        <div>
            <h4
                class="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-1"
            >
                {title}
            </h4>
            <div
                class="text-sm text-blue-800/80 dark:text-blue-100 prose prose-sm prose-blue dark:prose-invert max-w-none"
            >
                {@html htmlContent}
            </div>
        </div>
    </div>
</div>
