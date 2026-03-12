<script lang="ts">
    import { fetchApi } from "$lib/api";
    import { onMount } from "svelte";
    import DataTable from "$lib/components/DataTable.svelte";
    import ActionBadge from "$lib/components/ActionBadge.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import JsonCodeBlock from "$lib/components/JsonCodeBlock.svelte";
    import ActorIdentity from "$lib/components/ActorIdentity.svelte";
    import Badge from "$lib/components/ui/Badge.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import Surface from "$lib/components/ui/Surface.svelte";
    import { Icon, ArrowPath } from "svelte-hero-icons";

    type AuditEvent = {
        id: number;
        action: string;
        entityType: string;
        entityId: number;
        actorId: string | null;
        actorType: string | null;
        actorSource: string | null;
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

    const columns = [
        { key: "_expand", label: "", width: "40px" },
        { key: "createdAt", label: "Timestamp" },
        { key: "action", label: "Action" },
        { key: "entity", label: "Entity" },
        { key: "actorId", label: "Actor" },
    ];

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
            error = err;
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
    <div class="mb-6 flex items-start justify-between gap-4">
        <div>
            <h2
                class="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white"
            >
                Audit Logs
            </h2>
            <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Review operator and runtime actions across the control plane.
            </p>
        </div>
        <Button
            variant="outline"
            onclick={() => loadEvents(true)}
            title="Refresh"
        >
            <Icon src={ArrowPath} class="h-4 w-4" />
            Refresh
        </Button>
    </div>

    <!-- Filters -->
    <Surface class="mb-6 flex flex-wrap items-end gap-4">
        <div class="w-full md:w-auto">
            <label
                for="action-filter"
                class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                >Action</label
            >
            <Select
                id="action-filter"
                bind:value={filterAction}
                class="w-full md:w-44"
            >
                <option value="">All Actions</option>
                {#each ACTIONS as action}
                    <option value={action}>{action}</option>
                {/each}
            </Select>
        </div>
        <div class="w-full md:w-auto">
            <label
                for="entity-filter"
                class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                >Entity Type</label
            >
            <Select
                id="entity-filter"
                bind:value={filterEntityType}
                class="w-full md:w-52"
            >
                <option value="">All Entities</option>
                {#each ENTITIES as entity}
                    <option value={entity}>{entity}</option>
                {/each}
            </Select>
        </div>
        <Button
            onclick={applyFilters}
            variant="secondary"
            class="w-full md:w-auto"
        >
            Apply Filters
        </Button>
        {#if filterAction || filterEntityType}
            <Button
                onclick={() => {
                    filterAction = "";
                    filterEntityType = "";
                    applyFilters();
                }}
                variant="ghost"
                class="w-full md:w-auto"
            >
                Clear
            </Button>
        {/if}
    </Surface>

    {#if error}
        <ErrorBanner
            class="mb-6"
            {error}
            message={typeof error === "string" ? error : undefined}
        />
    {/if}

    <!-- Table -->
    <Surface class="flex flex-1 flex-col overflow-hidden p-0">
        <div class="overflow-x-auto flex-1 relative">
            <DataTable {columns} data={events} keyField="id" expandable={true}>
                {#snippet cell(ctx: any)}
                    {@const row = ctx.row}
                    {@const column = ctx.column}
                    {#if column.key === "createdAt"}
                        <span
                            class="font-mono text-sm text-slate-500 dark:text-slate-400"
                        >
                            {new Date(row.createdAt)
                                .toISOString()
                                .replace("T", " ")
                                .substring(0, 19)}
                        </span>
                    {:else if column.key === "action"}
                        <ActionBadge action={row.action} />
                    {:else if column.key === "entity"}
                        <Badge variant="muted" class="font-mono normal-case">
                            {row.entityType}:{row.entityId}
                        </Badge>
                    {:else if column.key === "actorId"}
                        <ActorIdentity
                            actorId={row.actorId}
                            actorType={row.actorType}
                            actorSource={row.actorSource}
                            compact={true}
                        />
                    {/if}
                {/snippet}

                {#snippet empty()}
                    {#if loading}
                        <LoadingSpinner size="md" class="mx-auto" />
                    {:else}
                        No audit logs found matching criteria.
                    {/if}
                {/snippet}

                {#snippet expanded(ctx: any)}
                    {@const row = ctx.row}
                    <div class="px-10 py-4">
                        {#if row.details}
                            <JsonCodeBlock
                                label="Payload Details"
                                value={row.details}
                            />
                        {:else}
                            <p class="text-sm text-gray-500 italic">
                                No details recorded for this event.
                            </p>
                        {/if}
                    </div>
                {/snippet}
            </DataTable>

            {#if loading && events.length > 0}
                <div
                    class="absolute inset-0 z-20 flex items-center justify-center bg-white/50 dark:bg-slate-950/50"
                >
                    <LoadingSpinner size="lg" />
                </div>
            {/if}
        </div>

        <!-- Pagination -->
        <div
            class="z-10 flex items-center justify-between border-t border-slate-200 px-4 py-3 sm:px-6 dark:border-slate-700"
        >
            <div class="hidden sm:block">
                <p class="text-sm text-slate-700 dark:text-slate-300">
                    Showing {events.length} results
                </p>
            </div>
            <div class="flex-1 flex justify-between sm:justify-end gap-2">
                <Button
                    onclick={goToPrevPage}
                    disabled={historyStack.length === 0 || loading}
                    variant="outline"
                >
                    Previous
                </Button>
                <Button
                    onclick={goToNextPage}
                    disabled={!hasMore || loading}
                    variant="outline"
                >
                    Next
                </Button>
            </div>
        </div>
    </Surface>
</div>
