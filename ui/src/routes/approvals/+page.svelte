<script lang="ts">
    import { fetchApi, ApiError } from "$lib/api";
    import { onMount } from "svelte";
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import { deepParseJson, formatJson } from "$lib/utils";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import JsonCodeBlock from "$lib/components/JsonCodeBlock.svelte";
    import {
        Icon,
        ArrowPath,
        CheckCircle,
        ChevronLeft,
        Check,
    } from "svelte-hero-icons";

    type ReviewTaskPayload = {
        task: {
            id: number;
            contentItemId: number;
            workflowTransitionId: number;
            status: string;
            assignee: string | null;
            createdAt: string;
            updatedAt: string;
        };
        transition: {
            id: number;
            workflowId: number;
            fromState: string;
            toState: string;
            requiredRoles: string[];
        };
        workflow: {
            id: number;
            name: string;
        };
        contentItem: {
            id: number;
            contentTypeId: number;
            data: any;
            status: string;
            version: number;
            createdAt: string;
            updatedAt: string;
        };
        contentType: {
            id: number;
            name: string;
            slug: string;
        };
    };

    const PRIMARY_LABEL_FIELDS = ["title", "name", "headline", "slug"];
    const SUMMARY_FIELDS = [
        "summary",
        "excerpt",
        "description",
        "content",
        "body",
        "text",
    ];

    let pendingTasks = $state<ReviewTaskPayload[]>([]);
    let loading = $state(true);
    let error = $state<string | null>(null);

    let selectedTask = $state<ReviewTaskPayload | null>(null);
    let processingItem = $state<number | null>(null);
    let selectedTaskQueueIndex = $derived.by(() => {
        const selectedTaskId = selectedTask?.task.id;
        if (selectedTaskId === undefined) {
            return -1;
        }

        return pendingTasks.findIndex(
            (payload) => payload.task.id === selectedTaskId,
        );
    });
    let oldestTask = $derived.by(() =>
        pendingTasks.length === 0
            ? null
            : pendingTasks.reduce((oldest, payload) =>
                  new Date(payload.task.createdAt).getTime() <
                  new Date(oldest.task.createdAt).getTime()
                      ? payload
                      : oldest,
              ),
    );

    onMount(async () => {
        await loadData();
    });

    function parseStructuredData(payload: unknown): Record<string, unknown> | null {
        const parsed = deepParseJson(payload);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return null;
        }
        return parsed as Record<string, unknown>;
    }

    function truncate(value: string, max = 160): string {
        return value.length > max ? `${value.slice(0, max - 1)}…` : value;
    }

    function pickFirstString(
        record: Record<string, unknown> | null,
        keys: string[],
    ): string | null {
        if (!record) return null;

        for (const key of keys) {
            const value = record[key];
            if (typeof value === "string" && value.trim().length > 0) {
                return value.trim();
            }
        }

        return null;
    }

    function formatStatusLabel(status: string): string {
        return status
            .split("_")
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ");
    }

    function formatRelativeDate(value: string): string {
        const timestamp = new Date(value).getTime();
        if (Number.isNaN(timestamp)) {
            return "unknown";
        }

        const deltaHours = Math.floor((Date.now() - timestamp) / 3_600_000);
        if (deltaHours < 1) return "just now";
        if (deltaHours < 24) return `${deltaHours}h ago`;

        const deltaDays = Math.floor(deltaHours / 24);
        if (deltaDays < 7) return `${deltaDays}d ago`;

        return new Date(value).toLocaleDateString();
    }

    function resolveTaskLabel(payload: ReviewTaskPayload): string {
        return (
            pickFirstString(
                parseStructuredData(payload.contentItem.data),
                PRIMARY_LABEL_FIELDS,
            ) ?? `${payload.contentType.name} #${payload.contentItem.id}`
        );
    }

    function resolveTaskSummary(payload: ReviewTaskPayload): string {
        const structured = parseStructuredData(payload.contentItem.data);
        const preferred = pickFirstString(structured, SUMMARY_FIELDS);

        if (preferred) {
            return truncate(preferred, 180);
        }

        return truncate(formatJson(payload.contentItem.data), 180);
    }

    function resolveTaskSlug(payload: ReviewTaskPayload): string | null {
        return pickFirstString(parseStructuredData(payload.contentItem.data), [
            "slug",
        ]);
    }

    function resolveTaskAttribution(payload: ReviewTaskPayload): string | null {
        return pickFirstString(parseStructuredData(payload.contentItem.data), [
            "author",
            "owner",
            "editor",
        ]);
    }

    async function loadData() {
        loading = true;
        error = null;
        try {
            const res = await fetchApi("/review-tasks");
            const nextTasks = res.data as ReviewTaskPayload[];
            const selectedTaskId = selectedTask?.task.id ?? null;
            pendingTasks = nextTasks;
            selectedTask =
                nextTasks.find((payload) => payload.task.id === selectedTaskId) ??
                nextTasks[0] ??
                null;
        } catch (err: any) {
            error = err.message || "Failed to load approval queue";
        } finally {
            loading = false;
        }
    }

    async function processTask(
        payload: ReviewTaskPayload,
        decision: "approved" | "rejected",
    ) {
        feedbackStore.openConfirm({
            title:
                decision === "approved" ? "Approve Content" : "Reject Content",
            message: `Are you sure you want to ${decision === "approved" ? "approve" : "reject"} task #${payload.task.id}? This action cannot be undone.`,
            confirmLabel: decision === "approved" ? "Approve" : "Reject",
            confirmIntent: decision === "approved" ? "primary" : "danger",
            onConfirm: async () => {
                processingItem = payload.task.id;
                try {
                    await fetchApi(`/review-tasks/${payload.task.id}/decide`, {
                        method: "POST",
                        body: JSON.stringify({ decision }),
                    });

                    const remaining = pendingTasks.filter(
                        (t) => t.task.id !== payload.task.id,
                    );
                    pendingTasks = remaining;
                    selectedTask =
                        remaining.find(
                            (candidate) =>
                                candidate.task.id === selectedTask?.task.id,
                        ) ??
                        remaining[0] ??
                        null;

                    feedbackStore.pushToast({
                        severity: "success",
                        title: "Operation Successful",
                        message: `Task #${payload.task.id} has been ${decision}.`,
                    });
                } catch (err: any) {
                    const isApiError = err instanceof ApiError;
                    feedbackStore.pushToast({
                        severity: "error",
                        title: "Operation Failed",
                        message: err.message || `Failed to ${decision} task.`,
                        code: isApiError ? err.code : undefined,
                        remediation: isApiError ? err.remediation : undefined,
                    });
                    throw err; // bubble up for modal loading state to reset natively via the ConfirmDialog try/catch
                } finally {
                    processingItem = null;
                }
            },
        });
    }

    function viewTask(payload: ReviewTaskPayload) {
        selectedTask = payload;
    }
