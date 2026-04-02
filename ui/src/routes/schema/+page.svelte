<script lang="ts">
    import { fetchApi, ApiError } from "$lib/api";
    import { onMount } from "svelte";
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Input from "$lib/components/ui/Input.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import Surface from "$lib/components/ui/Surface.svelte";
    import Textarea from "$lib/components/ui/Textarea.svelte";
    import {
        Icon,
        Plus,
        ArchiveBox,
        CheckCircle,
        Check,
        ExclamationCircle,
    } from "svelte-hero-icons";

    type ContentType = {
        id: number;
        name: string;
        slug: string;
        description: string;
        schema: string;
        schemaManifest?: string | null;
        basePrice?: number | null;
    };
    type SchemaSourceMode = "schema" | "manifest";
    type ManifestField = {
        name: string;
        type: string;
        label?: string;
        description?: string;
        required?: boolean;
        localized?: boolean;
        options?: string[];
        itemType?: string;
        fields?: ManifestField[];
        blocks?: ManifestBlock[];
    };
    type ManifestBlock = {
        type: string;
        label?: string;
        description?: string;
        fields: ManifestField[];
    };
    type ManifestDocument = {
        title?: string;
        description?: string;
        fields: ManifestField[];
        localization?: {
            supportedLocales?: string[];
            defaultLocale?: string;
        };
        publicWrite?: {
            subjectField?: string;
            allowedOperations?: string[];
            requiredStatus?: string;
        };
        lifecycle?: {
            ttlSeconds?: number;
            archiveStatus?: string;
            clock?: string;
        };
    };
    type ManifestPreviewRow = {
        id: string;
        depth: number;
        label: string;
        hint: string;
        required: boolean;
        kind: "field" | "container" | "block";
        description?: string;
    };
    type ManifestStarter = {
        id: string;
        name: string;
        slug: string;
        description: string;
        summary: string;
        searchableFields: string[];
        manifest: ManifestDocument;
    };

    let types = $state<ContentType[]>([]);
    let selectedType = $state<ContentType | null>(null);
    let loading = $state(true);

    // Editor State
    let isCreating = $state(false);
    let isEditing = $state(false);
    let editingName = $state("");
    let editingSlug = $state("");
    let editingDesc = $state("");
    let editingSourceMode = $state<SchemaSourceMode>("schema");
    let editingSchemaStr = $state("");
    let editingSchemaManifestStr = $state("");
    let editingBasePrice = $state<number | null>(null);
    let schemaError = $state<string | null>(null);
    let compiledSchemaPreviewStr = $state("");
    let compiledSchemaPreviewError = $state<string | null>(null);
    let compilingManifestPreview = $state(false);

    // Live validation preview
    let previewDataStr = $state("{\n  \n}");
    let previewValidationResult = $state<{
        valid: boolean;
        error?: string;
    } | null>(null);
    let manifestPreviewRows = $derived.by(() =>
        resolveManifestPreviewRows(editingSchemaManifestStr),
    );
    let manifestDocument = $derived.by(() =>
        parseManifestDocument(editingSchemaManifestStr),
    );

    const defaultSchemaStr = JSON.stringify(
        {
            type: "object",
            properties: {
                title: { type: "string" },
                body: { type: "string" },
            },
            required: ["title"],
        },
        null,
        2,
    );
    const defaultManifestStr = JSON.stringify(
        {
            title: "Article",
            fields: [
                {
                    name: "title",
                    type: "text",
                    label: "Title",
                    required: true,
                },
                {
                    name: "body",
                    type: "textarea",
                    label: "Body",
                },
            ],
        },
        null,
        2,
    );
    const manifestStarters: ManifestStarter[] = [
        {
            id: "memory",
            name: "Agent Memory",
            slug: "agent-memory",
            description:
                "Durable memory entries optimized for search and resumable agent workflows.",
            summary:
                "Stores durable facts with a stable key, compact summary text, tags, lifecycle state, and provenance.",
            searchableFields: ["summary", "details"],
            manifest: {
                title: "Agent Memory",
                description:
                    "Durable memory entries optimized for retrieval.",
                fields: [
                    { name: "memoryKey", type: "text", required: true },
                    { name: "subjectId", type: "text", required: true },
                    { name: "summary", type: "text", required: true },
                    { name: "details", type: "textarea" },
                    { name: "tags", type: "array", itemType: "text" },
                    {
                        name: "status",
                        type: "select",
                        required: true,
                        options: ["active", "stale", "archived"],
                    },
                    {
                        name: "provenance",
                        type: "group",
                        fields: [
                            { name: "source", type: "text" },
                            { name: "capturedBy", type: "text" },
                            { name: "capturedAt", type: "text" },
                        ],
                    },
                ],
            },
        },
        {
            id: "task-log",
            name: "Task Log",
            slug: "task-log",
            description:
                "Execution log entries for agent runs with lifecycle retention and audit-oriented provenance.",
            summary:
                "Captures per-run checkpoints with short searchable summaries and optional long-form detail.",
            searchableFields: ["summary", "detail"],
            manifest: {
                title: "Task Log",
                description: "Execution log entries for agent runs.",
                lifecycle: {
                    ttlSeconds: 2592000,
                    archiveStatus: "expired",
                    clock: "updatedAt",
                },
                fields: [
                    { name: "runId", type: "text", required: true },
                    { name: "stepKey", type: "text", required: true },
                    { name: "summary", type: "text", required: true },
                    { name: "detail", type: "textarea" },
                    { name: "tags", type: "array", itemType: "text" },
                    {
                        name: "status",
                        type: "select",
                        required: true,
                        options: ["queued", "running", "succeeded", "failed"],
                    },
                    {
                        name: "provenance",
                        type: "group",
                        fields: [
                            { name: "actorId", type: "text" },
                            { name: "actorType", type: "text" },
                            { name: "source", type: "text" },
                        ],
                    },
                ],
            },
        },
        {
            id: "checkpoint",
            name: "Checkpoint",
            slug: "checkpoint",
            description:
                "Resumable state snapshots for agent handoff and low-memory continuation.",
            summary:
                "Stores stable checkpoint ids, searchable summaries, state payloads, and provenance for resume flows.",
            searchableFields: ["summary"],
            manifest: {
                title: "Checkpoint",
                description: "Resumable agent checkpoint snapshots.",
                fields: [
                    { name: "checkpointKey", type: "text", required: true },
                    { name: "parentCheckpointKey", type: "text" },
                    { name: "summary", type: "text", required: true },
                    { name: "stateJson", type: "textarea" },
                    { name: "tags", type: "array", itemType: "text" },
                    {
                        name: "status",
                        type: "select",
                        required: true,
                        options: ["active", "superseded", "invalid"],
                    },
                    {
                        name: "provenance",
                        type: "group",
                        fields: [
                            { name: "reason", type: "text" },
                            { name: "capturedBy", type: "text" },
                            { name: "capturedAt", type: "text" },
                        ],
                    },
                ],
            },
        },
    ];

    onMount(async () => {
        await loadTypes();
    });

    $effect(() => {
        saveDraft();
    });

    const DRAFT_PREFIX = "wc_schema_draft_";

    function getDraftKey(id: number | null) {
        return `${DRAFT_PREFIX}${id || "new"}`;
    }

    function saveDraft() {
        if (typeof sessionStorage === "undefined") return;
        if (!isEditing && !isCreating) return;
        const key = getDraftKey(isCreating ? null : (selectedType?.id ?? null));
        const draft = {
            name: editingName,
            slug: editingSlug,
            desc: editingDesc,
            sourceMode: editingSourceMode,
            basePrice: editingBasePrice,
            schemaStr: editingSchemaStr,
            schemaManifestStr: editingSchemaManifestStr,
            compiledSchemaPreviewStr,
            updatedAt: Date.now(),
        };
        sessionStorage.setItem(key, JSON.stringify(draft));
    }

    function loadDraft(id: number | null) {
        if (typeof sessionStorage === "undefined") return null;
        const key = getDraftKey(id);
        const saved = sessionStorage.getItem(key);
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch {
                return null;
            }
        }
        return null;
    }

    function clearDraft(id: number | null) {
        if (typeof sessionStorage === "undefined") return;
        const key = getDraftKey(id);
        sessionStorage.removeItem(key);
    }

    function normalizeSchemaString(schema: unknown): string {
        if (typeof schema === "string") {
            try {
                return JSON.stringify(JSON.parse(schema), null, 2);
            } catch {
                return schema;
            }
        }

        try {
            return JSON.stringify(schema, null, 2);
        } catch {
            return String(schema ?? "");
        }
    }

    function humanizeFieldName(value: string): string {
        return value
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/[_-]+/g, " ")
            .replace(/\b\w/g, (char) => char.toUpperCase());
    }

    function parseManifestDocument(value: string): ManifestDocument | null {
        try {
            const parsed = JSON.parse(value);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                return null;
            }
            return parsed as ManifestDocument;
        } catch {
            return null;
        }
    }

    function pushManifestPreviewRows(
        fields: ManifestField[],
        rows: ManifestPreviewRow[],
        depth = 0,
        prefix = "field",
    ) {
        for (const field of fields) {
            const label = field.label || humanizeFieldName(field.name || "field");
            const description =
                typeof field.description === "string" &&
                field.description.trim().length > 0
                    ? field.description.trim()
                    : undefined;

            if (field.type === "group") {
                rows.push({
                    id: `${prefix}-${field.name}`,
                    depth,
                    label,
                    hint: "Grouped fields",
                    required: field.required === true,
                    kind: "container",
                    description,
                });
                if (Array.isArray(field.fields)) {
                    pushManifestPreviewRows(
                        field.fields,
                        rows,
                        depth + 1,
                        `${prefix}-${field.name}`,
                    );
                }
                continue;
            }

            if (field.type === "array") {
                rows.push({
                    id: `${prefix}-${field.name}`,
                    depth,
                    label,
                    hint: field.itemType
                        ? `Repeatable ${field.itemType}`
                        : "Repeatable group",
                    required: field.required === true,
                    kind: "container",
                    description,
                });
                if (Array.isArray(field.fields)) {
                    pushManifestPreviewRows(
                        field.fields,
                        rows,
                        depth + 1,
                        `${prefix}-${field.name}-item`,
                    );
                }
                continue;
            }

            if (field.type === "block-set") {
                rows.push({
                    id: `${prefix}-${field.name}`,
                    depth,
                    label,
                    hint: "Block set",
                    required: field.required === true,
                    kind: "container",
                    description,
                });
                for (const block of field.blocks ?? []) {
                    rows.push({
                        id: `${prefix}-${field.name}-${block.type}`,
                        depth: depth + 1,
                        label: block.label || humanizeFieldName(block.type),
                        hint: "Block variant",
                        required: false,
                        kind: "block",
                        description:
                            typeof block.description === "string" &&
                            block.description.trim().length > 0
                                ? block.description.trim()
                                : undefined,
                    });
                    pushManifestPreviewRows(
                        block.fields ?? [],
                        rows,
                        depth + 2,
                        `${prefix}-${field.name}-${block.type}`,
                    );
                }
                continue;
            }

            const hintByType: Record<string, string> = {
                text: "Text input",
                textarea: "Long text",
                number: "Numeric input",
                checkbox: "Checkbox",
                select: "Select menu",
                asset: "Asset picker",
                "asset-list": "Asset list",
                "content-ref": "Reference picker",
                "content-ref-list": "Reference list",
            };
            rows.push({
                id: `${prefix}-${field.name}`,
                depth,
                label,
                hint: hintByType[field.type] || "Field",
                required: field.required === true,
                kind: "field",
                description:
                    field.localized === true
                        ? [description, "Localized field"]
                              .filter(Boolean)
                              .join(" • ")
                        : description,
            });
        }
    }

    function resolveManifestPreviewRows(
        manifestText: string,
    ): ManifestPreviewRow[] {
        const manifest = parseManifestDocument(manifestText);
        if (!manifest || !Array.isArray(manifest.fields)) {
            return [];
        }

        const rows: ManifestPreviewRow[] = [];
        pushManifestPreviewRows(manifest.fields, rows);
        return rows;
    }

    function getCompiledPreviewFallback() {
        if (editingSourceMode === "manifest") {
            return selectedType ? normalizeSchemaString(selectedType.schema) : "";
        }

        return "";
    }

    async function loadTypes() {
        loading = true;
        try {
            const res = await fetchApi("/content-types");
            types = res.data;
        } catch (err: any) {
            feedbackStore.pushToast({
                severity: "error",
                title: "Failed to load content types",
                message: err.message || "An error occurred.",
                code: err instanceof ApiError ? err.code : undefined,
                remediation:
                    err instanceof ApiError ? err.remediation : undefined,
            });
        } finally {
            loading = false;
        }
    }

    function resetPreviewState() {
        schemaError = null;
        compiledSchemaPreviewError = null;
        previewValidationResult = null;
    }

    function selectType(t: ContentType) {
        selectedType = t;
        isCreating = false;

        const draft = loadDraft(t.id);
        if (draft) {
            isEditing = true;
            editingName = draft.name;
            editingSlug = draft.slug;
            editingDesc = draft.desc;
            editingSourceMode =
                draft.sourceMode === "manifest" ? "manifest" : "schema";
            editingBasePrice = draft.basePrice;
            editingSchemaStr = draft.schemaStr;
            editingSchemaManifestStr =
                draft.schemaManifestStr || defaultManifestStr;
            compiledSchemaPreviewStr =
                draft.compiledSchemaPreviewStr ||
                normalizeSchemaString(t.schema);
        } else {
            isEditing = false;
            editingName = t.name;
            editingSlug = t.slug;
            editingDesc = t.description || "";
            editingSourceMode = t.schemaManifest ? "manifest" : "schema";
            editingBasePrice = t.basePrice ?? null;
            editingSchemaStr = normalizeSchemaString(t.schema);
            editingSchemaManifestStr = t.schemaManifest
                ? normalizeSchemaString(t.schemaManifest)
                : defaultManifestStr;
            compiledSchemaPreviewStr = t.schemaManifest
                ? normalizeSchemaString(t.schema)
                : "";
        }
        resetPreviewState();
    }

    function startCreate() {
        selectedType = null;
        isCreating = true;
        isEditing = true;

        const draft = loadDraft(null);
        if (draft) {
            editingName = draft.name;
            editingSlug = draft.slug;
            editingDesc = draft.desc;
            editingSourceMode =
                draft.sourceMode === "manifest" ? "manifest" : "schema";
            editingBasePrice = draft.basePrice;
            editingSchemaStr = draft.schemaStr;
            editingSchemaManifestStr =
                draft.schemaManifestStr || defaultManifestStr;
            compiledSchemaPreviewStr = draft.compiledSchemaPreviewStr || "";
        } else {
            editingName = "";
            editingSlug = "";
            editingDesc = "";
            editingSourceMode = "schema";
            editingBasePrice = null;
            editingSchemaStr = defaultSchemaStr;
            editingSchemaManifestStr = defaultManifestStr;
            compiledSchemaPreviewStr = "";
        }
        resetPreviewState();
    }

    function startEdit() {
        isEditing = true;
    }

    function cancelEdit() {
        clearDraft(isCreating ? null : (selectedType?.id ?? null));
        if (isCreating) {
            isCreating = false;
            isEditing = false;
            selectedType = types.length > 0 ? types[0] : null;
            if (selectedType) {
                const draft = loadDraft(selectedType.id);
                if (draft) {
                    isEditing = true;
                    editingName = draft.name;
                    editingSlug = draft.slug;
                    editingDesc = draft.desc;
                    editingSourceMode =
                        draft.sourceMode === "manifest"
                            ? "manifest"
                            : "schema";
                    editingBasePrice = draft.basePrice;
                    editingSchemaStr = draft.schemaStr;
                    editingSchemaManifestStr =
                        draft.schemaManifestStr || defaultManifestStr;
                    compiledSchemaPreviewStr =
                        draft.compiledSchemaPreviewStr ||
                        normalizeSchemaString(selectedType.schema);
                } else {
                    editingName = selectedType.name;
                    editingSlug = selectedType.slug;
                    editingDesc = selectedType.description || "";
                    editingSourceMode = selectedType.schemaManifest
                        ? "manifest"
                        : "schema";
                    editingBasePrice = selectedType.basePrice ?? null;
                    editingSchemaStr = normalizeSchemaString(
                        selectedType.schema,
                    );
                    editingSchemaManifestStr = selectedType.schemaManifest
                        ? normalizeSchemaString(selectedType.schemaManifest)
                        : defaultManifestStr;
                    compiledSchemaPreviewStr = selectedType.schemaManifest
                        ? normalizeSchemaString(selectedType.schema)
                        : "";
                }
            }
        } else {
            isEditing = false;
            if (selectedType) {
                // Return to clean state
                editingName = selectedType.name;
                editingSlug = selectedType.slug;
                editingDesc = selectedType.description || "";
                editingSourceMode = selectedType.schemaManifest
                    ? "manifest"
                    : "schema";
                editingBasePrice = selectedType.basePrice ?? null;
                editingSchemaStr = normalizeSchemaString(selectedType.schema);
                editingSchemaManifestStr = selectedType.schemaManifest
                    ? normalizeSchemaString(selectedType.schemaManifest)
                    : defaultManifestStr;
                compiledSchemaPreviewStr = selectedType.schemaManifest
                    ? normalizeSchemaString(selectedType.schema)
                    : "";
            }
        }
        resetPreviewState();
    }

    function buildContentTypePayload() {
        if (editingSourceMode === "manifest") {
            let manifestObj;
            try {
                manifestObj = JSON.parse(editingSchemaManifestStr);
            } catch {
                schemaError =
                    "Invalid JSON syntax. Please fix the schema manifest before saving.";
                return null;
            }

            return {
                schemaManifest: JSON.stringify(manifestObj, null, 2),
            };
        }

        let schemaObj;
        try {
            schemaObj = JSON.parse(editingSchemaStr);
        } catch {
            schemaError =
                "Invalid JSON syntax. Please fix the schema before saving.";
            return null;
        }

        return {
            schema: JSON.stringify(schemaObj, null, 2),
        };
    }

    function applyManifestStarter(starter: ManifestStarter) {
        editingSourceMode = "manifest";
        editingSchemaManifestStr = JSON.stringify(starter.manifest, null, 2);
        compiledSchemaPreviewStr = "";
        compiledSchemaPreviewError = null;
        schemaError = null;

        if (isCreating) {
            if (!editingName.trim()) editingName = starter.name;
            if (!editingSlug.trim()) editingSlug = starter.slug;
            if (!editingDesc.trim()) editingDesc = starter.description;
        }
    }

    async function refreshManifestPreview() {
        schemaError = null;
        compiledSchemaPreviewError = null;

        if (editingSourceMode !== "manifest") {
            compiledSchemaPreviewStr = getCompiledPreviewFallback();
            return;
        }

        const payload = buildContentTypePayload();
        if (!payload) {
            compiledSchemaPreviewStr = getCompiledPreviewFallback();
            return;
        }

        compilingManifestPreview = true;
        try {
            const body = {
                name: editingName.trim() || selectedType?.name || "Preview Model",
                slug: editingSlug.trim() || selectedType?.slug || "preview-model",
                description: editingDesc || undefined,
                basePrice: editingBasePrice,
                ...payload,
            };
            const response = await fetchApi(
                isCreating || !selectedType
                    ? "/content-types?mode=dry_run"
                    : `/content-types/${selectedType.id}?mode=dry_run`,
                {
                    method: isCreating || !selectedType ? "POST" : "PUT",
                    body: JSON.stringify(body),
                },
            );
            compiledSchemaPreviewStr = normalizeSchemaString(
                response.data.schema,
            );
        } catch (err: any) {
            compiledSchemaPreviewError =
                err.message || "Failed to compile schema manifest preview.";
        } finally {
            compilingManifestPreview = false;
        }
    }

    async function saveType() {
        schemaError = null;
        const payload = buildContentTypePayload();
        if (!payload) {
            return;
        }

        try {
            if (isCreating) {
                const res = await fetchApi("/content-types", {
                    method: "POST",
                    body: JSON.stringify({
                        name: editingName,
                        slug: editingSlug,
                        description: editingDesc,
                        basePrice: editingBasePrice,
                        ...payload,
                    }),
                });
                clearDraft(null);
                await loadTypes();
                selectType(types.find((t) => t.id === res.data.id)!);
            } else {
                const res = await fetchApi(
                    `/content-types/${selectedType!.id}`,
                    {
                        method: "PUT",
                        body: JSON.stringify({
                            name: editingName,
                            description: editingDesc,
                            basePrice: editingBasePrice,
                            ...payload,
                        }),
                    },
                );
                clearDraft(selectedType!.id);
                await loadTypes();
                selectType(types.find((t) => t.id === res.data.id)!);
            }
            feedbackStore.pushToast({
                severity: "success",
                title: "Success",
                message: `Content model successfully ${isCreating ? "created" : "updated"}.`,
            });
        } catch (err: any) {
            feedbackStore.pushToast({
                severity: "error",
                title: "Save Failed",
                message:
                    err.message ||
                    `Failed to ${isCreating ? "create" : "update"} content type`,
                code: err instanceof ApiError ? err.code : undefined,
                remediation:
                    err instanceof ApiError ? err.remediation : undefined,
            });
        }
    }

    // AJV simple preview validation logic (approximated for UI preview)
    // Actually calling a dry run would be more accurate. Let's use the dry run API!
    let validatingPreview = $state(false);
    async function validatePreview() {
        if (editingSourceMode !== "schema" || !editingSchemaStr) return;

        validatingPreview = true;
        try {
            let dataObj;
            try {
                dataObj = JSON.parse(previewDataStr);
            } catch (e) {
                previewValidationResult = {
                    valid: false,
                    error: "Invalid JSON data.",
                };
                return;
            }

            // We need to call dry_run to validate schema. If editing, we just check against the proposed schema.
            // Wait, the API doesn't have a direct "validate against arbitrary schema" endpoint.
            // But we can test POST /content-items?mode=dry_run if we are editing an EXISTING type.
            if (selectedType && !isCreating) {
                await fetchApi(`/content-items?mode=dry_run`, {
                    method: "POST",
                    body: JSON.stringify({
                        contentTypeId: selectedType.id,
                        data: dataObj,
                    }),
                });
                previewValidationResult = { valid: true };
            } else {
                previewValidationResult = {
                    valid: true,
                    error: "Cannot dry-run uncreated schema yet.",
                };
            }
        } catch (err: any) {
            previewValidationResult = { valid: false, error: err.message };
        } finally {
            validatingPreview = false;
        }
    }
