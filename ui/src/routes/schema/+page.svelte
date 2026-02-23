<script lang="ts">
    import { fetchApi } from "$lib/api";
    import { onMount } from "svelte";
    import { feedbackStore } from "$lib/ui-feedback.svelte";

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
            });
        } finally {
            loading = false;
        }
    }

    function selectType(t: ContentType) {
        selectedType = t;
        isCreating = false;
        isEditing = false;
        editingName = t.name;
        editingSlug = t.slug;
        editingDesc = t.description || "";
        editingBasePrice = t.basePrice ?? null;
        editingSchemaStr =
            typeof t.schema === "string"
                ? t.schema
                : JSON.stringify(t.schema, null, 2);
        schemaError = null;
        previewValidationResult = null;
    }

    function startCreate() {
        selectedType = null;
        isCreating = true;
        isEditing = true;
        editingName = "";
        editingSlug = "";
        editingDesc = "";
        editingBasePrice = null;
        editingSchemaStr = defaultSchemaStr;
        schemaError = null;
        previewValidationResult = null;
    }

    function startEdit() {
        isEditing = true;
    }

    function cancelEdit() {
        if (isCreating) {
            isCreating = false;
            isEditing = false;
            selectedType = types.length > 0 ? types[0] : null;
        } else {
            isEditing = false;
            selectType(selectedType!);
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

        try {
            if (isCreating) {
                const res = await fetchApi("/content-types", {
                    method: "POST",
                    body: JSON.stringify({
                        name: editingName,
                        slug: editingSlug,
                        description: editingDesc,
                        schema: editingSchemaStr,
                        basePrice: editingBasePrice,
                    }),
                });
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
                            schema: editingSchemaStr,
                            basePrice: editingBasePrice,
                        }),
                    },
                );
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
            <h2 class="text-2xl font-bold text-gray-900 dark:text-white">
                Schema Manager
            </h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Govern the data shapes that content agents produce.
            </p>
        </div>
        <button
            onclick={startCreate}
            disabled={isCreating}
            class="px-4 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
                    d="M12 4v16m8-8H4"
                ></path></svg
            >
            New Content Model
        </button>
    </div>

    <div class="flex-1 flex flex-col md:flex-row gap-6 overflow-hidden">
        <!-- Types List Sidebar -->
        <div
            class="w-full md:w-1/4 bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden"
        >
            <div
                class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50"
            >
                <h3
                    class="text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                >
                    Content Models
                </h3>
            </div>
            <div class="flex-1 overflow-y-auto p-2">
                {#if loading}
                    <div class="flex justify-center p-4">
                        <div
                            class="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"
                        ></div>
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
                                    class="w-full text-left px-3 py-2 rounded-md text-sm font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
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
                                    class="w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors {selectedType?.id ===
                                        t.id && !isCreating
                                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}"
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
        </div>

        <!-- Schema Editor area -->
        <div class="flex-1 flex flex-col gap-6 overflow-hidden">
            {#if !selectedType && !isCreating}
                <div
                    class="flex-1 bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center text-gray-400 italic text-sm p-12 text-center"
                >
                    <svg
                        class="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="1.5"
                            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                        ></path></svg
                    >
                    Select a content model to view its schema or create a new one.
                </div>
            {:else}
                <div
                    class="flex-1 bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden"
                >
                    <div
                        class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex justify-between items-center"
                    >
                        <h3
                            class="text-lg font-bold text-gray-900 dark:text-white"
                        >
                            {isCreating
                                ? "Create New Model"
                                : `${selectedType?.name} Model`}
                        </h3>
                        <div class="flex gap-2">
                            {#if isEditing}
                                <button
                                    onclick={cancelEdit}
                                    class="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors"
                                    >Cancel</button
                                >
                                <button
                                    onclick={saveType}
                                    class="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors shadow-sm"
                                    >Save Schema</button
                                >
                            {:else}
                                <button
                                    onclick={startEdit}
                                    class="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-md shadow-sm transition-colors"
                                    >Edit Model</button
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
                                    class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                                    >Name</label
                                >
                                <input
                                    id="name"
                                    type="text"
                                    bind:value={editingName}
                                    disabled={!isEditing}
                                    class="block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 disabled:opacity-50"
                                    placeholder="e.g. Blog Post"
                                />
                            </div>
                            <div>
                                <label
                                    for="slug"
                                    class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                                    >Slug</label
                                >
                                <input
                                    id="slug"
                                    type="text"
                                    bind:value={editingSlug}
                                    disabled={!isCreating}
                                    class="block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 disabled:bg-gray-100 disabled:dark:bg-gray-800"
                                    placeholder="e.g. blog-post"
                                />
                            </div>
                            <div class="flex gap-4">
                                <div class="flex-1">
                                    <label
                                        for="desc"
                                        class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                                        >Description</label
                                    >
                                    <textarea
                                        id="desc"
                                        bind:value={editingDesc}
                                        disabled={!isEditing}
                                        rows="2"
                                        class="block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 disabled:opacity-50"
                                        placeholder="Agent guidance for this model"
                                    ></textarea>
                                </div>
                                <div class="w-1/3">
                                    <label
                                        for="basePrice"
                                        class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                                        >Base Price (Sats)</label
                                    >
                                    <input
                                        id="basePrice"
                                        type="number"
                                        min="0"
                                        bind:value={editingBasePrice}
                                        disabled={!isEditing}
                                        class="block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 disabled:opacity-50"
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
                                    class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex justify-between"
                                >
                                    <span>JSON Schema Definition</span>
                                </label>
                                <textarea
                                    id="schema"
                                    bind:value={editingSchemaStr}
                                    disabled={!isEditing}
                                    class="flex-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-blue-900 dark:text-green-400 font-mono text-xs shadow-inner focus:border-blue-500 focus:ring-blue-500 p-4 disabled:opacity-80 resize-none h-64"
                                    spellcheck="false"
                                ></textarea>
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
                        <div
                            class="w-full md:w-1/2 flex flex-col gap-4 bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700"
                        >
                            <h4
                                class="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2"
                            >
                                <svg
                                    class="w-4 h-4 text-blue-500"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                    ><path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                                    ></path></svg
                                >
                                Validation Sandbox
                            </h4>
                            <p class="text-xs text-gray-500 dark:text-gray-400">
                                Paste test JSON payloads here to see if agents
                                can successfully submit data against this
                                schema.
                            </p>

                            <textarea
                                bind:value={previewDataStr}
                                class="flex-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-300 font-mono text-xs shadow-inner focus:border-blue-500 focus:ring-blue-500 p-4 resize-none h-48"
                                spellcheck="false"
                                placeholder="&lbrace;&rbrace;"
                            ></textarea>

                            <button
                                onclick={validatePreview}
                                disabled={validatingPreview}
                                class="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
                            >
                                {validatingPreview
                                    ? "Validating against API..."
                                    : "Run Dry-Run Validation"}
                            </button>

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
                                            <svg
                                                class="w-5 h-5 text-green-500"
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
                                            Schema accepts payload
                                        </div>
                                    {:else}
                                        <div
                                            class="flex gap-2 items-start font-bold mb-1"
                                        >
                                            <svg
                                                class="w-5 h-5 text-red-500 shrink-0"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                                ><path
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    stroke-width="2"
                                                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                                ></path></svg
                                            >
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
                        </div>
                    </div>
                </div>
            {/if}
        </div>
    </div>
</div>
