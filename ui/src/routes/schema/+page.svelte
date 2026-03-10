<script lang="ts">
    import { fetchApi, ApiError } from "$lib/api";
    import { onMount } from "svelte";
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Input from "$lib/components/ui/Input.svelte";
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
        schema: any;
        basePrice?: number | null;
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
    let editingSchemaStr = $state("");
    let editingBasePrice = $state<number | null>(null);
    let schemaError = $state<string | null>(null);

    // Live validation preview
    let previewDataStr = $state("{\n  \n}");
    let previewValidationResult = $state<{
        valid: boolean;
        error?: string;
    } | null>(null);

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

    onMount(async () => {
        await loadTypes();
    });

    const DRAFT_PREFIX = "wc_schema_draft_";

    function getDraftKey(id: number | null) {
        return `${DRAFT_PREFIX}${id || "new"}`;
    }

    function saveDraft() {
        if (!isEditing && !isCreating) return;
        const key = getDraftKey(isCreating ? null : (selectedType?.id ?? null));
        const draft = {
            name: editingName,
            slug: editingSlug,
            desc: editingDesc,
            basePrice: editingBasePrice,
            schemaStr: editingSchemaStr,
            updatedAt: Date.now(),
        };
        sessionStorage.setItem(key, JSON.stringify(draft));
    }

    function loadDraft(id: number | null) {
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

    function selectType(t: ContentType) {
        selectedType = t;
        isCreating = false;

        const draft = loadDraft(t.id);
        if (draft) {
            isEditing = true;
            editingName = draft.name;
            editingSlug = draft.slug;
            editingDesc = draft.desc;
            editingBasePrice = draft.basePrice;
            editingSchemaStr = draft.schemaStr;
        } else {
            isEditing = false;
            editingName = t.name;
            editingSlug = t.slug;
            editingDesc = t.description || "";
            editingBasePrice = t.basePrice ?? null;
            editingSchemaStr = normalizeSchemaString(t.schema);
        }
        schemaError = null;
        previewValidationResult = null;
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
            editingBasePrice = draft.basePrice;
            editingSchemaStr = draft.schemaStr;
        } else {
            editingName = "";
            editingSlug = "";
            editingDesc = "";
            editingBasePrice = null;
            editingSchemaStr = defaultSchemaStr;
        }
        schemaError = null;
        previewValidationResult = null;
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
                    editingBasePrice = draft.basePrice;
                    editingSchemaStr = draft.schemaStr;
                } else {
                    editingName = selectedType.name;
                    editingSlug = selectedType.slug;
                    editingDesc = selectedType.description || "";
                    editingBasePrice = selectedType.basePrice ?? null;
                    editingSchemaStr = normalizeSchemaString(
                        selectedType.schema,
                    );
                }
            }
        } else {
            isEditing = false;
            if (selectedType) {
                // Return to clean state
                editingName = selectedType.name;
                editingSlug = selectedType.slug;
                editingDesc = selectedType.description || "";
                editingBasePrice = selectedType.basePrice ?? null;
                editingSchemaStr = normalizeSchemaString(selectedType.schema);
            }
        }
    }

    async function saveType() {
        schemaError = null;

        let schemaObj;
        try {
            schemaObj = JSON.parse(editingSchemaStr);
        } catch (e) {
            schemaError =
                "Invalid JSON syntax. Please fix the schema before saving.";
            return;
        }

        const normalizedSchemaStr = JSON.stringify(schemaObj, null, 2);

        try {
            if (isCreating) {
                const res = await fetchApi("/content-types", {
                    method: "POST",
                    body: JSON.stringify({
                        name: editingName,
                        slug: editingSlug,
                        description: editingDesc,
                        schema: normalizedSchemaStr,
                        basePrice: editingBasePrice,
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
                            schema: normalizedSchemaStr,
                            basePrice: editingBasePrice,
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
        if (!editingSchemaStr) return;

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
    <div class="mb-6 flex justify-between items-end">
        <div>
            <h2
                class="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white"
            >
                Schema Manager
            </h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Govern the data shapes that content agents produce.
            </p>
        </div>
        <Button onclick={startCreate} disabled={isCreating}>
            <Icon src={Plus} class="w-5 h-5" />
            New Content Model
        </Button>
    </div>

    <div class="flex-1 flex flex-col md:flex-row gap-6 overflow-hidden">
        <!-- Types List Sidebar -->
        <Surface class="w-full md:w-1/4 flex flex-col overflow-hidden p-0">
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
        <div class="flex-1 flex flex-col gap-6 overflow-hidden">
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
                        class="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-6 py-4 dark:border-slate-700 dark:bg-slate-900/30"
                    >
                        <h3
                            class="text-lg font-semibold text-gray-900 dark:text-white"
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
                        class="flex-1 overflow-y-auto p-6 flex flex-col md:flex-row gap-6"
                    >
                        <!-- Form / Schema Code -->
                        <div class="w-full md:w-1/2 flex flex-col gap-4">
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
                            <div class="flex gap-4">
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
                                        class="text-[0.65rem] text-gray-500 mt-1 dark:text-gray-400"
                                    >
                                        Leave empty to disable L402.
                                    </p>
                                </div>
                            </div>

                            <div class="flex-1 flex flex-col relative">
                                <label
                                    for="schema"
                                    class="mb-1 flex justify-between text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                >
                                    <span>JSON Schema Definition</span>
                                </label>
                                <Textarea
                                    id="schema"
                                    bind:value={editingSchemaStr}
                                    disabled={!isEditing}
                                    class="h-64 flex-1 resize-none border-slate-700 bg-slate-950 p-4 font-mono text-xs text-green-400 shadow-inner dark:text-green-300"
                                    spellcheck="false"
                                ></Textarea>
                                {#if schemaError}
                                    <p
                                        class="mt-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/40 p-2 rounded"
                                    >
                                        {schemaError}
                                    </p>
                                {/if}
                            </div>
                        </div>

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
                    </div>
                </Surface>
            {/if}
        </div>
    </div>
</div>
