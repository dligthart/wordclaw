<script lang="ts">
    import { onMount } from "svelte";
    import { fetchApi } from "$lib/api";

    let payments = $state<any[]>([]);
    let loading = $state(true);
    let error = $state<string | null>(null);
    let expandedRows = $state<Set<number>>(new Set());

    function toggleRow(id: number) {
        if (expandedRows.has(id)) {
            expandedRows.delete(id);
        } else {
            expandedRows.add(id);
        }
        expandedRows = new Set(expandedRows);
    }

    async function loadPayments() {
        loading = true;
        error = null;
        try {
            const res = await fetchApi("/payments");
            payments = res.data;
        } catch (err: any) {
            error = err.message || "Failed to load payments";
        } finally {
            loading = false;
        }
    }

    onMount(() => {
        loadPayments();
    });
</script>

<div class="px-4 sm:px-6 lg:px-8">
    <div class="sm:flex sm:items-center">
        <div class="sm:flex-auto">
            <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">
                Payment Flow Tracking
            </h1>
            <p class="mt-2 text-sm text-gray-700 dark:text-gray-300">
                A list of all L402 invoices generated, including pending
                payments and completed settlements across all content resources.
            </p>
        </div>
        <div class="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
            <button
                onclick={loadPayments}
                class="inline-flex items-center justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:w-auto"
            >
                Refresh
            </button>
        </div>
    </div>
    <div class="mt-8 flex flex-col">
        <div class="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
            <div
                class="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8"
            >
                {#if loading}
                    <div class="flex justify-center py-8">
                        <div
                            class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"
                        ></div>
                    </div>
                {:else if error}
                    <div class="rounded-md bg-red-50 p-4 mt-6">
                        <div class="flex">
                            <div class="ml-3">
                                <h3 class="text-sm font-medium text-red-800">
                                    Error loading payments
                                </h3>
                                <div class="mt-2 text-sm text-red-700">
                                    <p>{error}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                {:else if payments.length === 0}
                    <div class="text-center py-12">
                        <p class="text-sm text-gray-500 dark:text-gray-400">
                            No active or historical payments found.
                        </p>
                    </div>
                {:else}
                    <div
                        class="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg"
                    >
                        <table
                            class="min-w-full divide-y divide-gray-300 dark:divide-gray-700"
                        >
                            <thead class="bg-gray-50 dark:bg-gray-800">
                                <tr>
                                    <th scope="col" class="w-10 px-6 py-3"></th>
                                    <th
                                        scope="col"
                                        class="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 dark:text-white sm:pl-6"
                                        >ID</th
                                    >
                                    <th
                                        scope="col"
                                        class="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white"
                                        >Actor</th
                                    >
                                    <th
                                        scope="col"
                                        class="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white"
                                        >Amount (Sats)</th
                                    >
                                    <th
                                        scope="col"
                                        class="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white"
                                        >Status</th
                                    >
                                    <th
                                        scope="col"
                                        class="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white"
                                        >Resource Path</th
                                    >
                                    <th
                                        scope="col"
                                        class="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white"
                                        >Created At</th
                                    >
                                </tr>
                            </thead>
                            <tbody
                                class="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-900"
                            >
                                {#each payments as p}
                                    <tr
                                        class="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                                        onclick={() => toggleRow(p.id)}
                                    >
                                        <td
                                            class="px-6 py-4 whitespace-nowrap text-gray-400"
                                        >
                                            <svg
                                                class="w-5 h-5 transform transition-transform {expandedRows.has(
                                                    p.id,
                                                )
                                                    ? 'rotate-90 text-blue-500'
                                                    : ''}"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                                ><path
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    stroke-width="2"
                                                    d="M9 5l7 7-7 7"
                                                ></path></svg
                                            >
                                        </td>
                                        <td
                                            class="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 dark:text-white sm:pl-6"
                                        >
                                            {p.id}
                                        </td>
                                        <td
                                            class="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-300 font-mono"
                                        >
                                            {#if p.actorId}
                                                {p.actorId}
                                            {:else}
                                                <span
                                                    class="italic text-gray-400"
                                                    >Anonymous</span
                                                >
                                            {/if}
                                        </td>
                                        <td
                                            class="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-300"
                                        >
                                            {p.amountSatoshis}
                                        </td>
                                        <td
                                            class="whitespace-nowrap px-3 py-4 text-sm"
                                        >
                                            {#if p.status === "paid"}
                                                <span
                                                    class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                                                >
                                                    PAID
                                                </span>
                                            {:else}
                                                <span
                                                    class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                                                >
                                                    PENDING
                                                </span>
                                            {/if}
                                        </td>
                                        <td
                                            class="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-300"
                                        >
                                            {p.resourcePath}
                                        </td>
                                        <td
                                            class="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-300"
                                        >
                                            {new Date(
                                                p.createdAt,
                                            ).toLocaleString()}
                                        </td>
                                    </tr>
                                    {#if expandedRows.has(p.id)}
                                        <tr
                                            class="bg-gray-50 dark:bg-gray-800/50"
                                        >
                                            <td
                                                colspan="7"
                                                class="px-10 py-4 border-b border-gray-100 dark:border-gray-700"
                                            >
                                                {#if p.details}
                                                    <div
                                                        class="rounded-md bg-gray-900 overflow-hidden shadow-inner"
                                                    >
                                                        <div
                                                            class="px-4 py-2 border-b border-gray-700 bg-gray-800 flex justify-between items-center text-xs text-gray-400 font-mono"
                                                        >
                                                            <span
                                                                >Request Context</span
                                                            >
                                                        </div>
                                                        <pre
                                                            class="p-4 text-xs text-green-400 font-mono overflow-x-auto"><code
                                                                >{JSON.stringify(
                                                                    p.details,
                                                                    null,
                                                                    2,
                                                                )}</code
                                                            ></pre>
                                                    </div>
                                                {:else}
                                                    <p
                                                        class="text-sm text-gray-500 italic"
                                                    >
                                                        No detailed request
                                                        context recorded.
                                                    </p>
                                                {/if}
                                                <div
                                                    class="mt-4 text-sm text-gray-500 dark:text-gray-400"
                                                >
                                                    <strong
                                                        >Payment Hash:</strong
                                                    >
                                                    <span
                                                        class="font-mono text-xs ml-2 bg-gray-200 dark:bg-gray-700 p-1 rounded"
                                                        >{p.paymentHash}</span
                                                    >
                                                </div>
                                            </td>
                                        </tr>
                                    {/if}
                                {/each}
                            </tbody>
                        </table>
                    </div>
                {/if}
            </div>
        </div>
    </div>
</div>
