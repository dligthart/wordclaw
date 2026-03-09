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
    class="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white dark:border-slate-700 dark:bg-slate-900/40 shadow-sm"
>
    <table class="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
        <thead class="bg-slate-50/80 dark:bg-slate-900/60">
            <tr>
                {#each columns as column (column.key)}
                    <th
                        scope="col"
                        class={`px-3 py-3 text-left text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 sm:px-6 ${column.sortable ? "group cursor-pointer select-none hover:bg-slate-100/80 dark:hover:bg-slate-800" : ""}`}
                        style={column.width ? `width: ${column.width};` : ""}
                        onclick={() => handleSort(column)}
                    >
                        <div class="flex items-center space-x-1">
                            <span>{column.label}</span>
                            {#if column.sortable}
                                <span
                                    class="text-slate-400 dark:text-slate-500 flex-shrink-0"
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
        <tbody class="divide-y divide-slate-200 bg-white dark:divide-slate-700 dark:bg-slate-900/20">
            {#if data.length === 0}
                <tr>
                    <td
                        colspan={columns.length}
                        class="px-3 py-12 text-center text-sm text-slate-500 dark:text-slate-400 sm:px-6"
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
                        class={`group ${onRowClick || expandable ? "cursor-pointer transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/60" : ""}`}
                        onclick={() => {
                            if (expandable) toggleExpanded(row[keyField]);
                            if (onRowClick) onRowClick(row);
                        }}
                    >
                        {#each columns as column (column.key)}
                            <td
                                class="px-3 py-4 whitespace-nowrap text-sm text-slate-900 dark:text-slate-100 sm:px-6"
                            >
                                {#if column.key === "_expand" && expandable}
                                    <svg
                                        class="w-5 h-5 text-slate-400 transform transition-transform {expandedRows.has(
                                            row[keyField],
                                        )
                                            ? 'rotate-90 text-slate-700 dark:text-slate-200'
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
                        <tr class="bg-slate-50/60 dark:bg-slate-900/30">
                            <td
                                colspan={columns.length}
                                class="border-b border-slate-200 p-0 dark:border-slate-700"
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
