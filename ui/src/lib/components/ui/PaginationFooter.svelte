<!--
    PaginationFooter — Consistent pagination bar with count and prev/next.

    Extracted from content (2 instances) and assets (1 instance).

    @see RFC 0033 Appendix A.6
-->
<script lang="ts">
    import Button from "./Button.svelte";

    let {
        start,
        end,
        total,
        hasPrev,
        hasNext,
        onPrev,
        onNext,
    }: {
        /** 1-indexed start of the current page */
        start: number;
        /** 1-indexed end of the current page */
        end: number;
        /** Total number of items */
        total: number;
        /** Whether there is a previous page */
        hasPrev: boolean;
        /** Whether there is a next page */
        hasNext: boolean;
        /** Handler for navigating to the previous page */
        onPrev: () => void;
        /** Handler for navigating to the next page */
        onNext: () => void;
    } = $props();
</script>

<div class="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
    <p class="text-sm text-slate-500 dark:text-slate-400">
        Showing {start}–{end} of {total}
    </p>
    <div class="flex items-center gap-3">
        <Button variant="outline" disabled={!hasPrev} onclick={onPrev}>Previous</Button>
        <Button variant="outline" disabled={!hasNext} onclick={onNext}>Next</Button>
    </div>
</div>
