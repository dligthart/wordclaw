<!--
    StatTile — Small bordered metric card with label + value.

    Extracted from 18+ instances across dashboard, jobs, and assets.

    @see RFC 0033 Appendix A.4
-->
<script lang="ts">
    import { cn } from "$lib/cn";
    import type { Snippet } from "svelte";

    let {
        label,
        value,
        class: className = "",
    }: {
        /** Uppercase label text */
        label: string;
        /** Value content (can be a snippet for Badge or complex content) */
        value: Snippet;
        /** Optional additional CSS classes */
        class?: string;
    } = $props();
</script>

<div class={cn("rounded-2xl border border-slate-200 px-4 py-4 dark:border-slate-700", className)}>
    <p class="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
        {label}
    </p>
    <div class="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
        {@render value()}
    </div>
</div>
