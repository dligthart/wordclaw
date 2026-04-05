<!--
    PageHeader — Consistent page-level title block.

    Extracted from 6+ routes that each hand-coded identical title/description/actions
    layouts with ad-hoc sizing and inconsistent color tokens.

    @see RFC 0033 Appendix A.2
-->
<script lang="ts">
    import type { Snippet } from "svelte";

    let {
        eyebrow,
        title,
        description,
        badges,
        actions,
    }: {
        /** Optional uppercase eyebrow label above the title */
        eyebrow?: string;
        /** Page title (rendered as h1) */
        title: string;
        /** Page description below the title */
        description?: string;
        /** Optional snippet for inline badges next to the description */
        badges?: Snippet;
        /** Optional snippet for action buttons (right-aligned) */
        actions?: Snippet;
    } = $props();
</script>

<div class="flex flex-wrap items-start justify-between gap-4">
    <div class="space-y-1">
        {#if eyebrow}
            <p class="text-sm font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">
                {eyebrow}
            </p>
        {/if}
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            {title}
        </h1>
        {#if description}
            <p class="max-w-3xl text-sm text-slate-500 dark:text-slate-400">
                {description}
            </p>
        {/if}
        {#if badges}
            <div class="mt-2 flex flex-wrap gap-2">
                {@render badges()}
            </div>
        {/if}
    </div>

    {#if actions}
        <div class="flex flex-wrap items-center gap-3">
            {@render actions()}
        </div>
    {/if}
</div>
