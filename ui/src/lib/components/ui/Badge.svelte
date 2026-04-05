<script lang="ts">
    import { cn } from "$lib/cn";
    import type { BadgeVariant } from "$lib/types";

    type Variant = BadgeVariant;

    let {
        variant = "default",
        class: className = "",
        children,
    }: {
        variant?: Variant;
        class?: string;
        children?: import("svelte").Snippet;
    } = $props();

    const baseClass =
        "inline-flex items-center rounded-full px-2.5 py-1 text-[0.68rem] font-semibold tracking-[0.08em]";

    const variantClass = $derived(
        variant === "muted"
            ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            : variant === "outline"
              ? "border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300"
              : variant === "success"
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
                : variant === "warning"
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
                  : variant === "danger"
                    ? "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200"
                    : variant === "paid"
                      ? "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
                      : variant === "info"
                        ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200"
                        : "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950",
    );
</script>

<span class={cn(baseClass, variantClass, className)}>
    {@render children?.()}
</span>