</script>

<svelte:head>
    <title>Schema Manager | WordClaw Supervisor</title>
</svelte:head>

<div class="h-full flex flex-col">
    <div class="mb-4 flex items-center justify-between gap-4">
        <div>
            <h2
                class="text-xl font-semibold tracking-tight text-gray-900 dark:text-white"
            >
                Schema Manager
            </h2>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Govern data shapes and manifest-first starter patterns for agent workflows.
            </p>
        </div>
        <Button onclick={startCreate} disabled={isCreating} size="sm">
            <Icon src={Plus} class="w-4 h-4" />
            New Content Model
        </Button>
    </div>

    <div class="flex-1 grid gap-4 overflow-hidden md:grid-cols-[14rem_minmax(0,1fr)]">
        <!-- Types List Sidebar -->
        <Surface class="flex flex-col overflow-hidden p-0">
            <div
                class="border-b border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/30"
            >
                <h3
                    class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                >
                    Content Models
                </h3>
            </div>
            <div class="flex-1 overflow-y-auto p-2">
                {#if loading}
                    <div class="flex justify-center p-4">
                        <LoadingSpinner size="sm" />
                    </div>
                {:else if types.length === 0 && !isCreating}
                    <p class="text-center text-sm text-gray-500 p-4">
                        No content models defined.
                    </p>
                {:else}
                    <ul class="space-y-1">
                        {#if isCreating}
                            <li>
                                <div
                                    class="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-left text-sm font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                >
                                    <div class="font-medium italic">
                                        New Model...
                                    </div>
                                </div>
                            </li>
                        {/if}
                        {#each types as t}
                            <li>
                                <button
                                    onclick={() => selectType(t)}
                                    class="w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors {selectedType?.id ===
                                        t.id && !isCreating
                                        ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}"
                                >
                                    <div class="font-medium">{t.name}</div>
                                    <div
                                        class="text-[0.65rem] text-gray-500 font-mono mt-0.5"
                                    >
                                        {t.slug}
                                    </div>
                                </button>
                            </li>
                        {/each}
                    </ul>
                {/if}
            </div>
        </Surface>

        <!-- Schema Editor area -->
        <div class="flex flex-col gap-4 overflow-hidden min-h-0">
            {#if !selectedType && !isCreating}
                <Surface
                    class="flex-1 flex flex-col items-center justify-center p-12 text-center text-sm italic text-slate-400 dark:text-slate-500"
                >
                    <Icon
                        src={ArchiveBox}
                        class="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4"
                    />
                    Select a content model to view its schema or create a new one.
                </Surface>
            {:else}
                <Surface class="flex-1 flex flex-col overflow-hidden p-0">
                    <div
                        class="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/30"
                    >
                        <h3
                            class="text-base font-semibold text-gray-900 dark:text-white"
                        >
                            {isCreating
                                ? "Create New Model"
                                : `${selectedType?.name} Model`}
                        </h3>
                        <div class="flex gap-2">
                            {#if isEditing}
                                <Button
                                    onclick={cancelEdit}
                                    variant="outline"
                                    size="sm">Cancel</Button
                                >
                                <Button onclick={saveType} size="sm"
                                    >Save Schema</Button
                                >
                            {:else}
                                <Button
                                    onclick={startEdit}
                                    variant="outline"
                                    size="sm">Edit Model</Button
                                >
                            {/if}
                        </div>
                    </div>

                    <div
                        class="flex-1 overflow-y-auto p-4 flex flex-col md:flex-row gap-4"
                    >
                        <!-- Form / Schema Code -->
                        <div class="w-full md:w-1/2 flex flex-col gap-3">
                            <div class="grid grid-cols-2 gap-3">
                                <div>
                                    <label
                                        for="name"
                                        class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                        >Name</label
                                    >
                                    <Input
                                        id="name"
                                        type="text"
                                        bind:value={editingName}
                                        disabled={!isEditing}
                                        placeholder="e.g. Blog Post"
                                    />
                                </div>
                                <div>
                                    <label
                                        for="slug"
                                        class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                        >Slug</label
                                    >
                                    <Input
                                        id="slug"
                                        type="text"
                                        bind:value={editingSlug}
                                        disabled={!isCreating}
                                        class="disabled:bg-slate-100 dark:disabled:bg-slate-900/50"
                                        placeholder="e.g. blog-post"
                                    />
                                </div>
                            </div>
                            <div>
                                <label
                                    for="source-mode"
                                    class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                    >Authoring Source</label
                                >
                                <Select
                                    id="source-mode"
                                    bind:value={editingSourceMode}
                                    disabled={!isEditing}
                                >
                                    <option value="schema">Raw JSON Schema</option>
                                    <option value="manifest">Field Manifest</option>
                                </Select>
                                <p
                                    class="mt-0.5 text-[0.65rem] text-slate-500 dark:text-slate-400"
                                >
                                    {editingSourceMode === "manifest"
                                        ? "Manifest mode compiles fields into canonical JSON Schema on the server."
                                        : "Schema mode edits the canonical JSON Schema directly and clears any stored manifest on save."}
                                </p>
                            </div>
                            {#if editingSourceMode === "manifest"}
                                <Surface tone="muted" class="p-4">
                                    <div
                                        class="flex items-start justify-between gap-3"
                                    >
                                        <div>
                                            <h4
                                                class="text-sm font-semibold text-slate-900 dark:text-slate-100"
                                            >
                                                Agent Starter Manifests
                                            </h4>
                                            <p
                                                class="mt-1 text-[0.72rem] text-slate-500 dark:text-slate-400"
                                            >
                                                Use these schema-design
                                                starters when no content model
                                                exists yet and the runtime needs
                                                an agent-friendly memory,
                                                task-log, or checkpoint shape.
                                            </p>
                                        </div>
                                    </div>
                                    <div class="mt-3 grid gap-3">
                                        {#each manifestStarters as starter}
                                            <button
                                                type="button"
                                                onclick={() =>
                                                    applyManifestStarter(starter)}
                                                disabled={!isEditing}
                                                class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950/40 dark:hover:border-slate-600 dark:hover:bg-slate-900/60"
                                            >
                                                <div
                                                    class="flex items-start justify-between gap-3"
                                                >
                                                    <div>
                                                        <div
                                                            class="text-sm font-semibold text-slate-900 dark:text-slate-100"
                                                        >
                                                            {starter.name}
                                                        </div>
                                                        <p
                                                            class="mt-1 text-[0.74rem] text-slate-500 dark:text-slate-400"
                                                        >
                                                            {starter.summary}
                                                        </p>
                                                    </div>
                                                    <span
                                                        class="rounded-full bg-slate-100 px-2 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                                    >
                                                        {starter.searchableFields.join(
                                                            ", ",
                                                        )}
                                                    </span>
                                                </div>
                                            </button>
                                        {/each}
                                    </div>
                                    <div
                                        class="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-[0.72rem] text-slate-600 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-300"
                                    >
                                        Semantic indexing currently favors
                                        top-level summary/title/body-style
                                        fields and skips metadata keys such as
                                        <code class="font-mono text-[0.68rem]"
                                            >slug</code
                                        >,
                                        <code class="font-mono text-[0.68rem]"
                                            >coverImage</code
                                        >,
                                        <code class="font-mono text-[0.68rem]"
                                            >authorId</code
                                        >,
                                        <code class="font-mono text-[0.68rem]"
                                            >category</code
                                        >,
                                        <code class="font-mono text-[0.68rem]"
                                            >readTimeMinutes</code
                                        >,
                                        <code class="font-mono text-[0.68rem]"
                                            >avatarUrl</code
                                        >,
                                        <code class="font-mono text-[0.68rem]"
                                            >socialLinks</code
                                        >, and
                                        <code class="font-mono text-[0.68rem]"
                                            >id</code
                                        >. Keep retrieval-critical text in
                                        concise top-level fields.
                                    </div>
                                </Surface>
                            {/if}
                            <div class="flex gap-3">
                                <div class="flex-1">
                                    <label
                                        for="desc"
                                        class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                        >Description</label
                                    >
                                    <Textarea
                                        id="desc"
                                        bind:value={editingDesc}
                                        disabled={!isEditing}
                                        rows={2}
                                        placeholder="Agent guidance for this model"
                                    ></Textarea>
                                </div>
                                <div class="w-1/3">
                                    <label
                                        for="basePrice"
                                        class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                        >Base Price (Sats)</label
                                    >
                                    <Input
                                        id="basePrice"
                                        type="number"
                                        min="0"
                                        bind:value={editingBasePrice}
                                        disabled={!isEditing}
                                        placeholder="Optional..."
                                        title="Minimum Lightning payment required to create items of this type"
                                    />
                                    <p
                                        class="text-[0.6rem] text-gray-500 mt-0.5 dark:text-gray-400"
                                    >
                                        Leave empty to disable L402.
                                    </p>
                                </div>
                            </div>

                            <div class="flex-1 flex flex-col relative">
                                <label
                                    for={editingSourceMode === "manifest"
                                        ? "schema-manifest"
                                        : "schema"}
                                    class="mb-1 flex justify-between text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                >
                                    <span
                                        >{editingSourceMode === "manifest"
                                            ? "Field Manifest Definition"
                                            : "JSON Schema Definition"}</span
                                    >
                                </label>
                                <p
                                    class="mb-1.5 text-[0.65rem] text-slate-500 dark:text-slate-400"
                                >
                                    {editingSourceMode === "manifest"
                                        ? "Use field types: text, textarea, select, group, array, asset, content-ref, block-set."
                                        : "Use canonical JSON Schema plus the existing WordClaw schema extensions."}
                                </p>
                                {#if editingSourceMode === "manifest"}
                                    <Textarea
                                        id="schema-manifest"
                                        bind:value={editingSchemaManifestStr}
                                        disabled={!isEditing}
                                        class="min-h-[14rem] flex-1 resize-none border-slate-700 bg-slate-950 p-3 font-mono text-xs text-green-400 shadow-inner dark:text-green-300"
                                        spellcheck="false"
                                    ></Textarea>
                                {:else}
                                    <Textarea
                                        id="schema"
                                        bind:value={editingSchemaStr}
                                        disabled={!isEditing}
                                        class="min-h-[14rem] flex-1 resize-none border-slate-700 bg-slate-950 p-3 font-mono text-xs text-green-400 shadow-inner dark:text-green-300"
                                        spellcheck="false"
                                    ></Textarea>
                                {/if}
                                {#if schemaError}
                                    <p
                                        class="mt-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/40 p-2 rounded"
                                    >
                                        {schemaError}
                                    </p>
                                {/if}
                            </div>
                        </div>

                        {#if editingSourceMode === "manifest"}
                            <Surface
                                tone="muted"
                                class="w-full md:w-1/2 flex flex-col gap-3"
                            >
                                <div
                                    class="flex items-start justify-between gap-3"
                                >
                                    <div>
                                        <h4
                                            class="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2"
                                        >
                                            <Icon
                                                src={CheckCircle}
                                                class="w-4 h-4 text-blue-500"
                                            />
                                            Generated Form Preview
                                        </h4>
                                        <p
                                            class="mt-1 text-xs text-gray-500 dark:text-gray-400"
                                        >
                                            Preview the supervisor-facing form
                                            structure generated from this
                                            manifest.
                                        </p>
                                    </div>
                                    <Button
                                        onclick={refreshManifestPreview}
                                        disabled={compilingManifestPreview}
                                        variant="outline"
                                        size="sm"
                                    >
                                        {compilingManifestPreview
                                            ? "Compiling..."
                                            : "Refresh compiled schema"}
                                    </Button>
                                </div>

                                <div
                                    class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/40"
                                >
                                    {#if !manifestDocument}
                                        <p
                                            class="text-sm text-red-600 dark:text-red-400"
                                        >
                                            Fix the manifest JSON to render the
                                            generated form preview.
                                        </p>
                                    {:else if manifestPreviewRows.length === 0}
                                        <p
                                            class="text-sm text-slate-500 dark:text-slate-400"
                                        >
                                            Add fields to the manifest to render
                                            the generated form preview.
                                        </p>
                                    {:else}
                                        <div class="space-y-3">
                                            {#if manifestDocument.localization}
                                                <div
                                                    class="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-[0.72rem] text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300"
                                                >
                                                    Locales:
                                                    {(manifestDocument.localization.supportedLocales ??
                                                        []
                                                    ).join(", ") || "Not configured"}
                                                    {#if manifestDocument.localization.defaultLocale}
                                                        . Default:
                                                        {manifestDocument.localization.defaultLocale}
                                                    {/if}
                                                </div>
                                            {/if}
                                            {#each manifestPreviewRows as row}
                                                <div
                                                    class="rounded-xl border px-3 py-2 {row.kind === 'block'
                                                        ? 'border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20'
                                                        : row.kind === 'container'
                                                          ? 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40'
                                                          : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/30'}"
                                                    style={`margin-left: ${row.depth * 16}px;`}
                                                >
                                                    <div
                                                        class="flex items-center justify-between gap-3"
                                                    >
                                                        <div>
                                                            <div
                                                                class="text-sm font-medium text-slate-900 dark:text-slate-100"
                                                            >
                                                                {row.label}
                                                            </div>
                                                            <div
                                                                class="text-[0.72rem] text-slate-500 dark:text-slate-400"
                                                            >
                                                                {row.hint}
                                                            </div>
                                                        </div>
                                                        {#if row.required}
                                                            <span
                                                                class="rounded-full bg-slate-900 px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-white dark:bg-slate-100 dark:text-slate-900"
                                                            >
                                                                Required
                                                            </span>
                                                        {/if}
                                                    </div>
                                                    {#if row.description}
                                                        <p
                                                            class="mt-2 text-[0.72rem] text-slate-500 dark:text-slate-400"
                                                        >
                                                            {row.description}
                                                        </p>
                                                    {/if}
                                                </div>
                                            {/each}
                                        </div>
                                    {/if}
                                </div>

                                <div class="space-y-2">
                                    <div
                                        class="flex items-center justify-between gap-3"
                                    >
                                        <h5
                                            class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400"
                                        >
                                            Compiled Canonical Schema
                                        </h5>
                                        <span
                                            class="text-[0.7rem] text-slate-500 dark:text-slate-400"
                                        >
                                            Server dry-run output
                                        </span>
                                    </div>
                                    <Textarea
                                        value={compiledSchemaPreviewStr ||
                                            getCompiledPreviewFallback()}
                                        readonly
                                        class="h-56 resize-none border-slate-700 bg-slate-950 p-4 font-mono text-xs text-cyan-200 shadow-inner"
                                        spellcheck="false"
                                    ></Textarea>
                                    {#if compiledSchemaPreviewError}
                                        <p
                                            class="rounded-md bg-red-50 p-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300"
                                        >
                                            {compiledSchemaPreviewError}
                                        </p>
                                    {/if}
                                </div>
                            </Surface>
                        {:else}
                            <!-- Live Validation Preview Sandbox -->
                            <Surface
                                tone="muted"
                                class="w-full md:w-1/2 flex flex-col gap-4"
                            >
                                <h4
                                    class="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2"
                                >
                                    <Icon
                                        src={CheckCircle}
                                        class="w-4 h-4 text-blue-500"
                                    />
                                    Validation Sandbox
                                </h4>
                                <p class="text-xs text-gray-500 dark:text-gray-400">
                                    Paste test JSON payloads here to see if agents
                                    can successfully submit data against this
                                    schema.
                                </p>

                                <Textarea
                                    bind:value={previewDataStr}
                                    class="h-48 flex-1 resize-none bg-white p-4 font-mono text-xs text-gray-800 shadow-inner dark:bg-slate-950 dark:text-gray-300"
                                    spellcheck="false"
                                    placeholder="&lbrace;&rbrace;"
                                ></Textarea>

                                <Button
                                    onclick={validatePreview}
                                    disabled={validatingPreview}
                                    variant="outline"
                                    class="w-full"
                                >
                                    {validatingPreview
                                        ? "Validating against API..."
                                        : "Run Dry-Run Validation"}
                                </Button>

                                {#if previewValidationResult}
                                    <div
                                        class="mt-2 p-3 rounded-md text-sm border {previewValidationResult.valid
                                            ? 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/30 dark:border-green-800 dark:text-green-300'
                                            : 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/30 dark:border-red-800 dark:text-red-300'}"
                                    >
                                        {#if previewValidationResult.valid}
                                            <div
                                                class="flex gap-2 items-center font-bold"
                                            >
                                                <Icon
                                                    src={Check}
                                                    class="w-5 h-5 text-green-500"
                                                />
                                                Schema accepts payload
                                            </div>
                                        {:else}
                                            <div
                                                class="flex gap-2 items-start font-bold mb-1"
                                            >
                                                <Icon
                                                    src={ExclamationCircle}
                                                    class="w-5 h-5 text-red-500 shrink-0"
                                                />
                                                Validation Failed
                                            </div>
                                            <p
                                                class="text-xs font-mono ml-7 break-words"
                                            >
                                                {previewValidationResult.error}
                                            </p>
                                        {/if}
                                    </div>
                                {/if}
                            </Surface>
                        {/if}
                    </div>
                </Surface>
            {/if}
        </div>
    </div>
</div>
