<script lang="ts">
    import { fetchApi, ApiError } from "$lib/api";
    import { onMount } from "svelte";
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import { deepParseJson } from "$lib/utils";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import JsonCodeBlock from "$lib/components/JsonCodeBlock.svelte";
    import ActorIdentity from "$lib/components/ActorIdentity.svelte";
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
            assigneeActorId: string | null;
            assigneeActorType: string | null;
            assigneeActorSource: string | null;
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

    type ContentItemVersionPayload = {
        id: number;
        version: number;
        data: string;
        status: string;
        createdAt: string;
    };

    type ReviewCommentPayload = {
        id: number;
        authorId: string;
        authorActorId: string | null;
        authorActorType: string | null;
        authorActorSource: string | null;
        comment: string;
        createdAt: string;
    };

    type DiffEntry = {
        key: string;
        before: string;
        after: string;
        change: "added" | "removed" | "changed";
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
    const AI_REVISION_COMMENT_PREFIX = "AI revision requested: ";

    let pendingTasks = $state<ReviewTaskPayload[]>([]);
    let loading = $state(true);
    let error = $state<any>(null);

    let selectedTask = $state<ReviewTaskPayload | null>(null);
    let processingItem = $state<number | null>(null);
    let revisingItem = $state<number | null>(null);
    let decisionReason = $state("");
    let revisionPrompt = $state("");
    let selectedTaskVersions = $state<ContentItemVersionPayload[]>([]);
    let selectedTaskComments = $state<ReviewCommentPayload[]>([]);
    let revisionContextLoading = $state(false);
    let revisionContextError = $state<string | null>(null);
    let revisionContextRequestId = 0;
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

    $effect(() => {
        const contentItemId = selectedTask?.contentItem.id ?? null;
        const contentVersion = selectedTask?.contentItem.version ?? null;

        if (!contentItemId || !contentVersion) {
            selectedTaskVersions = [];
            selectedTaskComments = [];
            revisionContextError = null;
            revisionContextLoading = false;
            return;
        }

        void loadSelectedTaskRevisionContext(contentItemId);
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

    function stringifyPreview(value: unknown, max = 80): string {
        if (value === null) return "null";
        if (value === undefined) return "—";
        if (typeof value === "string") return truncate(value, max);
        if (typeof value === "number" || typeof value === "boolean") {
            return String(value);
        }

        try {
            return truncate(JSON.stringify(value), max);
        } catch {
            return truncate(String(value), max);
        }
    }

    function flattenValue(
        value: unknown,
        prefix = "",
        output = new Map<string, string>(),
    ): Map<string, string> {
        if (Array.isArray(value)) {
            output.set(prefix || "(root)", stringifyPreview(value, 120));
            return output;
        }

        if (value && typeof value === "object") {
            const entries = Object.entries(value as Record<string, unknown>);
            if (entries.length === 0) {
                output.set(prefix || "(root)", "{}");
                return output;
            }

            for (const [key, child] of entries) {
                const nextPrefix = prefix ? `${prefix}.${key}` : key;
                flattenValue(child, nextPrefix, output);
            }

            return output;
        }

        output.set(prefix || "(root)", stringifyPreview(value, 120));
        return output;
    }

    function buildDiffEntries(
        previousPayload: unknown,
        currentPayload: unknown,
        previousStatus?: string,
        currentStatus?: string,
    ): DiffEntry[] {
        const previous = flattenValue(deepParseJson(previousPayload));
        const current = flattenValue(deepParseJson(currentPayload));
        const keys = new Set([...previous.keys(), ...current.keys()]);
        const entries: DiffEntry[] = [];

        if (
            previousStatus &&
            currentStatus &&
            previousStatus !== currentStatus
        ) {
            entries.push({
                key: "status",
                before: previousStatus,
                after: currentStatus,
                change: "changed",
            });
        }

        for (const key of Array.from(keys).sort()) {
            const before = previous.get(key);
            const after = current.get(key);
            if (before === after) {
                continue;
            }

            entries.push({
                key,
                before: before ?? "—",
                after: after ?? "—",
                change:
                    before === undefined
                        ? "added"
                        : after === undefined
                          ? "removed"
                          : "changed",
            });
        }

        return entries;
    }

    function resolveDiffBadgeVariant(
        change: DiffEntry["change"],
    ): "success" | "danger" | "warning" {
        if (change === "added") return "success";
        if (change === "removed") return "danger";
        return "warning";
    }

    function resolveLatestRevisionPrompt(
        comments: ReviewCommentPayload[],
    ): ReviewCommentPayload | null {
        return (
            comments.find((entry) =>
                entry.comment.startsWith(AI_REVISION_COMMENT_PREFIX),
            ) ?? null
        );
    }

    function extractRevisionPrompt(comment: string): string {
        return comment.startsWith(AI_REVISION_COMMENT_PREFIX)
            ? comment.slice(AI_REVISION_COMMENT_PREFIX.length).trim()
            : comment;
    }

    let previousVersionSnapshot = $derived.by(() => {
        if (!selectedTask) {
            return null;
        }

        return (
            selectedTaskVersions.find(
                (entry) =>
                    entry.version === selectedTask!.contentItem.version - 1,
            ) ??
            selectedTaskVersions[0] ??
            null
        );
    });

    let revisionDiffEntries = $derived.by(() =>
        selectedTask && previousVersionSnapshot
            ? buildDiffEntries(
                  previousVersionSnapshot.data,
                  selectedTask.contentItem.data,
                  previousVersionSnapshot.status,
                  selectedTask.contentItem.status,
              )
            : [],
    );

    let latestRevisionPromptComment = $derived.by(() =>
        resolveLatestRevisionPrompt(selectedTaskComments),
    );

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

    async function loadSelectedTaskRevisionContext(contentItemId: number) {
        const requestId = ++revisionContextRequestId;
        revisionContextLoading = true;
        revisionContextError = null;

        try {
            const [versionsResponse, commentsResponse] = await Promise.all([
                fetchApi(`/content-items/${contentItemId}/versions`),
                fetchApi(`/content-items/${contentItemId}/comments`),
            ]);

            if (requestId !== revisionContextRequestId) {
                return;
            }

            selectedTaskVersions = versionsResponse.data as ContentItemVersionPayload[];
            selectedTaskComments = commentsResponse.data as ReviewCommentPayload[];
        } catch (err: any) {
            if (requestId !== revisionContextRequestId) {
                return;
            }

            selectedTaskVersions = [];
            selectedTaskComments = [];
            revisionContextError =
                err instanceof ApiError
                    ? err.message
                    : "Revision history could not be loaded.";
        } finally {
            if (requestId === revisionContextRequestId) {
                revisionContextLoading = false;
            }
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

    async function reviseTask(payload: ReviewTaskPayload) {
        if (!revisionPrompt.trim()) {
            feedbackStore.pushToast({
                severity: "error",
                title: "Revision prompt required",
                message:
                    "Describe what the agent should change before requesting a revision.",
            });
            return;
        }

        revisingItem = payload.task.id;
        try {
            const response = await fetchApi(`/review-tasks/${payload.task.id}/revise`, {
                method: "POST",
                body: JSON.stringify({
                    prompt: revisionPrompt.trim(),
                }),
            });
            const result = response.data as {
                contentItemId: number;
                contentVersion: number;
            };

            revisionPrompt = "";
            await loadData();

            feedbackStore.pushToast({
                severity: "success",
                title: "Draft revised",
                message: `The agent updated item #${result.contentItemId} to version ${result.contentVersion}. The task remains in the approval queue.`,
            });
        } catch (err: any) {
            const isApiError = err instanceof ApiError;
            feedbackStore.pushToast({
                severity: "error",
                title: "Revision failed",
                message:
                    err.message || "Failed to request an agent revision.",
                code: isApiError ? err.code : undefined,
                remediation: isApiError ? err.remediation : undefined,
            });
        } finally {
            revisingItem = null;
        }
    }

    function viewTask(payload: ReviewTaskPayload) {
        selectedTask = payload;
        decisionReason = "";
        revisionPrompt = "";
        revisionContextError = null;
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
                                            <div class="min-w-0">
                                                {#if payload.task.assignee || payload.task.assigneeActorId}
                                                    <ActorIdentity
                                                        actorId={payload.task.assigneeActorId ??
                                                            payload.task.assignee}
                                                        actorType={payload.task.assigneeActorType}
                                                        actorSource={payload.task.assigneeActorSource}
                                                        fallback="Unassigned"
                                                        compact={true}
                                                    />
                                                {:else}
                                                    <span
                                                        title={new Date(
                                                            payload.task.createdAt,
                                                        ).toLocaleString()}
                                                    >
                                                        Submitted {formatRelativeDate(
                                                            payload.task.createdAt,
                                                        )}
                                                    </span>
                                                {/if}
                                            </div>
                                            <div
                                                class="flex flex-col items-end gap-1 text-right"
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
                                            selectedTask.task.id ||
                                        revisingItem === selectedTask.task.id}
                                    variant="outline"
                                >
                                    Reject
                                </Button>
                                <Button
                                    onclick={() => reviseTask(selectedTask!)}
                                    disabled={revisingItem ===
                                            selectedTask.task.id ||
                                        processingItem ===
                                            selectedTask.task.id ||
                                        !revisionPrompt.trim()}
                                    variant="outline"
                                >
                                    {#if revisingItem === selectedTask.task.id}
                                        <LoadingSpinner size="sm" />
                                    {:else}
                                        <Icon
                                            src={ArrowPath}
                                            class="w-4 h-4"
                                        />
                                    {/if}
                                    Revise With Agent
                                </Button>
                                <Button
                                    onclick={() =>
                                        processTask(selectedTask!, "approved")}
                                    disabled={processingItem ===
                                            selectedTask.task.id ||
                                        revisingItem === selectedTask.task.id}
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
                                                for="revision-prompt"
                                                class="block text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 mb-1"
                                            >
                                                Agent Revision Prompt
                                            </label>
                                            <Textarea
                                                id="revision-prompt"
                                                bind:value={revisionPrompt}
                                                placeholder="Tell the agent what to adjust before approval, for example: tighten the executive summary, clarify timeline risks, and make pricing assumptions explicit."
                                                rows={3}
                                                class="w-full text-sm"
                                                disabled={revisingItem ===
                                                    selectedTask.task.id}
                                            />
                                            <p
                                                class="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400"
                                            >
                                                This re-runs the agent against
                                                the same draft item, keeps the
                                                review task pending, and versions
                                                the content instead of creating a
                                                second item.
                                            </p>
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
                                                Assigned Reviewer
                                            </dt>
                                            <dd class="mt-1">
                                                <ActorIdentity
                                                    actorId={selectedTask.task
                                                        .assigneeActorId ??
                                                        selectedTask.task
                                                            .assignee}
                                                    actorType={selectedTask.task
                                                        .assigneeActorType}
                                                    actorSource={selectedTask.task
                                                        .assigneeActorSource}
                                                    fallback="Unassigned"
                                                />
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
                                    <div
                                        class="flex items-start justify-between gap-3 flex-wrap"
                                    >
                                        <div>
                                            <h4
                                                class="text-sm font-semibold text-gray-900 dark:text-white"
                                            >
                                                Latest Agent Changes
                                            </h4>
                                            <p
                                                class="mt-1 text-xs text-gray-500 dark:text-gray-400"
                                            >
                                                Review exactly what changed in
                                                the latest revision before you
                                                approve the draft.
                                            </p>
                                        </div>
                                        {#if previousVersionSnapshot && selectedTask}
                                            <Badge variant="outline"
                                                >v{previousVersionSnapshot.version}
                                                → v{selectedTask.contentItem
                                                    .version}</Badge
                                            >
                                        {/if}
                                    </div>
                                </div>

                                <div class="space-y-4 p-5">
                                    {#if revisionContextLoading}
                                        <div
                                            class="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300"
                                        >
                                            <LoadingSpinner size="sm" />
                                            Loading revision history…
                                        </div>
                                    {:else if revisionContextError}
                                        <div
                                            class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
                                        >
                                            {revisionContextError}
                                        </div>
                                    {:else if !previousVersionSnapshot && !latestRevisionPromptComment}
                                        <div
                                            class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300"
                                        >
                                            No prior agent revision has been
                                            recorded for this item yet.
                                        </div>
                                    {:else}
                                        {#if latestRevisionPromptComment}
                                            <div
                                                class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-950/40"
                                            >
                                                <div
                                                    class="flex items-start justify-between gap-3 flex-wrap"
                                                >
                                                    <div>
                                                        <p
                                                            class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                                                        >
                                                            Last Revision Prompt
                                                        </p>
                                                        <p
                                                            class="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200"
                                                        >
                                                            {extractRevisionPrompt(
                                                                latestRevisionPromptComment.comment,
                                                            )}
                                                        </p>
                                                    </div>
                                                    <span
                                                        class="text-[0.68rem] text-slate-500 dark:text-slate-400"
                                                    >
                                                        {formatAbsoluteDate(
                                                            latestRevisionPromptComment.createdAt,
                                                        )}
                                                    </span>
                                                </div>
                                            </div>
                                        {/if}

                                        {#if previousVersionSnapshot}
                                            <div
                                                class="grid gap-3 lg:grid-cols-3"
                                            >
                                                <div
                                                    class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-950/40"
                                                >
                                                    <p
                                                        class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                                                    >
                                                        Summary
                                                    </p>
                                                    <p
                                                        class="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white"
                                                    >
                                                        {revisionDiffEntries.length}
                                                    </p>
                                                    <p
                                                        class="mt-1 text-sm text-slate-600 dark:text-slate-300"
                                                    >
                                                        field-level change{revisionDiffEntries
                                                            .length === 1
                                                            ? ""
                                                            : "s"} detected in
                                                        the latest revision.
                                                    </p>
                                                </div>
                                                <div
                                                    class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-950/40"
                                                >
                                                    <p
                                                        class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                                                    >
                                                        Previous Snapshot
                                                    </p>
                                                    <p
                                                        class="mt-2 text-lg font-semibold text-slate-900 dark:text-white"
                                                    >
                                                        v{previousVersionSnapshot.version}
                                                    </p>
                                                    <p
                                                        class="mt-1 text-sm text-slate-600 dark:text-slate-300"
                                                    >
                                                        {formatAbsoluteDate(
                                                            previousVersionSnapshot.createdAt,
                                                        )}
                                                    </p>
                                                </div>
                                                <div
                                                    class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-950/40"
                                                >
                                                    <p
                                                        class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                                                    >
                                                        Current Draft
                                                    </p>
                                                    <p
                                                        class="mt-2 text-lg font-semibold text-slate-900 dark:text-white"
                                                    >
                                                        v{selectedTask.contentItem.version}
                                                    </p>
                                                    <p
                                                        class="mt-1 text-sm text-slate-600 dark:text-slate-300"
                                                    >
                                                        {formatAbsoluteDate(
                                                            selectedTask.contentItem.updatedAt,
                                                        )}
                                                    </p>
                                                </div>
                                            </div>

                                            {#if revisionDiffEntries.length === 0}
                                                <div
                                                    class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300"
                                                >
                                                    No field-level payload
                                                    changes were detected
                                                    between the last two
                                                    versions. The model may have
                                                    returned semantically
                                                    equivalent content.
                                                </div>
                                            {:else}
                                                <div
                                                    class="grid gap-3 lg:grid-cols-2"
                                                >
                                                    {#each revisionDiffEntries as entry}
                                                        <div
                                                            class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/40"
                                                        >
                                                            <div
                                                                class="flex items-start justify-between gap-3"
                                                            >
                                                                <div>
                                                                    <p
                                                                        class="font-mono text-xs text-slate-500 dark:text-slate-400"
                                                                    >
                                                                        {entry.key}
                                                                    </p>
                                                                    <p
                                                                        class="mt-1 text-sm font-medium text-slate-900 dark:text-white"
                                                                    >
                                                                        {entry.change
                                                                            .charAt(
                                                                                0,
                                                                            )
                                                                            .toUpperCase() +
                                                                            entry.change.slice(
                                                                                1,
                                                                            )}
                                                                    </p>
                                                                </div>
                                                                <Badge
                                                                    variant={resolveDiffBadgeVariant(
                                                                        entry.change,
                                                                    )}
                                                                    class="uppercase"
                                                                >
                                                                    {entry.change}
                                                                </Badge>
                                                            </div>
                                                            <dl
                                                                class="mt-4 grid gap-3 text-sm"
                                                            >
                                                                <div>
                                                                    <dt
                                                                        class="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                                                    >
                                                                        Before
                                                                    </dt>
                                                                    <dd
                                                                        class="mt-1 whitespace-pre-wrap break-words rounded-xl bg-slate-50 px-3 py-2 text-slate-700 dark:bg-slate-900/70 dark:text-slate-200"
                                                                    >
                                                                        {entry.before}
                                                                    </dd>
                                                                </div>
                                                                <div>
                                                                    <dt
                                                                        class="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                                                    >
                                                                        After
                                                                    </dt>
                                                                    <dd
                                                                        class="mt-1 whitespace-pre-wrap break-words rounded-xl bg-emerald-50 px-3 py-2 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
                                                                    >
                                                                        {entry.after}
                                                                    </dd>
                                                                </div>
                                                            </dl>
                                                        </div>
                                                    {/each}
                                                </div>
                                            {/if}

                                            <div
                                                class="grid gap-4 xl:grid-cols-2"
                                            >
                                                <JsonCodeBlock
                                                    value={previousVersionSnapshot.data}
                                                    label={`Previous version JSON (v${previousVersionSnapshot.version})`}
                                                    copyable={true}
                                                />
                                                <JsonCodeBlock
                                                    value={selectedTask.contentItem.data}
                                                    label={`Current version JSON (v${selectedTask.contentItem.version})`}
                                                    copyable={true}
                                                />
                                            </div>
                                        {/if}
                                    {/if}
                                </div>
                            </Surface>

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
