<script lang="ts">
    import { cn } from "$lib/cn";
    import type { HTMLTextareaAttributes } from "svelte/elements";

    let {
        value = $bindable(""),
        class: className = "",
        ...rest
    }: HTMLTextareaAttributes & {
        value?: string;
        class?: string;
    } = $props();

    const textareaClass =
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-500 dark:focus:ring-slate-800";
</script>

<textarea
    {...rest}
    bind:value
    class={cn(textareaClass, className)}
></textarea>
