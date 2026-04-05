<script lang="ts">
    import { onMount } from "svelte";
    import { ApiError, fetchApi } from "$lib/api";
    import { formatDateTime, formatRelativeDate } from "$lib/format";
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import DataTable from "$lib/components/DataTable.svelte";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import PageHeader from "$lib/components/ui/PageHeader.svelte";
    import JsonCodeBlock from "$lib/components/JsonCodeBlock.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import Badge from "$lib/components/ui/Badge.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Input from "$lib/components/ui/Input.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import Surface from "$lib/components/ui/Surface.svelte";
    import Textarea from "$lib/components/ui/Textarea.svelte";
    import {
        Icon,
        ArrowPath,
        NoSymbol,
        Plus,
        Clock,
    } from "svelte-hero-icons";

    type JobKind = "content_status_transition" | "outbound_webhook";
    type JobStatus =
        | "queued"
        | "running"
        | "succeeded"
        | "failed"
        | "cancelled";

    type Job = {
        id: number;
        domainId: number;
        kind: JobKind;
        queue: string;
        status: JobStatus;
        payload: Record<string, unknown>;
        result: Record<string, unknown> | null;
        attempts: number;
        maxAttempts: number;
        runAt: string;
        claimedAt: string | null;
        startedAt: string | null;
        completedAt: string | null;
        lastError: string | null;
        createdAt: string;
        updatedAt: string;
    };

    type JobsWorkerStatus = {
        started: boolean;
        sweepInProgress: boolean;
        intervalMs: number;
        maxJobsPerSweep: number;
        lastSweepStartedAt: string | null;
        lastSweepCompletedAt: string | null;
        lastSweepProcessedJobs: number;
        totalSweeps: number;
        totalProcessedJobs: number;
        lastError: {
            message: string;
            at: string;
        } | null;
    };

    const jobColumns = [
        { key: "id", label: "Job" },
        { key: "kind", label: "Kind" },
        { key: "status", label: "Status" },
        { key: "runAt", label: "Run at" },
    ];

    const JOB_KIND_OPTIONS: Array<{ value: JobKind; label: string }> = [
        {
            value: "content_status_transition",
            label: "Content status transition",
        },
        { value: "outbound_webhook", label: "Outbound webhook" },
    ];

    const JOB_STATUS_OPTIONS: Array<{ value: JobStatus; label: string }> = [
        { value: "queued", label: "Queued" },
        { value: "running", label: "Running" },
        { value: "succeeded", label: "Succeeded" },
        { value: "failed", label: "Failed" },
        { value: "cancelled", label: "Cancelled" },
    ];

    let jobs = $state<Job[]>([]);
    let selectedJobId = $state<number | null>(null);
    let selectedJob = $derived(
        jobs.find((job) => job.id === selectedJobId) ?? null,
    );
    let workerStatus = $state<JobsWorkerStatus | null>(null);

    let filterStatus = $state("");
    let filterKind = $state("");

    let createKind = $state<JobKind>("outbound_webhook");
    let createQueue = $state("");
    let createRunAt = $state(defaultLocalDateTime(5));
    let createMaxAttempts = $state("4");
    let createPayloadText = $state(
        JSON.stringify(
            {
                url: "https://example.com/hooks/wordclaw",
                body: {
                    event: "demo",
                    source: "supervisor-ui",
                },
                source: "audit",
            },
            null,
            2,
        ),
    );

    let scheduleContentItemId = $state("");
    let scheduleTargetStatus = $state("published");
    let scheduleRunAt = $state(defaultLocalDateTime(15));
    let scheduleMaxAttempts = $state("3");

    let loading = $state(true);
    let loadingSelection = $state(false);
    let loadingWorkerStatus = $state(false);
    let creatingJob = $state(false);
    let cancellingJob = $state(false);
    let schedulingStatus = $state(false);
    let error = $state<unknown>(null);

    onMount(() => {
        void loadPage();
    });

    function defaultLocalDateTime(minutesAhead: number) {
        const date = new Date(Date.now() + minutesAhead * 60_000);
        const offsetMs = date.getTimezoneOffset() * 60_000;
        return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
    }

    function toIsoDateTime(value: string, label: string) {
        if (!value.trim()) {
            throw new Error(`${label} is required.`);
        }

        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            throw new Error(`${label} must be a valid date-time.`);
        }

        return parsed.toISOString();
    }



    function statusVariant(status: JobStatus) {
        if (status === "succeeded") return "success";
        if (status === "failed" || status === "cancelled") return "danger";
        if (status === "running") return "info";
        return "warning";
    }

    function kindLabel(kind: JobKind) {
        return kind === "content_status_transition"
            ? "Status transition"
            : "Webhook";
    }

    async function loadPage(preferredJobId?: number | null) {
        loading = true;
        error = null;

        try {
            const params = new URLSearchParams();
            if (filterStatus) params.set("status", filterStatus);
            if (filterKind) params.set("kind", filterKind);

            const [jobsResponse, workerResponse] = await Promise.all([
                fetchApi(`/jobs${params.size > 0 ? `?${params.toString()}` : ""}`),
                fetchApi("/jobs/worker-status"),
            ]);

            jobs = (jobsResponse.data as Job[]) ?? [];
            workerStatus = (workerResponse.data as JobsWorkerStatus) ?? null;

            const nextId =
                preferredJobId ?? selectedJobId ?? jobs[0]?.id ?? null;
            if (nextId) {
                await selectJob(nextId);
            } else {
                selectedJobId = null;
            }
        } catch (err) {
            error = err;
        } finally {
            loading = false;
        }
    }

    async function selectJob(id: number) {
        loadingSelection = true;
        error = null;

        try {
            const response = await fetchApi(`/jobs/${id}`);
            const job = response.data as Job;
            selectedJobId = job.id;
            jobs = jobs.map((entry) => (entry.id === job.id ? job : entry));
        } catch (err) {
            error = err;
        } finally {
            loadingSelection = false;
        }
    }

    async function refreshWorkerStatus() {
        loadingWorkerStatus = true;
        try {
            const response = await fetchApi("/jobs/worker-status");
            workerStatus = response.data as JobsWorkerStatus;
        } catch (err) {
            error = err;
        } finally {
            loadingWorkerStatus = false;
        }
    }

    async function createJobFromEditor() {
        creatingJob = true;
        error = null;

        try {
            const payload = JSON.parse(createPayloadText) as Record<
                string,
                unknown
            >;
            const response = await fetchApi("/jobs", {
                method: "POST",
                body: JSON.stringify({
                    kind: createKind,
                    payload,
                    queue: createQueue.trim() || undefined,
                    runAt: toIsoDateTime(createRunAt, "Run at"),
                    maxAttempts: createMaxAttempts.trim()
                        ? Number.parseInt(createMaxAttempts, 10)
                        : undefined,
                }),
            });

            const created = response.data as Job;
            feedbackStore.pushToast({
                severity: "success",
                title: "Job queued",
                message: `Background job #${created.id} is queued for execution.`,
            });
            await loadPage(created.id);
        } catch (err) {
            error = err;
            feedbackStore.pushToast({
                severity: "error",
                title: "Unable to queue job",
                message: err instanceof Error ? err.message : String(err),
                ...(err instanceof ApiError
                    ? {
                          code: err.code,
                          remediation: err.remediation,
                      }
                    : {}),
            });
        } finally {
            creatingJob = false;
        }
    }

    function confirmCancelSelectedJob() {
        if (!selectedJob) {
            return;
        }

        feedbackStore.openConfirm({
            title: "Cancel job",
            message: `Cancel queued job #${selectedJob.id}? Running or completed jobs cannot be cancelled.`,
            confirmLabel: "Cancel job",
            confirmIntent: "danger",
            onConfirm: async () => {
                cancellingJob = true;
                try {
                    const response = await fetchApi(`/jobs/${selectedJob.id}`, {
                        method: "DELETE",
                    });
                    const cancelled = response.data as Job;
                    feedbackStore.pushToast({
                        severity: "success",
                        title: "Job cancelled",
                        message: `Job #${cancelled.id} is now cancelled.`,
                    });
                    await loadPage(cancelled.id);
                } finally {
                    cancellingJob = false;
                }
            },
        });
    }

    async function scheduleStatusTransition() {
        schedulingStatus = true;
        error = null;

        try {
            const contentItemId = Number.parseInt(scheduleContentItemId, 10);
            if (!Number.isInteger(contentItemId) || contentItemId <= 0) {
                throw new Error("Content item ID must be a positive integer.");
            }

            const response = await fetchApi(
                `/content-items/${contentItemId}/schedule-status`,
                {
                    method: "POST",
                    body: JSON.stringify({
                        targetStatus: scheduleTargetStatus.trim(),
                        runAt: toIsoDateTime(scheduleRunAt, "Schedule time"),
                        maxAttempts: scheduleMaxAttempts.trim()
                            ? Number.parseInt(scheduleMaxAttempts, 10)
                            : undefined,
                    }),
                },
            );

            const scheduled = response.data as Job;
            feedbackStore.pushToast({
                severity: "success",
                title: "Status change scheduled",
                message: `Job #${scheduled.id} will update content item #${contentItemId}.`,
            });
            await loadPage(scheduled.id);
        } catch (err) {
            error = err;
            feedbackStore.pushToast({
                severity: "error",
                title: "Unable to schedule status change",
                message: err instanceof Error ? err.message : String(err),
                ...(err instanceof ApiError
                    ? {
                          code: err.code,
                          remediation: err.remediation,
                      }
                    : {}),
            });
        } finally {
            schedulingStatus = false;
        }
    }
