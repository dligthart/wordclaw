<script lang="ts">
    import { cn } from "$lib/cn";
    import type { HTMLSelectAttributes } from "svelte/elements";

    let {
        value = $bindable(""),
        class: className = "",
        children,
        ...rest
    }: HTMLSelectAttributes & {
        value?: string;
        class?: string;
        children?: import("svelte").Snippet;
    } = $props();

    const selectClass =
        "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-slate-500 dark:focus:ring-slate-800";
</script>

<select {...rest} bind:value class={cn(selectClass, className)}>
    {@render children?.()}
</select>
