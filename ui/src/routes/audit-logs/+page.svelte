<script lang="ts">
    import { fetchApi } from "$lib/api";
    import { onMount } from "svelte";

    type AuditEvent = {
        id: number;
        action: string;
        entityType: string;
        entityId: number;
        userId: number | null;
        details: any;
        createdAt: string;
    };

    let events = $state<AuditEvent[]>([]);
    let loading = $state(true);
    let error = $state<string | null>(null);

    // Pagination
    let cursor = $state<string | null>(null);
    let hasMore = $state(false);
    let nextCursor = $state<string | null>(null);
    let historyStack = $state<string[]>([]); // To go back

    // Filters
    let filterAction = $state("");
    let filterEntityType = $state("");

    const ACTIONS = ["create", "update", "delete", "rollback", "error"];
    const ENTITIES = ["content_type", "content_item", "api_key", "webhook"];

    let expandedRows = $state<Set<number>>(new Set());

    function toggleRow(id: number) {
        if (expandedRows.has(id)) {
            expandedRows.delete(id);
        } else {
            expandedRows.add(id);
        }
        // $state triggers reactivity on Sets when reassigned or in Svelte 5 we can just reassign
        expandedRows = new Set(expandedRows);
    }

    async function loadEvents(reset = false) {
        loading = true;
        error = null;

        if (reset) {
            cursor = null;
            historyStack = [];
        }

        try {
            const params = new URLSearchParams();
            if (cursor) params.set("cursor", cursor);
            if (filterAction) params.set("action", filterAction);
            if (filterEntityType) params.set("entityType", filterEntityType);
            params.set("limit", "20");

            const res = await fetchApi(`/audit-logs?${params.toString()}`);
            events = res.data;
            hasMore = res.meta.hasMore;
            nextCursor = res.meta.nextCursor;
        } catch (err: any) {
            error = err.message || "Failed to load audit logs";
        } finally {
            loading = false;
        }
    }

    onMount(() => {
        loadEvents(true);
    });

    function applyFilters() {
        loadEvents(true);
    }

    function goToNextPage() {
        if (nextCursor) {
            historyStack.push(cursor || "");
            cursor = nextCursor;
            loadEvents();
        }
    }

    function goToPrevPage() {
        if (historyStack.length > 0) {
            cursor = historyStack.pop() || null;
            loadEvents();
        }
    }
</script>

<svelte:head>
    <title>Audit Logs | WordClaw Supervisor</title>
</svelte:head>

