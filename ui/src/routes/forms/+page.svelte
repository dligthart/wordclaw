<script lang="ts">
    import { onMount } from "svelte";
    import { ApiError, fetchApi } from "$lib/api";
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import { formatJson } from "$lib/utils";
    import DataTable from "$lib/components/DataTable.svelte";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import JsonCodeBlock from "$lib/components/JsonCodeBlock.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import Badge from "$lib/components/ui/Badge.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Input from "$lib/components/ui/Input.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import Surface from "$lib/components/ui/Surface.svelte";
    import Textarea from "$lib/components/ui/Textarea.svelte";
    import { Icon, ArrowPath, Plus, PaperAirplane, Trash } from "svelte-hero-icons";

    type ContentType = {
        id: number;
        name: string;
        slug: string;
        kind: "collection" | "singleton";
        basePrice?: number | null;
    };

    type FormFieldOption = {
        label?: string | null;
        value: string;
    };

    type FormField = {
        name: string;
        label?: string | null;
        description?: string | null;
        type: "text" | "textarea" | "number" | "checkbox" | "select";
        required: boolean;
        placeholder?: string | null;
        options?: FormFieldOption[];
    };

    type FormDefinition = {
        id: number;
        domainId: number;
        name: string;
        slug: string;
        description: string | null;
        contentTypeId: number;
        contentTypeName: string;
        contentTypeSlug: string;
        active: boolean;
        publicRead: boolean;
        submissionStatus: string;
        workflowTransitionId: number | null;
        requirePayment: boolean;
        successMessage: string | null;
        fields: FormField[];
        defaultData: Record<string, unknown>;
        createdAt: string;
        updatedAt: string;
    };

    type PublicFormDefinition = {
        id: number;
        domainId: number;
        name: string;
        slug: string;
        description: string | null;
        contentTypeId: number;
        contentTypeName: string;
        contentTypeSlug: string;
        requirePayment: boolean;
        successMessage: string | null;
        fields: FormField[];
        createdAt: string;
        updatedAt: string;
    };

    type FormEditorState = {
        id: number | null;
        name: string;
        slug: string;
        description: string;
        contentTypeId: string;
        active: boolean;
        publicRead: boolean;
        submissionStatus: string;
        workflowTransitionId: string;
        requirePayment: boolean;
        webhookUrl: string;
        webhookSecret: string;
        successMessage: string;
    };

    const formColumns = [
        { key: "name", label: "Form" },
        { key: "target", label: "Target" },
        { key: "status", label: "Visibility" },
        { key: "updatedAt", label: "Updated" },
    ];

    const EMPTY_FIELDS_JSON = formatJson(
        [
            {
                name: "email",
                label: "Email",
                type: "text",
                required: true,
            },
        ],
        2,
    );

    let forms = $state<FormDefinition[]>([]);
    let contentTypes = $state<ContentType[]>([]);
    let selectedFormId = $state<number | null>(null);
    let selectedForm = $derived(
        forms.find((form) => form.id === selectedFormId) ?? null,
    );

    let editor = $state<FormEditorState>(emptyEditorState());
    let fieldsText = $state(EMPTY_FIELDS_JSON);
    let defaultDataText = $state("{}");
    let sampleSubmissionText = $state("{}");
    let publicContract = $state<PublicFormDefinition | null>(null);
    let publicContractError = $state<string | null>(null);
    let lastSubmission = $state<Record<string, unknown> | null>(null);

    let loading = $state(true);
    let loadingSelection = $state(false);
    let saving = $state(false);
    let deleting = $state(false);
    let refreshingPublicContract = $state(false);
    let submittingSample = $state(false);
    let error = $state<unknown>(null);

    onMount(() => {
        void loadPage();
    });

    function emptyEditorState(): FormEditorState {
        return {
            id: null,
            name: "",
            slug: "",
            description: "",
            contentTypeId: "",
            active: true,
            publicRead: true,
            submissionStatus: "draft",
            workflowTransitionId: "",
            requirePayment: false,
            webhookUrl: "",
            webhookSecret: "",
            successMessage: "",
        };
    }

    function currentDomainId() {
        if (typeof window === "undefined") {
            return null;
        }

        const raw = window.localStorage.getItem("__wc_domain_id");
        const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }

    function formatDate(value: string | null) {
        if (!value) return "Unknown";
        const timestamp = new Date(value).getTime();
        if (Number.isNaN(timestamp)) return "Unknown";
        return new Date(value).toLocaleString();
    }

    function formatRelativeDate(value: string | null) {
        if (!value) return "Unknown";
        const timestamp = new Date(value).getTime();
        if (Number.isNaN(timestamp)) return "Unknown";

        const deltaHours = Math.floor((Date.now() - timestamp) / 3_600_000);
        if (deltaHours < 1) return "Just now";
        if (deltaHours < 24) return `${deltaHours}h ago`;

        const deltaDays = Math.floor(deltaHours / 24);
        if (deltaDays < 7) return `${deltaDays}d ago`;

        return new Date(value).toLocaleDateString();
    }

    function formVisibilityBadges(form: FormDefinition) {
        return [
            form.active ? "Active" : "Inactive",
            form.publicRead ? "Public contract" : "Private contract",
            form.requirePayment ? "L402 gated" : "No payment",
        ];
    }

    function applyEditor(form: FormDefinition | null) {
        if (!form) {
            const fallbackContentTypeId = contentTypes[0]
                ? String(contentTypes[0].id)
                : "";
            editor = {
                ...emptyEditorState(),
                contentTypeId: fallbackContentTypeId,
            };
            fieldsText = EMPTY_FIELDS_JSON;
            defaultDataText = "{}";
            sampleSubmissionText = "{}";
            publicContract = null;
            publicContractError = null;
            lastSubmission = null;
            return;
        }

        editor = {
            id: form.id,
            name: form.name,
            slug: form.slug,
            description: form.description ?? "",
            contentTypeId: String(form.contentTypeId),
            active: form.active,
            publicRead: form.publicRead,
            submissionStatus: form.submissionStatus,
            workflowTransitionId:
                form.workflowTransitionId === null
                    ? ""
                    : String(form.workflowTransitionId),
            requirePayment: form.requirePayment,
            webhookUrl: "",
            webhookSecret: "",
            successMessage: form.successMessage ?? "",
        };
        fieldsText = formatJson(form.fields, 2);
        defaultDataText = formatJson(form.defaultData, 2);
        sampleSubmissionText = formatJson(form.defaultData, 2);
        publicContract = null;
        publicContractError = null;
        lastSubmission = null;
    }

    async function loadPage(preferredFormId?: number | null) {
        loading = true;
        error = null;

        try {
            const [formsResponse, contentTypesResponse] = await Promise.all([
                fetchApi("/forms"),
                fetchApi("/content-types"),
            ]);

            forms = (formsResponse.data as FormDefinition[]) ?? [];
            contentTypes = ((contentTypesResponse.data as ContentType[]) ?? []).sort(
                (left, right) => left.name.localeCompare(right.name),
            );

            const nextId =
                preferredFormId ??
                selectedFormId ??
                forms[0]?.id ??
                null;

            if (nextId) {
                await selectForm(nextId);
            } else {
                selectedFormId = null;
                applyEditor(null);
            }
        } catch (err) {
            error = err;
        } finally {
            loading = false;
        }
    }

    async function selectForm(id: number) {
        loadingSelection = true;
        error = null;

        try {
            const response = await fetchApi(`/forms/${id}`);
            const form = response.data as FormDefinition;
            selectedFormId = form.id;
            applyEditor(form);
            await refreshPublicContract(form.slug);
        } catch (err) {
            error = err;
        } finally {
            loadingSelection = false;
        }
    }

    function startNewForm() {
        selectedFormId = null;
        applyEditor(null);
    }

    function parseJsonInput(value: string, label: string) {
        try {
            return JSON.parse(value);
        } catch (err) {
            throw new Error(
                `${label} must be valid JSON: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
        }
    }

    async function refreshPublicContract(slug = editor.slug) {
        const domainId = currentDomainId();
        if (!slug || !domainId) {
            publicContract = null;
            publicContractError = domainId
                ? "Select or save a form before loading its public contract."
                : "Choose a domain before inspecting public form contracts.";
            return;
        }

        refreshingPublicContract = true;
        publicContractError = null;

        try {
            const response = await fetchApi(
                `/public/forms/${slug}?domainId=${domainId}`,
            );
            publicContract = response.data as PublicFormDefinition;
        } catch (err) {
            publicContract = null;
            if (err instanceof ApiError) {
                publicContractError =
                    err.remediation ??
                    err.message ??
                    "Public contract is not currently available.";
            } else {
                publicContractError = "Public contract is not currently available.";
            }
        } finally {
            refreshingPublicContract = false;
        }
    }

    async function saveForm() {
        if (!editor.contentTypeId) {
            feedbackStore.pushToast({
                severity: "error",
                title: "Missing content type",
                message: "Choose a target content type before saving the form.",
            });
            return;
        }

        saving = true;
        error = null;

        try {
            const fields = parseJsonInput(fieldsText, "Fields");
            const defaultData = parseJsonInput(defaultDataText, "Default data");
            const body = {
                name: editor.name.trim(),
                slug: editor.slug.trim(),
                description: editor.description.trim() || undefined,
                contentTypeId: Number.parseInt(editor.contentTypeId, 10),
                fields,
                defaultData,
                active: editor.active,
                publicRead: editor.publicRead,
                submissionStatus: editor.submissionStatus.trim() || undefined,
                workflowTransitionId: editor.workflowTransitionId.trim()
                    ? Number.parseInt(editor.workflowTransitionId, 10)
                    : null,
                requirePayment: editor.requirePayment,
                webhookUrl: editor.webhookUrl.trim() || undefined,
                webhookSecret: editor.webhookSecret.trim() || undefined,
                successMessage: editor.successMessage.trim() || undefined,
            };

            const response = editor.id
                ? await fetchApi(`/forms/${editor.id}`, {
                      method: "PUT",
                      body: JSON.stringify(body),
                  })
                : await fetchApi("/forms", {
                      method: "POST",
                      body: JSON.stringify(body),
                  });

            const saved = response.data as FormDefinition;
            feedbackStore.pushToast({
                severity: "success",
                title: editor.id ? "Form updated" : "Form created",
                message: `${saved.name} is ready for public submissions.`,
            });

            await loadPage(saved.id);
        } catch (err) {
            error = err;
            feedbackStore.pushToast({
                severity: "error",
                title: "Unable to save form",
                message: err instanceof Error ? err.message : String(err),
                ...(err instanceof ApiError
                    ? {
                          code: err.code,
                          remediation: err.remediation,
                      }
                    : {}),
            });
        } finally {
            saving = false;
        }
    }

    function confirmDeleteSelected() {
        if (!selectedForm) {
            return;
        }

        feedbackStore.openConfirm({
            title: "Delete form",
            message: `Delete '${selectedForm.name}'? This stops future submissions for ${selectedForm.slug}.`,
            confirmLabel: "Delete form",
            confirmIntent: "danger",
            onConfirm: async () => {
                deleting = true;
                try {
                    await fetchApi(`/forms/${selectedForm.id}`, {
                        method: "DELETE",
                    });
                    feedbackStore.pushToast({
                        severity: "success",
                        title: "Form deleted",
                        message: `${selectedForm.name} no longer accepts submissions.`,
                    });
                    await loadPage(null);
                } finally {
                    deleting = false;
                }
            },
        });
    }

    async function submitSample() {
        const domainId = currentDomainId();
        const slug = editor.slug.trim();
        if (!slug || !domainId) {
            feedbackStore.pushToast({
                severity: "error",
                title: "Missing public form context",
                message: "Save the form and choose a domain before submitting a sample payload.",
            });
            return;
        }

        submittingSample = true;
        error = null;

        try {
            const data = parseJsonInput(
                sampleSubmissionText,
                "Sample submission",
            );
            const response = await fetchApi(
                `/public/forms/${slug}/submissions?domainId=${domainId}`,
                {
                    method: "POST",
                    body: JSON.stringify({ data }),
                },
            );

            lastSubmission = response.data as Record<string, unknown>;
            feedbackStore.pushToast({
                severity: "success",
                title: "Sample submission stored",
                message: `Form '${slug}' accepted the payload.`,
            });
            await loadPage(selectedFormId);
        } catch (err) {
            error = err;
            feedbackStore.pushToast({
                severity: "error",
                title: "Sample submission failed",
                message: err instanceof Error ? err.message : String(err),
                ...(err instanceof ApiError
                    ? {
                          code: err.code,
                          remediation: err.remediation,
                      }
                    : {}),
            });
        } finally {
            submittingSample = false;
        }
    }
</script>

<svelte:head>
    <title>Forms | WordClaw UI</title>
</svelte:head>

<div class="space-y-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="space-y-2">
            <p class="text-sm font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">
                Form Runtime
            </p>
            <div class="space-y-1">
                <h1 class="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
                    Reusable intake forms
                </h1>
                <p class="max-w-3xl text-sm text-slate-600 dark:text-slate-300">
                    Build bounded public submission flows on top of content types,
                    workflows, optional payment challenges, and job-backed follow-up
                    webhooks.
                </p>
            </div>
        </div>
        <div class="flex flex-wrap items-center gap-3">
            <Button variant="outline" onclick={() => void loadPage(selectedFormId)}>
                <Icon src={ArrowPath} class="h-4 w-4" />
                Refresh
            </Button>
            <Button onclick={startNewForm}>
                <Icon src={Plus} class="h-4 w-4" />
                New form
            </Button>
        </div>
    </div>

    {#if error}
        <ErrorBanner
            error={error}
            title="Forms workspace unavailable"
            actionLabel="Retry"
            onAction={() => void loadPage(selectedFormId)}
        />
    {/if}

    {#if loading}
        <div class="flex min-h-[18rem] items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white/70 dark:border-slate-700 dark:bg-slate-900/30">
            <LoadingSpinner size="lg" />
        </div>
    {:else}
        <div class="grid gap-6 xl:grid-cols-[1.05fr_1.3fr]">
            <div class="space-y-6">
                <Surface class="space-y-4">
                    <div class="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 class="text-lg font-semibold text-slate-900 dark:text-white">
                                Form inventory
                            </h2>
                            <p class="text-sm text-slate-500 dark:text-slate-400">
                                {forms.length} forms in the selected domain
                            </p>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <Badge variant="info">
                                {forms.filter((form) => form.active).length} active
                            </Badge>
                            <Badge variant="success">
                                {forms.filter((form) => form.publicRead).length}
                                public
                            </Badge>
                        </div>
                    </div>

                    <DataTable
                        columns={formColumns}
                        data={forms}
                        keyField="id"
                        onRowClick={(row) => void selectForm(row.id)}
                    >
                        {#snippet cell({ row, column })}
                            {@const form = row as FormDefinition}
                            {#if column.key === "name"}
                                <div class="min-w-0 space-y-1">
                                    <div class="flex flex-wrap items-center gap-2">
                                        <span class="truncate font-semibold text-slate-900 dark:text-white">
                                            {form.name}
                                        </span>
                                        {#if selectedFormId === form.id}
                                            <Badge variant="info">Selected</Badge>
                                        {/if}
                                    </div>
                                    <p class="truncate text-xs text-slate-500 dark:text-slate-400">
                                        #{form.id} · /{form.slug}
                                    </p>
                                </div>
                            {:else if column.key === "target"}
                                <div class="space-y-1 text-sm text-slate-600 dark:text-slate-300">
                                    <div>{form.contentTypeName}</div>
                                    <div class="text-xs text-slate-500 dark:text-slate-400">
                                        {form.contentTypeSlug}
                                    </div>
                                </div>
                            {:else if column.key === "status"}
                                <div class="flex flex-wrap gap-2">
                                    {#each formVisibilityBadges(form) as label}
                                        <Badge
                                            variant={
                                                label === "Inactive"
                                                    ? "warning"
                                                    : label === "L402 gated"
                                                      ? "paid"
                                                      : "default"
                                            }
                                        >
                                            {label}
                                        </Badge>
                                    {/each}
                                </div>
                            {:else if column.key === "updatedAt"}
                                <div class="space-y-1 text-slate-600 dark:text-slate-300">
                                    <div>{formatRelativeDate(form.updatedAt)}</div>
                                    <div class="text-xs text-slate-500 dark:text-slate-400">
                                        {formatDate(form.updatedAt)}
                                    </div>
                                </div>
                            {/if}
                        {/snippet}

                        {#snippet empty()}
                            No forms are configured for this domain yet.
                        {/snippet}
                    </DataTable>
                </Surface>

                <Surface tone="muted" class="space-y-3">
                    <div class="flex items-center justify-between gap-3">
                        <div>
                            <h2 class="text-base font-semibold text-slate-900 dark:text-white">
                                Public contract
                            </h2>
                            <p class="text-sm text-slate-500 dark:text-slate-400">
                                Sanitized view used by public clients and sample submissions.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            disabled={refreshingPublicContract || !editor.slug.trim()}
                            onclick={() => void refreshPublicContract()}
                        >
                            <Icon src={ArrowPath} class="h-4 w-4" />
                            Refresh contract
                        </Button>
                    </div>

                    {#if refreshingPublicContract}
                        <div class="flex items-center justify-center py-8">
                            <LoadingSpinner size="md" />
                        </div>
                    {:else if publicContract}
                        <JsonCodeBlock
                            value={publicContract}
                            label="Public form contract"
                            copyable={true}
                        />
                    {:else}
                        <div class="rounded-2xl border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            {publicContractError ??
                                "No public contract loaded yet. Save or select a form first."}
                        </div>
                    {/if}
                </Surface>
            </div>

            <div class="space-y-6">
                <Surface class="space-y-5">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h2 class="text-lg font-semibold text-slate-900 dark:text-white">
                                {editor.id ? "Edit form" : "Create form"}
                            </h2>
                            <p class="text-sm text-slate-500 dark:text-slate-400">
                                Define the target content type, field contract, workflow hand-off,
                                and public behavior.
                            </p>
                        </div>
                        {#if loadingSelection}
                            <LoadingSpinner size="sm" />
                        {/if}
                    </div>

                    <div class="grid gap-4 md:grid-cols-2">
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Name
                            </span>
                            <Input bind:value={editor.name} placeholder="Contact form" />
                        </label>
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Slug
                            </span>
                            <Input bind:value={editor.slug} placeholder="contact" />
                        </label>
                    </div>

                    <label class="space-y-2">
                        <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                            Description
                        </span>
                        <Textarea
                            bind:value={editor.description}
                            rows={2}
                            placeholder="Short description shown to operators and agents."
                        />
                    </label>

                    <div class="grid gap-4 md:grid-cols-2">
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Target content type
                            </span>
                            <Select bind:value={editor.contentTypeId}>
                                <option value="">Choose a content type</option>
                                {#each contentTypes as contentType}
                                    <option value={String(contentType.id)}>
                                        {contentType.name} ({contentType.slug})
                                    </option>
                                {/each}
                            </Select>
                        </label>
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Submission status
                            </span>
                            <Input
                                bind:value={editor.submissionStatus}
                                placeholder="draft"
                            />
                        </label>
                    </div>

                    <div class="grid gap-4 md:grid-cols-2">
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Workflow transition ID
                            </span>
                            <Input
                                bind:value={editor.workflowTransitionId}
                                placeholder="Optional automatic review transition"
                            />
                        </label>
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Success message
                            </span>
                            <Input
                                bind:value={editor.successMessage}
                                placeholder="Thanks, we received your submission."
                            />
                        </label>
                    </div>

                    <div class="grid gap-4 md:grid-cols-2">
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Follow-up webhook URL
                            </span>
                            <Input
                                bind:value={editor.webhookUrl}
                                placeholder="https://example.com/hooks/forms"
                            />
                        </label>
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Follow-up webhook secret
                            </span>
                            <Input
                                bind:value={editor.webhookSecret}
                                placeholder="Optional signing secret"
                            />
                        </label>
                    </div>

                    <div class="grid gap-3 md:grid-cols-3">
                        <label class="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">
                            <input type="checkbox" bind:checked={editor.active} />
                            Accept submissions
                        </label>
                        <label class="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">
                            <input
                                type="checkbox"
                                bind:checked={editor.publicRead}
                            />
                            Expose public contract
                        </label>
                        <label class="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">
                            <input
                                type="checkbox"
                                bind:checked={editor.requirePayment}
                            />
                            Require L402 payment
                        </label>
                    </div>

                    <div class="grid gap-4 xl:grid-cols-2">
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Fields JSON
                            </span>
                            <Textarea bind:value={fieldsText} rows={16} />
                        </label>
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Default data JSON
                            </span>
                            <Textarea bind:value={defaultDataText} rows={16} />
                        </label>
                    </div>

                    <div class="flex flex-wrap items-center gap-3">
                        <Button disabled={saving} onclick={() => void saveForm()}>
                            {#if saving}
                                <LoadingSpinner size="sm" />
                            {:else}
                                <Icon src={ArrowPath} class="h-4 w-4" />
                            {/if}
                            {editor.id ? "Save changes" : "Create form"}
                        </Button>
                        <Button variant="outline" onclick={startNewForm}>
                            Reset editor
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={!selectedForm || deleting}
                            onclick={confirmDeleteSelected}
                        >
                            <Icon src={Trash} class="h-4 w-4" />
                            Delete form
                        </Button>
                    </div>
                </Surface>

                <Surface tone="muted" class="space-y-5">
                    <div>
                        <h2 class="text-lg font-semibold text-slate-900 dark:text-white">
                            Sample submission
                        </h2>
                        <p class="text-sm text-slate-500 dark:text-slate-400">
                            Send a payload through the public submission endpoint for the
                            current domain and inspect the stored response.
                        </p>
                    </div>

                    <label class="space-y-2">
                        <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                            Submission data JSON
                        </span>
                        <Textarea bind:value={sampleSubmissionText} rows={10} />
                    </label>

                    <div class="flex flex-wrap items-center gap-3">
                        <Button
                            disabled={submittingSample || !editor.slug.trim()}
                            onclick={() => void submitSample()}
                        >
                            {#if submittingSample}
                                <LoadingSpinner size="sm" />
                            {:else}
                                <Icon src={PaperAirplane} class="h-4 w-4" />
                            {/if}
                            Submit sample
                        </Button>
                        <Badge variant="info">
                            Domain {currentDomainId() ?? "not selected"}
                        </Badge>
                    </div>

                    {#if lastSubmission}
                        <JsonCodeBlock
                            value={lastSubmission}
                            label="Last sample submission"
                            copyable={true}
                        />
                    {/if}
                </Surface>
            </div>
        </div>
    {/if}
</div>
