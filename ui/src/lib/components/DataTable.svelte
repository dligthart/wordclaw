<script lang="ts">
    import type { Snippet } from "svelte";

    export interface Column<T = Record<string, any>> {
        key: Extract<keyof T, string> | string;
        label: string;
        sortable?: boolean;
        width?: string;
    }

    type RowData = Record<string, any>;

    let {
        columns = [],
        data = [],
        keyField,
        onRowClick = undefined,
        sortKey = undefined,
        sortDirection = "asc",
        expandable = false,
        onSort = undefined,
        cell = undefined,
        expanded = undefined,
        empty = undefined,
    }: {
        columns?: Column<RowData>[];
        data?: RowData[];
        keyField: string;
        onRowClick?: (row: RowData) => void;
        sortKey?: string;
        sortDirection?: "asc" | "desc";
        expandable?: boolean;
        onSort?: (payload: { key: string; direction: "asc" | "desc" }) => void;
        cell?: Snippet<
            [
                {
                    row: RowData;
                    column: Column<RowData>;
                    value: unknown;
                },
            ]
        >;
        expanded?: Snippet<
            [
                {
                    row: RowData;
                },
            ]
        >;
        empty?: Snippet;
    } = $props();

    let expandedRows = $state(new Set<any>());

    function toggleExpanded(id: any) {
        if (expandedRows.has(id)) {
            expandedRows.delete(id);
        } else {
            expandedRows.add(id);
        }
        expandedRows = new Set(expandedRows);
    }

    function handleSort(col: Column<RowData>) {
        if (!col.sortable) return;

        let newDir: "asc" | "desc" = "asc";
        if (sortKey === col.key) {
            newDir = sortDirection === "asc" ? "desc" : "asc";
        }

        sortKey = col.key;
        sortDirection = newDir;
        onSort?.({ key: String(col.key), direction: newDir });
    }
</script>

<div
    class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm"
>
    <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead class="bg-gray-50 dark:bg-gray-900/50">
            <tr>
                {#each columns as column (column.key)}
                    <th
                        scope="col"
                        class={`px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider ${column.sortable ? "group cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-800" : ""}`}
                        style={column.width ? `width: ${column.width};` : ""}
                        onclick={() => handleSort(column)}
                    >
                        <div class="flex items-center space-x-1">
                            <span>{column.label}</span>
                            {#if column.sortable}
                                <span
                                    class="text-gray-400 dark:text-gray-500 flex-shrink-0"
                                >
                                    {#if sortKey === column.key}
                                        {#if sortDirection === "asc"}
                                            <svg
                                                class="w-4 h-4"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                                ><path
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    stroke-width="2"
                                                    d="M5 15l7-7 7 7"
                                                ></path></svg
                                            >
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
                                                    d="M19 9l-7 7-7-7"
                                                ></path></svg
                                            >
                                        {/if}
                                    {:else}
                                        <svg
                                            class="w-4 h-4 opacity-0 group-hover:opacity-50"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                            ><path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                stroke-width="2"
                                                d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
                                            ></path></svg
                                        >
                                    {/if}
                                </span>
                            {/if}
                        </div>
                    </th>
                {/each}
            </tr>
        </thead>
        <tbody
            class="bg-white divide-y divide-gray-200 dark:bg-gray-800 dark:divide-gray-700"
        >
            {#if data.length === 0}
                <tr>
                    <td
                        colspan={columns.length}
                        class="px-3 sm:px-6 py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                    >
                        {#if empty}
                            {@render empty()}
                        {:else}
                            No data available
                        {/if}
                    </td>
                </tr>
            {:else}
                {#each data as row (row[keyField])}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                    <tr
                        class={`group ${onRowClick || expandable ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors" : ""}`}
                        onclick={() => {
                            if (expandable) toggleExpanded(row[keyField]);
                            if (onRowClick) onRowClick(row);
                        }}
                    >
                        {#each columns as column (column.key)}
                            <td
                                class="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100"
                            >
                                {#if column.key === "_expand" && expandable}
                                    <svg
                                        class="w-5 h-5 text-gray-400 transform transition-transform {expandedRows.has(
                                            row[keyField],
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
                                {:else if cell}
                                    {@render cell({
                                        row,
                                        column,
                                        value: row[column.key as string],
                                    })}
                                {:else}
                                    {row[column.key as string] ?? ""}
                                {/if}
                            </td>
                        {/each}
                    </tr>
                    {#if expandable && expandedRows.has(row[keyField])}
                        <tr class="bg-gray-50 dark:bg-gray-800/50">
                            <td
                                colspan={columns.length}
                                class="p-0 border-b border-gray-100 dark:border-gray-700"
                            >
                                {#if expanded}
                                    {@render expanded({ row })}
                                {/if}
                            </td>
                        </tr>
                    {/if}
                {/each}
            {/if}
        </tbody>
    </table>
</div>