</script>

<svelte:head>
    <title>Approval Queue | WordClaw Supervisor</title>
</svelte:head>

<div class="h-full flex flex-col">
    <div class="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
            <div class="flex items-center gap-3 flex-wrap">
                <h2 class="text-2xl font-bold text-gray-900 dark:text-white">
                    Approval Queue
                </h2>
                {#if pendingTasks.length > 0 && !loading}
                    <span
                        class="inline-flex items-center justify-center bg-red-100 px-2.5 py-1 text-xs font-bold text-red-800 dark:bg-red-900/40 dark:text-red-300 rounded-full"
                        >{pendingTasks.length} pending</span
                    >
                {/if}
                {#if oldestTask && !loading}
                    <span
                        class="inline-flex items-center rounded-full bg-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                    >
                        Oldest {formatRelativeDate(oldestTask.task.createdAt)}
                    </span>
                {/if}
            </div>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Review agent-generated content before it goes live.
            </p>
        </div>
        <button
            onclick={loadData}
            class="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 shadow-sm transition hover:bg-gray-100 hover:text-blue-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            title="Refresh queue"
        >
            <Icon src={ArrowPath} class="w-4 h-4 flex-shrink-0" />
            Refresh Queue
        </button>
    </div>

    {#if error}
        <ErrorBanner class="mb-6 shadow-sm" message={error} />
    {/if}

    <div class="flex-1 grid grid-cols-1 xl:grid-cols-[23rem_minmax(0,1fr)] gap-6 overflow-hidden">
        <section
            class="w-full bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden {selectedTask
                ? 'hidden md:flex'
                : 'flex'}"
        >
            <div
                class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50"
            >
                <div class="flex items-center justify-between gap-3">
                    <div>
                        <h3
                            class="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                        >
                            Pending Review
                        </h3>
                        <p class="mt-1 text-[0.72rem] text-gray-500 dark:text-gray-400">
                            Newest submissions first
                        </p>
                    </div>
                    <span
                        class="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-[0.7rem] font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                    >
                        {pendingTasks.length}
                    </span>
                </div>
            </div>

            <div class="flex-1 overflow-y-auto p-2.5">
                {#if loading}
                    <div class="flex justify-center p-8">
                        <LoadingSpinner size="md" />
                    </div>
                {:else if pendingTasks.length === 0}
                    <div
                        class="text-center p-12 text-gray-500 dark:text-gray-400 flex flex-col items-center"
                    >
                        <Icon
                            src={CheckCircle}
                            class="w-12 h-12 text-gray-300 dark:text-gray-600 mb-4"
                        />
                        <p class="text-sm font-medium">All caught up!</p>
                        <p class="text-xs mt-1">
                            No items require approval right now.
                        </p>
                    </div>
                {:else}
                    <ul class="space-y-2">
                        {#each pendingTasks as payload}
                            <li>
                                <button
                                    onclick={() => viewTask(payload)}
                                    class="w-full text-left rounded-xl border p-3 transition-all {selectedTask
                                        ?.task.id === payload.task.id
                                        ? 'border-blue-400 ring-1 ring-blue-300 bg-blue-50/70 shadow-sm dark:border-blue-600 dark:ring-blue-900/50 dark:bg-blue-900/20'
                                        : 'border-gray-200 bg-white shadow-sm hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600 dark:hover:bg-gray-700/40'}"
                                >
                                    <div class="flex items-start justify-between gap-2">
                                        <div class="min-w-0">
                                            <p
                                                class="truncate text-sm font-semibold text-gray-900 dark:text-white"
                                            >
                                                {resolveTaskLabel(payload)}
                                            </p>
                                            <div
                                                class="mt-1 flex flex-wrap items-center gap-1.5 text-[0.68rem] text-gray-500 dark:text-gray-400"
                                            >
                                                <span>{payload.contentType.name}</span>
                                                <span>•</span>
                                                <span class="font-mono"
                                                    >#{payload.contentItem.id}</span
                                                >
                                                {#if resolveTaskSlug(payload)}
                                                    <span>•</span>
                                                    <span class="font-mono"
                                                        >{resolveTaskSlug(
                                                            payload,
                                                        )}</span
                                                    >
                                                {/if}
                                            </div>
                                        </div>
                                        <span
                                            class="rounded-full bg-gray-100 px-2 py-0.5 text-[0.65rem] font-mono text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                                        >
                                            v{payload.contentItem.version}
                                        </span>
                                    </div>

                                    <div class="mt-2 flex flex-wrap gap-1.5">
                                        <span
                                            class="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-orange-800 dark:bg-orange-900/40 dark:text-orange-400"
                                        >
                                            {formatStatusLabel(
                                                payload.transition.fromState,
                                            )} → {formatStatusLabel(
                                                payload.transition.toState,
                                            )}
                                        </span>
                                        <span
                                            class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[0.65rem] font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                                        >
                                            Current {formatStatusLabel(
                                                payload.contentItem.status,
                                            )}
                                        </span>
                                        {#if resolveTaskAttribution(payload)}
                                            <span
                                                class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[0.65rem] font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                                            >
                                                by {resolveTaskAttribution(
                                                    payload,
                                                )}
                                            </span>
                                        {/if}
                                    </div>

                                    <p
                                        class="mt-2 line-clamp-2 text-xs text-gray-600 dark:text-gray-300"
                                    >
                                        {resolveTaskSummary(payload)}
                                    </p>

                                    <div
                                        class="mt-3 flex items-center justify-between gap-2 text-[0.68rem] text-gray-500 dark:text-gray-400"
                                    >
                                        <span
                                            title={new Date(
                                                payload.task.createdAt,
                                            ).toLocaleString()}
                                        >
                                            Submitted {formatRelativeDate(
                                                payload.task.createdAt,
                                            )}
                                        </span>
                                        <span class="font-mono"
                                            >Task {payload.task.id}</span
                                        >
                                    </div>
                                </button>
                            </li>
                        {/each}
                    </ul>
                {/if}
            </div>
        </section>

        <section
            class="min-w-0 bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden {!selectedTask
                ? 'hidden md:flex'
                : 'flex'}"
        >
            {#if !selectedTask}
                <div
                    class="flex-1 flex items-center justify-center text-gray-400 italic text-sm p-12 text-center"
                >
                    Select an item from the queue to review and approve.
                </div>
            {:else}
                <div
                    class="px-6 py-5 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-br from-gray-50 to-white dark:from-gray-700/60 dark:to-gray-800/90"
                >
                    <div class="flex items-start justify-between gap-4 flex-wrap">
                        <div class="min-w-0">
                            <div class="flex items-center gap-2 flex-wrap">
                                <button
                                    class="md:hidden mr-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                    aria-label="Close review"
                                    onclick={() => (selectedTask = null)}
                                >
                                    <Icon src={ChevronLeft} class="w-6 h-6" />
                                </button>
                                <h3
                                    class="truncate text-xl font-bold text-gray-900 dark:text-white"
                                >
                                    {resolveTaskLabel(selectedTask)}
                                </h3>
                                <span
                                    class="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-800 dark:bg-gray-600 dark:text-gray-300"
                                >
                                    {selectedTask.contentType.name}
                                </span>
                                <span
                                    class="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-[0.7rem] font-bold uppercase tracking-wide text-orange-800 dark:bg-orange-900/40 dark:text-orange-400"
                                >
                                    {formatStatusLabel(
                                        selectedTask.transition.fromState,
                                    )} → {formatStatusLabel(
                                        selectedTask.transition.toState,
                                    )}
                                </span>
                            </div>
                            <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
                                {resolveTaskSummary(selectedTask)}
                            </p>
                            <div
                                class="mt-3 flex flex-wrap items-center gap-2 text-[0.72rem] text-gray-500 dark:text-gray-400"
                            >
                                <span class="font-mono"
                                    >Item #{selectedTask.contentItem.id}</span
                                >
                                <span class="font-mono"
                                    >Task #{selectedTask.task.id}</span
                                >
                                <span class="font-mono"
                                    >v{selectedTask.contentItem.version}</span
                                >
                                <span
                                    >Submitted {formatRelativeDate(
                                        selectedTask.task.createdAt,
                                    )}</span
                                >
                                <span
                                    >Updated {new Date(
                                        selectedTask.task.updatedAt,
                                    ).toLocaleString()}</span
                                >
                            </div>
                        </div>

                        <div class="flex gap-2 shrink-0">
                            <button
                                onclick={() =>
                                    processTask(selectedTask!, "rejected")}
                                disabled={processingItem === selectedTask.task.id}
                                class="px-4 py-2 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 rounded-md transition-colors shadow-sm disabled:opacity-50"
                            >
                                Reject
                            </button>
                            <button
                                onclick={() =>
                                    processTask(selectedTask!, "approved")}
                                disabled={processingItem === selectedTask.task.id}
                                class="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-500 rounded-md transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
                            >
                                {#if processingItem === selectedTask.task.id}
                                    <LoadingSpinner size="sm" color="white" />
                                {:else}
                                    <Icon src={Check} class="w-4 h-4" />
                                {/if}
                                Approve
                            </button>
                        </div>
                    </div>
                </div>

                <div
                    class="flex-1 overflow-y-auto p-5 bg-gray-100 dark:bg-gray-900"
                >
                    <div class="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_19rem]">
                        <div class="space-y-4">
                            <section
                                class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
                            >
                                <div>
                                    <h4
                                        class="text-sm font-semibold text-gray-900 dark:text-white"
                                    >
                                        Current Snapshot
                                    </h4>
                                    <p
                                        class="mt-1 text-xs text-gray-500 dark:text-gray-400"
                                    >
                                        Human-readable fields for fast review before
                                        opening the raw payload.
                                    </p>
                                </div>

                                <dl class="mt-4 grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                                    <div class="md:col-span-2">
                                        <dt
                                            class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                                        >
                                            Primary label
                                        </dt>
                                        <dd class="mt-1 text-gray-900 dark:text-white">
                                            {resolveTaskLabel(selectedTask)}
                                        </dd>
                                    </div>
                                    <div class="md:col-span-2">
                                        <dt
                                            class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                                        >
                                            Summary
                                        </dt>
                                        <dd class="mt-1 text-gray-700 dark:text-gray-300">
                                            {resolveTaskSummary(selectedTask)}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt
                                            class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                                        >
                                            Slug
                                        </dt>
                                        <dd class="mt-1 text-gray-700 dark:text-gray-300">
                                            {resolveTaskSlug(selectedTask) || "—"}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt
                                            class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                                        >
                                            Attribution
                                        </dt>
                                        <dd class="mt-1 text-gray-700 dark:text-gray-300">
                                            {resolveTaskAttribution(selectedTask) || "—"}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt
                                            class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                                        >
                                            Current status
                                        </dt>
                                        <dd class="mt-1 text-gray-700 dark:text-gray-300">
                                            {formatStatusLabel(
                                                selectedTask.contentItem.status,
                                            )}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt
                                            class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                                        >
                                            Content version
                                        </dt>
                                        <dd class="mt-1 text-gray-700 dark:text-gray-300">
                                            v{selectedTask.contentItem.version}
                                        </dd>
                                    </div>
                                </dl>
                            </section>

                            <section
                                class="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 overflow-hidden"
                            >
                                <div class="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                                    <h4
                                        class="text-sm font-semibold text-gray-900 dark:text-white"
                                    >
                                        Payload Data
                                    </h4>
                                    <p
                                        class="mt-1 text-xs text-gray-500 dark:text-gray-400"
                                    >
                                        Raw content submitted for this approval task.
                                    </p>
                                </div>
                                <JsonCodeBlock
                                    value={selectedTask.contentItem.data}
                                    label="Payload JSON"
                                    copyable={true}
                                />
                            </section>
                        </div>

                        <aside class="space-y-4">
                            <section
                                class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
                            >
                                <h4
                                    class="text-sm font-semibold text-gray-900 dark:text-white"
                                >
                                    Decision Context
                                </h4>
                                <dl class="mt-4 space-y-3 text-sm">
                                    <div>
                                        <dt
                                            class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                                        >
                                            Workflow
                                        </dt>
                                        <dd class="mt-1 text-gray-700 dark:text-gray-300">
                                            {selectedTask.workflow.name}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt
                                            class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                                        >
                                            Transition
                                        </dt>
                                        <dd class="mt-1 text-gray-700 dark:text-gray-300">
                                            {formatStatusLabel(
                                                selectedTask.transition.fromState,
                                            )} → {formatStatusLabel(
                                                selectedTask.transition.toState,
                                            )}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt
                                            class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                                        >
                                            Required roles
                                        </dt>
                                        <dd class="mt-1 text-gray-700 dark:text-gray-300">
                                            {selectedTask.transition.requiredRoles
                                                .length > 0
                                                ? selectedTask.transition.requiredRoles.join(
                                                      ", ",
                                                  )
                                                : "No explicit role gate"}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt
                                            class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                                        >
                                            Queue position
                                        </dt>
                                        <dd class="mt-1 text-gray-700 dark:text-gray-300">
                                            {selectedTaskQueueIndex + 1} of
                                            {pendingTasks.length}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt
                                            class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                                        >
                                            Submitted
                                        </dt>
                                        <dd class="mt-1 text-gray-700 dark:text-gray-300">
                                            {new Date(
                                                selectedTask.task.createdAt,
                                            ).toLocaleString()}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt
                                            class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                                        >
                                            Last update
                                        </dt>
                                        <dd class="mt-1 text-gray-700 dark:text-gray-300">
                                            {new Date(
                                                selectedTask.task.updatedAt,
                                            ).toLocaleString()}
                                        </dd>
                                    </div>
                                </dl>
                            </section>

                            <section
                                class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
                            >
                                <h4
                                    class="text-sm font-semibold text-gray-900 dark:text-white"
                                >
                                    Review Focus
                                </h4>
                                <p
                                    class="mt-3 text-sm text-gray-700 dark:text-gray-300"
                                >
                                    Approving this task will move the content from
                                    <strong
                                        class="text-gray-900 dark:text-white"
                                        >{formatStatusLabel(
                                            selectedTask.transition.fromState,
                                        )}</strong
                                    >
                                    to
                                    <strong
                                        class="text-gray-900 dark:text-white"
                                        >{formatStatusLabel(
                                            selectedTask.transition.toState,
                                        )}</strong
                                    >.
                                </p>
                                <p
                                    class="mt-3 text-sm text-gray-600 dark:text-gray-400"
                                >
                                    Reject when the content still needs revision or
                                    should not progress in the workflow yet.
                                </p>
                            </section>
                        </aside>
                    </div>
                </div>
            {/if}
        </section>
    </div>
</div>
