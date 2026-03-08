<script lang="ts">
    import { fetchApi } from "$lib/api";
    import { onMount } from "svelte";
    import {
        Alert,
        Card,
        Table,
        TableBody,
        TableBodyCell,
        TableBodyRow,
        TableHead,
        TableHeadCell,
    } from "flowbite-svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import ActionBadge from "$lib/components/ActionBadge.svelte";
    import {
        Icon,
        Check,
        CircleStack,
        Bolt,
        ChevronRight,
    } from "svelte-hero-icons";

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
            activeActors: number;
        };
        experimentalModules: {
            revenue: boolean;
            agentRuns: boolean;
        };
        earningsSummary: {
            total: number;
            pending: number;
            pendingCount: number;
        } | null;
        agentRunSummary: {
            queue: {
                backlog: number;
                waitingApproval: number;
                running: number;
            };
            throughput: {
                completedRuns: number;
                reviewActionsSucceeded: number;
                qualityChecksSucceeded: number;
            };
            failures: {
                settledFailed: number;
                policyDenied: number;
            };
            worker: {
                started: boolean;
                sweepInProgress: boolean;
                intervalMs: number;
                maxRunsPerSweep: number;
                lastSweepCompletedAt: string | null;
                totalSweeps: number;
                lastError: {
                    message: string;
                    at: string;
                } | null;
            };
        } | null;
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

    function formatRelativeTime(dateString: string | null) {
        if (!dateString) return "No sweep yet";
        const diffMs = Date.now() - new Date(dateString).getTime();
        const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
        if (diffMinutes < 1) return "Just now";
        if (diffMinutes < 60) return `${diffMinutes}m ago`;
        const diffHours = Math.round(diffMinutes / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        const diffDays = Math.round(diffHours / 24);
        return `${diffDays}d ago`;
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
            <LoadingSpinner size="xl" />
        </div>
    {:else if error}
        <ErrorBanner
            class="mb-6"
            title="Error loading dashboard"
            message={error}
            actionLabel="Retry"
            onAction={() => window.location.reload()}
        />
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
                    <Icon src={Check} class="h-6 w-6" />
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
                    <Icon src={CircleStack} class="h-6 w-6" />
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
                    <Icon src={Bolt} class="h-6 w-6" />
                </div>
            </Card>
        </div>

        {#if data.experimentalModules.revenue && data.earningsSummary}
            <!-- Experimental Revenue Summary -->
            <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-4">
                Experimental Revenue Summary
            </h3>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
                These payout-oriented metrics remain available for operator
                review, but they are not part of the default supported
                WordClaw product path.
            </p>
            <div class="mb-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Card
                    size="md"
                    class="px-5 py-4 border border-gray-100 dark:border-gray-700 flex flex-row items-center justify-between"
                >
                    <div>
                        <h3
                            class="text-sm font-medium text-gray-500 dark:text-gray-400"
                        >
                            Recorded Revenue
                        </h3>
                        <p
                            class="mt-1 text-3xl font-bold text-green-600 dark:text-green-400"
                        >
                            {data.earningsSummary.total.toLocaleString()}
                            <span
                                class="text-lg font-medium text-gray-500 dark:text-gray-400"
                                >Sats</span
                            >
                        </p>
                    </div>
                    <div
                        class="h-12 w-12 rounded-full flex items-center justify-center bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400"
                    >
                        <svg
                            class="w-7 h-7"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            xmlns="http://www.w3.org/2000/svg"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                            ></path></svg
                        >
                    </div>
                </Card>

                <Card
                    size="md"
                    class="px-5 py-4 border border-gray-100 dark:border-gray-700 flex flex-row items-center justify-between"
                >
                    <div>
                        <h3
                            class="text-sm font-medium text-gray-500 dark:text-gray-400"
                        >
                            Pending L402 Payments ({data.earningsSummary.pendingCount}
                            )
                        </h3>
                        <p
                            class="mt-1 text-3xl font-bold text-yellow-600 dark:text-yellow-400"
                        >
                            {data.earningsSummary.pending.toLocaleString()}
                            <span
                                class="text-lg font-medium text-gray-500 dark:text-gray-400"
                                >Sats</span
                            >
                        </p>
                    </div>
                    <div
                        class="h-12 w-12 rounded-full flex items-center justify-center bg-yellow-100 text-yellow-600 dark:bg-yellow-900/40 dark:text-yellow-400"
                    >
                        <svg
                            class="w-7 h-7"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            xmlns="http://www.w3.org/2000/svg"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                            ></path></svg
                        >
                    </div>
                </Card>
            </div>
        {/if}

        {#if data.experimentalModules.agentRuns && data.agentRunSummary}
            <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Experimental Autonomous Runtime
            </h3>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Autonomous runs remain incubating. These controls show queue
                pressure and worker health without making them part of the
                default operator workflow.
            </p>
            <div class="mb-8 grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card
                    size="md"
                    class="px-5 py-4 border border-gray-100 dark:border-gray-700"
                >
                    <div class="flex items-start justify-between gap-4">
                        <div>
                            <h4
                                class="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                            >
                                Worker
                            </h4>
                            <p
                                class="mt-1 text-xl font-semibold text-gray-900 dark:text-white"
                            >
                                {data.agentRunSummary.worker.started
                                    ? data.agentRunSummary.worker.sweepInProgress
                                        ? "Running sweep"
                                        : "Active"
                                    : "Stopped"}
                            </p>
                        </div>
                        <span
                            class={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                                data.agentRunSummary.worker.lastError
                                    ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                                    : data.agentRunSummary.worker.started
                                      ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                                      : "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                            }`}
                        >
                            {data.agentRunSummary.worker.lastError
                                ? "Attention"
                                : data.agentRunSummary.worker.started
                                  ? "Healthy"
                                  : "Offline"}
                        </span>
                    </div>
                    <dl
                        class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm text-gray-600 dark:text-gray-300"
                    >
                        <div>
                            <dt class="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
                                Interval
                            </dt>
                            <dd>{Math.round(
                                data.agentRunSummary.worker.intervalMs / 1000,
                            )}s</dd>
                        </div>
                        <div>
                            <dt class="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
                                Batch Size
                            </dt>
                            <dd>{data.agentRunSummary.worker.maxRunsPerSweep}</dd>
                        </div>
                        <div>
                            <dt class="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
                                Last Sweep
                            </dt>
                            <dd>{formatRelativeTime(
                                data.agentRunSummary.worker.lastSweepCompletedAt,
                            )}</dd>
                        </div>
                        <div>
                            <dt class="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
                                Total Sweeps
                            </dt>
                            <dd>{data.agentRunSummary.worker.totalSweeps}</dd>
                        </div>
                    </dl>
                    {#if data.agentRunSummary.worker.lastError}
                        <p
                            class="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
                        >
                            {data.agentRunSummary.worker.lastError.message}
                        </p>
                    {/if}
                </Card>

                <Card
                    size="md"
                    class="px-5 py-4 border border-gray-100 dark:border-gray-700"
                >
                    <h4
                        class="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                    >
                        Queue
                    </h4>
                    <p class="mt-1 text-xl font-semibold text-gray-900 dark:text-white">
                        {data.agentRunSummary.queue.backlog} open run(s)
                    </p>
                    <div class="mt-4 space-y-3">
                        <div class="flex items-center justify-between text-sm">
                            <span class="text-gray-500 dark:text-gray-400">Waiting approval</span>
                            <span class="font-medium text-gray-900 dark:text-white">
                                {data.agentRunSummary.queue.waitingApproval}
                            </span>
                        </div>
                        <div class="flex items-center justify-between text-sm">
                            <span class="text-gray-500 dark:text-gray-400">Currently running</span>
                            <span class="font-medium text-gray-900 dark:text-white">
                                {data.agentRunSummary.queue.running}
                            </span>
                        </div>
                        <div class="flex items-center justify-between text-sm">
                            <span class="text-gray-500 dark:text-gray-400">24h completed</span>
                            <span class="font-medium text-gray-900 dark:text-white">
                                {data.agentRunSummary.throughput.completedRuns}
                            </span>
                        </div>
                    </div>
                </Card>

                <Card
                    size="md"
                    class="px-5 py-4 border border-gray-100 dark:border-gray-700"
                >
                    <h4
                        class="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                    >
                        Execution Outcomes
                    </h4>
                    <div class="mt-4 space-y-3">
                        <div class="flex items-center justify-between text-sm">
                            <span class="text-gray-500 dark:text-gray-400">Review steps succeeded</span>
                            <span class="font-medium text-gray-900 dark:text-white">
                                {data.agentRunSummary.throughput.reviewActionsSucceeded}
                            </span>
                        </div>
                        <div class="flex items-center justify-between text-sm">
                            <span class="text-gray-500 dark:text-gray-400">Quality checks succeeded</span>
                            <span class="font-medium text-gray-900 dark:text-white">
                                {data.agentRunSummary.throughput.qualityChecksSucceeded}
                            </span>
                        </div>
                        <div class="flex items-center justify-between text-sm">
                            <span class="text-gray-500 dark:text-gray-400">Settled failures</span>
                            <span class="font-medium text-gray-900 dark:text-white">
                                {data.agentRunSummary.failures.settledFailed}
                            </span>
                        </div>
                        <div class="flex items-center justify-between text-sm">
                            <span class="text-gray-500 dark:text-gray-400">Policy denials</span>
                            <span class="font-medium text-gray-900 dark:text-white">
                                {data.agentRunSummary.failures.policyDenied}
                            </span>
                        </div>
                    </div>
                </Card>
            </div>
        {/if}

        <!-- Activity Summary (Last 24h) -->
        <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-4">
            Activity (Last 24h)
        </h3>
        <div
            class="mb-8 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4"
        >
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
                    Active Actors
                </p>
                <p
                    class="mt-1 text-2xl font-bold text-green-600 dark:text-green-400"
                >
                    {data.activitySummary.activeActors}
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
                    <TableHeadCell>Actor</TableHeadCell>
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
                                <ActionBadge action={event.action} />
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
                    <Icon
                        src={ChevronRight}
                        class="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1"
                    />
                </a>
            </div>
        </div>
    {/if}
</div>
