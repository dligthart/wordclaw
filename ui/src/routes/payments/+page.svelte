<script lang="ts">
    import { onMount } from "svelte";
    import { fetchApi } from "$lib/api";
    import DataTable from "$lib/components/DataTable.svelte";

    let payments = $state<any[]>([]);
    let loading = $state(true);
    let error = $state<string | null>(null);

    const columns = [
        { key: "_expand", label: "", width: "40px" },
        { key: "id", label: "ID", sortable: true },
        { key: "actorId", label: "Actor" },
        { key: "amountSatoshis", label: "Amount (Sats)" },
        { key: "status", label: "Status", sortable: true },
        { key: "resourcePath", label: "Resource Path" },
        { key: "createdAt", label: "Created At", sortable: true },
    ];

    function deepParseJsonPayload(obj: any): any {
        if (typeof obj === "string") {
            try {
                const parsed = JSON.parse(obj);
                if (typeof parsed === "object" && parsed !== null) {
                    return deepParseJsonPayload(parsed);
                }
            } catch (e) {
                // Ignored, not valid JSON
            }
            return obj;
        } else if (Array.isArray(obj)) {
            return obj.map(deepParseJsonPayload);
        } else if (typeof obj === "object" && obj !== null) {
            const result: any = {};
            for (const key in obj) {
                result[key] = deepParseJsonPayload(obj[key]);
            }
            return result;
        }
        return obj;
    }

    async function loadPayments() {
        loading = true;
        error = null;
        try {
            const res = await fetchApi("/payments");
            payments = res.data.map((p: any) => {
                if (p.details) {
                    p.details = deepParseJsonPayload(p.details);
                }
                return p;
            });
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
                    <DataTable
                        {columns}
                        data={payments}
                        keyField="id"
                        expandable={true}
                    >
                        <svelte:fragment slot="cell" let:row let:column>
                            {#if column.key === "id"}
                                <span
                                    class="font-medium text-gray-900 dark:text-white"
                                    >{row.id}</span
                                >
                            {:else if column.key === "actorId"}
                                <span class="font-mono">
                                    {#if row.actorId}
                                        {row.actorId}
                                    {:else}
                                        <span class="italic text-gray-400"
                                            >Anonymous</span
                                        >
                                    {/if}
                                </span>
                            {:else if column.key === "amountSatoshis"}
                                {row.amountSatoshis}
                            {:else if column.key === "status"}
                                {#if row.status === "paid"}
                                    <span
                                        class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                                        >PAID</span
                                    >
                                {:else}
                                    <span
                                        class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                                        >PENDING</span
                                    >
                                {/if}
                            {:else if column.key === "resourcePath"}
                                <span class="text-gray-500 dark:text-gray-300"
                                    >{row.resourcePath}</span
                                >
                            {:else if column.key === "createdAt"}
                                <span class="text-gray-500 dark:text-gray-300"
                                    >{new Date(
                                        row.createdAt,
                                    ).toLocaleString()}</span
                                >
                            {/if}
                        </svelte:fragment>

                        <svelte:fragment slot="expanded" let:row>
                            <div class="px-10 py-4">
                                {#if row.details}
                                    <div
                                        class="rounded-md bg-gray-900 overflow-hidden shadow-inner"
                                    >
                                        <div
                                            class="px-4 py-2 border-b border-gray-700 bg-gray-800 flex justify-between items-center text-xs text-gray-400 font-mono"
                                        >
                                            <span>Request Context</span>
                                        </div>
                                        <pre
                                            class="p-4 text-xs text-green-400 font-mono overflow-x-auto"><code
                                                >{JSON.stringify(
                                                    row.details,
                                                    null,
                                                    2,
                                                )}</code
                                            ></pre>
                                    </div>
                                {:else}
                                    <p class="text-sm text-gray-500 italic">
                                        No detailed request context recorded.
                                    </p>
                                {/if}
                                <div
                                    class="mt-4 text-sm text-gray-500 dark:text-gray-400"
                                >
                                    <strong>Payment Hash:</strong>
                                    <span
                                        class="font-mono text-xs ml-2 bg-gray-200 dark:bg-gray-700 p-1 rounded break-all"
                                        >{row.paymentHash}</span
                                    >
                                </div>
                            </div>
                        </svelte:fragment>
                    </DataTable>
                {/if}
            </div>
        </div>
    </div>
</div>
