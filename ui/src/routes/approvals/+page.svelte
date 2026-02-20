<script lang="ts">
    import { fetchApi } from "$lib/api";
    import { onMount } from "svelte";

    type ContentItem = {
        id: number;
        contentTypeId: number;
        status: string;
        version: number;
        data: any;
        createdAt: string;
        updatedAt: string;
    };

    type ContentType = {
        id: number;
        name: string;
        slug: string;
    };

    let pendingItems = $state<ContentItem[]>([]);
    let contentTypes = $state<Record<number, ContentType>>({});
    let loading = $state(true);
    let error = $state<string | null>(null);

    let selectedItem = $state<ContentItem | null>(null);
    let processingItem = $state<number | null>(null);

    onMount(async () => {
        await loadData();
    });

    async function loadData() {
        loading = true;
        error = null;
        try {
            // Fetch content types for reference
            const typesRes = await fetchApi("/content-types");
            const typesRecord: Record<number, ContentType> = {};
            for (const t of typesRes.data) {
                typesRecord[t.id] = t;
            }
            contentTypes = typesRecord;

            // Fetch pending items (we treat 'draft' or 'pending_approval' as pending)
            // Let's explicitly fetch 'pending_approval' if agents set it, but for our MVP, let's treat anything not 'published' and not 'rejected' and not 'archived' as reviewable. Let's explicitly query 'draft' for now.
            const res = await fetchApi("/content-items?status=draft&limit=50");
            pendingItems = res.data;

            // If we also have a specific 'pending_approval' status, fetch that too.
            const resPending = await fetchApi(
                "/content-items?status=pending_approval&limit=50",
            );
            pendingItems = [...pendingItems, ...resPending.data].sort(
                (a, b) =>
                    new Date(b.updatedAt).getTime() -
                    new Date(a.updatedAt).getTime(),
            );

            // Deduplicate if any overlap (unlikely if strictly matching statuses)
            const uniqueIds = new Set();
            pendingItems = pendingItems.filter((item) => {
                const isDup = uniqueIds.has(item.id);
                uniqueIds.add(item.id);
                return !isDup;
            });
        } catch (err: any) {
            error = err.message || "Failed to load approval queue";
        } finally {
            loading = false;
        }
    }

    async function processItem(
        item: ContentItem,
        newStatus: "published" | "rejected",
    ) {
        processingItem = item.id;
        try {
            await fetchApi(`/content-items/${item.id}`, {
                method: "PUT",
                body: JSON.stringify({ status: newStatus }),
            });
            // Remove from list
            pendingItems = pendingItems.filter((i) => i.id !== item.id);
            if (selectedItem?.id === item.id) {
                selectedItem = null;
            }
        } catch (err: any) {
            alert(`Failed to ${newStatus} item: ${err.message}`);
        } finally {
            processingItem = null;
        }
    }

    function viewItem(item: ContentItem) {
        selectedItem = item;
    }
</script>

<svelte:head>
    <title>Approval Queue | WordClaw Supervisor</title>
</svelte:head>

