<script lang="ts">
    import { cn } from "$lib/cn";

    type Tone = "default" | "muted" | "subtle";

    let {
        tone = "default",
        padded = true,
        class: className = "",
        children,
    }: {
        tone?: Tone;
        padded?: boolean;
        class?: string;
        children?: import("svelte").Snippet;
    } = $props();

    const toneClass = $derived(
        tone === "muted"
            ? "border-slate-200/80 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/30"
            : tone === "subtle"
              ? "border-slate-200/80 bg-white/70 dark:border-slate-700 dark:bg-slate-900/20"
              : "border-slate-200/80 bg-white dark:border-slate-700 dark:bg-slate-900/40",
    );
</script>

<section
    class={cn(
        "rounded-2xl border shadow-sm",
        toneClass,
        padded && "p-5",
        className,
    )}
>
    {@render children?.()}
</section>
