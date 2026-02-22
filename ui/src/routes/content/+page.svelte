<script lang="ts">
    import { fetchApi, ApiError } from "$lib/api";
    import { onMount } from "svelte";
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import { formatJson } from "$lib/utils";

    type ContentType = {
        id: number;
        name: string;
        slug: string;
        schema: any;
    };

    type ContentItem = {
        id: number;
        status: string;
        version: number;
        data: any;
        createdAt: string;
        updatedAt: string;
    };

    type ContentVersion = {
        id: number;
        version: number;
        status: string;
        data: any;
        createdAt: string;
    };

    type WorkflowTransition = {
        id: number;
        workflowId: number;
        fromState: string;
        toState: string;
        requiredRoles: string[];
    };

    type ActiveWorkflow = {
        id: number;
        name: string;
        contentTypeId: number;
        active: boolean;
        transitions: WorkflowTransition[];
    };

    type ReviewComment = {
        id: number;
        authorId: string;
        comment: string;
        createdAt: string;
    };

    let contentTypes = $state<ContentType[]>([]);
    let selectedType = $state<ContentType | null>(null);
    let items = $state<ContentItem[]>([]);
    let selectedItem = $state<ContentItem | null>(null);
    let versions = $state<ContentVersion[]>([]);
    let comments = $state<ReviewComment[]>([]);
    let activeWorkflow = $state<ActiveWorkflow | null>(null);

    let newComment = $state("");
    let submittingReview = $state(false);

    let loading = $state(true);
    let loadingItems = $state(false);
    let error = $state<string | null>(null);

    let rollingBack = $state(false);

    onMount(async () => {
        try {
            const res = await fetchApi("/content-types");
            contentTypes = res.data;
        } catch (err: any) {
            error = err.message || "Failed to load content types";
        } finally {
            loading = false;
        }
    });

    async function selectType(type: ContentType) {
        selectedType = type;
        selectedItem = null;
        versions = [];
        comments = [];
        activeWorkflow = null;
        loadingItems = true;

        try {
            const res = await fetchApi(
                `/content-items?contentTypeId=${type.id}&limit=50`,
            );
            items = res.data;

            try {
                const wfRes = await fetchApi(
                    `/content-types/${type.id}/workflows/active`,
                );
                if (wfRes.data) activeWorkflow = wfRes.data;
            } catch (e: any) {
                // Ignore, no active workflow
            }
        } catch (err: any) {
            error = err.message || "Failed to load items";
        } finally {
            loadingItems = false;
        }
    }

    async function selectItem(item: ContentItem) {
        selectedItem = item;
        try {
            const res = await fetchApi(`/content-items/${item.id}/versions`);
            versions = res.data;

            if (activeWorkflow) {
                const commentsRes = await fetchApi(
                    `/content-items/${item.id}/comments`,
                );
                comments = commentsRes.data;
            }
        } catch (err: any) {
            error = err.message || "Failed to load item context";
        }
    }

    async function rollbackToVersion(version: number) {
        if (!selectedItem) return;

        feedbackStore.openConfirm({
            title: "Rollback Content",
            message: `Are you sure you want to rollback to version ${version}? This will become the active state for the content item.`,
            confirmLabel: "Rollback",
            confirmIntent: "danger",
            onConfirm: async () => {
                rollingBack = true;
                try {
                    await fetchApi(
                        `/content-items/${selectedItem!.id}/rollback`,
                        {
                            method: "POST",
                            body: JSON.stringify({ version }),
                        },
                    );

                    const refreshedItem = items.find(
                        (i) => i.id === selectedItem!.id,
                    );
                    await selectType(selectedType!);
                    if (refreshedItem) await selectItem(refreshedItem);

                    feedbackStore.pushToast({
                        severity: "success",
                        title: "Rollback Applied",
                        message: `Successfully rolled back to version ${version}`,
                    });
                } catch (err: any) {
                    const isApiError = err instanceof ApiError;
                    feedbackStore.pushToast({
                        severity: "error",
                        title: "Rollback Failed",
                        message: err.message || "An error occurred.",
                        code: isApiError ? err.code : undefined,
                        remediation: isApiError ? err.remediation : undefined,
                    });
                    throw err;
                } finally {
                    rollingBack = false;
                }
            },
        });
    }

    async function submitForReview(transitionId: number) {
        if (!selectedItem) return;
        submittingReview = true;
        try {
            await fetchApi(`/content-items/${selectedItem.id}/submit`, {
                method: "POST",
                body: JSON.stringify({ workflowTransitionId: transitionId }),
            });
            feedbackStore.pushToast({
                severity: "success",
                title: "Submitted",
                message: "Item submitted for review.",
            });

            // Re-fetch item to get new status
            const refreshed = await fetchApi(
                `/content-items?contentTypeId=${selectedType!.id}&limit=50`,
            );
            items = refreshed.data;
            selectedItem = items.find((i) => i.id === selectedItem!.id) || null;
            if (selectedItem) await selectItem(selectedItem);
        } catch (err: any) {
            feedbackStore.pushToast({
                severity: "error",
                title: "Failed to submit",
                message: err.message,
            });
        } finally {
            submittingReview = false;
        }
    }

    async function postComment() {
        if (!newComment.trim() || !selectedItem) return;
        try {
            const res = await fetchApi(
                `/content-items/${selectedItem.id}/comments`,
                {
                    method: "POST",
                    body: JSON.stringify({ comment: newComment }),
                },
            );
            comments = [res.data, ...comments];
            newComment = "";
            feedbackStore.pushToast({
                severity: "success",
                title: "Comment Posted",
                message: "Your comment has been added.",
            });
        } catch (err: any) {
            feedbackStore.pushToast({
                severity: "error",
                title: "Failed to post comment",
                message: err.message,
            });
        }
    }
