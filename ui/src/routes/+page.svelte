<script lang="ts">
    import { fetchApi } from "$lib/api";
    import { onMount } from "svelte";

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
            <div
                class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"
            ></div>
        </div>
    {:else if error}
        <div
            class="bg-red-50 dark:bg-red-900/30 border-l-4 border-red-500 p-4 mb-6 rounded"
        >
            <p class="text-sm text-red-700 dark:text-red-400">{error}</p>
            <button
                onclick={() => window.location.reload()}
                class="mt-2 text-sm text-red-700 font-medium hover:underline"
                >Retry</button
            >
        </div>
    {:else if data}
        <!-- Alerts -->
        {#if data.alerts && data.alerts.length > 0}
            <div class="mb-8 space-y-3">
                {#each data.alerts as alert}
                    <div
                        class="p-4 rounded-md flex items-center shadow-sm {alert.type ===
                        'critical'
                            ? 'bg-red-50 border-l-4 border-red-500 text-red-800 dark:bg-red-900/30 dark:text-red-200'
                            : 'bg-yellow-50 border-l-4 border-yellow-400 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200'}"
                    >
                        <svg
                            class="h-5 w-5 mr-3"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                        >
                            <path
                                fill-rule="evenodd"
                                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                                clip-rule="evenodd"
                            />
                        </svg>
                        <span class="text-sm font-medium">{alert.message}</span>
                    </div>
                {/each}
            </div>
        {/if}

        <!-- System Health Strip -->
        <div class="mb-8 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div
                class="bg-white dark:bg-gray-800 rounded-lg shadow px-5 py-4 flex items-center justify-between border border-gray-100 dark:border-gray-700"
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
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M5 13l4 4L19 7"
                        /></svg
                    >
                </div>
            </div>

            <div
                class="bg-white dark:bg-gray-800 rounded-lg shadow px-5 py-4 flex items-center justify-between border border-gray-100 dark:border-gray-700"
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
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
                        /></svg
                    >
                </div>
            </div>

            <div
                class="bg-white dark:bg-gray-800 rounded-lg shadow px-5 py-4 flex items-center justify-between border border-gray-100 dark:border-gray-700"
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
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M13 10V3L4 14h7v7l9-11h-7z"
                        /></svg
                    >
                </div>
            </div>
        </div>

        <!-- Activity Summary (Last 24h) -->
        <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-4">
            Activity (Last 24h)
        </h3>
        <div class="mb-8 grid grid-cols-2 md:grid-cols-5 gap-4">
            <div
                class="bg-white dark:bg-gray-800 rounded-lg shadow px-4 py-3 border border-gray-100 dark:border-gray-700 text-center flex flex-col items-center justify-center"
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
            </div>
            <div
                class="bg-white dark:bg-gray-800 rounded-lg shadow px-4 py-3 border border-gray-100 dark:border-gray-700 text-center flex flex-col items-center justify-center"
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
            </div>
            <div
                class="bg-white dark:bg-gray-800 rounded-lg shadow px-4 py-3 border border-gray-100 dark:border-gray-700 text-center flex flex-col items-center justify-center"
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
            </div>
            <div
                class="bg-white dark:bg-gray-800 rounded-lg shadow px-4 py-3 border border-gray-100 dark:border-gray-700 text-center flex flex-col items-center justify-center"
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
            </div>
            <div
                class="bg-white dark:bg-gray-800 rounded-lg shadow px-4 py-3 border border-gray-100 dark:border-gray-700 text-center flex flex-col items-center justify-center"
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
            </div>
        </div>

        <!-- Recent Audit Events -->
        <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-4">
            Recent Audit Events
        </h3>
        <div
            class="bg-white dark:bg-gray-800 shadow rounded-lg overflow-hidden border border-gray-100 dark:border-gray-700"
        >
            <div class="overflow-x-auto">
                <table
                    class="min-w-full divide-y divide-gray-200 dark:divide-gray-700"
                >
                    <thead class="bg-gray-50 dark:bg-gray-700">
                        <tr>
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
                        class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700"
                    >
                        {#each data.recentEvents as event}
                            <tr
                                class="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                            >
                                <td
                                    class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400"
                                >
                                    {formatDate(event.createdAt)}
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
                                                  : 'bg-gray-100 text-gray-800 dark:bg-gray-300 dark:text-gray-400'}"
                                    >
                                        {event.action.toUpperCase()}
                                    </span>
                                </td>
                                <td
                                    class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-200 font-medium"
                                >
                                    {event.entityType}
                                    <span
                                        class="text-gray-500 dark:text-gray-400 font-normal"
                                        >#{event.entityId}</span
                                    >
                                </td>
                                <td
                                    class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400"
                                >
                                    {event.userId
                                        ? `ID: ${event.userId}`
                                        : "Unknown"}
                                </td>
                            </tr>
                        {:else}
                            <tr>
                                <td
                                    colspan="4"
                                    class="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400"
                                >
                                    No recent events found.
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
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
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M9 5l7 7-7 7"
                        /></svg
                    >
                </a>
            </div>
        </div>
    {/if}
</div>
