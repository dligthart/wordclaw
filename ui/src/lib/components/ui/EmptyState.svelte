<!--
    EmptyState — Dashed-border container for no-data states.

    Extracted from content (3 instances) and jobs (1 instance).

    @see RFC 0033 Appendix A.7
-->
<script lang="ts">
    import type { Snippet } from "svelte";

    let {
        message,
        action,
    }: {
        /** The message to display when there is no data */
        message: string;
        /** Optional call-to-action button snippet */
        action?: Snippet;
    } = $props();
</script>

<div class="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
    <p>{message}</p>
    {#if action}
        <div class="mt-3">
            {@render action()}
        </div>
    {/if}
</div>
