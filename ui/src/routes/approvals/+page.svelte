<script lang="ts">
    import { fetchApi, ApiError } from "$lib/api";
    import { onMount } from "svelte";
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import { deepParseJson } from "$lib/utils";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import JsonCodeBlock from "$lib/components/JsonCodeBlock.svelte";
    import Badge from "$lib/components/ui/Badge.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Surface from "$lib/components/ui/Surface.svelte";
    import Textarea from "$lib/components/ui/Textarea.svelte";
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
    let error = $state<any>(null);

    let selectedTask = $state<ReviewTaskPayload | null>(null);
    let processingItem = $state<number | null>(null);
    let decisionReason = $state("");
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

    function parseStructuredData(
        payload: unknown,
    ): Record<string, unknown> | null {
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

    function resolveStatusBadgeVariant(
        status: string,
    ): "muted" | "success" | "warning" | "danger" {
        if (status === "published") return "success";
        if (status === "in_review") return "warning";
        if (status === "rejected" || status === "archived") return "danger";
        return "muted";
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

    function formatAbsoluteDate(value: string): string {
        const timestamp = new Date(value).getTime();
        if (Number.isNaN(timestamp)) {
            return "Unknown";
        }

        return new Date(value).toLocaleString();
    }

    function resolveTaskLabel(payload: ReviewTaskPayload): string {
        return (
            pickFirstString(
                parseStructuredData(payload.contentItem.data),
                PRIMARY_LABEL_FIELDS,
            ) ?? `${payload.contentType.name} #${payload.contentItem.id}`
        );
    }

    function resolveTaskExcerpt(payload: ReviewTaskPayload): string | null {
        const structured = parseStructuredData(payload.contentItem.data);
        const preferred = pickFirstString(structured, SUMMARY_FIELDS);

        if (preferred) {
            return truncate(preferred, 180);
        }

        return null;
    }

    function resolveStructuredFieldCount(
        payload: ReviewTaskPayload,
    ): number | null {
        const structured = parseStructuredData(payload.contentItem.data);
        return structured ? Object.keys(structured).length : null;
    }

    function resolveTaskSummary(payload: ReviewTaskPayload): string {
        const excerpt = resolveTaskExcerpt(payload);
        if (excerpt) {
            return excerpt;
        }

        const fieldCount = resolveStructuredFieldCount(payload);
        if (fieldCount && fieldCount > 0) {
            return `${fieldCount} structured ${fieldCount === 1 ? "field" : "fields"} submitted. Open the payload only if you need the raw content.`;
        }

        return "Review the submitted payload before moving this item through the workflow.";
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
                nextTasks.find(
                    (payload) => payload.task.id === selectedTaskId,
                ) ??
                nextTasks[0] ??
                null;
        } catch (err: any) {
            error = err;
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
                        body: JSON.stringify({
                            decision,
                            reason: decisionReason.trim(),
                        }),
                    });

                    decisionReason = "";

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
        decisionReason = "";
    }

    function handleKeydown(e: KeyboardEvent) {
        if (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement ||
            e.target instanceof HTMLSelectElement
        ) {
            return;
        }

        if (e.key === "j") {
            if (pendingTasks.length > 0) {
                const idx = selectedTaskQueueIndex;
                if (idx < pendingTasks.length - 1) {
                    viewTask(pendingTasks[idx + 1]);
                } else if (idx === -1) {
                    viewTask(pendingTasks[0]);
                }
            }
        } else if (e.key === "k") {
            if (pendingTasks.length > 0) {
                const idx = selectedTaskQueueIndex;
                if (idx > 0) {
                    viewTask(pendingTasks[idx - 1]);
                }
            }
        } else if (e.key === "a" && selectedTask && !processingItem) {
            void processTask(selectedTask, "approved");
        } else if (e.key === "r" && selectedTask && !processingItem) {
            void processTask(selectedTask, "rejected");
        }
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
    <title>Approval Queue | WordClaw Supervisor</title>
</svelte:head>

<div class="h-full flex flex-col">
    <div class="mb-7 flex items-start justify-between gap-4 flex-wrap">
        <div>
            <div class="flex items-center gap-3 flex-wrap">
                <h2
                    class="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white"
                >
                    Approval Queue
                </h2>
            </div>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Review agent-generated content before it goes live.
            </p>
            {#if !loading}
                <div
                    class="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400"
                >
                    <Badge variant="muted">{pendingTasks.length} pending</Badge>
                    {#if oldestTask}
                        <Badge variant="outline"
                            >Oldest {formatRelativeDate(
                                oldestTask.task.createdAt,
                            )}</Badge
                        >
                    {/if}
                </div>
                <div
                    class="mt-2 text-[0.7rem] text-slate-400 dark:text-slate-500"
                >
                    <span class="font-mono">j/k</span> to navigate,
                    <span class="font-mono">a</span>
                    to approve, <span class="font-mono">r</span> to reject
                </div>
            {/if}
        </div>
        <Button variant="outline" onclick={loadData} title="Refresh queue">
            <Icon src={ArrowPath} class="w-4 h-4 flex-shrink-0" />
            Refresh
        </Button>
    </div>

    {#if error}
        <ErrorBanner
            class="mb-6 shadow-sm"
            {error}
            message={typeof error === "string" ? error : undefined}
        />
    {/if}

    <div
        class="flex-1 grid grid-cols-1 xl:grid-cols-[21rem_minmax(0,1fr)] gap-5 overflow-hidden"
    >
        <section
            class="w-full flex flex-col overflow-hidden {selectedTask
                ? 'hidden md:flex'
                : 'flex'}"
        >
            <Surface class="flex h-full flex-col overflow-hidden p-0">
                <div
                    class="border-b border-slate-200/80 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/30"
                >
                    <div class="flex items-center justify-between gap-3">
                        <div>
                            <h3
                                class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                            >
                                Pending Review
                            </h3>
                            <p
                                class="mt-1 text-[0.72rem] text-slate-500 dark:text-slate-400"
                            >
                                Ordered by newest submission
                            </p>
                        </div>
                        <Badge variant="muted">{pendingTasks.length}</Badge>
                    </div>
                </div>

                <div class="flex-1 overflow-y-auto">
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
                        <ul
                            class="divide-y divide-gray-200/80 dark:divide-gray-700"
                        >
                            {#each pendingTasks as payload}
                                <li>
                                    <button
                                        onclick={() => viewTask(payload)}
                                        class="w-full border-l-2 px-4 py-4 text-left transition-colors {selectedTask
                                            ?.task.id === payload.task.id
                                            ? 'border-slate-400 bg-slate-50/80 dark:border-slate-500 dark:bg-slate-800/80'
                                            : 'border-transparent hover:bg-slate-50/80 dark:hover:bg-slate-800/50'}"
                                    >
                                        <div
                                            class="flex items-start justify-between gap-2"
                                        >
                                            <div class="min-w-0">
                                                <p
                                                    class="truncate text-sm font-semibold text-gray-900 dark:text-white"
                                                >
                                                    {resolveTaskLabel(payload)}
                                                </p>
                                                <div
                                                    class="mt-1 flex flex-wrap items-center gap-1.5 text-[0.68rem] text-gray-500 dark:text-gray-400"
                                                >
                                                    <span
                                                        >{payload.contentType
                                                            .name}</span
                                                    >
                                                    <span>•</span>
                                                    <span class="font-mono"
                                                        >#{payload.contentItem
                                                            .id}</span
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
                                                class="text-[0.68rem] font-mono text-gray-400 dark:text-gray-500"
                                            >
                                                v{payload.contentItem.version}
                                            </span>
                                        </div>

                                        <div
                                            class="mt-2 flex flex-wrap items-center gap-2 text-[0.68rem] font-medium uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400"
                                        >
                                            <Badge
                                                variant="outline"
                                                class="uppercase"
                                            >
                                                {formatStatusLabel(
                                                    payload.transition
                                                        .fromState,
                                                )} → {formatStatusLabel(
                                                    payload.transition.toState,
                                                )}
                                            </Badge>
                                            <Badge
                                                variant={resolveStatusBadgeVariant(
                                                    payload.contentItem.status,
                                                )}
                                                class="uppercase"
                                            >
                                                {formatStatusLabel(
                                                    payload.contentItem.status,
                                                )}
                                            </Badge>
                                        </div>

                                        {#if resolveTaskExcerpt(payload)}
                                            <p
                                                class="mt-2 line-clamp-1 text-xs text-gray-500 dark:text-gray-400"
                                            >
                                                {resolveTaskExcerpt(payload)}
                                            </p>
                                        {/if}

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
            </Surface>
        </section>

        <section
            class="min-w-0 flex flex-col overflow-hidden {!selectedTask
                ? 'hidden md:flex'
                : 'flex'}"
        >
            <Surface class="flex h-full flex-col overflow-hidden p-0">
                {#if !selectedTask}
                    <div
                        class="flex-1 flex items-center justify-center text-gray-400 italic text-sm p-12 text-center"
                    >
                        Select an item from the queue to review and approve.
                    </div>
                {:else}
                    <div
                        class="border-b border-slate-200/80 bg-slate-50/85 px-6 py-5 dark:border-slate-700 dark:bg-slate-900/30"
                    >
                        <div
                            class="flex items-start justify-between gap-4 flex-wrap"
                        >
                            <div class="min-w-0">
                                <div class="flex items-center gap-2 flex-wrap">
                                    <button
                                        class="md:hidden mr-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                        aria-label="Close review"
                                        onclick={() => (selectedTask = null)}
                                    >
                                        <Icon
                                            src={ChevronLeft}
                                            class="w-6 h-6"
                                        />
                                    </button>
                                    <p
                                        class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400"
                                    >
                                        Reviewing item #{selectedTask
                                            .contentItem.id}
                                    </p>
                                </div>
                                <h3
                                    class="mt-2 truncate text-2xl font-semibold tracking-tight text-gray-900 dark:text-white"
                                >
                                    {resolveTaskLabel(selectedTask)}
                                </h3>
                                <div
                                    class="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-500 dark:text-gray-400"
                                >
                                    <Badge variant="outline"
                                        >{selectedTask.contentType.name}</Badge
                                    >
                                    <Badge variant="outline">
                                        {formatStatusLabel(
                                            selectedTask.transition.fromState,
                                        )} → {formatStatusLabel(
                                            selectedTask.transition.toState,
                                        )}
                                    </Badge>
                                    <Badge variant="muted"
                                        >Submitted {formatRelativeDate(
                                            selectedTask.task.createdAt,
                                        )}</Badge
                                    >
                                </div>
                            </div>

                            <div class="flex gap-2 shrink-0">
                                <Button
                                    onclick={() =>
                                        processTask(selectedTask!, "rejected")}
                                    disabled={processingItem ===
                                        selectedTask.task.id}
                                    variant="outline"
                                >
                                    Reject
                                </Button>
                                <Button
                                    onclick={() =>
                                        processTask(selectedTask!, "approved")}
                                    disabled={processingItem ===
                                        selectedTask.task.id}
                                    variant="success"
                                >
                                    {#if processingItem === selectedTask.task.id}
                                        <LoadingSpinner
                                            size="sm"
                                            color="white"
                                        />
                                    {:else}
                                        <Icon src={Check} class="w-4 h-4" />
                                    {/if}
                                    Approve
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div
                        class="flex-1 overflow-y-auto bg-slate-50/50 p-5 dark:bg-slate-950/40"
                    >
                        <div class="space-y-4">
                            <div
                                class="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_18rem]"
                            >
                                <Surface tone="subtle" class="rounded-2xl p-5">
                                    <p
                                        class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                                    >
                                        Submission Overview
                                    </p>
                                    <p
                                        class="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300"
                                    >
                                        {resolveTaskSummary(selectedTask)}
                                    </p>

                                    <dl
                                        class="mt-5 grid gap-4 text-sm sm:grid-cols-2"
                                    >
                                        <div>
                                            <dt
                                                class="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                            >
                                                Current Status
                                            </dt>
                                            <dd class="mt-1">
                                                <Badge
                                                    variant={resolveStatusBadgeVariant(
                                                        selectedTask.contentItem
                                                            .status,
                                                    )}
                                                    class="uppercase"
                                                >
                                                    {formatStatusLabel(
                                                        selectedTask.contentItem
                                                            .status,
                                                    )}
                                                </Badge>
                                            </dd>
                                        </div>
                                        <div class="sm:col-span-2">
                                            <label
                                                for="decision-reason"
                                                class="block text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 mb-1"
                                            >
                                                Decision Reason (Optional)
                                            </label>
                                            <Textarea
                                                id="decision-reason"
                                                bind:value={decisionReason}
                                                placeholder="Provide reasoning for approval or rejection..."
                                                rows={2}
                                                class="w-full text-sm"
                                            />
                                        </div>
                                        <div>
                                            <dt
                                                class="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                            >
                                                Content Version
                                            </dt>
                                            <dd
                                                class="mt-1 text-slate-900 dark:text-white"
                                            >
                                                v{selectedTask.contentItem
                                                    .version}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt
                                                class="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                            >
                                                Slug
                                            </dt>
                                            <dd
                                                class="mt-1 text-slate-700 dark:text-slate-300"
                                            >
                                                {resolveTaskSlug(
                                                    selectedTask,
                                                ) || "—"}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt
                                                class="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                            >
                                                Attribution
                                            </dt>
                                            <dd
                                                class="mt-1 text-slate-700 dark:text-slate-300"
                                            >
                                                {resolveTaskAttribution(
                                                    selectedTask,
                                                ) || "—"}
                                            </dd>
                                        </div>
                                    </dl>
                                </Surface>

                                <Surface tone="subtle" class="rounded-2xl p-5">
                                    <p
                                        class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                                    >
                                        Workflow Context
                                    </p>
                                    <dl class="mt-4 space-y-3 text-sm">
                                        <div>
                                            <dt
                                                class="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                            >
                                                Workflow
                                            </dt>
                                            <dd
                                                class="mt-1 text-slate-700 dark:text-slate-300"
                                            >
                                                {selectedTask.workflow.name}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt
                                                class="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                            >
                                                Transition
                                            </dt>
                                            <dd
                                                class="mt-1 text-slate-700 dark:text-slate-300"
                                            >
                                                {formatStatusLabel(
                                                    selectedTask.transition
                                                        .fromState,
                                                )} → {formatStatusLabel(
                                                    selectedTask.transition
                                                        .toState,
                                                )}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt
                                                class="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                            >
                                                Queue Position
                                            </dt>
                                            <dd
                                                class="mt-1 text-slate-700 dark:text-slate-300"
                                            >
                                                {selectedTaskQueueIndex >= 0
                                                    ? selectedTaskQueueIndex + 1
                                                    : 1} of {pendingTasks.length}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt
                                                class="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                            >
                                                Required Roles
                                            </dt>
                                            <dd
                                                class="mt-1 text-slate-700 dark:text-slate-300"
                                            >
                                                {selectedTask.transition
                                                    .requiredRoles.length > 0
                                                    ? selectedTask.transition.requiredRoles.join(
                                                          ", ",
                                                      )
                                                    : "No explicit role gate"}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt
                                                class="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                            >
                                                Submitted
                                            </dt>
                                            <dd
                                                class="mt-1 text-slate-700 dark:text-slate-300"
                                            >
                                                {formatAbsoluteDate(
                                                    selectedTask.task.createdAt,
                                                )}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt
                                                class="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                            >
                                                Last Update
                                            </dt>
                                            <dd
                                                class="mt-1 text-slate-700 dark:text-slate-300"
                                            >
                                                {formatAbsoluteDate(
                                                    selectedTask.task.updatedAt,
                                                )}
                                            </dd>
                                        </div>
                                    </dl>

                                    <div
                                        class="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300"
                                    >
                                        Approve to move this item from
                                        <span
                                            class="font-medium text-slate-900 dark:text-white"
                                        >
                                            {formatStatusLabel(
                                                selectedTask.transition
                                                    .fromState,
                                            )}
                                        </span>
                                        to
                                        <span
                                            class="font-medium text-slate-900 dark:text-white"
                                        >
                                            {formatStatusLabel(
                                                selectedTask.transition.toState,
                                            )}
                                        </span>.
                                    </div>
                                </Surface>
                            </div>

                            <Surface class="overflow-hidden rounded-2xl p-0">
                                <div
                                    class="border-b border-slate-200 px-5 py-3 dark:border-slate-700"
                                >
                                    <h4
                                        class="text-sm font-semibold text-gray-900 dark:text-white"
                                    >
                                        Payload
                                    </h4>
                                    <p
                                        class="mt-1 text-xs text-gray-500 dark:text-gray-400"
                                    >
                                        Open the raw structured submission only
                                        when you need the full detail.
                                    </p>
                                </div>
                                <JsonCodeBlock
                                    value={selectedTask.contentItem.data}
                                    label="Payload JSON"
                                    copyable={true}
                                />
                            </Surface>
                        </div>
                    </div>
                {/if}
            </Surface>
        </section>
    </div>
</div>