<div class="h-full flex flex-col">
    <div class="flex justify-between items-center mb-6">
        <h2 class="text-2xl font-bold text-gray-900 dark:text-white">
            Audit Logs
        </h2>
        <button
            onclick={() => loadEvents(true)}
            class="text-gray-500 hover:text-blue-600 dark:text-gray-400 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            title="Refresh"
        >
            <svg
                class="w-5 h-5"
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

    <!-- Filters -->
    <div
        class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 mb-6 flex flex-wrap gap-4 items-end"
    >
        <div>
            <label
                for="action-filter"
                class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >Action</label
            >
            <select
                id="action-filter"
                bind:value={filterAction}
                class="w-40 block rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm py-2 px-3"
            >
                <option value="">All Actions</option>
                {#each ACTIONS as action}
                    <option value={action}>{action}</option>
                {/each}
            </select>
        </div>
        <div>
            <label
                for="entity-filter"
                class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >Entity Type</label
            >
            <select
                id="entity-filter"
                bind:value={filterEntityType}
                class="w-48 block rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm py-2 px-3"
            >
                <option value="">All Entities</option>
                {#each ENTITIES as entity}
                    <option value={entity}>{entity}</option>
                {/each}
            </select>
        </div>
        <button
            onclick={applyFilters}
            class="px-4 py-2 bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md font-medium text-sm transition-colors border border-gray-300 dark:border-gray-600"
        >
            Apply Filters
        </button>
        {#if filterAction || filterEntityType}
            <button
                onclick={() => {
                    filterAction = "";
                    filterEntityType = "";
                    applyFilters();
                }}
                class="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                >Clear</button
            >
        {/if}
    </div>

    {#if error}
        <div
            class="bg-red-50 dark:bg-red-900/30 border-l-4 border-red-500 p-4 mb-6 rounded"
        >
            <p class="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
    {/if}

    <!-- Table -->
    <div
        class="flex-1 bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col"
    >
        <div class="overflow-x-auto flex-1">
            <table
                class="min-w-full divide-y divide-gray-200 dark:divide-gray-700 relative"
            >
                <thead class="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10">
                    <tr>
                        <th scope="col" class="w-10 px-6 py-3"></th>
                        <th
                            scope="col"
                            class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                            >Timestamp</th
                        >
                        <th
                            scope="col"
                            class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                            >Action</th
                        >
                        <th
                            scope="col"
                            class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                            >Entity</th
                        >
                        <th
                            scope="col"
                            class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                            >Agent/User</th
                        >
                    </tr>
                </thead>
                <tbody
                    class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700 relative"
                >
                    {#if loading && events.length === 0}
                        <tr
                            ><td
                                colspan="5"
                                class="px-6 py-12 text-center text-gray-500"
                                ><div
                                    class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto"
                                ></div></td
                            ></tr
                        >
                    {:else if events.length === 0}
                        <tr
                            ><td
                                colspan="5"
                                class="px-6 py-12 text-center text-gray-500 dark:text-gray-400"
                                >No audit logs found matching criteria.</td
                            ></tr
                        >
                    {:else}
                        {#each events as event}
                            <tr
                                class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors cursor-pointer {expandedRows.has(
                                    event.id,
                                )
                                    ? 'bg-blue-50/50 dark:bg-blue-900/10'
                                    : ''}"
                                onclick={() => toggleRow(event.id)}
                            >
                                <td
                                    class="px-6 py-4 whitespace-nowrap text-gray-400"
                                >
                                    <svg
                                        class="w-5 h-5 transform transition-transform {expandedRows.has(
                                            event.id,
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
                                    class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 font-mono"
                                >
                                    {new Date(event.createdAt)
                                        .toISOString()
                                        .replace("T", " ")
                                        .substring(0, 19)}
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap">
                                    <span
                                        class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full
                                        {event.action === 'create'
                                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                            : event.action === 'update'
                                              ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                                              : event.action === 'delete'
                                                ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                                : event.action === 'rollback'
                                                  ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
                                                  : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'}"
                                    >
                                        {event.action.toUpperCase()}
                                    </span>
                                </td>
                                <td
                                    class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200"
                                >
                                    <span
                                        class="font-medium font-mono text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded"
                                        >{event.entityType}:{event.entityId}</span
                                    >
                                </td>
                                <td
                                    class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400"
                                >
                                    {#if event.userId}
                                        <span class="flex items-center gap-1">
                                            <svg
                                                class="w-4 h-4"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                                ><path
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    stroke-width="2"
                                                    d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                                                ></path></svg
                                            >
                                            {event.userId}
                                        </span>
                                    {:else}
                                        <span class="text-gray-400 italic"
                                            >System / Unauthenticated</span
                                        >
                                    {/if}
                                </td>
                            </tr>
                            {#if expandedRows.has(event.id)}
                                <tr class="bg-gray-50 dark:bg-gray-800/50">
                                    <td
                                        colspan="5"
                                        class="px-10 py-4 border-b border-gray-100 dark:border-gray-700"
                                    >
                                        {#if event.details}
                                            <div
                                                class="rounded-md bg-gray-900 overflow-hidden shadow-inner"
                                            >
                                                <div
                                                    class="px-4 py-2 border-b border-gray-700 bg-gray-800 flex justify-between items-center text-xs text-gray-400 font-mono"
                                                >
                                                    <span>Payload Details</span>
                                                </div>
                                                <pre
                                                    class="p-4 text-xs text-green-400 font-mono overflow-x-auto"><code
                                                        >{JSON.stringify(
                                                            event.details,
                                                            null,
                                                            2,
                                                        )}</code
                                                    ></pre>
                                            </div>
                                        {:else}
                                            <p
                                                class="text-sm text-gray-500 italic"
                                            >
                                                No details recorded for this
                                                event.
                                            </p>
                                        {/if}
                                    </td>
                                </tr>
                            {/if}
                        {/each}
                    {/if}
                </tbody>
            </table>

            {#if loading && events.length > 0}
                <div
                    class="absolute inset-0 bg-white/50 dark:bg-gray-900/50 flex items-center justify-center z-20"
                >
                    <div
                        class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"
                    ></div>
                </div>
            {/if}
        </div>

        <!-- Pagination -->
        <div
            class="bg-white dark:bg-gray-800 px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between sm:px-6 z-10"
        >
            <div class="hidden sm:block">
                <p class="text-sm text-gray-700 dark:text-gray-300">
                    Showing {events.length} results
                </p>
            </div>
            <div class="flex-1 flex justify-between sm:justify-end gap-2">
                <button
                    onclick={goToPrevPage}
                    disabled={historyStack.length === 0 || loading}
                    class="relative inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Previous
                </button>
                <button
                    onclick={goToNextPage}
                    disabled={!hasMore || loading}
                    class="relative inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Next
                </button>
            </div>
        </div>
    </div>
</div>
