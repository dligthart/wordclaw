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

    let healthItems = $derived(
        data
            ? [
                  { label: "API", value: data.health.api, icon: Check, ok: data.health.api === "ok" },
                  { label: "Database", value: data.health.database, icon: CircleStack, ok: data.health.database === "ok" },
                  { label: "Rate Limits", value: data.health.rateLimitStatus, icon: Bolt, ok: true },
              ]
            : [],
    );

    let activityStats = $derived(
        data
            ? [
                  { label: "Creates", value: data.activitySummary.creates, color: "text-blue-600 dark:text-blue-400" },
                  { label: "Updates", value: data.activitySummary.updates, color: "text-amber-600 dark:text-amber-400" },
                  { label: "Deletes", value: data.activitySummary.deletes, color: "text-rose-600 dark:text-rose-400" },
                  { label: "Rollbacks", value: data.activitySummary.rollbacks, color: "text-violet-600 dark:text-violet-400" },
                  { label: "Actors", value: data.activitySummary.activeActors, color: "text-emerald-600 dark:text-emerald-400" },
              ]
            : [],
    );

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
    <div class="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <h2
            class="text-xl font-semibold tracking-tight text-gray-900 dark:text-white"
        >
            Supervisor Dashboard
        </h2>
        <p class="text-sm text-slate-500 dark:text-slate-400">
            System health, activity, and operator signals
        </p>
    </div>

    {#if loading}
        <div class="flex justify-center py-16">
            <LoadingSpinner size="xl" />
        </div>
    {:else if error}
        <ErrorBanner
            class="mb-4"
            title="Error loading dashboard"
            {error}
            message={typeof error === "string" ? error : undefined}
            actionLabel="Retry"
            onAction={() => window.location.reload()}
        />
    {:else if data}
        <div class="space-y-6">
            <!-- Alerts -->
            {#if data.alerts && data.alerts.length > 0}
                <div class="space-y-2">
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

            <!-- Health + Activity row -->
            <section class="grid gap-4 lg:grid-cols-[1fr_1fr]">
                <!-- Health strip -->
                <Surface class="p-0">
                    <div class="flex divide-x divide-slate-200 dark:divide-slate-700">
                        {#each healthItems as item}
                            <div class="flex flex-1 items-center gap-3 px-4 py-3">
                                <div
                                    class={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.ok ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300"}`}
                                >
                                    <Icon src={item.icon} class="h-4 w-4" />
                                </div>
                                <div class="min-w-0">
                                    <p class="text-[0.65rem] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">{item.label}</p>
                                    <p class="text-sm font-semibold capitalize text-slate-900 dark:text-white">{item.value}</p>
                                </div>
                            </div>
                        {/each}
                    </div>
                </Surface>

                <!-- Activity stats strip -->
                <Surface class="p-0">
                    <div class="flex divide-x divide-slate-200 dark:divide-slate-700">
                        {#each activityStats as stat}
                            <div class="flex flex-1 flex-col items-center justify-center px-2 py-3">
                                <p class="text-[0.6rem] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">{stat.label}</p>
                                <p class={`text-lg font-bold ${stat.color}`}>{stat.value}</p>
                            </div>
                        {/each}
                    </div>
                </Surface>
            </section>

            {#if data.paymentSummary}
                <!-- Payments row -->
                <section>
                    <div class="grid gap-4 sm:grid-cols-2">
                        <Surface class="flex items-center justify-between px-4 py-3">
                            <div>
                                <p class="text-[0.65rem] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                    Settled L402 ({data.paymentSummary.settledCount})
                                </p>
                                <p class="mt-0.5 text-xl font-bold text-emerald-600 dark:text-emerald-400">
                                    {data.paymentSummary.settledTotal.toLocaleString()}
                                    <span class="text-sm font-medium text-slate-400 dark:text-slate-500">Sats</span>
                                </p>
                            </div>
                            <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300">
                                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            </div>
                        </Surface>

                        <Surface class="flex items-center justify-between px-4 py-3">
                            <div>
                                <p class="text-[0.65rem] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                    Pending L402 ({data.paymentSummary.pendingCount})
                                </p>
                                <p class="mt-0.5 text-xl font-bold text-amber-600 dark:text-amber-400">
                                    {data.paymentSummary.pendingTotal.toLocaleString()}
                                    <span class="text-sm font-medium text-slate-400 dark:text-slate-500">Sats</span>
                                </p>
                            </div>
                            <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300">
                                <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            </div>
                        </Surface>
                    </div>
                </section>
            {/if}

            {#if data.experimentalModules.agentRuns && data.agentRunSummary}
                <!-- Experimental Runtime (collapsible) -->
                <section>
                    <details class="group">
                        <summary class="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white [&::-webkit-details-marker]:hidden">
                            <svg class="h-3.5 w-3.5 transition-transform group-open:rotate-90" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd"/></svg>
                            Autonomous Runtime
                            <Badge variant={data.agentRunSummary.worker.lastError ? "danger" : data.agentRunSummary.worker.started ? "success" : "muted"}>
                                {data.agentRunSummary.worker.lastError ? "Attention" : data.agentRunSummary.worker.started ? "Healthy" : "Offline"}
                            </Badge>
                        </summary>
                        <div class="mt-3 grid gap-4 lg:grid-cols-3">
                            <Surface class="px-4 py-3">
                                <p class="text-[0.65rem] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">Worker</p>
                                <p class="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                                    {data.agentRunSummary.worker.started ? (data.agentRunSummary.worker.sweepInProgress ? "Running sweep" : "Active") : "Stopped"}
                                </p>
                                <dl class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                                    <div><dt class="text-[0.6rem] uppercase tracking-wider text-slate-400 dark:text-slate-500">Interval</dt><dd>{Math.round(data.agentRunSummary.worker.intervalMs / 1000)}s</dd></div>
                                    <div><dt class="text-[0.6rem] uppercase tracking-wider text-slate-400 dark:text-slate-500">Batch Size</dt><dd>{data.agentRunSummary.worker.maxRunsPerSweep}</dd></div>
                                    <div><dt class="text-[0.6rem] uppercase tracking-wider text-slate-400 dark:text-slate-500">Last Sweep</dt><dd>{formatRelativeTime(data.agentRunSummary.worker.lastSweepCompletedAt)}</dd></div>
                                    <div><dt class="text-[0.6rem] uppercase tracking-wider text-slate-400 dark:text-slate-500">Total Sweeps</dt><dd>{data.agentRunSummary.worker.totalSweeps}</dd></div>
                                </dl>
                                {#if data.agentRunSummary.worker.lastError}
                                    <p class="mt-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                                        {data.agentRunSummary.worker.lastError.message}
                                    </p>
                                {/if}
                            </Surface>

                            <Surface class="px-4 py-3">
                                <p class="text-[0.65rem] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">Queue</p>
                                <p class="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{data.agentRunSummary.queue.backlog} open run(s)</p>
                                <div class="mt-2 space-y-1.5">
                                    <div class="flex items-center justify-between text-xs"><span class="text-slate-500 dark:text-slate-400">Waiting approval</span><span class="font-medium text-slate-900 dark:text-white">{data.agentRunSummary.queue.waitingApproval}</span></div>
                                    <div class="flex items-center justify-between text-xs"><span class="text-slate-500 dark:text-slate-400">Currently running</span><span class="font-medium text-slate-900 dark:text-white">{data.agentRunSummary.queue.running}</span></div>
                                    <div class="flex items-center justify-between text-xs"><span class="text-slate-500 dark:text-slate-400">24h completed</span><span class="font-medium text-slate-900 dark:text-white">{data.agentRunSummary.throughput.completedRuns}</span></div>
                                </div>
                            </Surface>

                            <Surface class="px-4 py-3">
                                <p class="text-[0.65rem] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">Execution Outcomes</p>
                                <div class="mt-2 space-y-1.5">
                                    <div class="flex items-center justify-between text-xs"><span class="text-slate-500 dark:text-slate-400">Review steps OK</span><span class="font-medium text-slate-900 dark:text-white">{data.agentRunSummary.throughput.reviewActionsSucceeded}</span></div>
                                    <div class="flex items-center justify-between text-xs"><span class="text-slate-500 dark:text-slate-400">Quality checks OK</span><span class="font-medium text-slate-900 dark:text-white">{data.agentRunSummary.throughput.qualityChecksSucceeded}</span></div>
                                    <div class="flex items-center justify-between text-xs"><span class="text-slate-500 dark:text-slate-400">Settled failures</span><span class="font-medium text-slate-900 dark:text-white">{data.agentRunSummary.failures.settledFailed}</span></div>
                                    <div class="flex items-center justify-between text-xs"><span class="text-slate-500 dark:text-slate-400">Policy denials</span><span class="font-medium text-slate-900 dark:text-white">{data.agentRunSummary.failures.policyDenied}</span></div>
                                </div>
                            </Surface>
                        </div>
                    </details>
                </section>
            {/if}

            <!-- Recent Audit Events -->
            <section>
                <Surface class="overflow-hidden p-0">
                    <div class="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900/60">
                        <h3 class="text-sm font-medium text-slate-900 dark:text-white">Recent Audit Events</h3>
                        <a
                            href="/ui/audit-logs"
                            class="group flex items-center text-xs font-medium text-blue-600 transition-colors hover:text-blue-500 dark:text-blue-400"
                        >
                            View all
                            <Icon src={ChevronRight} class="ml-0.5 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                        </a>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                            <thead class="bg-slate-50/40 dark:bg-slate-900/30">
                                <tr>
                                    <th class="px-4 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Timestamp</th>
                                    <th class="px-4 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Action</th>
                                    <th class="px-4 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Entity</th>
                                    <th class="px-4 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Actor</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-200 dark:divide-slate-700">
                                {#each data.recentEvents as event}
                                    <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                                        <td class="px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                                            {formatDate(event.createdAt)}
                                        </td>
                                        <td class="px-4 py-2.5">
                                            <ActionBadge action={event.action} />
                                        </td>
                                        <td class="px-4 py-2.5 text-sm font-medium text-slate-900 dark:text-slate-200">
                                            {event.entityType}
                                            <span class="font-normal text-slate-500 dark:text-slate-400">#{event.entityId}</span>
                                        </td>
                                        <td class="px-4 py-2.5 text-slate-500 dark:text-slate-400">
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
                                        <td colspan={4} class="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                                            No recent events found.
                                        </td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                </Surface>
            </section>
        </div>
    {/if}
</div>