</script>

<svelte:head>
    <title>Jobs | WordClaw UI</title>
</svelte:head>

<div class="space-y-6">
    <PageHeader
        eyebrow="Background Jobs"
        title="Scheduled and deferred work"
        description="Inspect worker health, queue webhook deliveries, and schedule content status transitions through the same core jobs runtime."
    >
        {#snippet actions()}
            <Button variant="outline" onclick={() => void loadPage(selectedJobId)}>
                <Icon src={ArrowPath} class="h-4 w-4" />
                Refresh
            </Button>
        {/snippet}
    </PageHeader>

    {#if error}
        <ErrorBanner
            error={error}
            title="Jobs workspace unavailable"
            actionLabel="Retry"
            onAction={() => void loadPage(selectedJobId)}
        />
    {/if}

    {#if loading}
        <div class="flex min-h-[18rem] items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white/70 dark:border-slate-700 dark:bg-slate-900/30">
            <LoadingSpinner size="lg" />
        </div>
    {:else}
        <div class="grid gap-6 xl:grid-cols-[1.05fr_1.25fr]">
            <div class="space-y-6">
                <Surface class="space-y-4">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h2 class="text-lg font-semibold text-slate-900 dark:text-white">
                                Worker health
                            </h2>
                            <p class="text-sm text-slate-500 dark:text-slate-400">
                                Queue sweeps, error state, and recent processing activity.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            disabled={loadingWorkerStatus}
                            onclick={() => void refreshWorkerStatus()}
                        >
                            <Icon src={ArrowPath} class="h-4 w-4" />
                            Refresh worker
                        </Button>
                    </div>

                    {#if workerStatus}
                        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <div class="rounded-2xl border border-slate-200 px-4 py-4 dark:border-slate-700">
                                <p class="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                    Started
                                </p>
                                <div class="mt-2">
                                    <Badge
                                        variant={
                                            workerStatus.started
                                                ? "success"
                                                : "warning"
                                        }
                                    >
                                        {workerStatus.started
                                            ? "Running"
                                            : "Not started"}
                                    </Badge>
                                </div>
                            </div>
                            <div class="rounded-2xl border border-slate-200 px-4 py-4 dark:border-slate-700">
                                <p class="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                    Sweeps
                                </p>
                                <p class="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
                                    {workerStatus.totalSweeps}
                                </p>
                            </div>
                            <div class="rounded-2xl border border-slate-200 px-4 py-4 dark:border-slate-700">
                                <p class="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                    Jobs processed
                                </p>
                                <p class="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
                                    {workerStatus.totalProcessedJobs}
                                </p>
                            </div>
                            <div class="rounded-2xl border border-slate-200 px-4 py-4 dark:border-slate-700">
                                <p class="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                    Last sweep
                                </p>
                                <p class="mt-2 text-sm font-medium text-slate-900 dark:text-white">
                                    {formatDateTime(workerStatus.lastSweepCompletedAt)}
                                </p>
                            </div>
                        </div>

                        <div class="rounded-2xl border border-slate-200 px-4 py-4 dark:border-slate-700">
                            <div class="flex flex-wrap items-center gap-2">
                                <Badge
                                    variant={
                                        workerStatus.sweepInProgress
                                            ? "info"
                                            : "default"
                                    }
                                >
                                    {workerStatus.sweepInProgress
                                        ? "Sweep in progress"
                                        : "Idle"}
                                </Badge>
                                <Badge variant="muted">
                                    Every {Math.round(workerStatus.intervalMs / 1000)}s
                                </Badge>
                                <Badge variant="muted">
                                    Max {workerStatus.maxJobsPerSweep} / sweep
                                </Badge>
                            </div>
                            {#if workerStatus.lastError}
                                <div class="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">
                                    <p class="font-semibold">Last error</p>
                                    <p>{workerStatus.lastError.message}</p>
                                    <p class="mt-1 text-xs opacity-80">
                                        {formatDateTime(workerStatus.lastError.at)}
                                    </p>
                                </div>
                            {/if}
                        </div>
                    {/if}
                </Surface>

                <Surface class="space-y-4">
                    <div class="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 class="text-lg font-semibold text-slate-900 dark:text-white">
                                Queue inventory
                            </h2>
                            <p class="text-sm text-slate-500 dark:text-slate-400">
                                {jobs.length} jobs match the current filters
                            </p>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <Badge variant="warning">
                                {jobs.filter((job) => job.status === "queued").length}
                                queued
                            </Badge>
                            <Badge variant="info">
                                {jobs.filter((job) => job.status === "running").length}
                                running
                            </Badge>
                        </div>
                    </div>

                    <div class="grid gap-4 md:grid-cols-2">
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Filter by status
                            </span>
                            <Select bind:value={filterStatus}>
                                <option value="">All statuses</option>
                                {#each JOB_STATUS_OPTIONS as option}
                                    <option value={option.value}>{option.label}</option>
                                {/each}
                            </Select>
                        </label>
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Filter by kind
                            </span>
                            <Select bind:value={filterKind}>
                                <option value="">All kinds</option>
                                {#each JOB_KIND_OPTIONS as option}
                                    <option value={option.value}>{option.label}</option>
                                {/each}
                            </Select>
                        </label>
                    </div>

                    <div class="flex flex-wrap items-center gap-3">
                        <Button
                            variant="outline"
                            onclick={() => void loadPage(selectedJobId)}
                        >
                            Apply filters
                        </Button>
                    </div>

                    <DataTable
                        columns={jobColumns}
                        data={jobs}
                        keyField="id"
                        onRowClick={(row) => void selectJob(row.id)}
                    >
                        {#snippet cell({ row, column })}
                            {@const job = row as Job}
                            {#if column.key === "id"}
                                <div class="space-y-1">
                                    <div class="flex flex-wrap items-center gap-2">
                                        <span class="font-semibold text-slate-900 dark:text-white">
                                            #{job.id}
                                        </span>
                                        {#if selectedJobId === job.id}
                                            <Badge variant="info">Selected</Badge>
                                        {/if}
                                    </div>
                                    <p class="text-xs text-slate-500 dark:text-slate-400">
                                        {job.queue}
                                    </p>
                                </div>
                            {:else if column.key === "kind"}
                                <div class="space-y-1">
                                    <div class="text-sm text-slate-700 dark:text-slate-200">
                                        {kindLabel(job.kind)}
                                    </div>
                                    <div class="text-xs text-slate-500 dark:text-slate-400">
                                        {job.kind}
                                    </div>
                                </div>
                            {:else if column.key === "status"}
                                <Badge variant={statusVariant(job.status)}>
                                    {job.status}
                                </Badge>
                            {:else if column.key === "runAt"}
                                <div class="space-y-1 text-slate-600 dark:text-slate-300">
                                    <div>{formatRelativeDate(job.runAt)}</div>
                                    <div class="text-xs text-slate-500 dark:text-slate-400">
                                        {formatDateTime(job.runAt)}
                                    </div>
                                </div>
                            {/if}
                        {/snippet}

                        {#snippet empty()}
                            No jobs match the current filters.
                        {/snippet}
                    </DataTable>
                </Surface>
            </div>

            <div class="space-y-6">
                <Surface class="space-y-5">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h2 class="text-lg font-semibold text-slate-900 dark:text-white">
                                Selected job
                            </h2>
                            <p class="text-sm text-slate-500 dark:text-slate-400">
                                Inspect payloads, results, attempts, and queue state.
                            </p>
                        </div>
                        {#if loadingSelection}
                            <LoadingSpinner size="sm" />
                        {/if}
                    </div>

                    {#if selectedJob}
                        <div class="flex flex-wrap items-center gap-2">
                            <Badge variant={statusVariant(selectedJob.status)}>
                                {selectedJob.status}
                            </Badge>
                            <Badge variant="muted">{selectedJob.kind}</Badge>
                            <Badge variant="muted">
                                Attempts {selectedJob.attempts}/{selectedJob.maxAttempts}
                            </Badge>
                        </div>

                        <div class="grid gap-4 md:grid-cols-2">
                            <div class="rounded-2xl border border-slate-200 px-4 py-4 dark:border-slate-700">
                                <p class="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                    Run at
                                </p>
                                <p class="mt-2 text-sm font-medium text-slate-900 dark:text-white">
                                    {formatDateTime(selectedJob.runAt)}
                                </p>
                            </div>
                            <div class="rounded-2xl border border-slate-200 px-4 py-4 dark:border-slate-700">
                                <p class="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                    Completed
                                </p>
                                <p class="mt-2 text-sm font-medium text-slate-900 dark:text-white">
                                    {formatDateTime(selectedJob.completedAt)}
                                </p>
                            </div>
                        </div>

                        {#if selectedJob.lastError}
                            <div class="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">
                                <p class="font-semibold">Last error</p>
                                <p>{selectedJob.lastError}</p>
                            </div>
                        {/if}

                        <JsonCodeBlock
                            value={selectedJob.payload}
                            label="Payload"
                            copyable={true}
                        />

                        {#if selectedJob.result}
                            <JsonCodeBlock
                                value={selectedJob.result}
                                label="Result"
                                copyable={true}
                            />
                        {/if}

                        <div class="flex flex-wrap items-center gap-3">
                            <Button
                                variant="destructive"
                                disabled={
                                    !selectedJob || selectedJob.status !== "queued" || cancellingJob
                                }
                                onclick={confirmCancelSelectedJob}
                            >
                                <Icon src={NoSymbol} class="h-4 w-4" />
                                Cancel queued job
                            </Button>
                        </div>
                    {:else}
                        <div class="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            Select a job from the queue to inspect its payload and result.
                        </div>
                    {/if}
                </Surface>

                <Surface tone="muted" class="space-y-5">
                    <div>
                        <h2 class="text-lg font-semibold text-slate-900 dark:text-white">
                            Queue generic job
                        </h2>
                        <p class="text-sm text-slate-500 dark:text-slate-400">
                            Create a raw background job directly against the core queue.
                        </p>
                    </div>

                    <div class="grid gap-4 md:grid-cols-2">
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Kind
                            </span>
                            <Select bind:value={createKind}>
                                {#each JOB_KIND_OPTIONS as option}
                                    <option value={option.value}>{option.label}</option>
                                {/each}
                            </Select>
                        </label>
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Queue
                            </span>
                            <Input
                                bind:value={createQueue}
                                placeholder="Optional queue override"
                            />
                        </label>
                    </div>

                    <div class="grid gap-4 md:grid-cols-2">
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Run at
                            </span>
                            <Input
                                type="datetime-local"
                                bind:value={createRunAt}
                            />
                        </label>
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Max attempts
                            </span>
                            <Input bind:value={createMaxAttempts} />
                        </label>
                    </div>

                    <label class="space-y-2">
                        <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                            Payload JSON
                        </span>
                        <Textarea bind:value={createPayloadText} rows={12} />
                    </label>

                    <div class="flex flex-wrap items-center gap-3">
                        <Button
                            disabled={creatingJob}
                            onclick={() => void createJobFromEditor()}
                        >
                            <Icon src={Plus} class="h-4 w-4" />
                            Queue job
                        </Button>
                    </div>
                </Surface>

                <Surface tone="muted" class="space-y-5">
                    <div>
                        <h2 class="text-lg font-semibold text-slate-900 dark:text-white">
                            Schedule content status change
                        </h2>
                        <p class="text-sm text-slate-500 dark:text-slate-400">
                            Create a first-class scheduled transition job for a content item.
                        </p>
                    </div>

                    <div class="grid gap-4 md:grid-cols-2">
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Content item ID
                            </span>
                            <Input
                                bind:value={scheduleContentItemId}
                                placeholder="123"
                            />
                        </label>
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Target status
                            </span>
                            <Input
                                bind:value={scheduleTargetStatus}
                                placeholder="published"
                            />
                        </label>
                    </div>

                    <div class="grid gap-4 md:grid-cols-2">
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Schedule time
                            </span>
                            <Input
                                type="datetime-local"
                                bind:value={scheduleRunAt}
                            />
                        </label>
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Max attempts
                            </span>
                            <Input bind:value={scheduleMaxAttempts} />
                        </label>
                    </div>

                    <div class="flex flex-wrap items-center gap-3">
                        <Button
                            disabled={schedulingStatus}
                            onclick={() => void scheduleStatusTransition()}
                        >
                            <Icon src={Clock} class="h-4 w-4" />
                            Schedule transition
                        </Button>
                    </div>
                </Surface>
            </div>
        </div>
    {/if}
</div>
