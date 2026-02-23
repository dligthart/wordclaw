<script lang="ts">
    let {
        action,
        class: className = "",
    }: {
        action: string;
        class?: string;
    } = $props();

    const normalized = $derived((action || "").toLowerCase());

    const tone = $derived(
        normalized === "create"
            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
            : normalized === "update"
              ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
              : normalized === "delete"
                ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                : normalized === "rollback"
                  ? "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400"
                  : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
    );
</script>

<span
    class={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${tone} ${className}`}
>
    {(action || "unknown").toUpperCase()}
</span>
