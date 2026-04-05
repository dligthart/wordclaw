<!--
    SectionHeader — Consistent section header inside Surface containers.

    Extracted from 20+ hand-coded instances across content, assets,
    approvals, schema, agents, keys, and dashboard routes.

    @see RFC 0033 Appendix A.3
-->
<script lang="ts">
    import type { Snippet } from "svelte";

    let {
        eyebrow,
        title,
        description,
        trailing,
    }: {
        /** Optional uppercase eyebrow label above the title */
        eyebrow?: string;
        /** Section title */
        title: string;
        /** Optional description text */
        description?: string;
        /** Optional trailing content (right-aligned) */
        trailing?: Snippet;
    } = $props();
</script>

<div class="border-b border-slate-200/80 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/30">
    <div class="flex items-start justify-between gap-3">
        <div>
            {#if eyebrow}
                <p class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    {eyebrow}
                </p>
            {/if}
            <h3 class="text-lg font-semibold text-slate-900 dark:text-white" class:mt-2={!!eyebrow}>
                {title}
            </h3>
            {#if description}
                <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {description}
                </p>
            {/if}
        </div>
        {#if trailing}
            {@render trailing()}
        {/if}
    </div>
</div>
