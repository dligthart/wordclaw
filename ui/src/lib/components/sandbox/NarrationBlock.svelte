<script lang="ts">
    import { Info } from "lucide-svelte";
    import { marked } from "marked";

    let {
        title,
        narration,
    }: {
        title: string;
        narration: string;
    } = $props();

    let htmlContent = $derived(marked.parse(narration || ""));
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
                class="text-sm text-blue-800/80 dark:text-blue-200/70 prose prose-sm prose-blue dark:prose-invert max-w-none"
            >
                {@html htmlContent}
            </div>
        </div>
    </div>
</div>
