<script lang="ts">
    import { fetchApi, ApiError } from "$lib/api";
    import { onMount } from "svelte";
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import { deepParseJson, formatJson } from "$lib/utils";
    import { openDeferredTab } from "$lib/deferred-tab";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import JsonCodeBlock from "$lib/components/JsonCodeBlock.svelte";
    import DataTable from "$lib/components/DataTable.svelte";
    import ActorIdentity from "$lib/components/ActorIdentity.svelte";
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
        publicationState: "draft" | "published" | "changed";
        workingCopyVersion: number;
        publishedVersion: number | null;
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

    type QueryableFieldType = "string" | "number" | "boolean";

    type QueryableField = {
        name: string;
        label: string;
        type: QueryableFieldType;
    };

    type LifecycleSchemaConfig = {
        ttlSeconds: number;
        archiveStatus: string;
        clock: "createdAt" | "updatedAt";
    };

    type PublicWriteSchemaConfig = {
        subjectField: string;
        allowedOperations: Array<"create" | "update">;
        requiredStatus: string | null;
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
        authorActorId: string | null;
        authorActorType: string | null;
        authorActorSource: string | null;
        comment: string;
        createdAt: string;
    };

    type ContentListMeta = {
        total: number;
        offset: number;
        limit: number;
        hasMore: boolean;
    };

    type PreviewTokenResponse = {
        token: string;
        previewPath: string;
        draft: boolean;
        ttlSeconds: number;
        expiresAt: string;
    };

    type ReferenceUsage = {
        contentItemId: number;
        contentTypeId: number;
        contentTypeName: string;
        contentTypeSlug: string;
        path: string;
        version: number;
        status?: string;
        contentItemVersionId?: number;
    };

    type ReferenceUsageSummary = {
        activeReferenceCount: number;
        historicalReferenceCount: number;
        activeReferences: ReferenceUsage[];
        historicalReferences: ReferenceUsage[];
    };

    type ItemSortDir = "asc" | "desc";
    type FieldFilterOperator = "eq" | "contains" | "gte" | "lte";

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
    const FIELD_FILTER_OPERATORS: Array<{
        value: FieldFilterOperator;
        label: string;
    }> = [
        { value: "eq", label: "Equals" },
        { value: "contains", label: "Contains" },
        { value: "gte", label: "At least" },
        { value: "lte", label: "At most" },
    ];
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

    const contentColumns = [
        { key: "_item", label: "Item" },
        { key: "slug", label: "Slug" },
        { key: "status", label: "Status" },
        { key: "version", label: "Version" },
        { key: "updatedAt", label: "Updated" },
        { key: "createdAt", label: "Created" },
    ];

    let contentTypes = $state<ContentType[]>([]);
    let selectedType = $state<ContentType | null>(null);
    let items = $state<ContentItem[]>([]);
    let selectedItem = $state<ContentItem | null>(null);
    let versions = $state<ContentVersion[]>([]);
    let comments = $state<ReviewComment[]>([]);
    let itemUsage = $state<ReferenceUsageSummary | null>(null);
    let activeWorkflow = $state<ActiveWorkflow | null>(null);

    let itemSearch = $state("");
    let filterStatus = $state("");
    let createdAfter = $state("");
    let createdBefore = $state("");
    let fieldFilterName = $state("");
    let fieldFilterOp = $state<FieldFilterOperator>("eq");
    let fieldFilterValue = $state("");
    let sortSelection = $state("updatedAt");
    let sortDir = $state<ItemSortDir>("desc");
    let includeArchived = $state(false);
    let itemsMeta = $state<ContentListMeta>({ ...DEFAULT_ITEMS_META });

    let selectedVersionForDiff = $state<number | null>(null);
    let newComment = $state("");
    let submittingReview = $state(false);
    let openingPreview = $state(false);
    let loading = $state(true);
    let loadingItems = $state(false);
    let loadingUsage = $state(false);
    let error = $state<any>(null);
    let rollingBack = $state(false);
    let showModelFilterModal = $state(false);
    let showSchemaInfoModal = $state(false);
    let showAdvancedFilters = $state(false);
    let schemaPickerSearch = $state("");
    let draftSelectedTypeId = $state<number | null>(null);

    let availableTransitions = $derived.by(() => {
        if (!activeWorkflow || !selectedItem) {
            return [];
        }

        const currentItem = selectedItem;
        return activeWorkflow.transitions.filter(
            (transition) => transition.fromState === currentItem.status,
        );
    });
    let currentRangeStart = $derived(
        items.length === 0 ? 0 : itemsMeta.offset + 1,
    );
    let currentRangeEnd = $derived(
        items.length === 0 ? 0 : itemsMeta.offset + items.length,
    );
    let hasFieldFilter = $derived(
        Boolean(fieldFilterName && fieldFilterValue.trim().length > 0),
    );
    let hasActiveFilters = $derived(
        Boolean(
            itemSearch.trim() ||
                filterStatus ||
                createdAfter ||
                createdBefore ||
                hasFieldFilter ||
                includeArchived ||
                sortSelection !== "updatedAt" ||
                sortDir !== "desc",
        ),
    );
    let hasAdvancedFilters = $derived(
        Boolean(
            filterStatus ||
                createdAfter ||
                createdBefore ||
                fieldFilterName ||
                includeArchived,
        ),
    );
    let activeAdvancedFilterCount = $derived(
        (filterStatus ? 1 : 0) +
            (hasFieldFilter ? 1 : 0) +
            (createdAfter ? 1 : 0) +
            (createdBefore ? 1 : 0) +
            (includeArchived ? 1 : 0),
    );
    let selectedDiffVersion = $derived(
        selectedVersionForDiff === null
            ? (versions[0] ?? null)
            : (versions.find(
                  (version) => version.version === selectedVersionForDiff,
              ) ??
                  versions[0] ??
                  null),
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
    let selectedTypeMetrics = $derived.by(() =>
        selectedType
            ? resolveSchemaMetrics(selectedType)
            : { fieldCount: 0, requiredCount: 0 },
    );
    let selectedTypeQueryableFields = $derived.by(() =>
        selectedType ? resolveQueryableFields(selectedType) : [],
    );
    let selectedTypeLifecycle = $derived.by(() =>
        selectedType ? resolveLifecycleSchemaConfig(selectedType) : null,
    );
    let selectedTypePublicWrite = $derived.by(() =>
        selectedType ? resolvePublicWriteSchemaConfig(selectedType) : null,
    );
    let selectedFieldFilterMeta = $derived.by(
        () =>
            selectedTypeQueryableFields.find(
                (field) => field.name === fieldFilterName,
            ) ?? null,
    );
    let availableFieldFilterOperators = $derived.by(() => {
        if (selectedFieldFilterMeta?.type === "number") {
            return FIELD_FILTER_OPERATORS.filter(
                (option) => option.value !== "contains",
            );
        }

        if (selectedFieldFilterMeta?.type === "boolean") {
            return FIELD_FILTER_OPERATORS.filter(
                (option) => option.value === "eq",
            );
        }

        return FIELD_FILTER_OPERATORS.filter(
            (option) => option.value === "eq" || option.value === "contains",
        );
    });
    let schemaSortOptions = $derived.by(() => [
        { value: "updatedAt", label: "Updated" },
        { value: "createdAt", label: "Created" },
        { value: "version", label: "Version" },
        ...selectedTypeQueryableFields.map((field) => ({
            value: `field:${field.name}`,
            label: `${field.label} (${field.type})`,
        })),
    ]);
    let schemaOverview = $derived.by(() => ({
        totalSchemas: contentTypes.length,
        schemasWithContent: contentTypes.filter(
            (type) => resolveTypeItemCount(type) > 0,
        ).length,
        paidSchemas: contentTypes.filter((type) => (type.basePrice ?? 0) > 0)
            .length,
        totalItems: contentTypes.reduce(
            (sum, type) => sum + resolveTypeItemCount(type),
            0,
        ),
    }));
    let highlightedSchemas = $derived.by(() => sortedContentTypes.slice(0, 6));
    let schemaPickerTypes = $derived.by(() => {
        const query = schemaPickerSearch.trim().toLowerCase();
        if (!query) {
            return sortedContentTypes;
        }

        return sortedContentTypes.filter((type) =>
            [type.name, type.slug, type.description ?? ""].some((value) =>
                value.toLowerCase().includes(query),
            ),
        );
    });

    function normalizeMeta(
        meta: Record<string, unknown> | null | undefined,
    ): ContentListMeta {
        return {
            total: Number(meta?.total ?? 0),
            offset: Number(meta?.offset ?? 0),
            limit: Number(meta?.limit ?? PAGE_SIZE),
            hasMore: Boolean(meta?.hasMore),
        };
    }

    function parseStructuredData(
        payload: unknown,
    ): Record<string, unknown> | null {
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
        return (
            pickFirstString(structured, PRIMARY_LABEL_FIELDS) ??
            `Item #${item.id}`
        );
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

    function formatPublicationStateLabel(
        state: ContentItem["publicationState"],
    ): string {
        if (state === "changed") return "Changed";
        if (state === "published") return "Published view";
        return "Draft only";
    }

    function resolvePublicationBadgeVariant(
        state: ContentItem["publicationState"],
    ): "muted" | "success" | "warning" | "danger" {
        if (state === "published") return "success";
        if (state === "changed") return "warning";
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
                rawNode &&
                typeof rawNode === "object" &&
                !Array.isArray(rawNode)
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
                              (field): field is string =>
                                  typeof field === "string",
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
        const metrics = resolveSchemaMetrics(type);
        if (metrics.fieldCount === 0) {
            return "Custom schema";
        }

        return `${metrics.fieldCount} fields, ${metrics.requiredCount} required`;
    }

    function resolveSchemaMetrics(type: ContentType): {
        fieldCount: number;
        requiredCount: number;
    } {
        try {
            const parsed = JSON.parse(type.schema) as {
                properties?: Record<string, unknown>;
                required?: unknown[];
            };
            const fieldCount = Object.keys(parsed.properties ?? {}).length;
            const requiredCount = Array.isArray(parsed.required)
                ? parsed.required.length
                : 0;
            return { fieldCount, requiredCount };
        } catch {
            return { fieldCount: 0, requiredCount: 0 };
        }
    }

    function parseSchemaDocument(
        type: ContentType,
    ): Record<string, unknown> | null {
        try {
            const parsed = JSON.parse(type.schema);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                return null;
            }
            return parsed as Record<string, unknown>;
        } catch {
            return null;
        }
    }

    function humanizeFieldName(value: string): string {
        return value
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/[_-]+/g, " ")
            .replace(/\b\w/g, (char) => char.toUpperCase());
    }

    function resolveQueryableFields(type: ContentType): QueryableField[] {
        const schema = parseSchemaDocument(type);
        const properties =
            schema?.properties &&
            typeof schema.properties === "object" &&
            !Array.isArray(schema.properties)
                ? (schema.properties as Record<string, unknown>)
                : null;

        if (!properties) {
            return [];
        }

        return Object.entries(properties).flatMap(([name, rawField]) => {
            if (
                !rawField ||
                typeof rawField !== "object" ||
                Array.isArray(rawField)
            ) {
                return [];
            }

            const field = rawField as Record<string, unknown>;
            const rawType =
                typeof field.type === "string" ? field.type : undefined;
            const typeLabel =
                rawType === "string"
                    ? "string"
                    : rawType === "integer" || rawType === "number"
                      ? "number"
                      : rawType === "boolean"
                        ? "boolean"
                        : null;

            if (!typeLabel) {
                return [];
            }

            return [
                {
                    name,
                    label: humanizeFieldName(name),
                    type: typeLabel,
                },
            ];
        });
    }

    function resolveLifecycleSchemaConfig(
        type: ContentType,
    ): LifecycleSchemaConfig | null {
        const schema = parseSchemaDocument(type);
        const rawConfig = schema?.["x-wordclaw-lifecycle"];

        if (
            !rawConfig ||
            typeof rawConfig !== "object" ||
            Array.isArray(rawConfig)
        ) {
            return null;
        }

        const config = rawConfig as Record<string, unknown>;
        if (config.enabled === false || typeof config.ttlSeconds !== "number") {
            return null;
        }

        return {
            ttlSeconds: config.ttlSeconds,
            archiveStatus:
                typeof config.archiveStatus === "string" &&
                config.archiveStatus.trim()
                    ? config.archiveStatus
                    : "archived",
            clock: config.clock === "createdAt" ? "createdAt" : "updatedAt",
        };
    }

    function resolvePublicWriteSchemaConfig(
        type: ContentType,
    ): PublicWriteSchemaConfig | null {
        const schema = parseSchemaDocument(type);
        const rawConfig = schema?.["x-wordclaw-public-write"];

        if (
            !rawConfig ||
            typeof rawConfig !== "object" ||
            Array.isArray(rawConfig)
        ) {
            return null;
        }

        const config = rawConfig as Record<string, unknown>;
        const subjectField =
            typeof config.subjectField === "string"
                ? config.subjectField.trim()
                : "";
        const allowedOperations = Array.isArray(config.allowedOperations)
            ? config.allowedOperations.filter(
                  (operation): operation is "create" | "update" =>
                      operation === "create" || operation === "update",
              )
            : [];

        if (config.enabled === false || !subjectField || !allowedOperations.length) {
            return null;
        }

        return {
            subjectField,
            allowedOperations,
            requiredStatus:
                typeof config.requiredStatus === "string" &&
                config.requiredStatus.trim().length > 0
                    ? config.requiredStatus
                    : null,
        };
    }

    function formatTtlDuration(seconds: number): string {
        if (seconds % 86_400 === 0) {
            const days = seconds / 86_400;
            return `${days}d`;
        }

        if (seconds % 3_600 === 0) {
            const hours = seconds / 3_600;
            return `${hours}h`;
        }

        if (seconds % 60 === 0) {
            const minutes = seconds / 60;
            return `${minutes}m`;
        }

        return `${seconds}s`;
    }

    function resolveFieldFilterPlaceholder(field: QueryableField | undefined) {
        if (!field) {
            return "Enter a value";
        }

        if (field.type === "boolean") {
            return "true or false";
        }

        if (field.type === "number") {
            return "Numeric value";
        }

        return `Match ${field.label.toLowerCase()}`;
    }

    function syncSchemaAwareControls(type: ContentType | null) {
        const fields = type ? resolveQueryableFields(type) : [];
        const fieldNames = new Set(fields.map((field) => field.name));
        const numericFieldNames = new Set(
            fields
                .filter((field) => field.type === "number")
                .map((field) => field.name),
        );

        if (fieldFilterName && !fieldNames.has(fieldFilterName)) {
            fieldFilterName = "";
            fieldFilterOp = "eq";
            fieldFilterValue = "";
        }

        if (
            sortSelection.startsWith("field:") &&
            !fieldNames.has(sortSelection.slice("field:".length))
        ) {
            sortSelection = "updatedAt";
        }

        if (!numericFieldNames.size && fieldFilterOp !== "eq" && fieldFilterOp !== "contains") {
            fieldFilterOp = "eq";
        }

        const selectedField =
            fields.find((field) => field.name === fieldFilterName) ?? null;
        if (selectedField?.type === "number" && fieldFilterOp === "contains") {
            fieldFilterOp = "eq";
        }

        if (selectedField?.type === "boolean" && fieldFilterOp !== "eq") {
            fieldFilterOp = "eq";
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

    function selectTypeById(typeId: string) {
        const nextType = contentTypes.find(
            (type) => type.id === Number(typeId),
        );
        if (!nextType || nextType.id === selectedType?.id) {
            return;
        }

        void selectType(nextType);
    }

    function openModelFilterModal() {
        draftSelectedTypeId =
            selectedType?.id ?? sortedContentTypes[0]?.id ?? null;
        schemaPickerSearch = "";
        showModelFilterModal = true;
    }

    async function applySchemaSelection() {
        if (draftSelectedTypeId === null) {
            showModelFilterModal = false;
            return;
        }

        const nextType =
            sortedContentTypes.find(
                (type) => type.id === draftSelectedTypeId,
            ) ?? null;
        showModelFilterModal = false;

        if (nextType && nextType.id !== selectedType?.id) {
            await selectType(nextType);
        }
    }

    function buildItemsQuery(offset = 0): string {
        if (!selectedType) return "";

        const params = new URLSearchParams({
            contentTypeId: String(selectedType.id),
            limit: String(PAGE_SIZE),
            offset: String(offset),
            sortDir,
        });

        if (sortSelection.startsWith("field:")) {
            params.set("sortField", sortSelection.slice("field:".length));
        } else {
            params.set("sortBy", sortSelection);
        }

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

        if (hasFieldFilter) {
            params.set("fieldName", fieldFilterName);
            params.set("fieldOp", fieldFilterOp);
            params.set("fieldValue", fieldFilterValue.trim());
        }

        if (includeArchived) {
            params.set("includeArchived", "true");
        }

        return params.toString();
    }

    function resetSelectedItemContext() {
        selectedItem = null;
        versions = [];
        comments = [];
        itemUsage = null;
        selectedVersionForDiff = null;
        newComment = "";
    }

    function resetFilters() {
        itemSearch = "";
        filterStatus = "";
        createdAfter = "";
        createdBefore = "";
        fieldFilterName = "";
        fieldFilterOp = "eq";
        fieldFilterValue = "";
        sortSelection = "updatedAt";
        sortDir = "desc";
        includeArchived = false;
    }

    async function loadContentTypes() {
        loading = true;
        error = null;

        try {
            const res = await fetchApi(
                "/content-types?limit=200&includeStats=true",
            );
            const nextTypes = res.data as ContentType[];
            const selectedTypeId = selectedType?.id ?? null;

            contentTypes = nextTypes;
            if (selectedTypeId !== null) {
                selectedType =
                    nextTypes.find((type) => type.id === selectedTypeId) ??
                    null;
                syncSchemaAwareControls(selectedType);
                if (!selectedType) {
                    items = [];
                    itemsMeta = { ...DEFAULT_ITEMS_META };
                    activeWorkflow = null;
                    resetSelectedItemContext();
                }
            }
        } catch (err: any) {
            error = err;
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
            error = err;
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
        syncSchemaAwareControls(type);
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
        itemUsage = null;
        selectedVersionForDiff = null;
        error = null;

        try {
            const followUps: Promise<void>[] = [
                (async () => {
                    const response = await fetchApi(
                        `/content-items/${item.id}/versions`,
                    );
                    versions = response.data;
                    selectedVersionForDiff = response.data[0]?.version ?? null;
                })(),
                loadContentItemUsage(item.id),
            ];

            if (activeWorkflow) {
                followUps.push(
                    (async () => {
                        const commentsRes = await fetchApi(
                            `/content-items/${item.id}/comments`,
                        );
                        comments = commentsRes.data;
                    })(),
                );
            }

            await Promise.all(followUps);
        } catch (err: any) {
            error = err;
        }
    }

    async function loadContentItemUsage(id: number) {
        loadingUsage = true;
        try {
            const response = await fetchApi(`/content-items/${id}/used-by`);
            itemUsage = response.data ?? null;
        } catch (err) {
            itemUsage = null;
            feedbackStore.pushToast({
                severity: "error",
                title: "Failed to load reference usage",
                message:
                    err instanceof ApiError
                        ? err.message
                        : "The usage graph could not be loaded.",
            });
        } finally {
            loadingUsage = false;
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

                    const refreshedItems = await loadItems(
                        itemsMeta.offset,
                        true,
                    );
                    const refreshedItem =
                        refreshedItems.find(
                            (item) => item.id === currentItemId,
                        ) ?? null;

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
                code: err instanceof ApiError ? err.code : undefined,
                remediation:
                    err instanceof ApiError ? err.remediation : undefined,
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
                code: err instanceof ApiError ? err.code : undefined,
                remediation:
                    err instanceof ApiError ? err.remediation : undefined,
            });
        }
    }

    async function openPreview() {
        if (!selectedItem) return;

        const previewTab = openDeferredTab();
        if (!previewTab) {
            feedbackStore.pushToast({
                severity: "error",
                title: "Preview blocked",
                message: "Allow pop-ups for this site and try again.",
            });
            return;
        }

        openingPreview = true;
        try {
            const response = await fetchApi(
                `/content-items/${selectedItem.id}/preview-token`,
                {
                    method: "POST",
                    body: JSON.stringify({ draft: true }),
                },
            );
            const preview = response.data as PreviewTokenResponse;
            previewTab.location.replace(
                new URL(preview.previewPath, window.location.origin).toString(),
            );
            feedbackStore.pushToast({
                severity: "success",
                title: "Preview opened",
                message: `Scoped preview available until ${formatDateTime(preview.expiresAt)}`,
            });
        } catch (err: any) {
            previewTab.close();
            feedbackStore.pushToast({
                severity: "error",
                title: "Preview unavailable",
                message: err.message,
                code: err instanceof ApiError ? err.code : undefined,
                remediation:
                    err instanceof ApiError ? err.remediation : undefined,
            });
        } finally {
            openingPreview = false;
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
        filter:
            | "search"
            | "status"
            | "createdAfter"
            | "createdBefore"
            | "field"
            | "archived",
    ) {
        if (filter === "search") {
            itemSearch = "";
        } else if (filter === "status") {
            filterStatus = "";
        } else if (filter === "createdAfter") {
            createdAfter = "";
        } else if (filter === "createdBefore") {
            createdBefore = "";
        } else if (filter === "field") {
            fieldFilterName = "";
            fieldFilterOp = "eq";
            fieldFilterValue = "";
        } else if (filter === "archived") {
            includeArchived = false;
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

<div class="flex h-full flex-col">
    <div class="mb-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
            <h2
                class="text-xl font-semibold tracking-tight text-slate-900 dark:text-white"
            >
                Content Browser
            </h2>
            <p class="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                Schema-first content inspection and browsing.
            </p>
        </div>
        <Button
            variant="outline"
            size="sm"
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
            <Icon src={ArrowPath} class="h-4 w-4" />
            Refresh
        </Button>
    </div>

    {#if error}
        <ErrorBanner
            class="mb-6"
            {error}
            message={typeof error === "string" ? error : undefined}
        />
    {/if}

    {#snippet SchemaLanding()}
        <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Surface class="p-5 lg:p-6">
                <p
                    class="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400"
                >
                    Schema-first browser
                </p>
                <h3
                    class="mt-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50"
                >
                    Choose a content schema
                </h3>
                <p
                    class="mt-2 max-w-2xl text-sm leading-5 text-slate-600 dark:text-slate-300"
                >
                    Select a model to inspect, then drill into individual items.
                </p>

                <div class="mt-3 flex flex-wrap items-center gap-2">
                    <Button type="button" onclick={openModelFilterModal}>
                        Choose schema
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onclick={() => void loadContentTypes()}
                    >
                        <Icon src={ArrowPath} class="h-4 w-4" />
                        Refresh
                    </Button>
                </div>

                <div
                    class="mt-3 flex flex-wrap gap-5 border-t border-slate-200 pt-3 dark:border-slate-700"
                >
                    <div class="flex items-baseline gap-1.5">
                        <span class="text-lg font-semibold text-slate-900 dark:text-slate-50">{schemaOverview.totalSchemas}</span>
                        <span class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">schemas</span>
                    </div>
                    <div class="flex items-baseline gap-1.5">
                        <span class="text-lg font-semibold text-slate-900 dark:text-slate-50">{schemaOverview.schemasWithContent}</span>
                        <span class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">with content</span>
                    </div>
                    <div class="flex items-baseline gap-1.5">
                        <span class="text-lg font-semibold text-slate-900 dark:text-slate-50">{schemaOverview.totalItems}</span>
                        <span class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">items</span>
                    </div>
                    <div class="flex items-baseline gap-1.5">
                        <span class="text-lg font-semibold text-slate-900 dark:text-slate-50">{schemaOverview.paidSchemas}</span>
                        <span class="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">paid</span>
                    </div>
                </div>
            </Surface>

            <Surface class="overflow-hidden p-0">
                <div
                    class="border-b border-slate-200/80 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/30"
                >
                    <p
                        class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                    >
                        Recently active schemas
                    </p>
                    <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Jump into models with recent activity.
                    </p>
                </div>

                <div class="p-4">
                    {#if loading}
                        <div class="flex justify-center p-8">
                            <LoadingSpinner size="md" />
                        </div>
                    {:else if highlightedSchemas.length === 0}
                        <div
                            class="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400"
                        >
                            No content schemas are available yet.
                        </div>
                    {:else}
                        <ul class="space-y-2">
                            {#each highlightedSchemas as type}
                                <li>
                                    <button
                                        type="button"
                                        onclick={() => selectType(type)}
                                        class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/30 dark:hover:border-slate-600 dark:hover:bg-slate-800/40"
                                    >
                                        <div
                                            class="flex items-start justify-between gap-3"
                                        >
                                            <div class="min-w-0">
                                                <p
                                                    class="truncate text-sm font-semibold text-slate-900 dark:text-slate-100"
                                                >
                                                    {type.name}
                                                </p>
                                                <p
                                                    class="mt-0.5 truncate text-[0.72rem] font-mono text-slate-500 dark:text-slate-400"
                                                >
                                                    {type.slug}
                                                </p>
                                            </div>
                                            <Badge variant="outline">
                                                {resolveTypeItemCount(type)}
                                            </Badge>
                                        </div>
                                        <div
                                            class="mt-3 flex items-center justify-between gap-3 text-[0.72rem] text-slate-500 dark:text-slate-400"
                                        >
                                            <span
                                                >{resolveSchemaSummary(
                                                    type,
                                                )}</span
                                            >
                                            <span
                                                >{resolveTypeLastActivity(
                                                    type,
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
        </div>
    {/snippet}

    {#snippet CurrentSchemaRail()}
        {#if selectedType}
            {@const previewLines = resolveSchemaPreviewLines(selectedType)}
            <Surface
                class="flex flex-col overflow-hidden p-0 min-[1400px]:h-full"
            >
                <div
                    class="border-b border-slate-200/80 bg-slate-50/80 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/30"
                >
                    <p
                        class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                    >
                        Selected schema
                    </p>
                    <h3
                        class="mt-2 text-base font-semibold text-slate-900 dark:text-slate-50"
                    >
                        {selectedType.name}
                    </h3>
                    <p
                        class="mt-1 text-[0.72rem] font-mono text-slate-500 dark:text-slate-400"
                    >
                        {selectedType.slug}
                    </p>
                </div>

                <div class="flex-1 overflow-y-auto p-3 space-y-3">
                    <p
                        class="text-xs leading-5 text-slate-600 dark:text-slate-300"
                    >
                        {selectedType.description ||
                            "Structured content model for supervised AI and operator workflows."}
                    </p>

                    <div class="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onclick={() => (showSchemaInfoModal = true)}
                        >
                            Info
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onclick={openModelFilterModal}
                        >
                            Change schema
                        </Button>
                    </div>

                    {#if selectedTypeLifecycle || selectedTypePublicWrite}
                        <div class="flex flex-wrap gap-2">
                            {#if selectedTypeLifecycle}
                                <Badge variant="outline">
                                    TTL {formatTtlDuration(
                                        selectedTypeLifecycle.ttlSeconds,
                                    )} on {selectedTypeLifecycle.clock ===
                                    "createdAt"
                                        ? "create"
                                        : "update"}
                                </Badge>
                            {/if}
                            {#if selectedTypePublicWrite}
                                <Badge variant="info">
                                    Public write · {selectedTypePublicWrite.allowedOperations.join(
                                        " / ",
                                    )}
                                </Badge>
                            {/if}
                        </div>
                    {/if}

                    <div class="flex items-center justify-between gap-2">
                        <span class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Activity</span>
                        <span class="text-xs font-semibold text-slate-900 dark:text-slate-50">
                            {selectedType.stats?.lastItemUpdatedAt
                                ? formatRelativeDate(
                                      selectedType.stats.lastItemUpdatedAt,
                                  )
                                : "No items yet"}
                        </span>
                    </div>

                    <details class="rounded-xl border border-slate-200/80 dark:border-slate-700" open>
                        <summary class="cursor-pointer px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 select-none flex items-center justify-between gap-2">
                            <span>Structure</span>
                            <span class="text-[0.65rem] normal-case tracking-normal font-normal">{resolveSchemaSummary(selectedType)}</span>
                        </summary>
                        <div class="px-3 pb-3 space-y-1">
                            {#each previewLines as line}
                                <div
                                    class="flex items-center gap-1.5 text-[0.68rem]"
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
                                            class="px-1 py-0 text-[0.5rem] uppercase tracking-wide"
                                        >
                                            {line.typeLabel}
                                        </Badge>
                                    {/if}
                                    {#if line.required}
                                        <Badge
                                            variant="info"
                                            class="px-1 py-0 text-[0.5rem] uppercase tracking-wide"
                                        >
                                            req
                                        </Badge>
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    </details>

                    {#if selectedTypeStatusSummary.length > 0}
                        <details class="rounded-xl border border-slate-200/80 dark:border-slate-700">
                            <summary class="cursor-pointer px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 select-none">
                                Status mix
                            </summary>
                            <div class="px-3 pb-2 flex flex-wrap gap-1.5">
                                {#each selectedTypeStatusSummary as summary}
                                    <Badge variant="muted">
                                        {formatStatusLabel(summary.status)}
                                        {summary.count}
                                    </Badge>
                                {/each}
                            </div>
                        </details>
                    {/if}
                </div>
            </Surface>
        {/if}
    {/snippet}

    {#snippet CurrentSchemaSummary()}
        {#if selectedType}
            <Surface class="p-4">
                <div
                    class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
                >
                    <div class="min-w-0">
                        <p
                            class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                        >
                            Selected schema
                        </p>
                        <h3
                            class="mt-2 truncate text-lg font-semibold text-slate-900 dark:text-slate-50"
                        >
                            {selectedType.name}
                        </h3>
                        <p
                            class="mt-1 truncate text-[0.72rem] font-mono text-slate-500 dark:text-slate-400"
                        >
                            {selectedType.slug}
                        </p>
                        <p
                            class="mt-2 line-clamp-2 text-sm text-slate-600 dark:text-slate-300"
                        >
                            {selectedType.description ||
                                "Structured content model for supervised AI and operator workflows."}
                        </p>
                    </div>

                    <div class="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onclick={() => (showSchemaInfoModal = true)}
                        >
                            Info
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onclick={openModelFilterModal}
                        >
                            Change schema
                        </Button>
                    </div>
                </div>

                <div class="mt-4 flex flex-wrap gap-2">
                    <Badge variant="outline">
                        {selectedType.stats?.lastItemUpdatedAt
                            ? `Updated ${formatRelativeDate(selectedType.stats.lastItemUpdatedAt)}`
                            : "No items yet"}
                    </Badge>
                    <Badge variant="outline">
                        {resolveSchemaSummary(selectedType)}
                    </Badge>
                    {#if selectedTypeLifecycle}
                        <Badge variant="outline">
                            TTL {formatTtlDuration(
                                selectedTypeLifecycle.ttlSeconds,
                            )} · {formatStatusLabel(
                                selectedTypeLifecycle.archiveStatus,
                            )}
                        </Badge>
                    {/if}
                    {#if selectedTypePublicWrite}
                        <Badge variant="info">
                            Public write · {humanizeFieldName(
                                selectedTypePublicWrite.subjectField,
                            )}
                        </Badge>
                    {/if}
                    {#if selectedTypeStatusSummary.length > 0}
                        <Badge variant="muted">
                            {formatStatusLabel(
                                selectedTypeStatusSummary[0].status,
                            )}
                            {selectedTypeStatusSummary[0].count}
                        </Badge>
                    {/if}
                </div>
            </Surface>
        {/if}
    {/snippet}

    {#snippet InspectorContent()}
        {#if !selectedItem}
            <div
                class="flex h-full items-center justify-center p-6 text-center"
            >
                <div class="max-w-sm">
                    <p
                        class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                    >
                        Inspector
                    </p>
                    <h3
                        class="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-50"
                    >
                        Select an item
                    </h3>
                    <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        Choose an item from the list to inspect its payload,
                        workflow state, and version history.
                    </p>
                </div>
            </div>
        {:else}
            <div class="flex h-full flex-col overflow-hidden">
                <div
                    class="border-b border-slate-200/80 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/30"
                >
                    <div class="flex items-start justify-between gap-4">
                        <div class="min-w-0">
                            <div class="flex items-center gap-2">
                                <button
                                    type="button"
                                    class="2xl:hidden text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                    aria-label="Close inspector"
                                    onclick={() => resetSelectedItemContext()}
                                >
                                    <Icon src={ChevronLeft} class="h-5 w-5" />
                                </button>
                                <h3
                                    class="truncate text-base font-semibold text-slate-900 dark:text-slate-50"
                                >
                                    {resolveItemLabel(selectedItem)}
                                </h3>
                                <Badge
                                    variant={resolveStatusBadgeVariant(
                                        selectedItem.status,
                                    )}
                                >
                                    {formatStatusLabel(selectedItem.status)}
                                </Badge>
                                <Badge
                                    variant={resolvePublicationBadgeVariant(
                                        selectedItem.publicationState,
                                    )}
                                >
                                    {formatPublicationStateLabel(
                                        selectedItem.publicationState,
                                    )}
                                </Badge>
                            </div>
                            <p
                                class="mt-2 text-sm text-slate-600 dark:text-slate-300"
                            >
                                {resolveItemSummary(selectedItem)}
                            </p>
                            <div
                                class="mt-1.5 flex flex-wrap items-center gap-2 text-[0.68rem] text-slate-500 dark:text-slate-400"
                            >
                                <span class="font-mono">#{selectedItem.id}</span
                                >
                                <span class="font-mono"
                                    >v{selectedItem.version}</span
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
                            class="2xl:hidden text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                            aria-label="Close inspector"
                            onclick={() => resetSelectedItemContext()}
                        >
                            <Icon src={XMark} class="h-5 w-5" />
                        </button>
                    </div>
                </div>

                <div class="flex-1 overflow-y-auto p-4 space-y-3">
                    <div class="rounded-xl border border-slate-200/80 px-3 py-2.5 dark:border-slate-700">
                        <div class="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                            <div>
                                <span class="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</span>
                                <p class="mt-0.5 text-slate-900 dark:text-slate-50">{formatStatusLabel(selectedItem.status)}</p>
                            </div>
                            <div>
                                <span class="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Version</span>
                                <p class="mt-0.5 text-slate-900 dark:text-slate-50">v{selectedItem.version}</p>
                            </div>
                            <div>
                                <span class="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Published</span>
                                <p class="mt-0.5 text-slate-900 dark:text-slate-50">{selectedItem.publishedVersion === null ? "—" : `v${selectedItem.publishedVersion}`}</p>
                            </div>
                            <div>
                                <span class="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Working</span>
                                <p class="mt-0.5 text-slate-900 dark:text-slate-50">v{selectedItem.workingCopyVersion}</p>
                            </div>
                        </div>
                    </div>

                    <Surface tone="subtle" class="p-4">
                        <div
                            class="flex items-start justify-between gap-3 flex-wrap"
                        >
                            <div>
                                <p
                                    class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                                >
                                    Referenced by
                                </p>
                                <p
                                    class="mt-1 text-xs text-slate-500 dark:text-slate-400"
                                >
                                    Review current and historical references before deleting or restructuring this item.
                                </p>
                            </div>
                            <div class="flex flex-wrap items-center gap-2">
                                <Badge variant="outline">
                                    {itemUsage?.activeReferenceCount ?? 0} active
                                </Badge>
                                <Badge variant="outline">
                                    {itemUsage?.historicalReferenceCount ?? 0} historical
                                </Badge>
                            </div>
                        </div>

                        <div class="mt-4 space-y-3">
                            {#if loadingUsage}
                                <div class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-950/30">
                                    <LoadingSpinner size="sm" />
                                    <p class="text-sm text-slate-500 dark:text-slate-400">
                                        Loading reverse references…
                                    </p>
                                </div>
                            {:else if itemUsage}
                                <div class="grid gap-3 lg:grid-cols-2">
                                    <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-950/30">
                                        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                            Active references
                                        </p>
                                        {#if itemUsage.activeReferences.length > 0}
                                            <div class="mt-3 space-y-3">
                                                {#each itemUsage.activeReferences.slice(0, 5) as reference}
                                                    <div class="rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/40">
                                                        <p class="text-sm font-medium text-slate-900 dark:text-slate-50">
                                                            {reference.contentTypeName} #{reference.contentItemId}
                                                        </p>
                                                        <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                            {reference.contentTypeSlug} · {reference.path} · v{reference.version}{reference.status ? ` · ${reference.status}` : ""}
                                                        </p>
                                                    </div>
                                                {/each}
                                            </div>
                                        {:else}
                                            <p class="mt-3 text-sm text-slate-500 dark:text-slate-400">
                                                No active items currently reference this record.
                                            </p>
                                        {/if}
                                    </div>

                                    <div class="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-950/30">
                                        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                            Historical references
                                        </p>
                                        {#if itemUsage.historicalReferences.length > 0}
                                            <div class="mt-3 space-y-3">
                                                {#each itemUsage.historicalReferences.slice(0, 5) as reference}
                                                    <div class="rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/40">
                                                        <p class="text-sm font-medium text-slate-900 dark:text-slate-50">
                                                            {reference.contentTypeName} #{reference.contentItemId}
                                                        </p>
                                                        <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                            {reference.contentTypeSlug} · {reference.path} · v{reference.version}
                                                        </p>
                                                    </div>
                                                {/each}
                                            </div>
                                        {:else}
                                            <p class="mt-3 text-sm text-slate-500 dark:text-slate-400">
                                                No historical version snapshots reference this record.
                                            </p>
                                        {/if}
                                    </div>
                                </div>
                            {:else}
                                <p class="text-sm text-slate-500 dark:text-slate-400">
                                    Reverse-reference data is not available for this item.
                                </p>
                            {/if}
                        </div>
                    </Surface>

                    <Surface tone="subtle" class="p-4">
                        <div
                            class="flex items-start justify-between gap-3 flex-wrap"
                        >
                            <div>
                                <p
                                    class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                                >
                                    Preview
                                </p>
                                <p
                                    class="mt-1 text-xs text-slate-500 dark:text-slate-400"
                                >
                                    Issue a short-lived draft preview token and
                                    open the runtime preview payload in a new
                                    tab.
                                </p>
                            </div>
                            <Button
                                type="button"
                                size="sm"
                                onclick={() => void openPreview()}
                                disabled={openingPreview}
                            >
                                Open preview
                            </Button>
                        </div>
                    </Surface>

                    {#if activeWorkflow}
                        <Surface tone="subtle" class="p-4">
                            <div class="flex items-start justify-between gap-3">
                                <div>
                                    <p
                                        class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                                    >
                                        Workflow
                                    </p>
                                    <h4
                                        class="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-50"
                                    >
                                        {activeWorkflow.name}
                                    </h4>
                                </div>
                            </div>
                            {#if availableTransitions.length > 0}
                                <div class="mt-3 flex flex-wrap gap-2">
                                    {#each availableTransitions as transition}
                                        <Button
                                            type="button"
                                            size="sm"
                                            onclick={() =>
                                                submitForReview(transition.id)}
                                            disabled={submittingReview}
                                        >
                                            {transition.toState === "published"
                                                ? "Publish"
                                                : `Move to ${formatStatusLabel(transition.toState)}`}
                                        </Button>
                                    {/each}
                                </div>
                            {:else}
                                <p
                                    class="mt-3 text-sm text-slate-500 dark:text-slate-400"
                                >
                                    No workflow transitions are available from
                                    the current state.
                                </p>
                            {/if}
                        </Surface>
                    {/if}

                    <Surface tone="subtle" class="p-4">
                        <div class="flex items-center justify-between gap-3">
                            <div>
                                <p
                                    class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                                >
                                    Payload
                                </p>
                                <p
                                    class="mt-1 text-xs text-slate-500 dark:text-slate-400"
                                >
                                    Current structured content data for this
                                    item.
                                </p>
                            </div>
                        </div>
                        <div class="mt-3">
                            <JsonCodeBlock value={selectedItem.data} />
                        </div>
                    </Surface>

                    <Surface tone="subtle" class="p-4">
                        <div
                            class="flex items-start justify-between gap-3 flex-wrap"
                        >
                            <div>
                                <p
                                    class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                                >
                                    Compare version
                                </p>
                                <p
                                    class="mt-1 text-xs text-slate-500 dark:text-slate-400"
                                >
                                    Review the selected historical version
                                    before rollback.
                                </p>
                            </div>
                            {#if versions.length > 0}
                                <div class="w-full sm:w-48">
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
                                                Version {version.version}
                                            </option>
                                        {/each}
                                    </Select>
                                </div>
                            {/if}
                        </div>
                        {#if !selectedDiffVersion}
                            <p
                                class="mt-4 text-sm italic text-slate-500 dark:text-slate-400"
                            >
                                No historical versions available yet.
                            </p>
                        {:else}
                            <div class="mt-4 space-y-3">
                                <div
                                    class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-200"
                                >
                                    Comparing current version v{selectedItem.version}
                                    with v{selectedDiffVersion.version}. {selectedDiffEntries.length}
                                    field-level difference(s).
                                </div>
                                {#if selectedDiffEntries.length === 0}
                                    <p
                                        class="text-sm italic text-slate-500 dark:text-slate-400"
                                    >
                                        No payload changes detected between
                                        these versions.
                                    </p>
                                {:else}
                                    <div
                                        class="max-h-64 space-y-2 overflow-y-auto pr-1"
                                    >
                                        {#each selectedDiffEntries as entry}
                                            <div
                                                class="rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-700"
                                            >
                                                <div
                                                    class="flex items-center justify-between gap-3"
                                                >
                                                    <code
                                                        class="text-xs font-semibold text-slate-800 dark:text-slate-100"
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
                                                    class="mt-2 grid gap-2 text-xs"
                                                >
                                                    <div
                                                        class="rounded-lg bg-slate-50 p-2 dark:bg-slate-950/60"
                                                    >
                                                        <p
                                                            class="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                                                        >
                                                            Current
                                                        </p>
                                                        <p
                                                            class="mt-1 break-words font-mono text-slate-700 dark:text-slate-200"
                                                        >
                                                            {entry.before}
                                                        </p>
                                                    </div>
                                                    <div
                                                        class="rounded-lg bg-slate-50 p-2 dark:bg-slate-950/60"
                                                    >
                                                        <p
                                                            class="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                                                        >
                                                            Selected
                                                        </p>
                                                        <p
                                                            class="mt-1 break-words font-mono text-slate-700 dark:text-slate-200"
                                                        >
                                                            {entry.after}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        {/each}
                                    </div>
                                {/if}
                                <div class="flex justify-end">
                                    <Button
                                        type="button"
                                        variant="destructive"
                                        size="sm"
                                        onclick={() =>
                                            rollbackToVersion(
                                                selectedDiffVersion.version,
                                            )}
                                        disabled={rollingBack}
                                    >
                                        Roll back to v{selectedDiffVersion.version}
                                    </Button>
                                </div>
                            </div>
                        {/if}
                    </Surface>

                    {#if activeWorkflow}
                        <Surface tone="subtle" class="p-4">
                            <p
                                class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                            >
                                Discussion
                            </p>
                            <div
                                class="mt-3 max-h-52 space-y-3 overflow-y-auto pr-1"
                            >
                                {#if comments.length === 0}
                                    <p
                                        class="text-sm italic text-slate-500 dark:text-slate-400"
                                    >
                                        No comments yet.
                                    </p>
                                {:else}
                                    {#each comments as comment}
                                        <div
                                            class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950/30"
                                        >
                                            <div
                                                class="flex items-center justify-between gap-2"
                                            >
                                                <ActorIdentity
                                                    actorId={comment.authorActorId ??
                                                        comment.authorId}
                                                    actorType={comment.authorActorType}
                                                    actorSource={comment.authorActorSource}
                                                    compact={true}
                                                />
                                                <span
                                                    class="text-[0.68rem] text-slate-500 dark:text-slate-400"
                                                >
                                                    {formatDateTime(
                                                        comment.createdAt,
                                                    )}
                                                </span>
                                            </div>
                                            <p
                                                class="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300"
                                            >
                                                {comment.comment}
                                            </p>
                                        </div>
                                    {/each}
                                {/if}
                            </div>
                            <form
                                class="mt-4 flex gap-2"
                                onsubmit={(event) => {
                                    event.preventDefault();
                                    void postComment();
                                }}
                            >
                                <Input
                                    type="text"
                                    bind:value={newComment}
                                    placeholder="Add a comment"
                                    class="flex-1"
                                />
                                <Button
                                    type="submit"
                                    variant="secondary"
                                    disabled={!newComment.trim()}
                                >
                                    Post
                                </Button>
                            </form>
                        </Surface>
                    {/if}

                    <Surface tone="subtle" class="p-4">
                        <p
                            class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                        >
                            Version history
                        </p>
                        {#if versions.length === 0}
                            <p
                                class="mt-3 text-sm italic text-slate-500 dark:text-slate-400"
                            >
                                No historical versions found.
                            </p>
                        {:else}
                            <div class="mt-3 space-y-3">
                                {#each versions as version}
                                    {@const versionDiff = buildDiffEntries(
                                        selectedItem.data,
                                        version.data,
                                        selectedItem.status,
                                        version.status,
                                    )}
                                    <div
                                        class="rounded-xl border border-slate-200 px-3 py-3 dark:border-slate-700"
                                    >
                                        <div
                                            class="flex items-start justify-between gap-3"
                                        >
                                            <div>
                                                <p
                                                    class="text-sm font-semibold text-slate-900 dark:text-slate-50"
                                                >
                                                    Version {version.version}
                                                </p>
                                                <p
                                                    class="mt-1 text-xs text-slate-500 dark:text-slate-400"
                                                >
                                                    {formatStatusLabel(
                                                        version.status,
                                                    )} · {formatDateTime(
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
                                                        selectedVersionForDiff =
                                                            version.version;
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
                                                    Roll back
                                                </Button>
                                            </div>
                                        </div>
                                        <p
                                            class="mt-3 text-sm text-slate-600 dark:text-slate-300"
                                        >
                                            {resolveItemSummary(version)}
                                        </p>
                                        <p
                                            class="mt-2 text-xs text-slate-500 dark:text-slate-400"
                                        >
                                            {versionDiff.length} change(s) from the
                                            current item
                                        </p>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </Surface>
                </div>
            </div>
        {/if}
    {/snippet}

    {#if !selectedType}
        {@render SchemaLanding()}
    {:else}
        <div
            class={`grid flex-1 gap-4 overflow-hidden min-[1400px]:grid-cols-[14rem_minmax(0,1fr)] ${selectedItem ? 'min-[1700px]:grid-cols-[14rem_minmax(0,1fr)_26rem]' : ''}`}
        >
            <aside class="hidden min-h-0 min-[1400px]:block">
                <div class="h-full">
                    {@render CurrentSchemaRail()}
                </div>
            </aside>

            <section class="min-h-0 min-w-0 flex flex-col gap-4">
                <div class="min-[1400px]:hidden">
                    {@render CurrentSchemaSummary()}
                </div>

                <Surface class="p-4">
                    <form
                        class="space-y-4"
                        onsubmit={(event) => {
                            event.preventDefault();
                            applyFilters();
                        }}
                    >
                        <div
                            class="flex flex-col gap-3 min-[1180px]:flex-row min-[1180px]:items-end"
                        >
                            <div class="min-w-0 flex-1">
                                <label
                                    for="content-search"
                                    class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                                >
                                    Search items
                                </label>
                                <Input
                                    id="content-search"
                                    bind:value={itemSearch}
                                    type="search"
                                    placeholder="Search title, slug, summary, author, or item ID"
                                />
                            </div>
                            <div
                                class="grid gap-3 sm:grid-cols-2 min-[1180px]:w-[24rem]"
                            >
                                <div>
                                    <label
                                        for="sort-by"
                                        class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                                    >
                                        Sort
                                    </label>
                                    <Select
                                        id="sort-by"
                                        bind:value={sortSelection}
                                    >
                                        {#each schemaSortOptions as option}
                                            <option value={option.value}
                                                >{option.label}</option
                                            >
                                        {/each}
                                    </Select>
                                </div>
                                <div>
                                    <label
                                        for="sort-dir"
                                        class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                                    >
                                        Order
                                    </label>
                                    <Select id="sort-dir" bind:value={sortDir}>
                                        <option value="desc"
                                            >Newest first</option
                                        >
                                        <option value="asc">Oldest first</option
                                        >
                                    </Select>
                                </div>
                            </div>
                            <div
                                class="flex flex-wrap items-center gap-2 min-[1180px]:justify-end"
                            >
                                <Button
                                    type="button"
                                    variant="outline"
                                    onclick={() => {
                                        showAdvancedFilters =
                                            !showAdvancedFilters;
                                    }}
                                >
                                    {#if showAdvancedFilters || hasAdvancedFilters}
                                        Hide filters
                                    {:else}
                                        More filters
                                        {#if activeAdvancedFilterCount > 0}
                                            ({activeAdvancedFilterCount})
                                        {/if}
                                    {/if}
                                </Button>
                                <Button type="submit">Apply</Button>
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

                        {#if showAdvancedFilters || hasAdvancedFilters}
                            <div
                                class="grid gap-3 rounded-2xl border border-slate-200/80 px-3 py-3 lg:grid-cols-[minmax(0,1fr)_170px_170px] lg:items-end dark:border-slate-700"
                            >
                                <div>
                                    <p
                                        class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                                    >
                                        Status
                                    </p>
                                    <div class="mt-2 flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onclick={() =>
                                                applyStatusFilter("")}
                                            class="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors {filterStatus ===
                                            ''
                                                ? 'border-slate-300 bg-slate-100 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
                                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-300 dark:hover:bg-slate-800'}"
                                        >
                                            <span>All</span>
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
                                                class="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors {filterStatus ===
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
                                {#if selectedTypeQueryableFields.length > 0}
                                    <div class="lg:col-span-3">
                                        <p
                                            class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                                        >
                                            Schema field query
                                        </p>
                                        <div
                                            class="mt-2 grid gap-3 md:grid-cols-[minmax(0,1.1fr)_160px_minmax(0,1fr)_auto]"
                                        >
                                            <Select
                                                bind:value={fieldFilterName}
                                                onchange={() =>
                                                    syncSchemaAwareControls(
                                                        selectedType,
                                                    )}
                                            >
                                                <option value="">
                                                    No field filter
                                                </option>
                                                {#each selectedTypeQueryableFields as field}
                                                    <option value={field.name}
                                                        >{field.label} ({field.type})</option
                                                    >
                                                {/each}
                                            </Select>
                                            <Select bind:value={fieldFilterOp}>
                                                {#each availableFieldFilterOperators as option}
                                                    <option value={option.value}
                                                        >{option.label}</option
                                                    >
                                                {/each}
                                            </Select>
                                            <Input
                                                bind:value={fieldFilterValue}
                                                placeholder={resolveFieldFilterPlaceholder(
                                                    selectedFieldFilterMeta ??
                                                        undefined,
                                                )}
                                            />
                                            <Button
                                                type="button"
                                                variant={includeArchived
                                                    ? "secondary"
                                                    : "outline"}
                                                onclick={() => {
                                                    includeArchived =
                                                        !includeArchived;
                                                }}
                                            >
                                                {includeArchived
                                                    ? "Including archived"
                                                    : "Hide archived"}
                                            </Button>
                                        </div>
                                    </div>
                                {:else}
                                    <div class="lg:col-span-3">
                                        <div
                                            class="rounded-xl border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400"
                                        >
                                            This schema has no top-level scalar
                                            fields available for field-aware
                                            queries yet.
                                        </div>
                                    </div>
                                {/if}
                                <div>
                                    <label
                                        for="created-after"
                                        class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                                    >
                                        After
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
                                        class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                                    >
                                        Before
                                    </label>
                                    <Input
                                        id="created-before"
                                        bind:value={createdBefore}
                                        type="date"
                                    />
                                </div>
                            </div>
                        {/if}

                        {#if hasActiveFilters}
                            <div
                                class="border-t border-slate-200 pt-3 dark:border-slate-700"
                            >
                                <p
                                    class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
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
                                    {#if hasFieldFilter}
                                        <button
                                            type="button"
                                            onclick={() =>
                                                clearFilterChip("field")}
                                            class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-200"
                                        >
                                            <span
                                                >Field: {humanizeFieldName(
                                                    fieldFilterName,
                                                )} {fieldFilterOp} "{fieldFilterValue.trim()}"</span
                                            >
                                            <span aria-hidden="true">×</span>
                                        </button>
                                    {/if}
                                    {#if createdAfter}
                                        <button
                                            type="button"
                                            onclick={() =>
                                                clearFilterChip("createdAfter")}
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
                                    {#if includeArchived}
                                        <button
                                            type="button"
                                            onclick={() =>
                                                clearFilterChip("archived")}
                                            class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-200"
                                        >
                                            <span>Including archived</span>
                                            <span aria-hidden="true">×</span>
                                        </button>
                                    {/if}
                                </div>
                            </div>
                        {/if}
                    </form>
                </Surface>

                <Surface
                    class="min-h-0 flex flex-1 flex-col overflow-hidden p-0"
                >
                    <div
                        class="border-b border-slate-200/80 bg-slate-50/80 px-5 py-4 dark:border-slate-700 dark:bg-slate-900/30"
                    >
                        <div
                            class="flex items-start justify-between gap-4 flex-wrap"
                        >
                            <div>
                                <p
                                    class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                                >
                                    Results
                                </p>
                                <h3
                                    class="mt-2 text-base font-semibold text-slate-900 dark:text-slate-50"
                                >
                                    Showing {currentRangeStart}-{currentRangeEnd}
                                    of {itemsMeta.total}
                                </h3>
                                <p
                                    class="mt-1 text-sm text-slate-500 dark:text-slate-400"
                                >
                                    {hasActiveFilters
                                        ? `Filtered results inside ${selectedType.name}.`
                                        : `All content stored against ${selectedType.name}. Select an item to inspect its history.`}
                                </p>
                                {#if selectedTypeLifecycle}
                                    <div class="mt-3 flex flex-wrap gap-2">
                                        <Badge variant="outline">
                                            TTL {formatTtlDuration(
                                                selectedTypeLifecycle.ttlSeconds,
                                            )} on {selectedTypeLifecycle.clock ===
                                            "createdAt"
                                                ? "create"
                                                : "update"}
                                        </Badge>
                                        {#if includeArchived}
                                            <Badge variant="muted">
                                                Archived rows included
                                            </Badge>
                                        {/if}
                                    </div>
                                {/if}
                            </div>
                            {#if activeWorkflow}
                                <div
                                    class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-200"
                                >
                                    <div
                                        class="font-semibold uppercase tracking-wide"
                                    >
                                        Workflow
                                    </div>
                                    <div class="mt-1">
                                        {activeWorkflow.name}
                                    </div>
                                </div>
                            {/if}
                        </div>
                    </div>

                    <div class="relative flex-1 overflow-y-auto p-4">
                        {#if loadingItems && items.length === 0}
                            <div class="flex justify-center p-10">
                                <LoadingSpinner size="md" />
                            </div>
                        {:else if items.length === 0}
                            <div
                                class="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400"
                            >
                                <p>
                                    No items found for the current schema and
                                    filters.
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
                            <div class="space-y-3 lg:hidden">
                                {#each items as item}
                                    <button
                                        type="button"
                                        class={`w-full rounded-2xl border px-4 py-4 text-left transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/50 ${
                                            selectedItem?.id === item.id
                                                ? "border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/60"
                                                : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/20"
                                        }`}
                                        onclick={() => selectItem(item)}
                                    >
                                        <div
                                            class="flex items-start justify-between gap-3"
                                        >
                                            <div class="min-w-0">
                                                <p
                                                    class="truncate text-sm font-semibold text-slate-900 dark:text-slate-50"
                                                >
                                                    {resolveItemLabel(item)}
                                                </p>
                                                <div
                                                    class="mt-1 flex flex-wrap items-center gap-2 text-[0.72rem] text-slate-500 dark:text-slate-400"
                                                >
                                                    <span class="font-mono"
                                                        >#{item.id}</span
                                                    >
                                                    {#if resolveItemSlug(item)}
                                                        <span class="font-mono"
                                                            >{resolveItemSlug(
                                                                item,
                                                            )}</span
                                                        >
                                                    {/if}
                                                    <span>v{item.version}</span>
                                                </div>
                                            </div>
                                            <Badge
                                                variant={resolveStatusBadgeVariant(
                                                    item.status,
                                                )}
                                            >
                                                {formatStatusLabel(item.status)}
                                            </Badge>
                                        </div>
                                        <p
                                            class="mt-3 line-clamp-2 text-sm text-slate-600 dark:text-slate-300"
                                        >
                                            {resolveItemSummary(item)}
                                        </p>
                                        <div
                                            class="mt-3 grid gap-2 text-[0.72rem] text-slate-500 dark:text-slate-400 sm:grid-cols-2"
                                        >
                                            <div>
                                                <span
                                                    class="font-semibold uppercase tracking-wide"
                                                    >Updated</span
                                                >
                                                <div class="mt-1">
                                                    {formatDate(item.updatedAt)}
                                                    · {formatRelativeDate(
                                                        item.updatedAt,
                                                    )}
                                                </div>
                                            </div>
                                            <div>
                                                <span
                                                    class="font-semibold uppercase tracking-wide"
                                                    >Created</span
                                                >
                                                <div class="mt-1">
                                                    {formatDate(item.createdAt)}
                                                    · {formatRelativeDate(
                                                        item.createdAt,
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                {/each}
                            </div>

                            <div class="hidden lg:block">
                                <DataTable
                                    columns={contentColumns}
                                    data={items}
                                    keyField="id"
                                    onRowClick={(row) =>
                                        selectItem(
                                            row as unknown as ContentItem,
                                        )}
                                >
                                    {#snippet cell({ row, column })}
                                        {@const item =
                                            row as unknown as ContentItem}
                                        {#if column.key === "_item"}
                                            <div class="min-w-0">
                                                <p
                                                    class="truncate text-sm font-semibold text-slate-900 dark:text-slate-50"
                                                >
                                                    {resolveItemLabel(item)}
                                                </p>
                                                <div
                                                    class="mt-1 flex flex-wrap items-center gap-2 text-[0.72rem] text-slate-500 dark:text-slate-400"
                                                >
                                                    <span class="font-mono"
                                                        >#{item.id}</span
                                                    >
                                                    {#if resolveItemAttribution(item)}
                                                        <span
                                                            >by {resolveItemAttribution(
                                                                item,
                                                            )}</span
                                                        >
                                                    {/if}
                                                </div>
                                                <p
                                                    class="mt-2 line-clamp-1 text-xs text-slate-500 dark:text-slate-400"
                                                >
                                                    {resolveItemSummary(item)}
                                                </p>
                                            </div>
                                        {:else if column.key === "slug"}
                                            <span
                                                class="font-mono text-xs text-slate-600 dark:text-slate-300"
                                            >
                                                {resolveItemSlug(item) ?? "—"}
                                            </span>
                                        {:else if column.key === "status"}
                                            <Badge
                                                variant={resolveStatusBadgeVariant(
                                                    item.status,
                                                )}
                                            >
                                                {formatStatusLabel(item.status)}
                                            </Badge>
                                        {:else if column.key === "version"}
                                            <span
                                                class="text-sm text-slate-600 dark:text-slate-300"
                                            >
                                                v{item.version}
                                            </span>
                                        {:else if column.key === "updatedAt"}
                                            <div
                                                class="text-sm text-slate-600 dark:text-slate-300"
                                            >
                                                <div>
                                                    {formatDate(item.updatedAt)}
                                                </div>
                                                <div
                                                    class="text-xs text-slate-500 dark:text-slate-400"
                                                >
                                                    {formatRelativeDate(
                                                        item.updatedAt,
                                                    )}
                                                </div>
                                            </div>
                                        {:else if column.key === "createdAt"}
                                            <div
                                                class="text-sm text-slate-600 dark:text-slate-300"
                                            >
                                                <div>
                                                    {formatDate(item.createdAt)}
                                                </div>
                                                <div
                                                    class="text-xs text-slate-500 dark:text-slate-400"
                                                >
                                                    {formatRelativeDate(
                                                        item.createdAt,
                                                    )}
                                                </div>
                                            </div>
                                        {/if}
                                    {/snippet}
                                </DataTable>
                            </div>
                        {/if}

                        {#if loadingItems && items.length > 0}
                            <div
                                class="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-slate-950/50"
                            >
                                <LoadingSpinner size="lg" />
                            </div>
                        {/if}
                    </div>

                    <div
                        class="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm dark:border-slate-700"
                    >
                        <p class="text-slate-600 dark:text-slate-300">
                            Showing {currentRangeStart}-{currentRangeEnd} of {itemsMeta.total}
                        </p>
                        <div class="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onclick={goToPrevPage}
                                disabled={itemsMeta.offset === 0 ||
                                    loadingItems}
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
            </section>

            {#if selectedItem}
                <aside class="hidden min-h-0 min-[1850px]:block">
                    <Surface class="h-full overflow-hidden p-0">
                        {@render InspectorContent()}
                    </Surface>
                </aside>
            {/if}
        </div>
    {/if}

    {#if selectedType && selectedItem}
        <button
            type="button"
            class="fixed inset-0 z-30 bg-slate-950/55 min-[1850px]:hidden"
            aria-label="Close inspector"
            onclick={() => resetSelectedItemContext()}
        ></button>
        <section
            class="fixed inset-y-0 right-0 z-40 flex w-full max-w-[36rem] flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900 min-[1850px]:hidden"
        >
            {@render InspectorContent()}
        </section>
    {/if}

    {#if selectedType && showSchemaInfoModal}
        <button
            type="button"
            class="fixed inset-0 z-40 bg-slate-950/55"
            aria-label="Close schema details"
            onclick={() => (showSchemaInfoModal = false)}
        ></button>
        <div
            class="fixed inset-x-4 top-1/2 z-50 mx-auto flex max-h-[80vh] w-full max-w-3xl -translate-y-1/2 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            role="dialog"
            aria-modal="true"
            aria-label="Schema details"
        >
            <div
                class="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-slate-700"
            >
                <div>
                    <p
                        class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                    >
                        Schema details
                    </p>
                    <h3
                        class="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-50"
                    >
                        {selectedType.name}
                    </h3>
                    <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {selectedType.description ||
                            "Structured content model for supervised AI and operator workflows."}
                    </p>
                </div>
                <button
                    type="button"
                    aria-label="Close schema details"
                    class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    onclick={() => (showSchemaInfoModal = false)}
                >
                    <Icon src={XMark} class="h-5 w-5" />
                </button>
            </div>

            <div class="flex-1 overflow-y-auto px-6 py-5">
                <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <Surface tone="subtle" class="p-4">
                        <p
                            class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                        >
                            Items
                        </p>
                        <p
                            class="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50"
                        >
                            {resolveTypeItemCount(selectedType)}
                        </p>
                        <p
                            class="mt-1 text-xs text-slate-500 dark:text-slate-400"
                        >
                            Stored in this schema
                        </p>
                    </Surface>
                    <Surface tone="subtle" class="p-4">
                        <p
                            class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                        >
                            Queryable fields
                        </p>
                        <p
                            class="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50"
                        >
                            {selectedTypeQueryableFields.length}
                        </p>
                        <p
                            class="mt-1 text-xs text-slate-500 dark:text-slate-400"
                        >
                            Top-level scalar fields
                        </p>
                    </Surface>
                    <Surface tone="subtle" class="p-4">
                        <p
                            class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                        >
                            Matching items
                        </p>
                        <p
                            class="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50"
                        >
                            {itemsMeta.total}
                        </p>
                        <p
                            class="mt-1 text-xs text-slate-500 dark:text-slate-400"
                        >
                            Current result set
                        </p>
                    </Surface>
                    <Surface tone="subtle" class="p-4">
                        <p
                            class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                        >
                            Lifecycle
                        </p>
                        {#if selectedTypeLifecycle}
                            <p
                                class="mt-2 text-base font-semibold text-slate-900 dark:text-slate-50"
                            >
                                {formatTtlDuration(
                                    selectedTypeLifecycle.ttlSeconds,
                                )} to {formatStatusLabel(
                                    selectedTypeLifecycle.archiveStatus,
                                )}
                            </p>
                            <p
                                class="mt-1 text-xs text-slate-500 dark:text-slate-400"
                            >
                                Ages from {selectedTypeLifecycle.clock ===
                                "createdAt"
                                    ? "creation"
                                    : "last update"} and hides archived rows by
                                default
                            </p>
                        {:else}
                            <p
                                class="mt-2 text-base font-semibold text-slate-900 dark:text-slate-50"
                            >
                                Inactive
                            </p>
                            <p
                                class="mt-1 text-xs text-slate-500 dark:text-slate-400"
                            >
                                No TTL archival policy on this schema
                            </p>
                        {/if}
                    </Surface>
                    <Surface tone="subtle" class="p-4">
                        <p
                            class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                        >
                            Last activity
                        </p>
                        <p
                            class="mt-2 text-base font-semibold text-slate-900 dark:text-slate-50"
                        >
                            {selectedType.stats?.lastItemUpdatedAt
                                ? formatRelativeDate(
                                      selectedType.stats.lastItemUpdatedAt,
                                  )
                                : "No items yet"}
                        </p>
                        <p
                            class="mt-1 text-xs text-slate-500 dark:text-slate-400"
                        >
                            {selectedType.stats?.lastItemUpdatedAt
                                ? formatDateTime(
                                      selectedType.stats.lastItemUpdatedAt,
                                  )
                                : "This schema has not been used yet"}
                        </p>
                    </Surface>
                    <Surface tone="subtle" class="p-4">
                        <p
                            class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                        >
                            Workflow
                        </p>
                        <p
                            class="mt-2 text-base font-semibold text-slate-900 dark:text-slate-50"
                        >
                            {activeWorkflow
                                ? activeWorkflow.name
                                : "No active workflow"}
                        </p>
                        <p
                            class="mt-1 text-xs text-slate-500 dark:text-slate-400"
                        >
                            {activeWorkflow
                                ? `${activeWorkflow.transitions.length} transition(s) available`
                                : "Items keep their current status until a workflow is assigned"}
                        </p>
                    </Surface>
                    <Surface tone="subtle" class="p-4">
                        <p
                            class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                        >
                            Public write
                        </p>
                        {#if selectedTypePublicWrite}
                            <p
                                class="mt-2 text-base font-semibold text-slate-900 dark:text-slate-50"
                            >
                                {selectedTypePublicWrite.allowedOperations.join(
                                    " / ",
                                )}
                            </p>
                            <p
                                class="mt-1 text-xs text-slate-500 dark:text-slate-400"
                            >
                                Subject: {humanizeFieldName(
                                    selectedTypePublicWrite.subjectField,
                                )}{#if selectedTypePublicWrite.requiredStatus}
                                    · only {formatStatusLabel(
                                        selectedTypePublicWrite.requiredStatus,
                                    )}{/if}
                            </p>
                        {:else}
                            <p
                                class="mt-2 text-base font-semibold text-slate-900 dark:text-slate-50"
                            >
                                Disabled
                            </p>
                            <p
                                class="mt-1 text-xs text-slate-500 dark:text-slate-400"
                            >
                                No public session write lane on this schema
                            </p>
                        {/if}
                    </Surface>
                </div>

                {#if selectedTypeStatusSummary.length > 0}
                    <Surface tone="subtle" class="mt-4 p-4">
                        <p
                            class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                        >
                            Status mix
                        </p>
                        <div class="mt-3 flex flex-wrap gap-2">
                            {#each selectedTypeStatusSummary as summary}
                                <Badge variant="muted">
                                    {formatStatusLabel(summary.status)}
                                    {summary.count}
                                </Badge>
                            {/each}
                        </div>
                    </Surface>
                {/if}
            </div>

            <div
                class="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-700"
            >
                <Button
                    type="button"
                    variant="outline"
                    onclick={() => (showSchemaInfoModal = false)}
                >
                    Close
                </Button>
            </div>
        </div>
    {/if}

    {#if showModelFilterModal}
        <button
            type="button"
            class="fixed inset-0 z-40 bg-slate-950/55"
            aria-label="Close model chooser"
            onclick={() => (showModelFilterModal = false)}
        ></button>
        <div
            class="fixed inset-x-4 top-1/2 z-50 mx-auto flex max-h-[80vh] w-full max-w-2xl -translate-y-1/2 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            role="dialog"
            aria-modal="true"
            aria-label="Choose content schema"
        >
            <div
                class="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-slate-700"
            >
                <div>
                    <p
                        class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                    >
                        Content models
                    </p>
                    <h3
                        class="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-50"
                    >
                        Choose content schema
                    </h3>
                    <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Select the schema you want to browse. The browser will
                        then show all content created from that schema.
                    </p>
                </div>
                <button
                    type="button"
                    aria-label="Close model chooser"
                    class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    onclick={() => (showModelFilterModal = false)}
                >
                    <Icon src={XMark} class="h-5 w-5" />
                </button>
            </div>

            <div
                class="border-b border-slate-200 px-6 py-4 dark:border-slate-700"
            >
                <Input
                    bind:value={schemaPickerSearch}
                    type="search"
                    placeholder="Find a content schema"
                />
            </div>

            <div class="flex-1 overflow-y-auto px-6 py-4">
                <div class="space-y-3">
                    {#each schemaPickerTypes as type}
                        <label
                            class="flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-4 transition-colors {draftSelectedTypeId ===
                            type.id
                                ? 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/60'
                                : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/40'}"
                        >
                            <input
                                type="radio"
                                name="schema-picker"
                                checked={draftSelectedTypeId === type.id}
                                onchange={() => (draftSelectedTypeId = type.id)}
                                class="mt-0.5 h-4 w-4 border-slate-300 text-slate-900 focus:ring-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-slate-700"
                            />
                            <div class="min-w-0 flex-1">
                                <div
                                    class="flex items-center justify-between gap-3"
                                >
                                    <div class="min-w-0">
                                        <p
                                            class="truncate text-sm font-semibold text-slate-900 dark:text-slate-100"
                                        >
                                            {type.name}
                                        </p>
                                        <p
                                            class="mt-0.5 truncate text-[0.72rem] font-mono text-slate-500 dark:text-slate-400"
                                        >
                                            {type.slug}
                                        </p>
                                    </div>
                                    <div class="flex items-center gap-2">
                                        <Badge variant="outline">
                                            {resolveTypeItemCount(type)}
                                        </Badge>
                                        {#if (type.basePrice ?? 0) > 0}
                                            <Badge variant="paid">Paid</Badge>
                                        {/if}
                                    </div>
                                </div>
                                <p
                                    class="mt-1 text-xs text-slate-500 dark:text-slate-400"
                                >
                                    {type.description ||
                                        resolveSchemaSummary(type)}
                                </p>
                            </div>
                        </label>
                    {/each}
                    {#if schemaPickerTypes.length === 0}
                        <div
                            class="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400"
                        >
                            No schemas match “{schemaPickerSearch.trim()}”.
                        </div>
                    {/if}
                </div>
            </div>

            <div
                class="flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-4 dark:border-slate-700"
            >
                <p class="text-sm text-slate-500 dark:text-slate-400">
                    {draftSelectedTypeId === null
                        ? "No schema selected"
                        : `${schemaPickerTypes.find((type) => type.id === draftSelectedTypeId)?.name ?? "Schema selected"}`}
                </p>
                <div class="flex items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onclick={() => (showModelFilterModal = false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        onclick={() => void applySchemaSelection()}
                        disabled={draftSelectedTypeId === null}
                    >
                        Apply
                    </Button>
                </div>
            </div>
        </div>
    {/if}
</div>
