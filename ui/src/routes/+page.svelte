<script lang="ts">
    import { fetchApi } from "$lib/api";
    import { onMount } from "svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import ActionBadge from "$lib/components/ActionBadge.svelte";
    import ActorIdentity from "$lib/components/ActorIdentity.svelte";
    import Badge from "$lib/components/ui/Badge.svelte";
    import Surface from "$lib/components/ui/Surface.svelte";
    import {
        Icon,
        Check,
        CircleStack,
        Bolt,
        ChevronRight,
    } from "svelte-hero-icons";

    type RecentEvent = {
        id: number;
        entityType: string;
        entityId: number;
        action: string;
        actorId: string | null;
        actorType: string | null;
        actorSource: string | null;
        userId: number | null;
        createdAt: string;
    };

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
        paymentSummary: {
            settledTotal: number;
            settledCount: number;
            pendingTotal: number;
            pendingCount: number;
        };
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
        recentEvents: RecentEvent[];
        alerts: { type: string; message: string }[];
    };

    let data = $state<DashboardData | null>(null);
    let error = $state<string | null>(null);
    let loading = $state(true);

    onMount(async () => {
        try {
            data = await fetchApi("/supervisors/dashboard");
        } catch (err: any) {
            error = err;
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
    <div class="mb-8">
        <h2
            class="text-[2rem] font-semibold tracking-tight text-gray-900 dark:text-white"
        >
            Supervisor Dashboard
        </h2>
        <p
            class="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400"
        >
            System health, recent activity, and operator signals for the current
            domain.
        </p>
    </div>

    {#if loading}
        <div class="flex justify-center py-16">
            <LoadingSpinner size="xl" />
        </div>
    {:else if error}
        <ErrorBanner
            class="mb-6"
            title="Error loading dashboard"
            {error}
            message={typeof error === "string" ? error : undefined}
            actionLabel="Retry"
            onAction={() => window.location.reload()}
        />
    {:else if data}
        <div class="space-y-10">
            <!-- Alerts -->
            {#if data.alerts && data.alerts.length > 0}
                <div class="space-y-3">
                    {#each data.alerts as alert}
                        <ErrorBanner
                            message={alert.message}
                            class="shadow-sm"
                            title={alert.type === "critical"
                                ? "Critical Alert"
                                : "Attention Needed"}
                        />
                    {/each}
                </div>
            {/if}

            <!-- System Health Strip -->
            <section class="space-y-4">
                <div class="grid grid-cols-1 gap-5 lg:grid-cols-3">
                    <Surface
                        class="flex flex-row items-center justify-between px-5 py-4"
                    >
                        <div>
                            <h3
                                class="text-sm font-medium text-slate-500 dark:text-slate-400"
                            >
                                API Status
                            </h3>
                            <p
                                class="mt-1 text-lg font-semibold capitalize text-gray-900 dark:text-white"
                            >
                                {data.health.api}
                            </p>
                        </div>
                        <div
                            class="flex h-10 w-10 items-center justify-center rounded-full {data
                                .health.api === 'ok'
                                ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300'
                                : 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300'}"
                        >
                            <Icon src={Check} class="h-6 w-6" />
                        </div>
                    </Surface>

                    <Surface
                        class="flex flex-row items-center justify-between px-5 py-4"
                    >
                        <div>
                            <h3
                                class="text-sm font-medium text-slate-500 dark:text-slate-400"
                            >
                                Database
                            </h3>
                            <p
                                class="mt-1 text-lg font-semibold capitalize text-gray-900 dark:text-white"
                            >
                                {data.health.database}
                            </p>
                        </div>
                        <div
                            class="flex h-10 w-10 items-center justify-center rounded-full {data
                                .health.database === 'ok'
                                ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300'
                                : 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300'}"
                        >
                            <Icon src={CircleStack} class="h-6 w-6" />
                        </div>
                    </Surface>

                    <Surface
                        class="flex flex-row items-center justify-between px-5 py-4"
                    >
                        <div>
                            <h3
                                class="text-sm font-medium text-slate-500 dark:text-slate-400"
                            >
                                Rate Limits
                            </h3>
                            <p
                                class="mt-1 text-lg font-semibold capitalize text-gray-900 dark:text-white"
                            >
                                {data.health.rateLimitStatus}
                            </p>
                        </div>
                        <div
                            class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300"
                        >
                            <Icon src={Bolt} class="h-6 w-6" />
                        </div>
                    </Surface>
                </div>
            </section>

            {#if data.paymentSummary}
                <section class="space-y-4">
                    <div>
                        <h3
                            class="text-lg font-medium text-gray-900 dark:text-white"
                        >
                            Payments Overview
                        </h3>
                        <p
                            class="mt-1 text-sm text-slate-500 dark:text-slate-400"
                        >
                            Core L402 settlement activity for this domain,
                            including paid invoices and pending payment
                            challenges.
                        </p>
                    </div>
                    <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
                        <Surface
                            class="flex flex-row items-center justify-between px-5 py-4"
                        >
                            <div>
                                <h3
                                    class="text-sm font-medium text-slate-500 dark:text-slate-400"
                                >
                                    Settled L402 Payments ({data.paymentSummary
                                        .settledCount})
                                </h3>
                                <p
                                    class="mt-1 text-3xl font-bold text-emerald-600 dark:text-emerald-400"
                                >
                                    {data.paymentSummary.settledTotal.toLocaleString()}
                                    <span
                                        class="text-lg font-medium text-slate-500 dark:text-slate-400"
                                        >Sats</span
                                    >
                                </p>
                            </div>
                            <div
                                class="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300"
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
                        </Surface>

                        <Surface
                            class="flex flex-row items-center justify-between px-5 py-4"
                        >
                            <div>
                                <h3
                                    class="text-sm font-medium text-slate-500 dark:text-slate-400"
                                >
                                    Pending L402 Payments ({data.paymentSummary
                                        .pendingCount}
                                    )
                                </h3>
                                <p
                                    class="mt-1 text-3xl font-bold text-amber-600 dark:text-amber-400"
                                >
                                    {data.paymentSummary.pendingTotal.toLocaleString()}
                                    <span
                                        class="text-lg font-medium text-slate-500 dark:text-slate-400"
                                        >Sats</span
                                    >
                                </p>
                            </div>
                            <div
                                class="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300"
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
                        </Surface>
                    </div>
                </section>
            {/if}

            {#if data.experimentalModules.agentRuns && data.agentRunSummary}
                <section class="space-y-4">
                    <div>
                        <h3
                            class="text-lg font-medium text-gray-900 dark:text-white"
                        >
                            Experimental Autonomous Runtime
                        </h3>
                        <p
                            class="mt-1 text-sm text-slate-500 dark:text-slate-400"
                        >
                            Autonomous runs remain incubating. These controls
                            show queue pressure and worker health without making
                            them part of the default operator workflow.
                        </p>
                    </div>
                    <div class="grid grid-cols-1 gap-5 lg:grid-cols-3">
                        <Surface class="px-5 py-4">
                            <div class="flex items-start justify-between gap-4">
                                <div>
                                    <h4
                                        class="text-sm font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
                                    >
                                        Worker
                                    </h4>
                                    <p
                                        class="mt-1 text-xl font-semibold text-gray-900 dark:text-white"
                                    >
                                        {data.agentRunSummary.worker.started
                                            ? data.agentRunSummary.worker
                                                  .sweepInProgress
                                                ? "Running sweep"
                                                : "Active"
                                            : "Stopped"}
                                    </p>
                                </div>
                                <Badge
                                    variant={data.agentRunSummary.worker
                                        .lastError
                                        ? "danger"
                                        : data.agentRunSummary.worker.started
                                          ? "success"
                                          : "muted"}
                                >
                                    {data.agentRunSummary.worker.lastError
                                        ? "Attention"
                                        : data.agentRunSummary.worker.started
                                          ? "Healthy"
                                          : "Offline"}
                                </Badge>
                            </div>
                            <dl
                                class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm text-slate-600 dark:text-slate-300"
                            >
                                <div>
                                    <dt
                                        class="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500"
                                    >
                                        Interval
                                    </dt>
                                    <dd>
                                        {Math.round(
                                            data.agentRunSummary.worker
                                                .intervalMs / 1000,
                                        )}s
                                    </dd>
                                </div>
                                <div>
                                    <dt
                                        class="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500"
                                    >
                                        Batch Size
                                    </dt>
                                    <dd>
                                        {data.agentRunSummary.worker
                                            .maxRunsPerSweep}
                                    </dd>
                                </div>
                                <div>
                                    <dt
                                        class="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500"
                                    >
                                        Last Sweep
                                    </dt>
                                    <dd>
                                        {formatRelativeTime(
                                            data.agentRunSummary.worker
                                                .lastSweepCompletedAt,
                                        )}
                                    </dd>
                                </div>
                                <div>
                                    <dt
                                        class="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500"
                                    >
                                        Total Sweeps
                                    </dt>
                                    <dd>
                                        {data.agentRunSummary.worker
                                            .totalSweeps}
                                    </dd>
                                </div>
                            </dl>
                            {#if data.agentRunSummary.worker.lastError}
                                <p
                                    class="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                                >
                                    {data.agentRunSummary.worker.lastError
                                        .message}
                                </p>
                            {/if}
                        </Surface>

                        <Surface class="px-5 py-4">
                            <h4
                                class="text-sm font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
                            >
                                Queue
                            </h4>
                            <p
                                class="mt-1 text-xl font-semibold text-gray-900 dark:text-white"
                            >
                                {data.agentRunSummary.queue.backlog} open run(s)
                            </p>
                            <div class="mt-4 space-y-3">
                                <div
                                    class="flex items-center justify-between text-sm"
                                >
                                    <span
                                        class="text-slate-500 dark:text-slate-400"
                                        >Waiting approval</span
                                    >
                                    <span
                                        class="font-medium text-gray-900 dark:text-white"
                                    >
                                        {data.agentRunSummary.queue
                                            .waitingApproval}
                                    </span>
                                </div>
                                <div
                                    class="flex items-center justify-between text-sm"
                                >
                                    <span
                                        class="text-slate-500 dark:text-slate-400"
                                        >Currently running</span
                                    >
                                    <span
                                        class="font-medium text-gray-900 dark:text-white"
                                    >
                                        {data.agentRunSummary.queue.running}
                                    </span>
                                </div>
                                <div
                                    class="flex items-center justify-between text-sm"
                                >
                                    <span
                                        class="text-slate-500 dark:text-slate-400"
                                        >24h completed</span
                                    >
                                    <span
                                        class="font-medium text-gray-900 dark:text-white"
                                    >
                                        {data.agentRunSummary.throughput
                                            .completedRuns}
                                    </span>
                                </div>
                            </div>
                        </Surface>

                        <Surface class="px-5 py-4">
                            <h4
                                class="text-sm font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
                            >
                                Execution Outcomes
                            </h4>
                            <div class="mt-4 space-y-3">
                                <div
                                    class="flex items-center justify-between text-sm"
                                >
                                    <span
                                        class="text-slate-500 dark:text-slate-400"
                                        >Review steps succeeded</span
                                    >
                                    <span
                                        class="font-medium text-gray-900 dark:text-white"
                                    >
                                        {data.agentRunSummary.throughput
                                            .reviewActionsSucceeded}
                                    </span>
                                </div>
                                <div
                                    class="flex items-center justify-between text-sm"
                                >
                                    <span
                                        class="text-slate-500 dark:text-slate-400"
                                        >Quality checks succeeded</span
                                    >
                                    <span
                                        class="font-medium text-gray-900 dark:text-white"
                                    >
                                        {data.agentRunSummary.throughput
                                            .qualityChecksSucceeded}
                                    </span>
                                </div>
                                <div
                                    class="flex items-center justify-between text-sm"
                                >
                                    <span
                                        class="text-slate-500 dark:text-slate-400"
                                        >Settled failures</span
                                    >
                                    <span
                                        class="font-medium text-gray-900 dark:text-white"
                                    >
                                        {data.agentRunSummary.failures
                                            .settledFailed}
                                    </span>
                                </div>
                                <div
                                    class="flex items-center justify-between text-sm"
                                >
                                    <span
                                        class="text-slate-500 dark:text-slate-400"
                                        >Policy denials</span
                                    >
                                    <span
                                        class="font-medium text-gray-900 dark:text-white"
                                    >
                                        {data.agentRunSummary.failures
                                            .policyDenied}
                                    </span>
                                </div>
                            </div>
                        </Surface>
                    </div>
                </section>
            {/if}

            <!-- Activity Summary (Last 24h) -->
            <section class="space-y-4">
                <h3 class="text-lg font-medium text-gray-900 dark:text-white">
                    Activity (Last 24h)
                </h3>
                <div
                    class="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-5"
                >
                    <Surface
                        class="flex flex-col items-center justify-center px-4 py-3 text-center"
                    >
                        <p
                            class="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
                        >
                            Creates
                        </p>
                        <p
                            class="mt-1 text-2xl font-bold text-blue-600 dark:text-blue-400"
                        >
                            {data.activitySummary.creates}
                        </p>
                    </Surface>
                    <Surface
                        class="flex flex-col items-center justify-center px-4 py-3 text-center"
                    >
                        <p
                            class="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
                        >
                            Updates
                        </p>
                        <p
                            class="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400"
                        >
                            {data.activitySummary.updates}
                        </p>
                    </Surface>
                    <Surface
                        class="flex flex-col items-center justify-center px-4 py-3 text-center"
                    >
                        <p
                            class="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
                        >
                            Deletes
                        </p>
                        <p
                            class="mt-1 text-2xl font-bold text-rose-600 dark:text-rose-400"
                        >
                            {data.activitySummary.deletes}
                        </p>
                    </Surface>
                    <Surface
                        class="flex flex-col items-center justify-center px-4 py-3 text-center"
                    >
                        <p
                            class="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
                        >
                            Rollbacks
                        </p>
                        <p
                            class="mt-1 text-2xl font-bold text-violet-600 dark:text-violet-400"
                        >
                            {data.activitySummary.rollbacks}
                        </p>
                    </Surface>
                    <Surface
                        class="flex flex-col items-center justify-center px-4 py-3 text-center"
                    >
                        <p
                            class="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
                        >
                            Active Actors
                        </p>
                        <p
                            class="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400"
                        >
                            {data.activitySummary.activeActors}
                        </p>
                    </Surface>
                </div>
            </section>

            <!-- Recent Audit Events -->
            <section class="space-y-4">
                <h3 class="text-lg font-medium text-gray-900 dark:text-white">
                    Recent Audit Events
                </h3>

                <Surface class="overflow-hidden p-0">
                    <div class="overflow-x-auto">
                        <table
                            class="min-w-full divide-y divide-slate-200 dark:divide-slate-700"
                        >
                            <thead class="bg-slate-50/80 dark:bg-slate-900/60">
                                <tr>
                                    <th
                                        class="px-6 py-3 text-left text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                                        >Timestamp</th
                                    >
                                    <th
                                        class="px-6 py-3 text-left text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                                        >Action</th
                                    >
                                    <th
                                        class="px-6 py-3 text-left text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                                        >Entity</th
                                    >
                                    <th
                                        class="px-6 py-3 text-left text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                                        >Actor</th
                                    >
                                </tr>
                            </thead>
                            <tbody
                                class="divide-y divide-slate-200 dark:divide-slate-700"
                            >
                                {#each data.recentEvents as event}
                                    <tr
                                        class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                                    >
                                        <td
                                            class="px-6 py-4 text-sm text-slate-500 dark:text-slate-400"
                                        >
                                            {formatDate(event.createdAt)}
                                        </td>
                                        <td class="px-6 py-4">
                                            <ActionBadge
                                                action={event.action}
                                            />
                                        </td>
                                        <td
                                            class="px-6 py-4 font-medium text-slate-900 dark:text-slate-200"
                                        >
                                            {event.entityType}
                                            <span
                                                class="font-normal text-slate-500 dark:text-slate-400"
                                                >#{event.entityId}</span
                                            >
                                        </td>
                                        <td
                                            class="px-6 py-4 text-slate-500 dark:text-slate-400"
                                        >
                                            <ActorIdentity
                                                actorId={event.actorId}
                                                actorType={event.actorType}
                                                actorSource={event.actorSource}
                                                legacyUserId={event.userId}
                                                compact={true}
                                            />
                                        </td>
                                    </tr>
                                {:else}
                                    <tr>
                                        <td
                                            colspan={4}
                                            class="px-6 py-8 text-center text-slate-500 dark:text-slate-400"
                                        >
                                            No recent events found.
                                        </td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                    <div
                        class="flex justify-end border-t border-slate-200 bg-slate-50/80 px-6 py-3 dark:border-slate-700 dark:bg-slate-900/40"
                    >
                        <a
                            href="/ui/audit-logs"
                            class="group flex items-center text-sm font-medium text-blue-600 transition-colors hover:text-blue-500 dark:text-blue-400"
                        >
                            View all logs
                            <Icon
                                src={ChevronRight}
                                class="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1"
                            />
                        </a>
                    </div>
                </Surface>
            </section>
        </div>
    {/if}
</div>
