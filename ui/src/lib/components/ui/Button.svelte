<script lang="ts">
    import { cn } from "$lib/cn";
    import type { HTMLButtonAttributes } from "svelte/elements";

    type Variant =
        | "default"
        | "secondary"
        | "outline"
        | "ghost"
        | "destructive"
        | "success";
    type Size = "sm" | "md" | "lg" | "icon";

    let {
        variant = "default",
        size = "md",
        type = "button",
        disabled = false,
        class: className = "",
        children,
        ...rest
    }: HTMLButtonAttributes & {
        variant?: Variant;
        size?: Size;
        class?: string;
        children?: import("svelte").Snippet;
    } = $props();

    const baseClass =
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-50 dark:focus-visible:ring-slate-700 dark:focus-visible:ring-offset-slate-950";

    const variantClass = $derived(
        variant === "secondary"
            ? "bg-slate-100 text-slate-900 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            : variant === "outline"
              ? "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200 dark:hover:bg-slate-800"
              : variant === "ghost"
                ? "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                : variant === "destructive"
                  ? "bg-rose-600 text-white hover:bg-rose-500"
                  : variant === "success"
                    ? "bg-emerald-600 text-white hover:bg-emerald-500"
                    : "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white",
    );

    const sizeClass = $derived(
        size === "sm"
            ? "h-8 sm:h-8 min-h-[36px] sm:min-h-0 px-3 text-xs"
            : size === "lg"
              ? "h-11 px-5 text-sm"
              : size === "icon"
                ? "h-10 w-10 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0"
                : "h-10 sm:h-10 min-h-[44px] sm:min-h-0 px-4 text-sm",
    );
</script>

<button
    {...rest}
    {type}
    {disabled}
    class={cn(baseClass, variantClass, sizeClass, className)}
>
    {@render children?.()}
</button>