</script>

<svelte:head>
    <title>Content Browser | WordClaw Supervisor</title>
</svelte:head>

<div class="h-full flex flex-col">
    <div class="mb-6">
        <h2 class="text-2xl font-bold text-gray-900 dark:text-white">
            Content Browser
        </h2>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Read-only oversight of managed content and version history.
        </p>
    </div>

    {#if error}
        <div
            class="bg-red-50 dark:bg-red-900/30 border-l-4 border-red-500 p-4 mb-6 rounded"
        >
            <p class="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
    {/if}

    <div class="flex-1 flex flex-col md:flex-row gap-6 overflow-hidden">
        <!-- Content Types Sidebar -->
        <div
            class="w-full md:w-1/4 bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden {selectedType
                ? 'hidden md:flex'
                : 'flex'}"
        >
            <div
                class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50"
            >
                <h3
                    class="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                >
                    Models
                </h3>
            </div>
            <div class="flex-1 overflow-y-auto p-2">
                {#if loading}
                    <div class="flex justify-center p-4">
                        <div
                            class="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"
                        ></div>
                    </div>
                {:else if contentTypes.length === 0}
                    <p class="text-center text-sm text-gray-500 p-4">
                        No types defined.
                    </p>
                {:else}
                    <ul class="space-y-1">
                        {#each contentTypes as type}
                            <li>
                                <button
                                    onclick={() => selectType(type)}
                                    class="w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors {selectedType?.id ===
                                    type.id
                                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-750'}"
                                >
                                    <div class="font-medium">{type.name}</div>
                                    <div
                                        class="text-[0.65rem] text-gray-500 font-mono mt-0.5"
                                    >
                                        {type.slug}
                                    </div>
                                </button>
                            </li>
                        {/each}
                    </ul>
                {/if}
            </div>
        </div>

        <!-- Content Items / Detail View -->
        <div
            class="flex-1 flex flex-col md:flex-row gap-6 overflow-hidden {!selectedType
                ? 'hidden md:flex'
                : 'flex'}"
        >
            {#if !selectedType}
                <div
                    class="flex-1 bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-400 italic text-sm"
                >
                    Select a content model to view items
                </div>
            {:else}
                <!-- Items List -->
                <div
                    class="{selectedItem
                        ? 'hidden md:flex md:w-1/3'
                        : 'w-full'} transition-all duration-300 bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden"
                >
                    <div
                        class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex justify-between items-center"
                    >
                        <div class="flex items-center gap-2">
                            <button
                                class="md:hidden text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                aria-label="Back to models"
                                onclick={() => (selectedType = null)}
                            >
                                <svg
                                    class="w-5 h-5"
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
                                class="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                            >
                                Items in "{selectedType.name}"
                            </h3>
                        </div>
                        <span
                            class="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 py-0.5 px-2 rounded-full text-xs font-bold"
                            >{items.length}</span
                        >
                    </div>
                    <div class="flex-1 overflow-y-auto p-2">
                        {#if loadingItems}
                            <div class="flex justify-center p-8">
                                <div
                                    class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"
                                ></div>
                            </div>
                        {:else if items.length === 0}
                            <div
                                class="text-center p-8 text-sm text-gray-500 dark:text-gray-400"
                            >
                                No items found in this model.
                            </div>
                        {:else}
                            <ul class="space-y-2">
                                {#each items as item}
                                    <!-- A small card for each item -->
                                    <button
                                        onclick={() => selectItem(item)}
                                        class="w-full text-left bg-white dark:bg-gray-800 border {selectedItem?.id ===
                                        item.id
                                            ? 'border-blue-500 ring-1 ring-blue-500 shadow-sm'
                                            : 'border-gray-200 dark:border-gray-700 shadow-sm hover:border-gray-300 dark:hover:border-gray-600'} rounded-lg p-3 transition-all relative"
                                    >
                                        <div
                                            class="flex justify-between items-start mb-2"
                                        >
                                            <span
                                                class="inline-flex items-center px-2 py-0.5 rounded text-[0.65rem] font-bold uppercase tracking-wider
                                                {item.status === 'published'
                                                    ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400'
                                                    : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'}"
                                            >
                                                {item.status}
                                            </span>
                                            <span
                                                class="text-[0.65rem] font-mono text-gray-400"
                                                >v{item.version}</span
                                            >
                                        </div>

                                        <div
                                            class="text-xs text-gray-800 dark:text-gray-200 font-mono line-clamp-2 break-all opacity-80 mb-2"
                                        >
                                            <!-- Simple preview of JSON data -->
                                            {formatJson(item.data).substring(
                                                0,
                                                100,
                                            )}...
                                        </div>

                                        <div
                                            class="flex justify-between items-end text-[0.65rem] text-gray-400"
                                        >
                                            <span
                                                title={new Date(
                                                    item.updatedAt,
                                                ).toLocaleString()}
                                                >Updated {new Date(
                                                    item.updatedAt,
                                                ).toLocaleDateString()}</span
                                            >
                                            <span>ID: {item.id}</span>
                                        </div>
                                    </button>
                                {/each}
                            </ul>
                        {/if}
                    </div>
                </div>

                <!-- Item Detail & Versions -->
                {#if selectedItem}
                    <div
                        class="flex-1 bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden transition-all duration-300 w-full"
                    >
                        <!-- Top header -->
                        <div
                            class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex justify-between items-center"
                        >
                            <div>
                                <div class="flex items-center gap-3">
                                    <button
                                        class="md:hidden text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                        aria-label="Close detail"
                                        onclick={() => (selectedItem = null)}
                                    >
                                        <svg
                                            class="w-5 h-5"
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
                                    <h2
                                        class="text-lg font-bold text-gray-900 dark:text-white"
                                    >
                                        Item #{selectedItem.id}
                                    </h2>
                                    <span
                                        class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider
                                        {selectedItem.status === 'published'
                                            ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400'
                                            : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'}"
                                    >
                                        {selectedItem.status}
                                    </span>
                                </div>
                                <p class="text-[0.7rem] text-gray-500 mt-1">
                                    Current Version: v{selectedItem.version}
                                </p>
                            </div>
                            <button
                                aria-label="Close detail view"
                                onclick={() => (selectedItem = null)}
                                class="text-gray-400 hover:text-gray-500"
                            >
                                <svg
                                    class="w-5 h-5"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                    ><path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M6 18L18 6M6 6l12 12"
                                    ></path></svg
                                >
                            </button>
                        </div>

                        <div
                            class="flex-1 overflow-y-auto p-6 flex flex-col gap-6"
                        >
                            <!-- Current Data Display -->
                            <div>
                                <h4
                                    class="text-sm font-semibold text-gray-900 dark:text-white mb-2 uppercase tracking-wide"
                                >
                                    Current Data Payload
                                </h4>
                                <div
                                    class="bg-gray-900 rounded-md shadow-inner overflow-hidden border border-gray-700"
                                >
                                    <pre
                                        class="p-4 text-xs font-mono text-green-400 overflow-x-auto"><code
                                            >{formatJson(
                                                selectedItem.data,
                                            )}</code
                                        ></pre>
                                </div>
                            </div>

                            <hr class="border-gray-200 dark:border-gray-700" />

                            <!-- Workflow Actions (If Active) -->
                            {#if activeWorkflow}
                                <div>
                                    <h4
                                        class="text-sm font-semibold text-gray-900 dark:text-white mb-4 uppercase tracking-wide"
                                    >
                                        Workflow: {activeWorkflow.name}
                                    </h4>

                                    {#if activeWorkflow.transitions.filter((t) => t.fromState === selectedItem?.status).length > 0}
                                        <div class="flex flex-wrap gap-2 mb-6">
                                            {#each activeWorkflow.transitions.filter((t) => t.fromState === selectedItem?.status) as transition}
                                                <button
                                                    onclick={() =>
                                                        submitForReview(
                                                            transition.id,
                                                        )}
                                                    disabled={submittingReview}
                                                    class="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
                                                >
                                                    {transition.toState ===
                                                    "published"
                                                        ? "Publish"
                                                        : `Submit for ${transition.toState}`}
                                                </button>
                                            {/each}
                                        </div>
                                    {:else}
                                        <p
                                            class="text-xs text-gray-500 mb-6 italic"
                                        >
                                            No transitions available from
                                            current state.
                                        </p>
                                    {/if}

                                    <!-- Comments -->
                                    <div
                                        class="bg-gray-50 dark:bg-gray-700/30 rounded-lg border border-gray-200 dark:border-gray-600 p-4"
                                    >
                                        <h5
                                            class="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-3"
                                        >
                                            Discussion
                                        </h5>

                                        <div
                                            class="space-y-3 mb-4 max-h-48 overflow-y-auto pr-2"
                                        >
                                            {#if comments.length === 0}
                                                <p
                                                    class="text-xs text-center text-gray-400 italic"
                                                >
                                                    No comments yet.
                                                </p>
                                            {:else}
                                                {#each comments as comment}
                                                    <div
                                                        class="bg-white dark:bg-gray-800 p-3 rounded shadow-sm border border-gray-100 dark:border-gray-700"
                                                    >
                                                        <div
                                                            class="flex justify-between items-center mb-1"
                                                        >
                                                            <span
                                                                class="text-xs font-bold text-gray-800 dark:text-gray-200"
                                                                >{comment.authorId}</span
                                                            >
                                                            <span
                                                                class="text-[0.6rem] text-gray-500"
                                                                >{new Date(
                                                                    comment.createdAt,
                                                                ).toLocaleString()}</span
                                                            >
                                                        </div>
                                                        <p
                                                            class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap"
                                                        >
                                                            {comment.comment}
                                                        </p>
                                                    </div>
                                                {/each}
                                            {/if}
                                        </div>

                                        <form
                                            onsubmit={(e) => {
                                                e.preventDefault();
                                                postComment();
                                            }}
                                            class="flex gap-2"
                                        >
                                            <input
                                                type="text"
                                                bind:value={newComment}
                                                placeholder="Add a comment..."
                                                class="flex-1 rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm dark:bg-gray-800 dark:text-white"
                                            />
                                            <button
                                                type="submit"
                                                disabled={!newComment.trim()}
                                                class="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-500 text-gray-800 dark:text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
                                            >
                                                Post
                                            </button>
                                        </form>
                                    </div>
                                </div>
                                <hr
                                    class="border-gray-200 dark:border-gray-700 my-6"
                                />
                            {/if}

                            <!-- Version History -->
                            <div>
                                <h4
                                    class="text-sm font-semibold text-gray-900 dark:text-white mb-4 uppercase tracking-wide"
                                >
                                    Version Timeline
                                </h4>

                                <div
                                    class="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-gray-300 dark:before:via-gray-600 before:to-transparent"
                                >
                                    <!-- Current Version Node -->
                                    <div
                                        class="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active"
                                    >
                                        <div
                                            class="flex items-center justify-center w-10 h-10 rounded-full border-4 border-white dark:border-gray-800 bg-blue-500 text-white shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10 font-bold text-xs font-mono"
                                        >
                                            v{selectedItem.version}
                                        </div>
                                        <div
                                            class="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800 shadow-sm"
                                        >
                                            <div
                                                class="flex justify-between items-center mb-1"
                                            >
                                                <span
                                                    class="text-sm font-bold text-blue-900 dark:text-blue-200"
                                                    >Current State ({selectedItem.status})</span
                                                >
                                                <time
                                                    class="text-[0.65rem] text-blue-600 dark:text-blue-400 font-medium"
                                                    >{new Date(
                                                        selectedItem.updatedAt,
                                                    ).toLocaleString()}</time
                                                >
                                            </div>
                                            <div
                                                class="text-xs font-mono text-gray-600 dark:text-gray-400 bg-white/50 dark:bg-gray-900/50 p-2 rounded mt-2 max-h-24 overflow-y-auto"
                                            >
                                                {formatJson(
                                                    selectedItem.data,
                                                ).substring(0, 150)}...
                                            </div>
                                        </div>
                                    </div>

                                    {#each versions as v}
                                        <div
                                            class="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group"
                                        >
                                            <div
                                                class="flex items-center justify-center w-10 h-10 rounded-full border-4 border-white dark:border-gray-800 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10 font-bold text-xs font-mono"
                                            >
                                                v{v.version}
                                            </div>
                                            <div
                                                class="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow group-hover:border-gray-300 dark:group-hover:border-gray-600"
                                            >
                                                <div
                                                    class="flex justify-between items-center mb-2"
                                                >
                                                    <span
                                                        class="text-sm font-bold text-gray-700 dark:text-gray-300"
                                                        >Historical ({v.status})</span
                                                    >
                                                    <time
                                                        class="text-[0.65rem] text-gray-500 font-medium"
                                                        >{new Date(
                                                            v.createdAt,
                                                        ).toLocaleString()}</time
                                                    >
                                                </div>
                                                <div
                                                    class="text-xs font-mono text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 p-2 rounded mb-3 max-h-24 overflow-y-auto"
                                                >
                                                    {formatJson(
                                                        v.data,
                                                    ).substring(0, 150)}...
                                                </div>
                                                <button
                                                    onclick={() =>
                                                        rollbackToVersion(
                                                            v.version,
                                                        )}
                                                    disabled={rollingBack}
                                                    class="text-xs font-medium px-3 py-1.5 bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:hover:bg-purple-900/60 rounded transition-colors disabled:opacity-50"
                                                >
                                                    Rollback to this version
                                                </button>
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                                {#if versions.length === 0}
                                    <p
                                        class="text-sm text-gray-500 italic mt-4"
                                    >
                                        No historical versions found.
                                    </p>
                                {/if}
                            </div>
                        </div>
                    </div>
                {/if}
            {/if}
        </div>
    </div>
</div>
