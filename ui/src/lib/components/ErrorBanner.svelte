<script lang="ts">
    let {
        error,
        message,
        title,
        code,
        remediation,
        details = [],
        actionLabel,
        onAction,
        class: className = "",
    }: {
        error?: any;
        message?: string;
        title?: string;
        code?: string;
        remediation?: string;
        details?: string[];
        actionLabel?: string;
        onAction?: () => void;
        class?: string;
    } = $props();

    let resolvedMessage = $derived(
        error && typeof error === "object" && typeof error.message === "string"
            ? error.message
            : typeof error === "string"
              ? error
              : message,
    );

    let resolvedCode = $derived(
        error && typeof error === "object" && typeof error.code === "string"
            ? error.code
            : code,
    );

    let resolvedRemediation = $derived(
        error &&
            typeof error === "object" &&
            typeof error.remediation === "string"
            ? error.remediation
            : remediation,
    );
</script>

<div
    role="alert"
    aria-live="assertive"
    class={`bg-red-50 dark:bg-red-900/30 border-l-4 border-red-500 p-4 rounded ${className}`}
>
    <div class="flex items-start justify-between gap-4">
        <div>
            {#if title}
                <p class="text-sm font-semibold text-red-800 dark:text-red-300">
                    {title}
                </p>
            {/if}
            <p class="text-sm text-red-700 dark:text-red-400">
                {resolvedMessage}
            </p>
            {#if details.length > 0}
                <ul
                    class="mt-2 list-disc pl-5 text-sm text-red-700 dark:text-red-300 space-y-1"
                >
                    {#each details as detail}
                        <li>{detail}</li>
                    {/each}
                </ul>
            {/if}
            {#if resolvedCode}
                <div
                    class="mt-2 text-[0.68rem] font-mono tracking-wider bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300 px-2 py-1 rounded inline-block uppercase"
                >
                    {resolvedCode}
                </div>
            {/if}
            {#if resolvedRemediation}
                <p class="mt-2 text-sm text-red-700 dark:text-red-300">
                    <span class="font-semibold block mb-0.5">Suggestion:</span>
                    {resolvedRemediation}
                </p>
            {/if}
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
