<script lang="ts">
    import { fetchApi, ApiError } from "$lib/api";
    import { onMount } from "svelte";
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import { deepParseJson } from "$lib/utils";
    import {
        resolveContentLabel,
        resolveContentSubtitle,
        resolveContentSummary,
        resolveContentSlug,
        resolveContentAttribution,
        resolveStructuredFieldCount,
        resolveContentTaskSummary,
        parseStructuredData,
        pickFirstString,
        truncate,
    } from "$lib/content-label";
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
            source: string;
            sourceEventId: number | null;
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

    type TimelineEntry = {
        kind: "comment" | "ai_revision" | "external_feedback";
        id: string;
        timestamp: string;
        actorId: string | null;
        actorType: string | null;
        actorSource: string | null;
        body: string;
        decision?: string | null;
        prompt?: string | null;
        refinementMode?: string;
        actorDisplayName?: string | null;
        publishedVersion?: number;
    };

    type ExternalFeedbackEventPayload = {
        id: number;
        domainId: number;
        contentItemId: number;
        publishedVersion: number;
        decision: string | null;
        comment: string | null;
        prompt: string | null;
        refinementMode: string;
        actorId: string;
        actorType: string;
        actorSource: string;
        actorDisplayName: string | null;
        actorEmail: string | null;
        reviewTaskId: number | null;
        createdAt: string;
    };

    type DiffEntry = {
        key: string;
        before: string;
        after: string;
        change: "added" | "removed" | "changed";
    };

    // Label / summary field lists are now in $lib/content-label.ts
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
    let selectedTaskFeedbackEvents = $state<ExternalFeedbackEventPayload[]>([]);
    let revisionContextLoading = $state(false);
    let revisionContextError = $state<string | null>(null);
    let externalFeedbackContextError = $state<string | null>(null);
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
        const payload = selectedTask;

        if (!payload) {
            selectedTaskVersions = [];
            selectedTaskComments = [];
            selectedTaskFeedbackEvents = [];
            revisionContextError = null;
            externalFeedbackContextError = null;
            revisionContextLoading = false;
            return;
        }

        void loadSelectedTaskRevisionContext(payload);
    });

    // parseStructuredData is now imported from $lib/content-label

    // truncate is now imported from $lib/content-label

    function formatApprovalTargetLabel(transition: {
        fromState: string;
        toState: string;
    }): string {
        return `Approval target: ${formatStatusLabel(transition.toState)}`;
    }

    function formatApprovalTargetHint(transition: {
        fromState: string;
        toState: string;
    }): string {
        return `Entered review from ${formatStatusLabel(
            transition.fromState,
        )}. Approval applies ${formatStatusLabel(transition.toState)}.`;
    }

    function stringifyPreview(value: unknown, max = 80): string {
        if (value === null) return "null";
        if (value === undefined) return "—";
        if (typeof value === "string") return truncate(value, max);
        if (typeof value === "number" || typeof value === "boolean") {
            return String(value);
        }

        try {
            return truncate(JSON.stringify(value) ?? "", max);
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

    function classifyCommentKind(
        comment: ReviewCommentPayload,
    ): "ai_revision" | "comment" {
        return comment.comment.startsWith(AI_REVISION_COMMENT_PREFIX)
            ? "ai_revision"
            : "comment";
    }

    let timelineEntries = $derived.by((): TimelineEntry[] => {
        const entries: TimelineEntry[] = [];

        for (const c of selectedTaskComments) {
            const kind = classifyCommentKind(c);
            entries.push({
                kind,
                id: `comment-${c.id}`,
                timestamp: c.createdAt,
                actorId: c.authorActorId ?? c.authorId,
                actorType: c.authorActorType,
                actorSource: c.authorActorSource,
                body:
                    kind === "ai_revision"
                        ? extractRevisionPrompt(c.comment)
                        : c.comment,
            });
        }

        for (const f of selectedTaskFeedbackEvents) {
            entries.push({
                kind: "external_feedback",
                id: `feedback-${f.id}`,
                timestamp: f.createdAt,
                actorId: f.actorId,
                actorType: f.actorType,
                actorSource: f.actorSource,
                body: f.comment ?? "",
                decision: f.decision,
                prompt: f.prompt,
                refinementMode: f.refinementMode,
                actorDisplayName: f.actorDisplayName,
                publishedVersion: f.publishedVersion,
            });
        }

        entries.sort(
            (a, b) =>
                new Date(b.timestamp).getTime() -
                new Date(a.timestamp).getTime(),
        );

        return entries;
    });

    let selectedTaskFeedbackEvent = $derived.by(() => {
        if (!selectedTask || selectedTask.task.source !== "external_feedback") {
            return null;
        }

        const sourceEventId = selectedTask.task.sourceEventId;

        return (
            selectedTaskFeedbackEvents.find(
                (event) => sourceEventId !== null && event.id === sourceEventId,
            ) ??
            selectedTaskFeedbackEvents[0] ??
            null
        );
    });

    // pickFirstString is now imported from $lib/content-label

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

    function resolveExternalFeedbackDecisionVariant(
        decision: string | null,
    ): "muted" | "success" | "warning" {
        if (decision === "accepted") return "success";
        if (decision === "changes_requested") return "warning";
        return "muted";
    }

    function formatFeedbackDecisionLabel(decision: string | null): string {
        return decision ? formatStatusLabel(decision) : "No Decision";
    }

    function formatRefinementModeLabel(mode: string): string {
        return formatStatusLabel(mode);
    }

    function resolveExternalFeedbackSubmitterLabel(
        event: ExternalFeedbackEventPayload,
    ): string {
        if (event.actorDisplayName?.trim()) {
            return event.actorDisplayName.trim();
        }

        if (event.actorEmail?.trim()) {
            return event.actorEmail.trim();
        }

        return event.actorId;
    }

    function resolveTaskLabel(payload: ReviewTaskPayload): string {
        return resolveContentLabel(payload.contentItem, payload.contentType);
    }

    function resolveTaskSubtitle(payload: ReviewTaskPayload): string | null {
        return resolveContentSubtitle(payload.contentItem, payload.contentType);
    }

    function resolveTaskExcerpt(payload: ReviewTaskPayload): string | null {
        return resolveContentSummary(payload.contentItem);
    }

    function resolveTaskSummary(payload: ReviewTaskPayload): string {
        return resolveContentTaskSummary(payload.contentItem);
    }

    function resolveTaskSlug(payload: ReviewTaskPayload): string | null {
        return resolveContentSlug(payload.contentItem);
    }

    function resolveTaskAttribution(payload: ReviewTaskPayload): string | null {
        return resolveContentAttribution(payload.contentItem);
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

    async function loadSelectedTaskRevisionContext(payload: ReviewTaskPayload) {
        const requestId = ++revisionContextRequestId;
        revisionContextLoading = true;
        revisionContextError = null;
        externalFeedbackContextError = null;
        selectedTaskFeedbackEvents = [];

        const versionsPromise = fetchApi(
            `/content-items/${payload.contentItem.id}/versions`,
        );
        const commentsPromise = fetchApi(
            `/content-items/${payload.contentItem.id}/comments`,
        );
        const feedbackEventsPromise =
            payload.task.source === "external_feedback"
                ? fetchApi(
                      `/content-items/${payload.contentItem.id}/external-feedback`,
                  )
                : null;

        try {
            const [versionsResponse, commentsResponse] = await Promise.all([
                versionsPromise,
                commentsPromise,
            ]);

            if (requestId !== revisionContextRequestId) {
                return;
            }

            selectedTaskVersions = versionsResponse.data as ContentItemVersionPayload[];
            selectedTaskComments = commentsResponse.data as ReviewCommentPayload[];

            if (feedbackEventsPromise) {
                try {
                    const feedbackEventsResponse = await feedbackEventsPromise;
                    if (requestId !== revisionContextRequestId) {
                        return;
                    }

                    selectedTaskFeedbackEvents =
                        feedbackEventsResponse.data as ExternalFeedbackEventPayload[];
                } catch (err: any) {
                    if (requestId !== revisionContextRequestId) {
                        return;
                    }

                    selectedTaskFeedbackEvents = [];
                    externalFeedbackContextError =
                        err instanceof ApiError
                            ? err.message
                            : "Client feedback could not be loaded.";
                }
            }
        } catch (err: any) {
            if (requestId !== revisionContextRequestId) {
                return;
            }

            selectedTaskVersions = [];
            selectedTaskComments = [];
            selectedTaskFeedbackEvents = [];
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
        externalFeedbackContextError = null;
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
                    class="mt-2 text-[0.7rem] text-slate-400 dark:text-slate-500 hidden md:block"
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
                                                {#if resolveTaskSubtitle(payload)}
                                                    <p class="truncate text-[0.72rem] text-gray-600 dark:text-gray-300 mt-0.5">
                                                        {resolveTaskSubtitle(payload)}
                                                    </p>
                                                {/if}
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
                                            <span
                                                title={formatApprovalTargetHint(
                                                    payload.transition,
                                                )}
                                            >
                                                <Badge
                                                    variant="outline"
                                                    class="uppercase"
                                                >
                                                    {formatApprovalTargetLabel(
                                                        payload.transition,
                                                    )}
                                                </Badge>
                                            </span>
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
                                            {#if payload.task.source === "external_feedback"}
                                                <Badge
                                                    variant="warning"
                                                    class="uppercase"
                                                >
                                                    Client feedback
                                                </Badge>
                                            {/if}
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
                    <!-- Sticky action bar: always visible at top -->
                    <div
                        class="sticky top-0 z-10 border-b border-slate-200/80 bg-white/95 backdrop-blur-sm px-3 py-3 sm:px-5 sm:py-4 dark:border-slate-700 dark:bg-slate-900/95"
                    >
                        <!-- Row 1: Back button + title -->
                        <div
                            class="flex items-center gap-2 min-w-0"
                        >
                            <button
                                class="md:hidden shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                aria-label="Close review"
                                onclick={() => (selectedTask = null)}
                            >
                                <Icon
                                    src={ChevronLeft}
                                    class="w-5 h-5"
                                />
                            </button>
                            <div class="min-w-0 flex-1">
                                <h3
                                    class="truncate text-base sm:text-lg font-semibold tracking-tight text-gray-900 dark:text-white"
                                >
                                    {resolveTaskLabel(selectedTask)}
                                </h3>
                                {#if resolveTaskSubtitle(selectedTask)}
                                    <p class="mt-0.5 text-xs sm:text-sm text-gray-500 dark:text-gray-400 truncate">
                                        {resolveTaskSubtitle(selectedTask)}
                                    </p>
                                {/if}
                            </div>
                        </div>

                        <!-- Row 2: Scrollable badges -->
                        <div
                            class="mt-1.5 flex items-center gap-1.5 text-xs overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none"
                        >
                            <Badge variant="outline"
                                >{selectedTask.contentType.name}</Badge
                            >
                            <Badge variant="outline"
                                >#{selectedTask.contentItem.id}</Badge
                            >
                            <Badge
                                variant={resolveStatusBadgeVariant(
                                    selectedTask.contentItem.status,
                                )}
                                class="uppercase whitespace-nowrap"
                            >
                                {formatStatusLabel(
                                    selectedTask.contentItem.status,
                                )}
                            </Badge>
                            <Badge variant="outline" class="whitespace-nowrap">
                                {formatApprovalTargetLabel(
                                    selectedTask.transition,
                                )}
                            </Badge>
                            <Badge variant="muted" class="whitespace-nowrap"
                                >v{selectedTask.contentItem
                                    .version}</Badge
                            >
                            {#if selectedTask.task.source ===
                                "external_feedback"}
                                <Badge
                                    variant="warning"
                                    class="uppercase whitespace-nowrap"
                                >
                                    Client feedback
                                </Badge>
                            {/if}
                            <Badge variant="muted" class="whitespace-nowrap"
                                >{formatRelativeDate(
                                    selectedTask.task.createdAt,
                                )}</Badge
                            >
                        </div>

                        <!-- Row 3: Action buttons -->
                        <div class="mt-2.5 flex gap-2">
                            <Button
                                onclick={() =>
                                    processTask(selectedTask!, "rejected")}
                                disabled={processingItem ===
                                        selectedTask.task.id ||
                                    revisingItem === selectedTask.task.id}
                                variant="outline"
                                class="flex-1 sm:flex-none"
                            >
                                Reject
                            </Button>
                            <Button
                                onclick={() =>
                                    processTask(selectedTask!, "approved")}
                                disabled={processingItem ===
                                        selectedTask.task.id ||
                                    revisingItem === selectedTask.task.id}
                                variant="success"
                                class="flex-1 sm:flex-none"
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

                        <!-- Row 4: Compact revision prompt inline -->
                        <div class="mt-2.5 flex items-start gap-2">
                            <div class="flex-1 min-w-0">
                                <Textarea
                                    id="revision-prompt"
                                    aria-label="Agent Revision Prompt"
                                    bind:value={revisionPrompt}
                                    placeholder="Describe what the agent should change…"
                                    rows={1}
                                    class="w-full text-sm resize-y"
                                    disabled={revisingItem ===
                                        selectedTask.task.id}
                                />
                            </div>
                            <Button
                                onclick={() => reviseTask(selectedTask!)}
                                disabled={revisingItem ===
                                        selectedTask.task.id ||
                                    processingItem ===
                                        selectedTask.task.id ||
                                    !revisionPrompt.trim()}
                                variant="outline"
                                class="shrink-0"
                            >
                                {#if revisingItem === selectedTask.task.id}
                                    <LoadingSpinner size="sm" />
                                {:else}
                                    <Icon
                                        src={ArrowPath}
                                        class="w-4 h-4"
                                    />
                                {/if}
                                Revise
                            </Button>
                        </div>

                        <!-- Row 5: Optional decision reason (collapsible) -->
                        <details class="mt-2">
                            <summary
                                class="cursor-pointer text-[0.7rem] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 select-none"
                            >
                                Add decision reason (optional)
                            </summary>
                            <div class="mt-1.5">
                                <Textarea
                                    id="decision-reason"
                                    aria-label="Decision Reason"
                                    bind:value={decisionReason}
                                    placeholder="Reasoning for approval or rejection…"
                                    rows={2}
                                    class="w-full text-sm"
                                />
                            </div>
                        </details>
                    </div>

                    <!-- Scrollable body: two-column layout -->
                    <div
                        class="flex-1 overflow-y-auto bg-slate-50/50 p-3 sm:p-4 dark:bg-slate-950/40"
                    >
                        <div
                            class="grid gap-3 sm:gap-4 xl:grid-cols-[minmax(0,1fr)_15rem]"
                        >
                            <!-- LEFT COLUMN: Diff view (primary content) -->
                            <div class="space-y-4 min-w-0">
                                {#if selectedTask.task.source === "external_feedback"}
                                    {#if selectedTaskFeedbackEvent && !revisionContextLoading}
                                        <div
                                            class="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 dark:border-amber-900/60 dark:bg-amber-950/30"
                                        >
                                            <div
                                                class="flex flex-wrap items-center gap-2"
                                            >
                                                <p
                                                    class="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-400"
                                                >
                                                    Client Feedback
                                                </p>
                                                <Badge
                                                    variant={resolveExternalFeedbackDecisionVariant(
                                                        selectedTaskFeedbackEvent.decision,
                                                    )}
                                                    class="uppercase"
                                                >
                                                    {formatFeedbackDecisionLabel(
                                                        selectedTaskFeedbackEvent.decision,
                                                    )}
                                                </Badge>
                                                <Badge
                                                    variant="outline"
                                                    class="uppercase"
                                                >
                                                    {formatRefinementModeLabel(
                                                        selectedTaskFeedbackEvent.refinementMode,
                                                    )}
                                                </Badge>
                                                <Badge variant="muted">
                                                    Published v{selectedTaskFeedbackEvent.publishedVersion}
                                                </Badge>
                                            </div>
                                            <p
                                                class="mt-1 text-sm text-amber-900 dark:text-amber-100"
                                            >
                                                From {resolveExternalFeedbackSubmitterLabel(
                                                    selectedTaskFeedbackEvent,
                                                )}
                                            </p>
                                            {#if selectedTaskFeedbackEvent.comment}
                                                <p
                                                    class="mt-2 text-sm leading-relaxed text-amber-900 dark:text-amber-100"
                                                >
                                                    {selectedTaskFeedbackEvent.comment}
                                                </p>
                                            {/if}
                                            {#if selectedTaskFeedbackEvent.prompt}
                                                <div
                                                    class="mt-3 rounded-lg border border-amber-200/80 bg-white/70 px-3 py-2 dark:border-amber-900/60 dark:bg-slate-950/30"
                                                >
                                                    <p
                                                        class="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-400"
                                                    >
                                                        Agent Prompt
                                                    </p>
                                                    <p
                                                        class="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-200"
                                                    >
                                                        {selectedTaskFeedbackEvent.prompt}
                                                    </p>
                                                </div>
                                            {/if}
                                            <p
                                                class="mt-2 text-[0.65rem] text-amber-700/80 dark:text-amber-300/80"
                                            >
                                                {formatAbsoluteDate(
                                                    selectedTaskFeedbackEvent.createdAt,
                                                )}
                                            </p>
                                        </div>
                                    {:else if externalFeedbackContextError}
                                        <div
                                            class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
                                        >
                                            {externalFeedbackContextError}
                                        </div>
                                    {/if}
                                {/if}

                                <!-- Latest revision prompt banner -->
                                {#if latestRevisionPromptComment && !revisionContextLoading}
                                    <div
                                        class="rounded-xl border border-indigo-200 bg-indigo-50/80 px-4 py-3 dark:border-indigo-800 dark:bg-indigo-950/30"
                                    >
                                        <p
                                            class="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-indigo-500 dark:text-indigo-400"
                                        >
                                            Last Revision Prompt
                                        </p>
                                        <p
                                            class="mt-1 text-sm leading-relaxed text-indigo-800 dark:text-indigo-200"
                                        >
                                            {extractRevisionPrompt(
                                                latestRevisionPromptComment.comment,
                                            )}
                                        </p>
                                        <p
                                            class="mt-1 text-[0.65rem] text-indigo-400 dark:text-indigo-500"
                                        >
                                            {formatAbsoluteDate(
                                                latestRevisionPromptComment.createdAt,
                                            )}
                                        </p>
                                    </div>
                                {/if}

                                <!-- Diff section -->
                                <Surface class="overflow-hidden rounded-xl p-0">
                                    <div
                                        class="border-b border-slate-200 px-4 py-2.5 dark:border-slate-700 flex items-center justify-between gap-3"
                                    >
                                        <h4
                                            class="text-sm font-semibold text-gray-900 dark:text-white"
                                        >
                                            Changes
                                        </h4>
                                        {#if previousVersionSnapshot && selectedTask}
                                            <Badge variant="outline"
                                                >v{previousVersionSnapshot.version}
                                                → v{selectedTask.contentItem
                                                    .version}</Badge
                                            >
                                        {/if}
                                    </div>

                                    <div class="p-4">
                                        {#if revisionContextLoading}
                                            <div
                                                class="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300"
                                            >
                                                <LoadingSpinner size="sm" />
                                                Loading revision history…
                                            </div>
                                        {:else if revisionContextError}
                                            <div
                                                class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
                                            >
                                                {revisionContextError}
                                            </div>
                                        {:else if !previousVersionSnapshot}
                                            <div
                                                class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300"
                                            >
                                                First version — no prior revision to compare against.
                                            </div>
                                        {:else if revisionDiffEntries.length === 0}
                                            <div
                                                class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300"
                                            >
                                                No field-level changes detected. The model may have returned semantically equivalent content.
                                            </div>
                                        {:else}
                                            <!-- Compact diff table -->
                                            <div
                                                class="divide-y divide-slate-200 dark:divide-slate-700 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden"
                                            >
                                                {#each revisionDiffEntries as entry}
                                                    <div class="text-sm">
                                                        <div
                                                            class="flex items-center justify-between gap-2 bg-slate-50/80 px-3 py-1.5 dark:bg-slate-900/40"
                                                        >
                                                            <span
                                                                class="font-mono text-xs text-slate-600 dark:text-slate-300 font-medium truncate"
                                                            >
                                                                {entry.key}
                                                            </span>
                                                            <Badge
                                                                variant={resolveDiffBadgeVariant(
                                                                    entry.change,
                                                                )}
                                                                class="uppercase text-[0.6rem] shrink-0"
                                                            >
                                                                {entry.change}
                                                            </Badge>
                                                        </div>
                                                        <div
                                                            class="grid grid-cols-1 sm:grid-cols-2 sm:divide-x divide-slate-200 dark:divide-slate-700"
                                                        >
                                                            <div
                                                                class="px-3 py-2 whitespace-pre-wrap break-words text-xs text-slate-500 dark:text-slate-400 bg-red-50/40 dark:bg-red-950/10 border-b sm:border-b-0 border-slate-200 dark:border-slate-700"
                                                            >
                                                                <span class="sm:hidden font-semibold text-[0.6rem] uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-0.5">Before</span>
                                                                {entry.before}
                                                            </div>
                                                            <div
                                                                class="px-3 py-2 whitespace-pre-wrap break-words text-xs text-emerald-800 dark:text-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/10"
                                                            >
                                                                <span class="sm:hidden font-semibold text-[0.6rem] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 block mb-0.5">After</span>
                                                                {entry.after}
                                                            </div>
                                                        </div>
                                                    </div>
                                                {/each}
                                            </div>
                                        {/if}
                                    </div>
                                </Surface>

                                <!-- Submission summary -->
                                <Surface
                                    tone="subtle"
                                    class="rounded-xl p-4"
                                >
                                    <p
                                        class="text-sm leading-relaxed text-slate-600 dark:text-slate-300"
                                    >
                                        {resolveTaskSummary(selectedTask)}
                                    </p>
                                </Surface>

                                <!-- Review Activity Timeline -->
                                {#if !revisionContextLoading && timelineEntries.length > 0}
                                    <Surface class="overflow-hidden rounded-xl p-0">
                                        <div
                                            class="border-b border-slate-200 px-4 py-2.5 dark:border-slate-700 flex items-center justify-between gap-3"
                                        >
                                            <h4
                                                class="text-sm font-semibold text-gray-900 dark:text-white"
                                            >
                                                Review Activity
                                            </h4>
                                            <Badge variant="muted"
                                                >{timelineEntries.length} event{timelineEntries.length ===
                                                1
                                                    ? ""
                                                    : "s"}</Badge
                                            >
                                        </div>

                                        <div class="divide-y divide-slate-100 dark:divide-slate-800">
                                            {#each timelineEntries as entry (entry.id)}
                                                <div class="px-4 py-3 flex gap-3">
                                                    <!-- Timeline indicator -->
                                                    <div class="flex flex-col items-center pt-1 shrink-0">
                                                        <div
                                                            class="w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 {entry.kind ===
                                                            'external_feedback'
                                                                ? 'bg-amber-400'
                                                                : entry.kind ===
                                                                    'ai_revision'
                                                                  ? 'bg-indigo-400'
                                                                  : 'bg-slate-300 dark:bg-slate-600'}"
                                                        ></div>
                                                    </div>

                                                    <!-- Entry content -->
                                                    <div class="min-w-0 flex-1">
                                                        <div class="flex flex-wrap items-center gap-1.5 mb-1">
                                                            {#if entry.kind === "external_feedback"}
                                                                <Badge
                                                                    variant="warning"
                                                                    class="uppercase text-[0.6rem]"
                                                                >
                                                                    Client Feedback
                                                                </Badge>
                                                                {#if entry.decision}
                                                                    <Badge
                                                                        variant={resolveExternalFeedbackDecisionVariant(
                                                                            entry.decision,
                                                                        )}
                                                                        class="uppercase text-[0.6rem]"
                                                                    >
                                                                        {formatFeedbackDecisionLabel(
                                                                            entry.decision,
                                                                        )}
                                                                    </Badge>
                                                                {/if}
                                                                {#if entry.refinementMode}
                                                                    <Badge
                                                                        variant="outline"
                                                                        class="uppercase text-[0.6rem]"
                                                                    >
                                                                        {formatRefinementModeLabel(
                                                                            entry.refinementMode,
                                                                        )}
                                                                    </Badge>
                                                                {/if}
                                                            {:else if entry.kind === "ai_revision"}
                                                                <Badge
                                                                    variant="muted"
                                                                    class="uppercase text-[0.6rem]"
                                                                >
                                                                    AI Revision
                                                                </Badge>
                                                            {:else}
                                                                <Badge
                                                                    variant="muted"
                                                                    class="uppercase text-[0.6rem]"
                                                                >
                                                                    Comment
                                                                </Badge>
                                                            {/if}

                                                            <span
                                                                class="text-[0.65rem] text-slate-400 dark:text-slate-500"
                                                                title={formatAbsoluteDate(
                                                                    entry.timestamp,
                                                                )}
                                                            >
                                                                {formatRelativeDate(
                                                                    entry.timestamp,
                                                                )}
                                                            </span>
                                                        </div>

                                                        <!-- Actor attribution -->
                                                        <div class="mb-1">
                                                            {#if entry.kind === "external_feedback" && entry.actorDisplayName}
                                                                <span
                                                                    class="text-xs font-medium text-slate-700 dark:text-slate-300"
                                                                >
                                                                    {entry.actorDisplayName}
                                                                </span>
                                                            {:else}
                                                                <ActorIdentity
                                                                    actorId={entry.actorId}
                                                                    actorType={entry.actorType}
                                                                    actorSource={entry.actorSource}
                                                                    fallback="System"
                                                                    compact={true}
                                                                />
                                                            {/if}
                                                        </div>

                                                        <!-- Body text -->
                                                        {#if entry.body}
                                                            <p
                                                                class="text-sm leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-line"
                                                            >
                                                                {entry.body}
                                                            </p>
                                                        {/if}

                                                        <!-- Agent prompt (for external feedback entries) -->
                                                        {#if entry.kind === "external_feedback" && entry.prompt}
                                                            <div
                                                                class="mt-2 rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/20"
                                                            >
                                                                <p
                                                                    class="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-400"
                                                                >
                                                                    Agent Prompt
                                                                </p>
                                                                <p
                                                                    class="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-200"
                                                                >
                                                                    {entry.prompt}
                                                                </p>
                                                            </div>
                                                        {/if}

                                                        {#if entry.kind === "external_feedback" && entry.publishedVersion}
                                                            <p
                                                                class="mt-1 text-[0.65rem] text-slate-400 dark:text-slate-500"
                                                            >
                                                                Feedback on published v{entry.publishedVersion}
                                                            </p>
                                                        {/if}
                                                    </div>
                                                </div>
                                            {/each}
                                        </div>
                                    </Surface>
                                {/if}

                                <!-- Collapsible raw payload -->
                                <details>
                                    <summary
                                        class="cursor-pointer text-sm font-semibold text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white select-none py-2"
                                    >
                                        Raw Payload JSON
                                    </summary>
                                    <Surface
                                        class="overflow-hidden rounded-xl p-0 mt-2"
                                    >
                                        <JsonCodeBlock
                                            value={selectedTask.contentItem.data}
                                            label="Payload JSON"
                                            copyable={true}
                                        />
                                    </Surface>
                                </details>

                                <!-- Collapsible version JSON comparison -->
                                {#if previousVersionSnapshot}
                                    <details>
                                        <summary
                                            class="cursor-pointer text-sm font-semibold text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white select-none py-2"
                                        >
                                            Full Version Comparison (JSON)
                                        </summary>
                                        <div
                                            class="grid gap-3 xl:grid-cols-2 mt-2"
                                        >
                                            <JsonCodeBlock
                                                value={previousVersionSnapshot.data}
                                                label={`v${previousVersionSnapshot.version}`}
                                                copyable={true}
                                            />
                                            <JsonCodeBlock
                                                value={selectedTask.contentItem.data}
                                                label={`v${selectedTask.contentItem.version}`}
                                                copyable={true}
                                            />
                                        </div>
                                    </details>
                                {/if}
                            </div>

                            <!-- RIGHT COLUMN: Compact metadata sidebar (collapsible on mobile, visible on xl) -->
                            <details class="xl:hidden">
                                <summary
                                    class="cursor-pointer text-sm font-semibold text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white select-none py-2"
                                >
                                    Item Details
                                </summary>
                                <div class="mt-2 space-y-3">
                                    <Surface
                                        tone="subtle"
                                        class="rounded-xl p-3.5"
                                    >
                                        <p
                                            class="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 mb-3"
                                        >
                                            Details
                                        </p>
                                        <dl class="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                                            <div>
                                                <dt class="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Slug</dt>
                                                <dd class="mt-0.5 text-slate-700 dark:text-slate-300 font-mono break-all">{resolveTaskSlug(selectedTask) || "—"}</dd>
                                            </div>
                                            <div>
                                                <dt class="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Attribution</dt>
                                                <dd class="mt-0.5 text-slate-700 dark:text-slate-300">{resolveTaskAttribution(selectedTask) || "—"}</dd>
                                            </div>
                                            <div>
                                                <dt class="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Workflow</dt>
                                                <dd class="mt-0.5 text-slate-700 dark:text-slate-300">{selectedTask.workflow.name}</dd>
                                            </div>
                                            <div>
                                                <dt class="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Queue</dt>
                                                <dd class="mt-0.5 text-slate-700 dark:text-slate-300">{selectedTaskQueueIndex >= 0 ? selectedTaskQueueIndex + 1 : 1} of {pendingTasks.length}</dd>
                                            </div>
                                            <div>
                                                <dt class="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Submitted</dt>
                                                <dd class="mt-0.5 text-slate-700 dark:text-slate-300">{formatAbsoluteDate(selectedTask.task.createdAt)}</dd>
                                            </div>
                                            <div>
                                                <dt class="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Roles</dt>
                                                <dd class="mt-0.5 text-slate-700 dark:text-slate-300">{selectedTask.transition.requiredRoles.length > 0 ? selectedTask.transition.requiredRoles.join(", ") : "None"}</dd>
                                            </div>
                                        </dl>
                                    </Surface>
                                </div>
                            </details>
                            <div class="space-y-3 hidden xl:block">
                                <Surface
                                    tone="subtle"
                                    class="rounded-xl p-3.5"
                                >
                                    <p
                                        class="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 mb-3"
                                    >
                                        Details
                                    </p>
                                    <dl class="space-y-2.5 text-xs">
                                        <div>
                                            <dt
                                                class="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500"
                                            >
                                                Slug
                                            </dt>
                                            <dd
                                                class="mt-0.5 text-slate-700 dark:text-slate-300 font-mono break-all"
                                            >
                                                {resolveTaskSlug(
                                                    selectedTask,
                                                ) || "—"}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt
                                                class="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500"
                                            >
                                                Attribution
                                            </dt>
                                            <dd
                                                class="mt-0.5 text-slate-700 dark:text-slate-300"
                                            >
                                                {resolveTaskAttribution(
                                                    selectedTask,
                                                ) || "—"}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt
                                                class="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500"
                                            >
                                                Workflow
                                            </dt>
                                            <dd
                                                class="mt-0.5 text-slate-700 dark:text-slate-300"
                                            >
                                                {selectedTask.workflow.name}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt
                                                class="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500"
                                            >
                                                Reviewer
                                            </dt>
                                            <dd class="mt-0.5">
                                                <ActorIdentity
                                                    actorId={selectedTask.task
                                                        .assigneeActorId ??
                                                        selectedTask.task
                                                            .assignee}
                                                    actorType={selectedTask.task
                                                        .assigneeActorType}
                                                    actorSource={selectedTask
                                                        .task
                                                        .assigneeActorSource}
                                                    fallback="Unassigned"
                                                    compact={true}
                                                />
                                            </dd>
                                        </div>
                                        <div>
                                            <dt
                                                class="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500"
                                            >
                                                Queue
                                            </dt>
                                            <dd
                                                class="mt-0.5 text-slate-700 dark:text-slate-300"
                                            >
                                                {selectedTaskQueueIndex >= 0
                                                    ? selectedTaskQueueIndex + 1
                                                    : 1} of {pendingTasks.length}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt
                                                class="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500"
                                            >
                                                Roles
                                            </dt>
                                            <dd
                                                class="mt-0.5 text-slate-700 dark:text-slate-300"
                                            >
                                                {selectedTask.transition
                                                    .requiredRoles.length > 0
                                                    ? selectedTask.transition.requiredRoles.join(
                                                          ", ",
                                                      )
                                                    : "None"}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt
                                                class="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500"
                                            >
                                                Submitted
                                            </dt>
                                            <dd
                                                class="mt-0.5 text-slate-700 dark:text-slate-300"
                                            >
                                                {formatAbsoluteDate(
                                                    selectedTask.task.createdAt,
                                                )}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt
                                                class="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500"
                                            >
                                                Updated
                                            </dt>
                                            <dd
                                                class="mt-0.5 text-slate-700 dark:text-slate-300"
                                            >
                                                {formatAbsoluteDate(
                                                    selectedTask.task.updatedAt,
                                                )}
                                            </dd>
                                        </div>
                                    </dl>

                                    <div
                                        class="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300"
                                    >
                                        Current item status:
                                        <span
                                            class="font-medium text-slate-900 dark:text-white"
                                        >
                                            {formatStatusLabel(
                                                selectedTask.contentItem.status,
                                            )}
                                        </span>
                                        . Approval applies
                                        <span
                                            class="font-medium text-slate-900 dark:text-white"
                                        >
                                            {formatStatusLabel(
                                                selectedTask.transition.toState,
                                            )}
                                        </span>
                                        . The original workflow entry state was{" "}
                                        <span
                                            class="font-medium text-slate-900 dark:text-white"
                                        >
                                            {formatStatusLabel(
                                                selectedTask.transition
                                                    .fromState,
                                            )}
                                        </span>
                                        .
                                    </div>
                                </Surface>

                                <!-- Revision stats (if available) -->
                                {#if previousVersionSnapshot && !revisionContextLoading}
                                    <Surface
                                        tone="subtle"
                                        class="rounded-xl p-3.5"
                                    >
                                        <p
                                            class="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 mb-3"
                                        >
                                            Revision
                                        </p>
                                        <dl class="space-y-2 text-xs">
                                            <div>
                                                <dt
                                                    class="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500"
                                                >
                                                    Changes
                                                </dt>
                                                <dd
                                                    class="mt-0.5 text-lg font-semibold text-slate-900 dark:text-white"
                                                >
                                                    {revisionDiffEntries.length}
                                                    <span
                                                        class="text-xs font-normal text-slate-500"
                                                        >field{revisionDiffEntries.length ===
                                                        1
                                                            ? ""
                                                            : "s"}</span
                                                    >
                                                </dd>
                                            </div>
                                            <div>
                                                <dt
                                                    class="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500"
                                                >
                                                    Previous
                                                </dt>
                                                <dd
                                                    class="mt-0.5 text-slate-700 dark:text-slate-300"
                                                >
                                                    v{previousVersionSnapshot.version}
                                                    · {formatRelativeDate(
                                                        previousVersionSnapshot.createdAt,
                                                    )}
                                                </dd>
                                            </div>
                                        </dl>
                                    </Surface>
                                {/if}
                            </div>
                        </div>
                    </div>
                {/if}
            </Surface>
        </section>
    </div>
</div>
