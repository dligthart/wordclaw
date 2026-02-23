<script lang="ts">
    import { fetchApi, ApiError } from "$lib/api";
    import { onMount } from "svelte";
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import { formatJson } from "$lib/utils";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import JsonCodeBlock from "$lib/components/JsonCodeBlock.svelte";

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

    let pendingTasks = $state<ReviewTaskPayload[]>([]);
    let loading = $state(true);
    let error = $state<string | null>(null);

    let selectedTask = $state<ReviewTaskPayload | null>(null);
    let processingItem = $state<number | null>(null);

    onMount(async () => {
        await loadData();
    });

    async function loadData() {
        loading = true;
        error = null;
        try {
            const res = await fetchApi("/review-tasks");
            pendingTasks = res.data;
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

                    pendingTasks = pendingTasks.filter(
                        (t) => t.task.id !== payload.task.id,
                    );
                    if (selectedTask?.task.id === payload.task.id) {
                        selectedTask = null;
                    }

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
    <div class="mb-6 flex justify-between items-end">
        <div>
            <h2
                class="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3"
            >
                Approval Queue
                {#if pendingTasks.length > 0 && !loading}
                    <span
                        class="inline-flex items-center justify-center bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 text-xs font-bold w-6 h-6 rounded-full"
                        >{pendingTasks.length}</span
                    >
                {/if}
            </h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Review agent-generated content before it goes live.
            </p>
        </div>
        <button
            onclick={loadData}
            class="text-gray-500 hover:text-blue-600 dark:text-gray-400 p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition shadow-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
            title="Refresh"
        >
            <svg
                class="w-5 h-5 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                ><path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                ></path></svg
            >
        </button>
    </div>

    {#if error}
        <ErrorBanner class="mb-6 shadow-sm" message={error} />
    {/if}

    <div class="flex-1 flex flex-col md:flex-row gap-6 overflow-hidden">
        <!-- Queue List -->
        <div
            class="w-full md:w-1/3 bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden {selectedTask
                ? 'hidden md:flex'
                : 'flex'}"
        >
            <div
                class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex justify-between items-center"
            >
                <h3
                    class="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                >
                    Pending Items
                </h3>
            </div>

            <div class="flex-1 overflow-y-auto p-2">
                {#if loading}
                    <div class="flex justify-center p-8">
                        <LoadingSpinner size="md" />
                    </div>
                {:else if pendingTasks.length === 0}
                    <div
                        class="text-center p-12 text-gray-500 dark:text-gray-400 flex flex-col items-center"
                    >
                        <svg
                            class="w-12 h-12 text-gray-300 dark:text-gray-600 mb-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="1.5"
                                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                            ></path></svg
                        >
                        <p class="text-sm font-medium">All caught up!</p>
                        <p class="text-xs mt-1">
                            No items require approval right now.
                        </p>
                    </div>
                {:else}
                    <ul class="space-y-2">
                        {#each pendingTasks as payload}
                            <button
                                onclick={() => viewTask(payload)}
                                class="w-full text-left bg-white dark:bg-gray-800 border {selectedTask
                                    ?.task.id === payload.task.id
                                    ? 'border-orange-500 ring-1 ring-orange-500 shadow-sm'
                                    : 'border-gray-200 dark:border-gray-700 shadow-sm hover:border-gray-300 dark:hover:border-gray-600'} rounded-lg p-3 transition-all relative"
                            >
                                <div
                                    class="flex justify-between items-start mb-2"
                                >
                                    <span
                                        class="inline-flex items-center px-2 py-0.5 rounded text-[0.65rem] font-bold uppercase tracking-wider bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-400"
                                    >
                                        {payload.transition.fromState} ➞ {payload
                                            .transition.toState}
                                    </span>
                                    <span
                                        class="text-[0.65rem] font-mono text-gray-400"
                                        >v{payload.contentItem.version}</span
                                    >
                                </div>

                                <div
                                    class="text-sm font-medium text-gray-900 dark:text-white mb-1"
                                >
                                    {payload.contentType.name} - #{payload
                                        .contentItem.id}
                                </div>

                                <div
                                    class="text-xs text-gray-600 dark:text-gray-400 font-mono line-clamp-2 break-all opacity-80 mb-2"
                                >
                                    {formatJson(
                                        payload.contentItem.data,
                                    ).substring(0, 80)}...
                                </div>

                                <div
                                    class="flex justify-between items-end text-[0.65rem] text-gray-400"
                                >
                                    <span
                                        title={new Date(
                                            payload.task.createdAt,
                                        ).toLocaleString()}
                                        >{new Date(
                                            payload.task.createdAt,
                                        ).toLocaleDateString()}</span
                                    >
                                    <span>Task: {payload.task.id}</span>
                                </div>
                            </button>
                        {/each}
                    </ul>
                {/if}
            </div>
        </div>

        <!-- Review Detail -->
        <div
            class="flex-1 bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden {!selectedTask
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
                <!-- Header -->
                <div
                    class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex justify-between items-center"
                >
                    <div>
                        <div class="flex items-center gap-3">
                            <button
                                class="md:hidden mr-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                aria-label="Close review"
                                onclick={() => (selectedTask = null)}
                            >
                                <svg
                                    class="w-6 h-6"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                    ><path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M15 19l-7-7 7-7"
                                    ></path></svg
                                >
                            </button>
                            <h3
                                class="text-lg font-bold text-gray-900 dark:text-white"
                            >
                                Reviewing Item #{selectedTask.contentItem.id}
                            </h3>
                            <span
                                class="text-xs font-medium bg-gray-200 text-gray-800 dark:bg-gray-600 dark:text-gray-300 px-2 py-0.5 rounded"
                            >
                                {selectedTask.contentType.name}
                            </span>
                        </div>
                        <p class="text-[0.7rem] text-gray-500 mt-1">
                            Workflow task: {selectedTask.workflow.name} mapped ➞
                            "{selectedTask.transition.toState}" state.
                            Submitted: {new Date(
                                selectedTask.task.updatedAt,
                            ).toLocaleString()}
                        </p>
                    </div>
                    <div class="flex gap-2">
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
                                <svg
                                    class="w-4 h-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                    ><path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M5 13l4 4L19 7"
                                    ></path></svg
                                >
                            {/if}
                            Approve
                        </button>
                    </div>
                </div>

                <!-- Data Preview -->
                <div
                    class="flex-1 overflow-y-auto p-6 bg-gray-100 dark:bg-gray-900"
                >
                    <div
                        class="bg-white dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                    >
                        <JsonCodeBlock
                            value={selectedTask!.contentItem.data}
                            label="Payload Data"
                            copyable={true}
                        />
                    </div>
                </div>
            {/if}
        </div>
    </div>
</div>
