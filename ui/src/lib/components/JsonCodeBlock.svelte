<script lang="ts">
    import { formatJson } from "$lib/utils";

    let {
        value,
        label,
        copyable = false,
        class: className = "",
    }: {
        value: unknown;
        label?: string;
        copyable?: boolean;
        class?: string;
    } = $props();

    const display = $derived(
        typeof value === "string" ? formatJson(value) : formatJson(value, 2),
    );

    async function copyValue() {
        await navigator.clipboard.writeText(display);
    }
</script>

<div class={`rounded-md bg-gray-900 overflow-hidden shadow-inner border border-gray-700 ${className}`}>
    {#if label || copyable}
        <div
            class="px-4 py-2 border-b border-gray-700 bg-gray-800 flex justify-between items-center text-xs text-gray-400 font-mono"
        >
            <span>{label || "JSON"}</span>
            {#if copyable}
                <button
                    type="button"
                    class="text-blue-400 hover:text-blue-300"
                    title="Copy to clipboard"
                    onclick={copyValue}
                >
                    Copy JSON
                </button>
            {/if}
        </div>
    {/if}
    <pre
        class="p-4 text-xs font-mono text-green-400 dark:text-green-300 overflow-x-auto whitespace-pre-wrap break-words"
    ><code>{display}</code></pre>
</div>
