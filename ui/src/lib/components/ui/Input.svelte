<script lang="ts">
    import { cn } from "$lib/cn";
    import type { HTMLInputAttributes } from "svelte/elements";

    let {
        value = $bindable<string | number | null>(""),
        type = "text",
        class: className = "",
        ...rest
    }: HTMLInputAttributes & {
        value?: string | number | null;
        class?: string;
    } = $props();

    const inputClass =
        "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-500 dark:focus:ring-slate-800";
</script>

<input
    {...rest}
    bind:value
    {type}
    class={cn(inputClass, className)}
/>
