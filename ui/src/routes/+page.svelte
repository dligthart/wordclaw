<script lang="ts">
    import { fetchApi } from "$lib/api";
    import { onMount } from "svelte";
    import {
        Spinner,
        Alert,
        Card,
        Badge,
        Table,
        TableBody,
        TableBodyCell,
        TableBodyRow,
        TableHead,
        TableHeadCell,
    } from "flowbite-svelte";

    type DashboardData = {
        health: {
            api: string;
            database: string;
            rateLimitStatus: string;
        };
        activitySummary: {
            creates: number;
            updates: number;
            deletes: number;
            rollbacks: number;
            totalAgentsActive: number;
        };
        recentEvents: any[];
        alerts: { type: string; message: string }[];
    };

    let data = $state<DashboardData | null>(null);
    let error = $state<string | null>(null);
    let loading = $state(true);

    onMount(async () => {
        try {
            data = await fetchApi("/supervisors/dashboard");
        } catch (err: any) {
            error = err.message || "Failed to load dashboard data";
        } finally {
            loading = false;
        }
    });

    function formatDate(dateString: string) {
        return new Date(dateString).toLocaleString();
    }
</script>

<svelte:head>
    <title>Dashboard | WordClaw Supervisor</title>
</svelte:head>

<div>
    <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        Supervisor Dashboard
    </h2>

    {#if loading}
        <div class="flex justify-center py-12">
            <Spinner size="10" color="blue" />
        </div>
    {:else if error}
        <Alert color="red" class="mb-6">
            <span class="font-medium">Error:</span>
            {error}
            <button
                onclick={() => window.location.reload()}
                class="ml-2 text-sm text-red-700 font-medium hover:underline"
                >Retry</button
            >
        </Alert>
    {:else if data}
        <!-- Alerts -->
        {#if data.alerts && data.alerts.length > 0}
            <div class="mb-8 space-y-3">
                {#each data.alerts as alert}
                    <Alert color={alert.type === "critical" ? "red" : "yellow"}>
                        <span class="font-medium">{alert.message}</span>
                    </Alert>
                {/each}
            </div>
        {/if}

        <!-- System Health Strip -->
        <div class="mb-8 grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card
                size="md"
                class="px-5 py-4 flex flex-row items-center justify-between border border-gray-100 dark:border-gray-700"
            >
                <div>
                    <h3
                        class="text-sm font-medium text-gray-500 dark:text-gray-400"
                    >
                        API Status
                    </h3>
                    <p
                        class="mt-1 text-lg font-semibold text-gray-900 dark:text-white capitalize"
                    >
                        {data.health.api}
                    </p>
                </div>
                <div
                    class="h-10 w-10 rounded-full flex items-center justify-center {data
                        .health.api === 'ok'
                        ? 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400'
                        : 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'}"
                >
                    <svg
                        class="h-6 w-6"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M5 13l4 4L19 7"
                        />
                    </svg>
                </div>
            </Card>

            <Card
                size="md"
                class="px-5 py-4 flex flex-row items-center justify-between border border-gray-100 dark:border-gray-700"
            >
                <div>
                    <h3
                        class="text-sm font-medium text-gray-500 dark:text-gray-400"
                    >
                        Database
                    </h3>
                    <p
                        class="mt-1 text-lg font-semibold text-gray-900 dark:text-white capitalize"
                    >
                        {data.health.database}
                    </p>
                </div>
                <div
                    class="h-10 w-10 rounded-full flex items-center justify-center {data
                        .health.database === 'ok'
                        ? 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400'
                        : 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'}"
                >
                    <svg
                        class="h-6 w-6"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
                        />
                    </svg>
                </div>
            </Card>

            <Card
                size="md"
                class="px-5 py-4 flex flex-row items-center justify-between border border-gray-100 dark:border-gray-700"
            >
                <div>
                    <h3
                        class="text-sm font-medium text-gray-500 dark:text-gray-400"
                    >
                        Rate Limits
                    </h3>
                    <p
                        class="mt-1 text-lg font-semibold text-gray-900 dark:text-white capitalize"
                    >
                        {data.health.rateLimitStatus}
                    </p>
                </div>
                <div
                    class="h-10 w-10 rounded-full flex items-center justify-center bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400"
                >
                    <svg
                        class="h-6 w-6"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M13 10V3L4 14h7v7l9-11h-7z"
                        />
                    </svg>
                </div>
            </Card>
        </div>

        <!-- Activity Summary (Last 24h) -->
        <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-4">
            Activity (Last 24h)
        </h3>
        <div class="mb-8 grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card
                size="md"
                class="px-4 py-3 border border-gray-100 dark:border-gray-700 text-center flex flex-col items-center justify-center"
            >
                <p
                    class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                >
                    Creates
                </p>
                <p
                    class="mt-1 text-2xl font-bold text-blue-600 dark:text-blue-400"
                >
                    {data.activitySummary.creates}
                </p>
            </Card>
            <Card
                size="md"
                class="px-4 py-3 border border-gray-100 dark:border-gray-700 text-center flex flex-col items-center justify-center"
            >
                <p
                    class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                >
                    Updates
                </p>
                <p
                    class="mt-1 text-2xl font-bold text-yellow-600 dark:text-yellow-400"
                >
                    {data.activitySummary.updates}
                </p>
            </Card>
            <Card
                size="md"
                class="px-4 py-3 border border-gray-100 dark:border-gray-700 text-center flex flex-col items-center justify-center"
            >
                <p
                    class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                >
                    Deletes
                </p>
                <p
                    class="mt-1 text-2xl font-bold text-red-600 dark:text-red-400"
                >
                    {data.activitySummary.deletes}
                </p>
            </Card>
            <Card
                size="md"
                class="px-4 py-3 border border-gray-100 dark:border-gray-700 text-center flex flex-col items-center justify-center"
            >
                <p
                    class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                >
                    Rollbacks
                </p>
                <p
                    class="mt-1 text-2xl font-bold text-purple-600 dark:text-purple-400"
                >
                    {data.activitySummary.rollbacks}
                </p>
            </Card>
            <Card
                size="md"
                class="px-4 py-3 border border-gray-100 dark:border-gray-700 text-center flex flex-col items-center justify-center"
            >
                <p
                    class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                >
                    Active Agents
                </p>
                <p
                    class="mt-1 text-2xl font-bold text-green-600 dark:text-green-400"
                >
                    {data.activitySummary.totalAgentsActive}
                </p>
            </Card>
        </div>

        <!-- Recent Audit Events -->
        <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-4">
            Recent Audit Events
        </h3>

        <div
            class="bg-white dark:bg-gray-800 shadow rounded-lg mb-8 overflow-hidden border border-gray-100 dark:border-gray-700"
        >
            <Table
                hoverable={true}
                class="mt-0 ring-0 sm:mt-0 !border-0 mb-0 shadow-none"
            >
                <TableHead>
                    <TableHeadCell>Timestamp</TableHeadCell>
                    <TableHeadCell>Action</TableHeadCell>
                    <TableHeadCell>Entity</TableHeadCell>
                    <TableHeadCell>Agent/User</TableHeadCell>
                </TableHead>
                <TableBody>
                    {#each data.recentEvents as event}
                        <TableBodyRow>
                            <TableBodyCell
                                class="text-gray-500 dark:text-gray-400"
                            >
                                {formatDate(event.createdAt)}
                            </TableBodyCell>
                            <TableBodyCell>
                                {@const actionColor =
                                    event.action === "create"
                                        ? "green"
                                        : event.action === "update"
                                          ? "yellow"
                                          : event.action === "delete"
                                            ? "red"
                                            : event.action === "rollback"
                                              ? "purple"
                                              : "gray"}
                                <Badge color={actionColor} rounded>
                                    {event.action.toUpperCase()}
                                </Badge>
                            </TableBodyCell>
                            <TableBodyCell
                                class="font-medium text-gray-900 dark:text-gray-200"
                            >
                                {event.entityType}
                                <span
                                    class="text-gray-500 dark:text-gray-400 font-normal"
                                    >#{event.entityId}</span
                                >
                            </TableBodyCell>
                            <TableBodyCell
                                class="text-gray-500 dark:text-gray-400"
                            >
                                {event.userId
                                    ? `ID: ${event.userId}`
                                    : "Unknown"}
                            </TableBodyCell>
                        </TableBodyRow>
                    {:else}
                        <TableBodyRow>
                            <TableBodyCell
                                colspan={4}
                                class="text-center text-gray-500 dark:text-gray-400 py-8"
                            >
                                No recent events found.
                            </TableBodyCell>
                        </TableBodyRow>
                    {/each}
                </TableBody>
            </Table>
            <div
                class="bg-gray-50 dark:bg-gray-700/50 px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end"
            >
                <a
                    href="/ui/audit-logs"
                    class="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-500 group flex items-center transition-colors"
                >
                    View all logs
                    <svg
                        class="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M9 5l7 7-7 7"
                        />
                    </svg>
                </a>
            </div>
        </div>
    {/if}
</div>
