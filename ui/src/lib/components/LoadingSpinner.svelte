<script lang="ts">
    let {
        size = "md",
        color = "blue",
        class: className = "",
    }: {
        size?: "sm" | "md" | "lg" | "xl";
        color?: "blue" | "white";
        class?: string;
    } = $props();

    const sizeClass = $derived(
        size === "sm"
            ? "h-4 w-4"
            : size === "lg"
              ? "h-8 w-8"
              : size === "xl"
                ? "h-10 w-10"
                : "h-6 w-6",
    );

    const colorClass = $derived(
        color === "white" ? "border-white" : "border-blue-600 dark:border-blue-500",
    );
</script>

<div
    class={`animate-spin rounded-full border-b-2 ${sizeClass} ${colorClass} ${className}`}
    role="status"
    aria-label="Loading"
></div>
