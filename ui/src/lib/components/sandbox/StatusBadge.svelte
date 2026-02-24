<script lang="ts">
    import { CheckCircle, XCircle } from "lucide-svelte";

    let {
        expectedStatus,
        actualStatus,
    }: {
        expectedStatus?: number;
        actualStatus?: number;
    } = $props();

    let isSuccess = $derived(
        expectedStatus !== undefined && actualStatus !== undefined
            ? expectedStatus === actualStatus
            : actualStatus !== undefined
              ? String(actualStatus).startsWith("2")
              : false,
    );
</script>

{#if expectedStatus || actualStatus}
    <div class="flex items-center gap-2 text-sm font-medium">
        {#if actualStatus}
            <span
                class="flex items-center gap-1 px-2 py-0.5 rounded-full {isSuccess
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}"
            >
                {#if isSuccess}
                    <CheckCircle class="w-3.5 h-3.5" />
                {:else}
                    <XCircle class="w-3.5 h-3.5" />
                {/if}
                {actualStatus} Actual
            </span>
        {/if}

        {#if expectedStatus}
            <span
                class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
            >
                {expectedStatus} Expected
            </span>
        {/if}
    </div>
{/if}
