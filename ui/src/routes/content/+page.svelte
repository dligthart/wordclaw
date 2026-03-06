<script lang="ts">
    import { fetchApi, ApiError } from "$lib/api";
    import { onMount } from "svelte";
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import { deepParseJson, formatJson } from "$lib/utils";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import JsonCodeBlock from "$lib/components/JsonCodeBlock.svelte";
    import { Icon, ArrowPath, ChevronLeft, XMark } from "svelte-hero-icons";

    type ContentTypeStats = {
        itemCount: number;
        lastItemUpdatedAt: string | null;
        statusCounts: Record<string, number>;
    };

    type ContentType = {
        id: number;
        name: string;
        slug: string;
        description?: string;
        schema: string;
        basePrice?: number;
        createdAt: string;
        updatedAt: string;
        stats?: ContentTypeStats;
    };

    type ContentItem = {
        id: number;
        contentTypeId: number;
        status: string;
        version: number;
        data: unknown;
        createdAt: string;
        updatedAt: string;
    };

    type ContentVersion = {
        id: number;
        version: number;
        status: string;
        data: unknown;
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

    type ContentListMeta = {
        total: number;
        offset: number;
        limit: number;
        hasMore: boolean;
    };

    type ItemSortKey = "updatedAt" | "createdAt" | "version";
    type ItemSortDir = "asc" | "desc";

    type DiffEntry = {
        key: string;
        before: string;
        after: string;
        change: "added" | "removed" | "changed";
    };

    const PAGE_SIZE = 20;
    const STATUS_OPTIONS = ["draft", "in_review", "published", "archived"];
    const PRIMARY_LABEL_FIELDS = ["title", "name", "headline", "slug"];
    const SUMMARY_FIELDS = [
        "summary",
        "excerpt",
        "description",
        "content",
        "body",
        "text",
    ];
    const DEFAULT_ITEMS_META: ContentListMeta = {
        total: 0,
        offset: 0,
        limit: PAGE_SIZE,
        hasMore: false,
    };

    let contentTypes = $state<ContentType[]>([]);
    let selectedType = $state<ContentType | null>(null);
    let items = $state<ContentItem[]>([]);
    let selectedItem = $state<ContentItem | null>(null);
    let versions = $state<ContentVersion[]>([]);
    let comments = $state<ReviewComment[]>([]);
    let activeWorkflow = $state<ActiveWorkflow | null>(null);

    let itemSearch = $state("");
    let filterStatus = $state("");
    let createdAfter = $state("");
    let createdBefore = $state("");
    let sortBy = $state<ItemSortKey>("updatedAt");
    let sortDir = $state<ItemSortDir>("desc");
    let itemsMeta = $state<ContentListMeta>({ ...DEFAULT_ITEMS_META });

    let selectedVersionForDiff = $state<number | null>(null);
    let newComment = $state("");
    let submittingReview = $state(false);
    let loading = $state(true);
    let loadingItems = $state(false);
    let error = $state<string | null>(null);
    let rollingBack = $state(false);

    let availableTransitions = $derived.by(() => {
        if (!activeWorkflow || !selectedItem) {
            return [];
        }

        const currentItem = selectedItem;
        return activeWorkflow.transitions.filter(
            (transition) => transition.fromState === currentItem.status,
        );
    });
    let currentRangeStart = $derived(items.length === 0 ? 0 : itemsMeta.offset + 1);
    let currentRangeEnd = $derived(
        items.length === 0 ? 0 : itemsMeta.offset + items.length,
    );
    let hasActiveFilters = $derived(
        Boolean(
            itemSearch.trim() ||
                filterStatus ||
                createdAfter ||
                createdBefore ||
                sortBy !== "updatedAt" ||
                sortDir !== "desc",
        ),
    );
    let selectedDiffVersion = $derived(
        selectedVersionForDiff === null
            ? versions[0] ?? null
            : versions.find(
                  (version) => version.version === selectedVersionForDiff,
              ) ?? versions[0] ?? null,
    );
    let selectedDiffEntries = $derived(
        selectedDiffVersion && selectedItem
            ? buildDiffEntries(
                  selectedItem.data,
                  selectedDiffVersion.data,
                  selectedItem.status,
                  selectedDiffVersion.status,
              )
            : [],
    );
    let sortedContentTypes = $derived.by(() =>
        [...contentTypes].sort((left, right) => {
            const leftLastActivity = left.stats?.lastItemUpdatedAt ?? "";
            const rightLastActivity = right.stats?.lastItemUpdatedAt ?? "";
            if (leftLastActivity !== rightLastActivity) {
                return rightLastActivity.localeCompare(leftLastActivity);
            }

            const leftCount = left.stats?.itemCount ?? 0;
            const rightCount = right.stats?.itemCount ?? 0;
            if (leftCount !== rightCount) {
                return rightCount - leftCount;
            }

            return left.name.localeCompare(right.name);
        }),
    );
    let selectedTypeStatusSummary = $derived.by(() =>
        selectedType ? summarizeTypeStatuses(selectedType) : [],
    );

    function normalizeMeta(meta: Record<string, unknown> | null | undefined): ContentListMeta {
        return {
            total: Number(meta?.total ?? 0),
            offset: Number(meta?.offset ?? 0),
            limit: Number(meta?.limit ?? PAGE_SIZE),
            hasMore: Boolean(meta?.hasMore),
        };
    }

    function parseStructuredData(payload: unknown): Record<string, unknown> | null {
        const parsed = deepParseJson(payload);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return null;
        }
        return parsed as Record<string, unknown>;
    }

    function truncate(value: string, max = 140): string {
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

    function resolveItemLabel(item: Pick<ContentItem, "id" | "data">): string {
        const structured = parseStructuredData(item.data);
        return pickFirstString(structured, PRIMARY_LABEL_FIELDS) ?? `Item #${item.id}`;
    }

    function resolveItemSummary(item: Pick<ContentItem, "data">): string {
        const structured = parseStructuredData(item.data);
        const preferred = pickFirstString(structured, SUMMARY_FIELDS);
        if (preferred) {
            return truncate(preferred, 160);
        }

        return truncate(formatJson(item.data), 160);
    }

    function resolveItemSlug(item: Pick<ContentItem, "data">): string | null {
        return pickFirstString(parseStructuredData(item.data), ["slug"]);
    }

    function resolveItemAttribution(
        item: Pick<ContentItem, "data">,
    ): string | null {
        return pickFirstString(parseStructuredData(item.data), [
            "author",
            "owner",
            "editor",
        ]);
    }

    function formatDate(value: string): string {
        return new Date(value).toLocaleDateString();
    }

    function formatDateTime(value: string): string {
        return new Date(value).toLocaleString();
    }

    function formatStatusLabel(status: string): string {
        return status
            .split("_")
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ");
    }

    function resolveSchemaSummary(type: ContentType): string {
        try {
            const parsed = JSON.parse(type.schema) as {
                properties?: Record<string, unknown>;
                required?: unknown[];
            };
            const fieldCount = Object.keys(parsed.properties ?? {}).length;
            const requiredCount = Array.isArray(parsed.required)
                ? parsed.required.length
                : 0;

            if (fieldCount === 0) {
                return "Custom schema";
            }

            return `${fieldCount} fields, ${requiredCount} required`;
        } catch {
            return "Custom schema";
        }
    }

    function toDateBoundary(date: string, boundary: "start" | "end"): string {
        return boundary === "start"
            ? `${date}T00:00:00.000Z`
            : `${date}T23:59:59.999Z`;
    }

    function resolveTypeItemCount(type: ContentType): number {
        return type.stats?.itemCount ?? 0;
    }

    function resolveTypeLastActivity(type: ContentType): string {
        if (!type.stats?.lastItemUpdatedAt) {
            return "No items yet";
        }

        return formatDateTime(type.stats.lastItemUpdatedAt);
    }

    function summarizeTypeStatuses(
        type: ContentType,
    ): Array<{ status: string; count: number }> {
        return Object.entries(type.stats?.statusCounts ?? {})
            .sort(([leftStatus, leftCount], [rightStatus, rightCount]) => {
                if (leftCount !== rightCount) {
                    return rightCount - leftCount;
                }

                return leftStatus.localeCompare(rightStatus);
            })
            .slice(0, 3)
            .map(([status, count]) => ({ status, count }));
    }

    function buildItemsQuery(offset = 0): string {
        if (!selectedType) return "";

        const params = new URLSearchParams({
            contentTypeId: String(selectedType.id),
            limit: String(PAGE_SIZE),
            offset: String(offset),
            sortBy,
            sortDir,
        });

        if (itemSearch.trim()) {
            params.set("q", itemSearch.trim());
        }

        if (filterStatus) {
            params.set("status", filterStatus);
        }

        if (createdAfter) {
            params.set("createdAfter", toDateBoundary(createdAfter, "start"));
        }

        if (createdBefore) {
            params.set("createdBefore", toDateBoundary(createdBefore, "end"));
        }

        return params.toString();
    }

    function resetSelectedItemContext() {
        selectedItem = null;
        versions = [];
        comments = [];
        selectedVersionForDiff = null;
        newComment = "";
    }

    function resetFilters() {
        itemSearch = "";
        filterStatus = "";
        createdAfter = "";
        createdBefore = "";
        sortBy = "updatedAt";
        sortDir = "desc";
    }

    async function loadContentTypes() {
        loading = true;
        error = null;

        try {
            const res = await fetchApi("/content-types?limit=200&includeStats=true");
            const nextTypes = res.data as ContentType[];
            const selectedTypeId = selectedType?.id ?? null;

            contentTypes = nextTypes;
            if (selectedTypeId !== null) {
                selectedType =
                    nextTypes.find((type) => type.id === selectedTypeId) ?? null;
                if (!selectedType) {
                    items = [];
                    itemsMeta = { ...DEFAULT_ITEMS_META };
                    activeWorkflow = null;
                    resetSelectedItemContext();
                }
            }
        } catch (err: any) {
            error = err.message || "Failed to load content types";
        } finally {
            loading = false;
        }
    }

    async function loadActiveWorkflow(typeId: number) {
        try {
            const response = await fetchApi(
                `/content-types/${typeId}/workflows/active`,
            );
            activeWorkflow = response.data ?? null;
        } catch {
            activeWorkflow = null;
        }
    }

    async function loadItems(
        offset = 0,
        preserveSelection = true,
    ): Promise<ContentItem[]> {
        if (!selectedType) return [];

        loadingItems = true;
        error = null;

        try {
            const response = await fetchApi(
                `/content-items?${buildItemsQuery(offset)}`,
            );
            const nextItems = response.data as ContentItem[];
            items = nextItems;
            itemsMeta = normalizeMeta(response.meta);

            if (preserveSelection && selectedItem) {
                const matching = nextItems.find(
                    (item) => item.id === selectedItem?.id,
                );
                if (matching) {
                    selectedItem = matching;
                } else {
                    resetSelectedItemContext();
                }
            } else if (!preserveSelection) {
                resetSelectedItemContext();
            }

            return nextItems;
        } catch (err: any) {
            error = err.message || "Failed to load items";
            items = [];
            itemsMeta = { ...DEFAULT_ITEMS_META };
            if (!preserveSelection) {
                resetSelectedItemContext();
            }
            return [];
        } finally {
            loadingItems = false;
        }
    }

    async function selectType(type: ContentType) {
        selectedType = type;
        activeWorkflow = null;
        resetFilters();
        itemsMeta = { ...DEFAULT_ITEMS_META };
        resetSelectedItemContext();

        await Promise.all([loadItems(0, false), loadActiveWorkflow(type.id)]);
    }

    async function selectItem(item: ContentItem) {
        selectedItem = item;
        versions = [];
        comments = [];
        selectedVersionForDiff = null;
        error = null;

        try {
            const response = await fetchApi(`/content-items/${item.id}/versions`);
            versions = response.data;
            selectedVersionForDiff = response.data[0]?.version ?? null;

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
        currentPayload: unknown,
        targetPayload: unknown,
        currentStatus?: string,
        targetStatus?: string,
    ): DiffEntry[] {
        const current = flattenValue(deepParseJson(currentPayload));
        const target = flattenValue(deepParseJson(targetPayload));
        const keys = new Set([...current.keys(), ...target.keys()]);
        const entries: DiffEntry[] = [];

        if (currentStatus && targetStatus && currentStatus !== targetStatus) {
            entries.push({
                key: "status",
                before: currentStatus,
                after: targetStatus,
                change: "changed",
            });
        }

        for (const key of Array.from(keys).sort()) {
            const before = current.get(key);
            const after = target.get(key);

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

    function formatDiffSummary(entries: DiffEntry[], maxItems = 4): string {
        if (entries.length === 0) {
            return "No field-level payload changes are expected.";
        }

        const visible = entries.slice(0, maxItems).map((entry) => {
            return `- ${entry.key}: ${entry.before} -> ${entry.after}`;
        });
        const remaining = entries.length - visible.length;

        return [
            `${entries.length} field-level change(s):`,
            ...visible,
            ...(remaining > 0 ? [`- +${remaining} more field(s)`] : []),
        ].join("\n");
    }

    async function rollbackToVersion(version: number) {
        if (!selectedItem) return;

        const targetVersion =
            versions.find((candidate) => candidate.version === version) ?? null;
        const diffSummary = targetVersion
            ? formatDiffSummary(
                  buildDiffEntries(
                      selectedItem.data,
                      targetVersion.data,
                      selectedItem.status,
                      targetVersion.status,
                  ),
              )
            : "Historical snapshot unavailable.";

        feedbackStore.openConfirm({
            title: "Rollback Content",
            message: [
                `Rollback "${resolveItemLabel(selectedItem)}" from version ${selectedItem.version} to version ${version}?`,
                "",
                "Supervisor summary:",
                diffSummary,
            ].join("\n"),
            confirmLabel: "Rollback",
            confirmIntent: "danger",
            onConfirm: async () => {
                rollingBack = true;
                const currentItemId = selectedItem!.id;

                try {
                    await fetchApi(`/content-items/${currentItemId}/rollback`, {
                        method: "POST",
                        body: JSON.stringify({ version }),
                    });

                    const refreshedItems = await loadItems(itemsMeta.offset, true);
                    const refreshedItem =
                        refreshedItems.find((item) => item.id === currentItemId) ??
                        null;

                    if (refreshedItem) {
                        await selectItem(refreshedItem);
                    } else {
                        resetSelectedItemContext();
                    }

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
        if (!selectedItem || !selectedType) return;
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

            const refreshedItems = await loadItems(itemsMeta.offset, true);
            const refreshedItem =
                refreshedItems.find((item) => item.id === selectedItem?.id) ??
                null;

            if (refreshedItem) {
                await selectItem(refreshedItem);
            } else {
                resetSelectedItemContext();
            }
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
            const response = await fetchApi(
                `/content-items/${selectedItem.id}/comments`,
                {
                    method: "POST",
                    body: JSON.stringify({ comment: newComment }),
                },
            );
            comments = [response.data, ...comments];
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

    function applyFilters() {
        if (!selectedType) return;
        void loadItems(0, false);
    }

    function clearFilters() {
        resetFilters();
        if (!selectedType) return;
        void loadItems(0, false);
    }

    function applyStatusFilter(status: string) {
        if (!selectedType) return;
        filterStatus = status;
        void loadItems(0, false);
    }

    function clearFilterChip(
        filter: "search" | "status" | "createdAfter" | "createdBefore",
    ) {
        if (filter === "search") {
            itemSearch = "";
        } else if (filter === "status") {
            filterStatus = "";
        } else if (filter === "createdAfter") {
            createdAfter = "";
        } else if (filter === "createdBefore") {
            createdBefore = "";
        }

        if (!selectedType) return;
        void loadItems(0, false);
    }

    function goToNextPage() {
        if (!itemsMeta.hasMore || loadingItems) return;
        void loadItems(itemsMeta.offset + itemsMeta.limit, false);
    }

    function goToPrevPage() {
        if (itemsMeta.offset === 0 || loadingItems) return;
        void loadItems(Math.max(0, itemsMeta.offset - itemsMeta.limit), false);
    }

    onMount(() => {
        void loadContentTypes();
    });
</script>

<svelte:head>
    <title>Content Browser | WordClaw Supervisor</title>
</svelte:head>

<div class="h-full flex flex-col">
    <div class="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
            <h2 class="text-2xl font-bold text-gray-900 dark:text-white">
                Content Browser
            </h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Find content by title, slug, status, or date, then inspect
                version history before taking workflow or rollback actions.
            </p>
        </div>
        <button
            type="button"
            onclick={() => {
                const selectedTypeId = selectedType?.id;
                if (selectedTypeId) {
                    void Promise.all([
                        loadContentTypes(),
                        loadItems(itemsMeta.offset, true),
                        loadActiveWorkflow(selectedTypeId),
                    ]);
                } else {
                    void loadContentTypes();
                }
            }}
            class="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
            <Icon src={ArrowPath} class="w-4 h-4" />
            Refresh
        </button>
    </div>

    {#if error}
        <ErrorBanner class="mb-6" message={error} />
    {/if}

    <div class="flex-1 flex flex-col lg:flex-row gap-6 overflow-hidden">
        <aside
            class="w-full lg:w-80 bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden {selectedType
                ? 'hidden lg:flex'
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
            <div class="flex-1 overflow-y-auto p-3">
                {#if loading}
                    <div class="flex justify-center p-8">
                        <LoadingSpinner size="md" />
                    </div>
                {:else if contentTypes.length === 0}
                    <p class="text-center text-sm text-gray-500 p-8">
                        No types defined.
                    </p>
                {:else}
                    <ul class="space-y-2">
                        {#each sortedContentTypes as type}
                            {@const typeStatusSummary =
                                summarizeTypeStatuses(type)}
                            <li>
                                <button
                                    type="button"
                                    onclick={() => selectType(type)}
                                    class="w-full text-left rounded-xl border px-4 py-3 transition-colors {selectedType?.id ===
                                    type.id
                                        ? 'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-100'
                                        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-600 dark:hover:bg-gray-700/60'}"
                                >
                                    <div
                                        class="flex items-start justify-between gap-3"
                                    >
                                        <div>
                                            <div class="font-semibold">
                                                {type.name}
                                            </div>
                                            <div
                                                class="mt-1 text-xs font-mono text-gray-500 dark:text-gray-400"
                                            >
                                                {type.slug}
                                            </div>
                                        </div>
                                        {#if (type.basePrice ?? 0) > 0}
                                            <span
                                                class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
                                            >
                                                Paid
                                            </span>
                                        {/if}
                                    </div>
                                    <p
                                        class="mt-3 text-sm text-gray-600 dark:text-gray-300 line-clamp-2"
                                    >
                                        {type.description ||
                                            "Structured content model for supervised AI and operator workflows."}
                                    </p>
                                    <div class="mt-3 grid grid-cols-2 gap-2">
                                        <div
                                            class="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-700/60"
                                        >
                                            <div
                                                class="text-[0.65rem] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                                            >
                                                Items
                                            </div>
                                            <div
                                                class="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100"
                                            >
                                                {resolveTypeItemCount(type)}
                                            </div>
                                        </div>
                                        <div
                                            class="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-700/60"
                                        >
                                            <div
                                                class="text-[0.65rem] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                                            >
                                                Last item
                                            </div>
                                            <div
                                                class="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100"
                                            >
                                                {resolveTypeLastActivity(type)}
                                            </div>
                                        </div>
                                    </div>
                                    {#if typeStatusSummary.length > 0}
                                        <div class="mt-3 flex flex-wrap gap-1.5">
                                            {#each typeStatusSummary as summary}
                                                <span
                                                    class="inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-[0.65rem] font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                                                >
                                                    {formatStatusLabel(
                                                        summary.status,
                                                    )}
                                                    <span class="ml-1 font-mono"
                                                        >{summary.count}</span
                                                    >
                                                </span>
                                            {/each}
                                        </div>
                                    {/if}
                                    <div
                                        class="mt-3 flex items-center justify-between text-[0.7rem] text-gray-500 dark:text-gray-400"
                                    >
                                        <span>{resolveSchemaSummary(type)}</span>
                                        <span
                                            >Model updated {formatDate(
                                                type.updatedAt,
                                            )}</span
                                        >
                                    </div>
                                </button>
                            </li>
                        {/each}
                    </ul>
                {/if}
            </div>
        </aside>

        <div
            class="flex-1 flex flex-col xl:flex-row gap-6 overflow-hidden {!selectedType
                ? 'hidden lg:flex'
                : 'flex'}"
        >
            {#if !selectedType}
                <div
                    class="flex-1 bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-400 italic text-sm"
                >
                    Select a content model to view items.
                </div>
            {:else}
                <section
                    class="{selectedItem
                        ? 'hidden xl:flex xl:w-[30rem]'
                        : 'w-full'} transition-all duration-300 bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden"
                >
                    <div
                        class="px-4 py-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-br from-gray-50 to-white dark:from-gray-700/60 dark:to-gray-800/90"
                    >
                        <div
                            class="flex items-start justify-between gap-3 flex-wrap"
                        >
                            <div class="flex items-start gap-3 min-w-0">
                                <button
                                    class="lg:hidden mt-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                    aria-label="Back to models"
                                    onclick={() => {
                                        selectedType = null;
                                        activeWorkflow = null;
                                        items = [];
                                        itemsMeta = { ...DEFAULT_ITEMS_META };
                                        resetSelectedItemContext();
                                    }}
                                >
                                    <Icon src={ChevronLeft} class="w-5 h-5" />
                                </button>
                                <div class="min-w-0">
                                    <div class="flex flex-wrap items-center gap-2">
                                        <h3
                                            class="text-base font-semibold text-gray-900 dark:text-white"
                                        >
                                            {selectedType.name}
                                        </h3>
                                        {#if (selectedType.basePrice ?? 0) > 0}
                                            <span
                                                class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
                                            >
                                                Paid
                                            </span>
                                        {/if}
                                        {#if activeWorkflow}
                                            <span
                                                class="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-blue-800 dark:bg-blue-900/30 dark:text-blue-200"
                                            >
                                                Workflow active
                                            </span>
                                        {/if}
                                    </div>
                                    <p
                                        class="mt-1 text-xs font-mono text-gray-500 dark:text-gray-400"
                                    >
                                        {selectedType.slug}
                                    </p>
                                    <p
                                        class="mt-2 max-w-3xl text-sm text-gray-600 dark:text-gray-300"
                                    >
                                        {selectedType.description ||
                                            "Structured content model for supervised AI and operator workflows."}
                                    </p>
                                </div>
                            </div>
                            <div class="flex flex-wrap items-center gap-2">
                                <span
                                    class="inline-flex items-center rounded-full bg-gray-200 px-2.5 py-1 text-xs font-bold text-gray-700 dark:bg-gray-600 dark:text-gray-200"
                                >
                                    {itemsMeta.total} items
                                </span>
                                <span
                                    class="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                                >
                                    {resolveSchemaSummary(selectedType)}
                                </span>
                            </div>
                        </div>

                        <form
                            class="mt-4 rounded-2xl border border-gray-200 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-gray-700 dark:bg-gray-900/30"
                            onsubmit={(event) => {
                                event.preventDefault();
                                applyFilters();
                            }}
                        >
                            <div class="grid gap-3 xl:grid-cols-[minmax(0,1.8fr)_220px_220px_auto] xl:items-end">
                                <div>
                                    <label
                                        for="content-search"
                                        class="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1"
                                    >
                                        Find items
                                    </label>
                                    <input
                                        id="content-search"
                                        bind:value={itemSearch}
                                        type="search"
                                        placeholder="Search title, slug, excerpt, author, or item ID"
                                        class="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                </div>

                                <div>
                                    <label
                                        for="sort-by"
                                        class="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1"
                                    >
                                        Sort by
                                    </label>
                                    <select
                                        id="sort-by"
                                        bind:value={sortBy}
                                        class="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    >
                                        <option value="updatedAt">
                                            Updated
                                        </option>
                                        <option value="createdAt">
                                            Created
                                        </option>
                                        <option value="version">
                                            Version
                                        </option>
                                    </select>
                                </div>

                                <div>
                                    <label
                                        for="sort-dir"
                                        class="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1"
                                    >
                                        Order
                                    </label>
                                    <select
                                        id="sort-dir"
                                        bind:value={sortDir}
                                        class="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    >
                                        <option value="desc">Newest first</option>
                                        <option value="asc">Oldest first</option>
                                    </select>
                                </div>

                                <div
                                    class="flex flex-wrap items-center gap-2 xl:justify-end"
                                >
                                    <button
                                        type="submit"
                                        class="inline-flex items-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                                    >
                                        Apply
                                    </button>
                                    {#if hasActiveFilters}
                                        <button
                                            type="button"
                                            onclick={clearFilters}
                                            class="inline-flex items-center rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                                        >
                                            Clear
                                        </button>
                                    {/if}
                                </div>
                            </div>

                            <div class="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_180px_180px] xl:items-end">
                                <div>
                                    <p
                                        class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                                    >
                                        Quick status
                                    </p>
                                    <div class="mt-2 flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onclick={() => applyStatusFilter("")}
                                            class="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors {filterStatus ===
                                            ''
                                                ? 'border-blue-400 bg-blue-50 text-blue-900 dark:border-blue-600 dark:bg-blue-900/30 dark:text-blue-100'
                                                : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}"
                                        >
                                            <span>All items</span>
                                            <span class="font-mono"
                                                >{resolveTypeItemCount(
                                                    selectedType,
                                                )}</span
                                            >
                                        </button>
                                        {#each selectedTypeStatusSummary as summary}
                                            <button
                                                type="button"
                                                onclick={() =>
                                                    applyStatusFilter(
                                                        summary.status,
                                                    )}
                                                class="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors {filterStatus ===
                                                summary.status
                                                    ? 'border-blue-400 bg-blue-50 text-blue-900 dark:border-blue-600 dark:bg-blue-900/30 dark:text-blue-100'
                                                    : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}"
                                            >
                                                <span
                                                    >{formatStatusLabel(
                                                        summary.status,
                                                    )}</span
                                                >
                                                <span class="font-mono"
                                                    >{summary.count}</span
                                                >
                                            </button>
                                        {/each}
                                    </div>
                                </div>

                                <div>
                                    <label
                                        for="created-after"
                                        class="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1"
                                    >
                                        Created after
                                    </label>
                                    <input
                                        id="created-after"
                                        bind:value={createdAfter}
                                        type="date"
                                        class="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                </div>

                                <div>
                                    <label
                                        for="created-before"
                                        class="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1"
                                    >
                                        Created before
                                    </label>
                                    <input
                                        id="created-before"
                                        bind:value={createdBefore}
                                        type="date"
                                        class="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                </div>
                            </div>

                            {#if hasActiveFilters}
                                <div
                                    class="mt-3 border-t border-gray-200 pt-3 dark:border-gray-700"
                                >
                                    <p
                                        class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                                    >
                                        Active filters
                                    </p>
                                    <div class="mt-2 flex flex-wrap gap-2">
                                        {#if itemSearch.trim()}
                                            <button
                                                type="button"
                                                onclick={() =>
                                                    clearFilterChip("search")}
                                                class="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-900 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-100"
                                            >
                                                <span
                                                    >Search: "{itemSearch.trim()}"</span
                                                >
                                                <span aria-hidden="true">×</span>
                                            </button>
                                        {/if}
                                        {#if filterStatus}
                                            <button
                                                type="button"
                                                onclick={() =>
                                                    clearFilterChip("status")}
                                                class="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-900 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-100"
                                            >
                                                <span
                                                    >Status: {formatStatusLabel(
                                                        filterStatus,
                                                    )}</span
                                                >
                                                <span aria-hidden="true">×</span>
                                            </button>
                                        {/if}
                                        {#if createdAfter}
                                            <button
                                                type="button"
                                                onclick={() =>
                                                    clearFilterChip(
                                                        "createdAfter",
                                                    )}
                                                class="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-900 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-100"
                                            >
                                                <span
                                                    >After: {formatDate(
                                                        `${createdAfter}T00:00:00.000Z`,
                                                    )}</span
                                                >
                                                <span aria-hidden="true">×</span>
                                            </button>
                                        {/if}
                                        {#if createdBefore}
                                            <button
                                                type="button"
                                                onclick={() =>
                                                    clearFilterChip(
                                                        "createdBefore",
                                                    )}
                                                class="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-900 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-100"
                                            >
                                                <span
                                                    >Before: {formatDate(
                                                        `${createdBefore}T00:00:00.000Z`,
                                                    )}</span
                                                >
                                                <span aria-hidden="true">×</span>
                                            </button>
                                        {/if}
                                    </div>
                                </div>
                            {/if}
                        </form>
                    </div>

                    <div class="flex-1 overflow-y-auto p-3 relative">
                        <div
                            class="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50/80 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/20"
                        >
                            <div>
                                <p
                                    class="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400"
                                >
                                    Results
                                </p>
                                <p
                                    class="mt-1 text-sm font-medium text-gray-800 dark:text-gray-100"
                                >
                                    Showing {currentRangeStart}-{currentRangeEnd}
                                    of {itemsMeta.total}
                                </p>
                                <p
                                    class="mt-1 text-xs text-gray-500 dark:text-gray-400"
                                >
                                    {hasActiveFilters
                                        ? "Filtered list for the selected model."
                                        : "Most recent items first. Select an item to inspect its history."}
                                </p>
                            </div>
                            {#if activeWorkflow}
                                <div
                                    class="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:bg-blue-900/20 dark:text-blue-100"
                                >
                                    <div class="font-semibold uppercase tracking-wide">
                                        Workflow
                                    </div>
                                    <div class="mt-1">{activeWorkflow.name}</div>
                                </div>
                            {/if}
                        </div>

                        {#if loadingItems && items.length === 0}
                            <div class="flex justify-center p-10">
                                <LoadingSpinner size="md" />
                            </div>
                        {:else if items.length === 0}
                            <div
                                class="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-8 text-center text-sm text-gray-500 dark:text-gray-400"
                            >
                                <p>
                                    No items found matching the current filters.
                                </p>
                                {#if hasActiveFilters}
                                    <button
                                        type="button"
                                        onclick={clearFilters}
                                        class="mt-4 inline-flex items-center rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                                    >
                                        Reset filters
                                    </button>
                                {/if}
                            </div>
                        {:else}
                            <ul class="space-y-3">
                                {#each items as item}
                                    <li>
                                        <button
                                            type="button"
                                            onclick={() => selectItem(item)}
                                            class="w-full text-left rounded-xl border p-4 transition-all {selectedItem?.id ===
                                            item.id
                                                ? 'border-blue-400 ring-2 ring-blue-200 dark:border-blue-500 dark:ring-blue-900/50 bg-blue-50/70 dark:bg-blue-900/20'
                                                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-gray-600 dark:hover:bg-gray-700/40'}"
                                        >
                                            <div
                                                class="flex items-start justify-between gap-3"
                                            >
                                                <div class="min-w-0">
                                                    <p
                                                        class="text-sm font-semibold text-gray-900 dark:text-white truncate"
                                                    >
                                                        {resolveItemLabel(item)}
                                                    </p>
                                                    <div
                                                        class="mt-1 flex flex-wrap items-center gap-2 text-[0.7rem] text-gray-500 dark:text-gray-400"
                                                    >
                                                        <span
                                                            class="font-mono"
                                                        >
                                                            #{item.id}
                                                        </span>
                                                        {#if resolveItemSlug(item)}
                                                            <span
                                                                class="font-mono"
                                                            >
                                                                {resolveItemSlug(
                                                                    item,
                                                                )}
                                                            </span>
                                                        {/if}
                                                        {#if resolveItemAttribution(item)}
                                                            <span>
                                                                by {resolveItemAttribution(
                                                                    item,
                                                                )}
                                                            </span>
                                                        {/if}
                                                    </div>
                                                </div>
                                                <div
                                                    class="flex items-center gap-2 shrink-0"
                                                >
                                                    <span
                                                        class="inline-flex items-center rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider {item.status ===
                                                        'published'
                                                            ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400'
                                                            : item.status ===
                                                                    'in_review'
                                                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                                                : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'}"
                                                    >
                                                        {formatStatusLabel(
                                                            item.status,
                                                        )}
                                                    </span>
                                                    <span
                                                        class="text-xs font-mono text-gray-500 dark:text-gray-400"
                                                    >
                                                        v{item.version}
                                                    </span>
                                                </div>
                                            </div>

                                            <p
                                                class="mt-3 text-sm text-gray-600 dark:text-gray-300 line-clamp-3"
                                            >
                                                {resolveItemSummary(item)}
                                            </p>

                                            <div
                                                class="mt-4 flex flex-wrap items-center gap-2 text-[0.7rem] text-gray-500 dark:text-gray-400"
                                            >
                                                <span
                                                    class="rounded-full bg-gray-100 px-2 py-1 dark:bg-gray-700"
                                                >
                                                    Updated {formatDate(
                                                        item.updatedAt,
                                                    )}
                                                </span>
                                                <span
                                                    class="rounded-full bg-gray-100 px-2 py-1 dark:bg-gray-700"
                                                >
                                                    Created {formatDate(
                                                        item.createdAt,
                                                    )}
                                                </span>
                                            </div>
                                        </button>
                                    </li>
                                {/each}
                            </ul>
                        {/if}

                        {#if loadingItems && items.length > 0}
                            <div
                                class="absolute inset-0 bg-white/50 dark:bg-gray-900/50 flex items-center justify-center"
                            >
                                <LoadingSpinner size="lg" />
                            </div>
                        {/if}
                    </div>

                    <div
                        class="border-t border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between gap-3 text-sm"
                    >
                        <p class="text-gray-600 dark:text-gray-300">
                            Showing {currentRangeStart}-{currentRangeEnd} of
                            {itemsMeta.total}
                        </p>
                        <div class="flex items-center gap-2">
                            <button
                                type="button"
                                onclick={goToPrevPage}
                                disabled={itemsMeta.offset === 0 || loadingItems}
                                class="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Previous
                            </button>
                            <button
                                type="button"
                                onclick={goToNextPage}
                                disabled={!itemsMeta.hasMore || loadingItems}
                                class="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                </section>

                {#if selectedItem}
                    <section
                        class="flex-1 bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden"
                    >
                        <div
                            class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex items-start justify-between gap-4"
                        >
                            <div class="min-w-0">
                                <div class="flex items-center gap-3">
                                    <button
                                        class="xl:hidden text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                        aria-label="Close detail"
                                        onclick={() => resetSelectedItemContext()}
                                    >
                                        <Icon
                                            src={ChevronLeft}
                                            class="w-5 h-5"
                                        />
                                    </button>
                                    <h2
                                        class="text-lg font-bold text-gray-900 dark:text-white truncate"
                                    >
                                        {resolveItemLabel(selectedItem)}
                                    </h2>
                                    <span
                                    class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider {selectedItem.status ===
                                        'published'
                                            ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400'
                                            : selectedItem.status ===
                                                    'in_review'
                                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                                : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'}"
                                    >
                                        {formatStatusLabel(selectedItem.status)}
                                    </span>
                                </div>
                                <p
                                    class="mt-2 text-sm text-gray-600 dark:text-gray-300"
                                >
                                    {resolveItemSummary(selectedItem)}
                                </p>
                                <div
                                    class="mt-3 flex flex-wrap items-center gap-2 text-[0.7rem] text-gray-500 dark:text-gray-400"
                                >
                                    <span class="font-mono"
                                        >Item #{selectedItem.id}</span
                                    >
                                    <span class="font-mono"
                                        >Current version v{selectedItem.version}</span
                                    >
                                    <span
                                        >Updated {formatDateTime(
                                            selectedItem.updatedAt,
                                        )}</span
                                    >
                                </div>
                            </div>
                            <button
                                type="button"
                                aria-label="Close detail view"
                                onclick={() => resetSelectedItemContext()}
                                class="text-gray-400 hover:text-gray-500"
                            >
                                <Icon src={XMark} class="w-5 h-5" />
                            </button>
                        </div>

                        <div class="flex-1 overflow-y-auto p-6 space-y-6">
                            <div class="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                                <div
                                    class="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900/30"
                                >
                                    <h4
                                        class="text-sm font-semibold text-gray-900 dark:text-white"
                                    >
                                        Current Snapshot
                                    </h4>
                                    <p
                                        class="mt-1 text-xs text-gray-500 dark:text-gray-400"
                                    >
                                        Readable summary of the current content
                                        item before reviewing raw JSON.
                                    </p>
                                    <dl class="mt-4 grid grid-cols-1 gap-3 text-sm">
                                        <div>
                                            <dt
                                                class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                                            >
                                                Primary label
                                            </dt>
                                            <dd
                                                class="mt-1 text-gray-900 dark:text-white"
                                            >
                                                {resolveItemLabel(selectedItem)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt
                                                class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                                            >
                                                Summary
                                            </dt>
                                            <dd
                                                class="mt-1 text-gray-700 dark:text-gray-300"
                                            >
                                                {resolveItemSummary(selectedItem)}
                                            </dd>
                                        </div>
                                        <div
                                            class="grid grid-cols-2 gap-3 text-xs text-gray-500 dark:text-gray-400"
                                        >
                                            <div>
                                                <dt class="font-semibold uppercase">
                                                    Status
                                                </dt>
                                                <dd class="mt-1 text-sm">
                                                    {formatStatusLabel(
                                                        selectedItem.status,
                                                    )}
                                                </dd>
                                            </div>
                                            <div>
                                                <dt class="font-semibold uppercase">
                                                    Version
                                                </dt>
                                                <dd class="mt-1 text-sm">
                                                    v{selectedItem.version}
                                                </dd>
                                            </div>
                                        </div>
                                    </dl>
                                </div>

                                <div
                                    class="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-900/10"
                                >
                                    <div
                                        class="flex items-start justify-between gap-3 flex-wrap"
                                    >
                                        <div>
                                            <h4
                                                class="text-sm font-semibold text-gray-900 dark:text-white"
                                            >
                                                Version Diff
                                            </h4>
                                            <p
                                                class="mt-1 text-xs text-gray-500 dark:text-gray-400"
                                            >
                                                Compare the current item to a
                                                historical version before
                                                rollback.
                                            </p>
                                        </div>
                                        {#if versions.length > 0}
                                            <select
                                                onchange={(event) => {
                                                    selectedVersionForDiff = Number(
                                                        (
                                                            event.currentTarget as HTMLSelectElement
                                                        ).value,
                                                    );
                                                }}
                                                class="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                                            >
                                                {#each versions as version}
                                                    <option
                                                        value={version.version}
                                                        selected={selectedDiffVersion?.version ===
                                                            version.version}
                                                    >
                                                        Compare with v{version.version}
                                                    </option>
                                                {/each}
                                            </select>
                                        {/if}
                                    </div>

                                    {#if !selectedDiffVersion}
                                        <p
                                            class="mt-4 text-sm text-gray-500 dark:text-gray-400 italic"
                                        >
                                            No historical versions available for
                                            comparison.
                                        </p>
                                    {:else}
                                        <div class="mt-4 space-y-3">
                                            <div
                                                class="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-xs text-blue-900 dark:text-blue-200"
                                            >
                                                Comparing current version
                                                v{selectedItem.version} with
                                                v{selectedDiffVersion.version}.
                                                {selectedDiffEntries.length}
                                                field-level difference(s)
                                                detected.
                                            </div>

                                            {#if selectedDiffEntries.length === 0}
                                                <p
                                                    class="text-sm text-gray-500 dark:text-gray-400 italic"
                                                >
                                                    No payload changes detected
                                                    between the selected
                                                    versions.
                                                </p>
                                            {:else}
                                                <div
                                                    class="max-h-72 overflow-y-auto space-y-2 pr-1"
                                                >
                                                    {#each selectedDiffEntries as entry}
                                                        <div
                                                            class="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-3"
                                                        >
                                                            <div
                                                                class="flex items-center justify-between gap-3"
                                                            >
                                                                <code
                                                                    class="text-xs font-semibold text-gray-800 dark:text-gray-100"
                                                                >
                                                                    {entry.key}
                                                                </code>
                                                                <span
                                                                    class="text-[0.65rem] font-semibold uppercase tracking-wide {entry.change ===
                                                                    'added'
                                                                        ? 'text-green-600 dark:text-green-400'
                                                                        : entry.change ===
                                                                                'removed'
                                                                            ? 'text-red-600 dark:text-red-400'
                                                                            : 'text-amber-600 dark:text-amber-300'}"
                                                                >
                                                                    {entry.change}
                                                                </span>
                                                            </div>
                                                            <div
                                                                class="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-2 text-xs"
                                                            >
                                                                <div
                                                                    class="rounded-md bg-gray-50 dark:bg-gray-900/50 p-2"
                                                                >
                                                                    <p
                                                                        class="font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                                                                    >
                                                                        Current
                                                                    </p>
                                                                    <p
                                                                        class="mt-1 font-mono text-gray-700 dark:text-gray-200 break-words"
                                                                    >
                                                                        {entry.before}
                                                                    </p>
                                                                </div>
                                                                <div
                                                                    class="rounded-md bg-gray-50 dark:bg-gray-900/50 p-2"
                                                                >
                                                                    <p
                                                                        class="font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                                                                    >
                                                                        Selected
                                                                    </p>
                                                                    <p
                                                                        class="mt-1 font-mono text-gray-700 dark:text-gray-200 break-words"
                                                                    >
                                                                        {entry.after}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    {/each}
                                                </div>
                                            {/if}
                                        </div>
                                    {/if}
                                </div>
                            </div>

                            <div>
                                <h4
                                    class="text-sm font-semibold text-gray-900 dark:text-white mb-2 uppercase tracking-wide"
                                >
                                    Current Data Payload
                                </h4>
                                <JsonCodeBlock value={selectedItem.data} />
                            </div>

                            {#if activeWorkflow}
                                <div class="space-y-4">
                                    <hr class="border-gray-200 dark:border-gray-700" />
                                    <div>
                                        <h4
                                            class="text-sm font-semibold text-gray-900 dark:text-white mb-2 uppercase tracking-wide"
                                        >
                                            Workflow: {activeWorkflow.name}
                                        </h4>
                                        {#if availableTransitions.length > 0}
                                            <div
                                                class="flex flex-wrap gap-2 mb-4"
                                            >
                                                {#each availableTransitions as transition}
                                                    <button
                                                        type="button"
                                                        onclick={() =>
                                                            submitForReview(
                                                                transition.id,
                                                            )}
                                                        disabled={submittingReview}
                                                        class="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors shadow-sm disabled:opacity-50"
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
                                                class="text-sm text-gray-500 dark:text-gray-400 italic mb-4"
                                            >
                                                No transitions available from the
                                                current state.
                                            </p>
                                        {/if}
                                    </div>

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
                                                            class="flex justify-between items-center mb-1 gap-2"
                                                        >
                                                            <span
                                                                class="text-xs font-bold text-gray-800 dark:text-gray-200"
                                                            >
                                                                {comment.authorId}
                                                            </span>
                                                            <span
                                                                class="text-[0.65rem] text-gray-500"
                                                            >
                                                                {formatDateTime(
                                                                    comment.createdAt,
                                                                )}
                                                            </span>
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
                                            onsubmit={(event) => {
                                                event.preventDefault();
                                                void postComment();
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
                            {/if}

                            <hr class="border-gray-200 dark:border-gray-700" />

                            <div>
                                <h4
                                    class="text-sm font-semibold text-gray-900 dark:text-white mb-4 uppercase tracking-wide"
                                >
                                    Version Timeline
                                </h4>

                                <div class="space-y-4">
                                    <div
                                        class="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4"
                                    >
                                        <div
                                            class="flex items-start justify-between gap-3"
                                        >
                                            <div>
                                                <p
                                                    class="text-sm font-bold text-blue-900 dark:text-blue-200"
                                                >
                                                    Current State
                                                </p>
                                                <p
                                                    class="mt-1 text-xs text-blue-700 dark:text-blue-300"
                                                >
                                                    v{selectedItem.version} ·
                                                    {selectedItem.status} ·
                                                    {formatDateTime(
                                                        selectedItem.updatedAt,
                                                    )}
                                                </p>
                                            </div>
                                            <span
                                                class="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300"
                                            >
                                                Live
                                            </span>
                                        </div>
                                        <p
                                            class="mt-3 text-sm text-blue-900 dark:text-blue-100"
                                        >
                                            {resolveItemSummary(selectedItem)}
                                        </p>
                                    </div>

                                    {#each versions as version}
                                        {@const versionDiff = buildDiffEntries(
                                            selectedItem.data,
                                            version.data,
                                            selectedItem.status,
                                            version.status,
                                        )}
                                        <div
                                            class="rounded-xl border p-4 {selectedDiffVersion?.version ===
                                            version.version
                                                ? 'border-blue-300 bg-blue-50/70 dark:border-blue-700 dark:bg-blue-900/20'
                                                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}"
                                        >
                                            <div
                                                class="flex items-start justify-between gap-3 flex-wrap"
                                            >
                                                <div>
                                                    <p
                                                        class="text-sm font-bold text-gray-900 dark:text-white"
                                                    >
                                                        Version {version.version}
                                                    </p>
                                                    <p
                                                        class="mt-1 text-xs text-gray-500 dark:text-gray-400"
                                                    >
                                                        {version.status} ·
                                                        {formatDateTime(
                                                            version.createdAt,
                                                        )}
                                                    </p>
                                                </div>
                                                <div
                                                    class="flex items-center gap-2"
                                                >
                                                    <button
                                                        type="button"
                                                        onclick={() => {
                                                            selectedVersionForDiff = version.version;
                                                        }}
                                                        class="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
                                                    >
                                                        Compare
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onclick={() =>
                                                            rollbackToVersion(
                                                                version.version,
                                                            )}
                                                        disabled={rollingBack}
                                                        class="px-3 py-1.5 rounded-md bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50 text-xs font-medium disabled:opacity-50"
                                                    >
                                                        Rollback
                                                    </button>
                                                </div>
                                            </div>

                                            <p
                                                class="mt-3 text-sm text-gray-600 dark:text-gray-300"
                                            >
                                                {resolveItemSummary(version)}
                                            </p>

                                            <div
                                                class="mt-4 rounded-lg bg-gray-50 dark:bg-gray-900/40 p-3"
                                            >
                                                <p
                                                    class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                                                >
                                                    Diff Summary
                                                </p>
                                                <p
                                                    class="mt-2 text-sm text-gray-700 dark:text-gray-300"
                                                >
                                                    {versionDiff.length}
                                                    change(s) from the current
                                                    item.
                                                </p>
                                                {#if versionDiff.length > 0}
                                                    <ul
                                                        class="mt-3 space-y-2 text-xs text-gray-600 dark:text-gray-300"
                                                    >
                                                        {#each versionDiff.slice(0, 3) as entry}
                                                            <li>
                                                                <code
                                                                    class="font-semibold text-gray-800 dark:text-gray-100"
                                                                >
                                                                    {entry.key}
                                                                </code>
                                                                <span>
                                                                    : {entry.before}
                                                                    -> {entry.after}
                                                                </span>
                                                            </li>
                                                        {/each}
                                                        {#if versionDiff.length > 3}
                                                            <li
                                                                class="text-gray-500 dark:text-gray-400"
                                                            >
                                                                +{versionDiff.length -
                                                                    3} more
                                                                change(s)
                                                            </li>
                                                        {/if}
                                                    </ul>
                                                {/if}
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
                    </section>
                {/if}
            {/if}
        </div>
    </div>
</div>
