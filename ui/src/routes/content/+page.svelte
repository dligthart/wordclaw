<script lang="ts">
    import { fetchApi, ApiError } from "$lib/api";
    import { onMount } from "svelte";
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import { deepParseJson, formatJson } from "$lib/utils";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import JsonCodeBlock from "$lib/components/JsonCodeBlock.svelte";
    import Badge from "$lib/components/ui/Badge.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Input from "$lib/components/ui/Input.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import Surface from "$lib/components/ui/Surface.svelte";
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

    type SchemaPreviewLine = {
        label: string;
        depth: number;
        required: boolean;
        typeLabel?: string;
        summary?: boolean;
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

    function resolveStatusBadgeVariant(
        status: string,
    ): "muted" | "success" | "warning" | "danger" {
        if (status === "published") return "success";
        if (status === "in_review") return "warning";
        if (status === "archived") return "danger";
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

        return formatDate(value);
    }

    function resolveSchemaTypeLabel(
        node: Record<string, unknown> | null,
    ): string | undefined {
        const type = typeof node?.type === "string" ? node.type : undefined;
        if (!type) return undefined;

        if (type === "string") return "text";
        if (type === "integer" || type === "number") return "num";
        if (type === "boolean") return "bool";
        if (type === "array") return "list";
        if (type === "object") return "group";
        return type;
    }

    function collectSchemaPreviewLines(
        properties: Record<string, unknown>,
        required: Set<string>,
        depth = 0,
        lines: SchemaPreviewLine[] = [],
        maxLines = 6,
    ): SchemaPreviewLine[] {
        const entries = Object.entries(properties);
        let processedAtDepth = 0;

        for (const [key, rawNode] of entries) {
            if (lines.length >= maxLines) {
                break;
            }

            processedAtDepth += 1;
            const node =
                rawNode && typeof rawNode === "object" && !Array.isArray(rawNode)
                    ? (rawNode as Record<string, unknown>)
                    : null;

            lines.push({
                label:
                    typeof node?.type === "string" && node.type === "array"
                        ? `${key}[]`
                        : key,
                depth,
                required: required.has(key),
                typeLabel: resolveSchemaTypeLabel(node),
            });

            const nestedProperties =
                node?.properties &&
                typeof node.properties === "object" &&
                !Array.isArray(node.properties)
                    ? (node.properties as Record<string, unknown>)
                    : null;

            if (nestedProperties && lines.length < maxLines && depth < 1) {
                const nestedRequired = new Set(
                    Array.isArray(node?.required)
                        ? node.required.filter(
                              (field): field is string =>
                                  typeof field === "string",
                          )
                        : [],
                );
                collectSchemaPreviewLines(
                    nestedProperties,
                    nestedRequired,
                    depth + 1,
                    lines,
                    maxLines,
                );
            }
        }

        const remaining = entries.length - processedAtDepth;
        if (remaining > 0 && lines.length < maxLines + 1) {
            lines.push({
                label: `+${remaining} more field${remaining === 1 ? "" : "s"}`,
                depth,
                required: false,
                summary: true,
            });
        }

        return lines.slice(0, maxLines + 1);
    }

    function resolveSchemaPreviewLines(type: ContentType): SchemaPreviewLine[] {
        try {
            const parsed = JSON.parse(type.schema) as {
                properties?: Record<string, unknown>;
                required?: unknown[];
            };
            const properties =
                parsed.properties &&
                typeof parsed.properties === "object" &&
                !Array.isArray(parsed.properties)
                    ? parsed.properties
                    : null;

            if (!properties || Object.keys(properties).length === 0) {
                return [
                    {
                        label: "Custom schema",
                        depth: 0,
                        required: false,
                        summary: true,
                    },
                ];
            }

            return collectSchemaPreviewLines(
                properties,
                new Set(
                    Array.isArray(parsed.required)
                        ? parsed.required.filter(
                              (field): field is string => typeof field === "string",
                          )
                        : [],
                ),
            );
        } catch {
            return [
                {
                    label: "Custom schema",
                    depth: 0,
                    required: false,
                    summary: true,
                },
            ];
        }
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
            <h2 class="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
                Content Browser
            </h2>
            <p class="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
                Find content by title, slug, status, or date, then inspect
                version history before taking workflow or rollback actions.
            </p>
        </div>
        <Button
            variant="outline"
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
        >
            <Icon src={ArrowPath} class="w-4 h-4" />
            Refresh
        </Button>
    </div>

    {#if error}
        <ErrorBanner class="mb-6" message={error} />
    {/if}

    <div class="flex-1 flex flex-col lg:flex-row gap-6 overflow-hidden">
        <aside
            class="w-full lg:w-72 xl:w-[17.5rem] flex flex-col overflow-hidden {selectedType
                ? 'hidden lg:flex'
                : 'flex'}"
        >
            <Surface class="flex h-full flex-col overflow-hidden p-0">
                <div
                    class="border-b border-slate-200/80 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/30"
                >
                    <div class="flex items-center justify-between gap-2">
                        <div>
                            <h3
                                class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                            >
                                Models
                            </h3>
                            <p class="mt-1 text-[0.72rem] text-slate-500 dark:text-slate-400">
                                Compact schema map
                            </p>
                        </div>
                        <Badge variant="muted">{contentTypes.length}</Badge>
                    </div>
                </div>
                <div class="flex-1 overflow-y-auto p-2.5">
                {#if loading}
                    <div class="flex justify-center p-8">
                        <LoadingSpinner size="md" />
                    </div>
                {:else if contentTypes.length === 0}
                    <p class="text-center text-sm text-gray-500 p-8">
                        No types defined.
                    </p>
                {:else}
                    <ul class="space-y-1.5">
                        {#each sortedContentTypes as type}
                            {@const typeStatusSummary =
                                summarizeTypeStatuses(type)}
                            {@const previewLines =
                                resolveSchemaPreviewLines(type)}
                            <li>
                                <button
                                    type="button"
                                    onclick={() => selectType(type)}
                                    class="w-full rounded-2xl border px-3 py-3 text-left transition-colors {selectedType?.id ===
                                    type.id
                                        ? 'border-slate-300 bg-slate-50 text-slate-950 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-50'
                                        : 'border-transparent bg-transparent hover:border-slate-200 hover:bg-slate-50/80 dark:hover:border-slate-700 dark:hover:bg-slate-800/70'}"
                                >
                                    <div
                                        class="flex items-start justify-between gap-2"
                                    >
                                        <div class="min-w-0">
                                            <div class="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                                {type.name}
                                            </div>
                                            <div
                                                class="mt-0.5 truncate text-[0.68rem] font-mono text-slate-500 dark:text-slate-400"
                                            >
                                                {type.slug}
                                            </div>
                                        </div>
                                        <div class="flex items-center gap-1 shrink-0">
                                            <Badge variant="outline">
                                                {resolveTypeItemCount(type)}
                                            </Badge>
                                            {#if (type.basePrice ?? 0) > 0}
                                                <Badge variant="paid">
                                                    Paid
                                                </Badge>
                                            {/if}
                                        </div>
                                    </div>
                                    <div
                                        class="mt-2 rounded-xl bg-slate-50 px-2.5 py-2 dark:bg-slate-950/50"
                                    >
                                        <div class="flex items-center justify-between gap-2">
                                            <p
                                                class="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                                            >
                                                Structure
                                            </p>
                                            <span
                                                class="text-[0.62rem] text-slate-500 dark:text-slate-400"
                                            >
                                                {resolveSchemaSummary(type)}
                                            </span>
                                        </div>
                                        <div
                                            class="mt-2 border-l border-slate-200 pl-2 dark:border-slate-700"
                                        >
                                            {#each previewLines as line}
                                                <div
                                                    class="flex items-center gap-1.5 py-0.5 text-[0.68rem]"
                                                    style={`padding-left: ${line.depth * 0.75}rem`}
                                                >
                                                    <span
                                                        class="text-slate-400 dark:text-slate-500"
                                                        >{line.summary ? "…" : "└"}</span
                                                    >
                                                    <span
                                                        class={line.summary
                                                            ? "truncate italic text-slate-500 dark:text-slate-400"
                                                            : "truncate text-slate-700 dark:text-slate-200"}
                                                    >
                                                        {line.label}
                                                    </span>
                                                    {#if line.typeLabel}
                                                        <Badge
                                                            variant="muted"
                                                            class="px-1.5 py-0.5 text-[0.55rem] uppercase tracking-wide"
                                                        >
                                                            {line.typeLabel}
                                                        </Badge>
                                                    {/if}
                                                    {#if line.required}
                                                        <Badge
                                                            variant="info"
                                                            class="px-1.5 py-0.5 text-[0.55rem] uppercase tracking-wide"
                                                        >
                                                            req
                                                        </Badge>
                                                    {/if}
                                                </div>
                                            {/each}
                                        </div>
                                    </div>
                                    {#if typeStatusSummary.length > 0}
                                        <div class="mt-2 flex flex-wrap gap-1">
                                            {#each typeStatusSummary as summary}
                                                <span
                                                    class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[0.6rem] font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200"
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
                                        class="mt-2 flex items-center justify-between gap-2 text-[0.65rem] text-slate-500 dark:text-slate-400"
                                    >
                                        <span>{resolveTypeItemCount(type)} items</span>
                                        <span
                                            >Updated {formatRelativeDate(
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
            </Surface>
        </aside>

        <div
            class="relative flex-1 min-w-0 overflow-hidden {!selectedType
                ? 'hidden lg:flex'
                : 'flex'}"
        >
            {#if !selectedType}
                <Surface class="flex flex-1 items-center justify-center text-sm italic text-slate-400 dark:text-slate-500">
                    Select a content model to view items.
                </Surface>
            {:else}
                <Surface class="flex w-full flex-col overflow-hidden p-0">
                    <div
                        class="border-b border-slate-200/80 bg-slate-50/80 px-4 py-4 dark:border-slate-700 dark:bg-slate-900/30"
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
                                            <Badge variant="paid">Paid</Badge>
                                        {/if}
                                        {#if activeWorkflow}
                                            <Badge variant="info">Workflow active</Badge>
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
                                <Badge variant="outline">{itemsMeta.total} items</Badge>
                                <Badge variant="muted">{resolveSchemaSummary(selectedType)}</Badge>
                            </div>
                        </div>

                        <form
                            class="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/30"
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
                                    <Input
                                        id="content-search"
                                        bind:value={itemSearch}
                                        type="search"
                                        placeholder="Search title, slug, excerpt, author, or item ID"
                                    />
                                </div>

                                <div>
                                    <label
                                        for="sort-by"
                                        class="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1"
                                    >
                                        Sort by
                                    </label>
                                    <Select
                                        id="sort-by"
                                        bind:value={sortBy}
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
                                    </Select>
                                </div>

                                <div>
                                    <label
                                        for="sort-dir"
                                        class="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1"
                                    >
                                        Order
                                    </label>
                                    <Select
                                        id="sort-dir"
                                        bind:value={sortDir}
                                    >
                                        <option value="desc">Newest first</option>
                                        <option value="asc">Oldest first</option>
                                    </Select>
                                </div>

                                <div
                                    class="flex flex-wrap items-center gap-2 xl:justify-end"
                                >
                                    <Button type="submit">
                                        Apply
                                    </Button>
                                    {#if hasActiveFilters}
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onclick={clearFilters}
                                        >
                                            Clear
                                        </Button>
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
                                                ? 'border-slate-300 bg-slate-100 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
                                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-300 dark:hover:bg-slate-800'}"
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
                                                    ? 'border-slate-300 bg-slate-100 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
                                                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-300 dark:hover:bg-slate-800'}"
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
                                    <Input
                                        id="created-after"
                                        bind:value={createdAfter}
                                        type="date"
                                    />
                                </div>

                                <div>
                                    <label
                                        for="created-before"
                                        class="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1"
                                    >
                                        Created before
                                    </label>
                                    <Input
                                        id="created-before"
                                        bind:value={createdBefore}
                                        type="date"
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
                                            class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-200"
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
                                            class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-200"
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
                                            class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-200"
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
                                            class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-200"
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
                            class="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/25"
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
                                    class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-200"
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
                                class="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400"
                            >
                                <p>
                                    No items found matching the current filters.
                                </p>
                                {#if hasActiveFilters}
                                    <Button
                                        type="button"
                                        variant="outline"
                                        class="mt-4"
                                        onclick={clearFilters}
                                    >
                                        Reset filters
                                    </Button>
                                {/if}
                            </div>
                        {:else}
                            <ul class="space-y-3">
                                {#each items as item}
                                    <li>
                                        <button
                                            type="button"
                                            onclick={() => selectItem(item)}
                                            class="w-full rounded-2xl border p-4 text-left transition-all {selectedItem?.id ===
                                            item.id
                                                ? 'border-slate-300 bg-slate-50 shadow-sm dark:border-slate-600 dark:bg-slate-800/90'
                                                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950/20 dark:hover:border-slate-600 dark:hover:bg-slate-800/60'}"
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
                                                    <Badge
                                                        variant={resolveStatusBadgeVariant(item.status)}
                                                    >
                                                        {formatStatusLabel(
                                                            item.status,
                                                        )}
                                                    </Badge>
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
                                                    class="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800"
                                                >
                                                    Updated {formatDate(
                                                        item.updatedAt,
                                                    )}
                                                </span>
                                                <span
                                                    class="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800"
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
                        class="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm dark:border-slate-700"
                    >
                        <p class="text-gray-600 dark:text-gray-300">
                            Showing {currentRangeStart}-{currentRangeEnd} of
                            {itemsMeta.total}
                        </p>
                        <div class="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onclick={goToPrevPage}
                                disabled={itemsMeta.offset === 0 || loadingItems}
                            >
                                Previous
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onclick={goToNextPage}
                                disabled={!itemsMeta.hasMore || loadingItems}
                            >
                                Next
                            </Button>
                        </div>
                    </div>
                </Surface>

                {#if selectedItem}
                    <button
                        type="button"
                        class="fixed inset-0 z-30 bg-slate-950/55 xl:hidden"
                        aria-label="Close detail view"
                        onclick={() => resetSelectedItemContext()}
                    ></button>
                    <section
                        class="fixed inset-y-0 right-0 z-40 flex w-full max-w-[36rem] flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900 xl:absolute xl:inset-y-3 xl:right-3 xl:w-[23rem] xl:max-w-none xl:rounded-2xl xl:border xl:border-slate-200 xl:shadow-xl dark:xl:border-slate-700 2xl:w-[25rem]"
                    >
                        <div
                            class="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-700 dark:bg-slate-950/60"
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
                                        class="truncate text-lg font-semibold text-gray-900 dark:text-white"
                                    >
                                        {resolveItemLabel(selectedItem)}
                                    </h2>
                                    <Badge
                                        variant={resolveStatusBadgeVariant(selectedItem.status)}
                                    >
                                        {formatStatusLabel(selectedItem.status)}
                                    </Badge>
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
                                class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                            >
                                <Icon src={XMark} class="w-5 h-5" />
                            </button>
                        </div>

                        <div class="flex-1 overflow-y-auto p-6 space-y-6">
                            <div class="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                                <Surface tone="muted" class="p-4">
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
                                </Surface>

                                <Surface class="p-4">
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
                                            <Select
                                                onchange={(event) => {
                                                    selectedVersionForDiff = Number(
                                                        (
                                                            event.currentTarget as HTMLSelectElement
                                                        ).value,
                                                    );
                                                }}
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
                                            </Select>
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
                                                class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-200"
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
                                                            class="rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-700"
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
                                                                        ? 'text-emerald-600 dark:text-emerald-400'
                                                                        : entry.change ===
                                                                                'removed'
                                                                            ? 'text-rose-600 dark:text-rose-400'
                                                                            : 'text-amber-600 dark:text-amber-300'}"
                                                                >
                                                                    {entry.change}
                                                                </span>
                                                            </div>
                                                            <div
                                                                class="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-2 text-xs"
                                                            >
                                                                <div
                                                                    class="rounded-lg bg-slate-50 p-2 dark:bg-slate-950/60"
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
                                                                    class="rounded-lg bg-slate-50 p-2 dark:bg-slate-950/60"
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
                                </Surface>
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
                                                    <Button
                                                        type="button"
                                                        onclick={() =>
                                                            submitForReview(
                                                                transition.id,
                                                            )}
                                                        disabled={submittingReview}
                                                    >
                                                        {transition.toState ===
                                                        "published"
                                                            ? "Publish"
                                                            : `Submit for ${transition.toState}`}
                                                    </Button>
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

                                    <Surface tone="muted" class="p-4">
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
                                                        class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-950/30"
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
                                            <Input
                                                type="text"
                                                bind:value={newComment}
                                                placeholder="Add a comment..."
                                                class="flex-1"
                                            />
                                            <Button
                                                type="submit"
                                                disabled={!newComment.trim()}
                                                variant="secondary"
                                            >
                                                Post
                                            </Button>
                                        </form>
                                    </Surface>
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
                                    <Surface tone="muted" class="p-4">
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
                                            <Badge variant="info">
                                                Live
                                            </Badge>
                                        </div>
                                        <p
                                            class="mt-3 text-sm text-blue-900 dark:text-blue-100"
                                        >
                                            {resolveItemSummary(selectedItem)}
                                        </p>
                                    </Surface>

                                    {#each versions as version}
                                        {@const versionDiff = buildDiffEntries(
                                            selectedItem.data,
                                            version.data,
                                            selectedItem.status,
                                            version.status,
                                        )}
                                        <div
                                            class="rounded-2xl border p-4 {selectedDiffVersion?.version ===
                                            version.version
                                                ? 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/80'
                                                : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950/20'}"
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
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        onclick={() => {
                                                            selectedVersionForDiff = version.version;
                                                        }}
                                                    >
                                                        Compare
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="destructive"
                                                        size="sm"
                                                        onclick={() =>
                                                            rollbackToVersion(
                                                                version.version,
                                                            )}
                                                        disabled={rollingBack}
                                                    >
                                                        Rollback
                                                    </Button>
                                                </div>
                                            </div>

                                            <p
                                                class="mt-3 text-sm text-gray-600 dark:text-gray-300"
                                            >
                                                {resolveItemSummary(version)}
                                            </p>

                                            <div
                                                class="mt-4 rounded-xl bg-slate-50 p-3 dark:bg-slate-950/40"
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
