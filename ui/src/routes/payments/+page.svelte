<script lang="ts">
    import { onMount } from "svelte";
    import { fetchApi } from "$lib/api";
    import DataTable from "$lib/components/DataTable.svelte";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import JsonCodeBlock from "$lib/components/JsonCodeBlock.svelte";
    import { deepParseJson } from "$lib/utils";
    import { Icon } from "svelte-hero-icons";
    import { ArrowPath } from "svelte-hero-icons";

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

    async function loadPayments() {
        loading = true;
        error = null;
        try {
            const res = await fetchApi("/payments");
            payments = res.data.map((p: any) => {
                if (p.details) p.details = deepParseJson(p.details);
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

<svelte:head>
    <title>Payments | WordClaw Supervisor</title>
</svelte:head>

<div class="h-full flex flex-col">
    <div class="mb-6 flex justify-between items-end">
        <div>
            <h2 class="text-2xl font-bold text-gray-900 dark:text-white">
                Payments
            </h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Track L402 invoice creation, status, and settlement details.
            </p>
        </div>
        <button
            type="button"
            onclick={loadPayments}
            class="text-gray-500 hover:text-blue-600 dark:text-gray-400 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            title="Refresh"
        >
            <Icon src={ArrowPath} class="w-5 h-5" />
        </button>
    </div>

    {#if error}
        <ErrorBanner class="mb-6" message={error} />
    {/if}

    <div
        class="bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 flex-1 flex flex-col overflow-hidden"
    >
        {#if loading}
            <div class="flex-1 flex justify-center items-center p-12">
                <LoadingSpinner size="lg" />
            </div>
        {:else if payments.length === 0}
            <div class="text-center py-12">
                <p class="text-sm text-gray-500 dark:text-gray-400">
                    No active or historical payments found.
                </p>
            </div>
        {:else}
            <DataTable {columns} data={payments} keyField="id" expandable={true}>
                {#snippet cell(ctx: any)}
                    {@const row = ctx.row}
                    {@const column = ctx.column}
                    {#if column.key === "id"}
                        <span class="font-medium text-gray-900 dark:text-white"
                            >{row.id}</span
                        >
                    {:else if column.key === "actorId"}
                        <span class="font-mono">
                            {#if row.actorId}
                                {row.actorId}
                            {:else}
                                <span class="italic text-gray-400">Anonymous</span>
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
                            >{new Date(row.createdAt).toLocaleString()}</span
                        >
                    {/if}
                {/snippet}

                {#snippet expanded(ctx: any)}
                    {@const row = ctx.row}
                    <div class="px-6 sm:px-10 py-4">
                        {#if row.details}
                            <JsonCodeBlock
                                label="Request Context"
                                value={row.details}
                            />
                        {:else}
                            <p class="text-sm text-gray-500 italic">
                                No detailed request context recorded.
                            </p>
                        {/if}
                        <div class="mt-4 text-sm text-gray-500 dark:text-gray-400">
                            <strong>Payment Hash:</strong>
                            <span
                                class="font-mono text-xs ml-2 bg-gray-200 dark:bg-gray-700 p-1 rounded break-all"
                                >{row.paymentHash}</span
                            >
                        </div>
                    </div>
                {/snippet}
            </DataTable>
        {/if}
    </div>
</div>
