<script lang="ts">
    let {
        message,
        title,
        actionLabel,
        onAction,
        class: className = "",
    }: {
        message: string;
        title?: string;
        actionLabel?: string;
        onAction?: () => void;
        class?: string;
    } = $props();
</script>

<div
    class={`bg-red-50 dark:bg-red-900/30 border-l-4 border-red-500 p-4 rounded ${className}`}
>
    <div class="flex items-start justify-between gap-4">
        <div>
            {#if title}
                <p class="text-sm font-semibold text-red-800 dark:text-red-300">
                    {title}
                </p>
            {/if}
            <p class="text-sm text-red-700 dark:text-red-400">{message}</p>
        </div>
        {#if actionLabel && onAction}
            <button
                type="button"
                onclick={onAction}
                class="text-sm font-medium text-red-700 dark:text-red-300 hover:underline shrink-0"
            >
                {actionLabel}
            </button>
        {/if}
    </div>
</div>