<div class="h-full flex flex-col">
    <div class="mb-6 flex justify-between items-end">
        <div>
            <h2
                class="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3"
            >
                Approval Queue
                {#if pendingItems.length > 0 && !loading}
                    <span
                        class="inline-flex items-center justify-center bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 text-xs font-bold w-6 h-6 rounded-full"
                        >{pendingItems.length}</span
                    >
                {/if}
            </h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Review agent-generated content before it goes live.
            </p>
        </div>
        <button
            onclick={loadData}
            class="text-gray-500 hover:text-blue-600 dark:text-gray-400 p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition shadow-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
            title="Refresh"
        >
            <svg
                class="w-5 h-5 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                ><path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                ></path></svg
            >
        </button>
    </div>

    {#if error}
        <div
            class="bg-red-50 dark:bg-red-900/30 border-l-4 border-red-500 p-4 mb-6 rounded shadow-sm"
        >
            <p class="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
    {/if}

    <div class="flex-1 flex gap-6 overflow-hidden">
        <!-- Queue List -->
        <div
            class="w-1/3 bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden"
        >
            <div
                class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex justify-between items-center"
            >
                <h3
                    class="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                >
                    Pending Items
                </h3>
            </div>

            <div class="flex-1 overflow-y-auto p-2">
                {#if loading}
                    <div class="flex justify-center p-8">
                        <div
                            class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"
                        ></div>
                    </div>
                {:else if pendingItems.length === 0}
                    <div
                        class="text-center p-12 text-gray-500 dark:text-gray-400 flex flex-col items-center"
                    >
                        <svg
                            class="w-12 h-12 text-gray-300 dark:text-gray-600 mb-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="1.5"
                                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                            ></path></svg
                        >
                        <p class="text-sm font-medium">All caught up!</p>
                        <p class="text-xs mt-1">
                            No items require approval right now.
                        </p>
                    </div>
                {:else}
                    <ul class="space-y-2">
                        {#each pendingItems as item}
                            <button
                                onclick={() => viewItem(item)}
                                class="w-full text-left bg-white dark:bg-gray-800 border {selectedItem?.id ===
                                item.id
                                    ? 'border-orange-500 ring-1 ring-orange-500 shadow-sm'
                                    : 'border-gray-200 dark:border-gray-700 shadow-sm hover:border-gray-300 dark:hover:border-gray-600'} rounded-lg p-3 transition-all relative"
                            >
                                <div
                                    class="flex justify-between items-start mb-2"
                                >
                                    <span
                                        class="inline-flex items-center px-2 py-0.5 rounded text-[0.65rem] font-bold uppercase tracking-wider bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-400"
                                    >
                                        {item.status}
                                    </span>
                                    <span
                                        class="text-[0.65rem] font-mono text-gray-400"
                                        >v{item.version}</span
                                    >
                                </div>

                                <div
                                    class="text-sm font-medium text-gray-900 dark:text-white mb-1"
                                >
                                    {contentTypes[item.contentTypeId]?.name ||
                                        "Unknown Model"}
                                </div>

                                <div
                                    class="text-xs text-gray-600 dark:text-gray-400 font-mono line-clamp-2 break-all opacity-80 mb-2"
                                >
                                    {JSON.stringify(item.data).substring(
                                        0,
                                        80,
                                    )}...
                                </div>

                                <div
                                    class="flex justify-between items-end text-[0.65rem] text-gray-400"
                                >
                                    <span
                                        title={new Date(
                                            item.updatedAt,
                                        ).toLocaleString()}
                                        >{new Date(
                                            item.updatedAt,
                                        ).toLocaleDateString()}</span
                                    >
                                    <span>ID: {item.id}</span>
                                </div>
                            </button>
                        {/each}
                    </ul>
                {/if}
            </div>
        </div>

        <!-- Review Detail -->
        <div
            class="flex-1 bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden"
        >
            {#if !selectedItem}
                <div
                    class="flex-1 flex items-center justify-center text-gray-400 italic text-sm p-12 text-center"
                >
                    Select an item from the queue to review and approve.
                </div>
            {:else}
                <!-- Header -->
                <div
                    class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex justify-between items-center"
                >
                    <div>
                        <div class="flex items-center gap-3">
                            <h3
                                class="text-lg font-bold text-gray-900 dark:text-white"
                            >
                                Reviewing Item #{selectedItem.id}
                            </h3>
                            <span
                                class="text-xs font-medium bg-gray-200 text-gray-800 dark:bg-gray-600 dark:text-gray-300 px-2 py-0.5 rounded"
                            >
                                {contentTypes[selectedItem.contentTypeId]
                                    ?.name || "Unknown Model"}
                            </span>
                        </div>
                        <p class="text-[0.7rem] text-gray-500 mt-1">
                            Submitted: {new Date(
                                selectedItem.updatedAt,
                            ).toLocaleString()}
                        </p>
                    </div>
                    <div class="flex gap-2">
                        <button
                            onclick={() =>
                                processItem(selectedItem!, "rejected")}
                            disabled={processingItem === selectedItem.id}
                            class="px-4 py-2 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 rounded-md transition-colors shadow-sm disabled:opacity-50"
                        >
                            Reject
                        </button>
                        <button
                            onclick={() =>
                                processItem(selectedItem!, "published")}
                            disabled={processingItem === selectedItem.id}
                            class="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-500 rounded-md transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
                        >
                            {#if processingItem === selectedItem.id}
                                <div
                                    class="animate-spin rounded-full h-3 w-3 border-b-2 border-white"
                                ></div>
                            {:else}
                                <svg
                                    class="w-4 h-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                    ><path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M5 13l4 4L19 7"
                                    ></path></svg
                                >
                            {/if}
                            Approve
                        </button>
                    </div>
                </div>

                <!-- Data Preview -->
                <div
                    class="flex-1 overflow-y-auto p-6 bg-gray-100 dark:bg-gray-900"
                >
                    <div
                        class="bg-white dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                    >
                        <div
                            class="px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex justify-between items-center text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                        >
                            Payload Data
                            <button
                                class="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                                title="Copy to clipboard"
                                onclick={() =>
                                    navigator.clipboard.writeText(
                                        JSON.stringify(
                                            selectedItem!.data,
                                            null,
                                            2,
                                        ),
                                    )}
                            >
                                Copy JSON
                            </button>
                        </div>
                        <pre
                            class="p-4 text-sm font-mono text-gray-800 dark:text-green-400 overflow-x-auto whitespace-pre-wrap word-break"><code
                                >{JSON.stringify(
                                    selectedItem.data,
                                    null,
                                    2,
                                )}</code
                            ></pre>
                    </div>
                </div>
            {/if}
        </div>
    </div>
</div>
