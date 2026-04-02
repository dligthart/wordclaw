<script lang="ts">
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";
    import { ApiError, fetchApi } from "$lib/api";
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import { formatJson } from "$lib/utils";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import JsonCodeBlock from "$lib/components/JsonCodeBlock.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import Badge from "$lib/components/ui/Badge.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Input from "$lib/components/ui/Input.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import Surface from "$lib/components/ui/Surface.svelte";
    import Textarea from "$lib/components/ui/Textarea.svelte";
    import { Icon, ArrowPath, ArrowLeft, PaperAirplane, Trash } from "svelte-hero-icons";

    import type {
        ContentType,
        FormDefinition,
        FormEditorState,
        PublicFormDefinition,
        WorkforceAgent,
    } from "./formTypes";
    import {
        EMPTY_FIELDS_JSON,
        emptyEditorState,
        currentDomainId,
        parseJsonInput,
        parseObjectJsonInput,
        configurableDraftProviders,
    } from "./formHelpers";

    type Props = {
        formId: number | null;
    };
    let { formId }: Props = $props();

    let contentTypes = $state<ContentType[]>([]);
    let workforceAgents = $state<WorkforceAgent[]>([]);
    let workforceAgentsError = $state<string | null>(null);
    let form = $state<FormDefinition | null>(null);

    let editor = $state<FormEditorState>(emptyEditorState());
    let fieldsText = $state(EMPTY_FIELDS_JSON);
    let defaultDataText = $state("{}");
    let draftGenerationEnabled = $state(false);
    let draftTargetContentTypeId = $state("");
    let draftWorkforceAgentId = $state("");
    let draftAgentSoul = $state("");
    let draftProviderType = $state<
        "deterministic" | "openai" | "anthropic" | "gemini"
    >("deterministic");
    let draftProviderModel = $state("");
    let draftProviderInstructions = $state("");
    let draftFieldMapText = $state("{}");
    let draftDefaultDataText = $state("{}");
    let draftPostGenerationWorkflowTransitionId = $state("");
    let sampleSubmissionText = $state("{}");
    let publicContract = $state<PublicFormDefinition | null>(null);
    let publicContractError = $state<string | null>(null);
    let lastSubmission = $state<Record<string, unknown> | null>(null);
    let selectedDraftWorkforceAgent = $derived.by(() => {
        const id = Number.parseInt(draftWorkforceAgentId, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return null;
        }
        return workforceAgents.find((agent) => agent.id === id) ?? null;
    });

    let loading = $state(true);
    let saving = $state(false);
    let deleting = $state(false);
    let refreshingPublicContract = $state(false);
    let submittingSample = $state(false);
    let error = $state<unknown>(null);

    onMount(() => {
        void loadEditor();
    });

    function resetDraftGenerationEditor() {
        draftGenerationEnabled = false;
        draftTargetContentTypeId = "";
        draftWorkforceAgentId = "";
        draftAgentSoul = "";
        draftProviderType = "deterministic";
        draftProviderModel = "";
        draftProviderInstructions = "";
        draftFieldMapText = "{}";
        draftDefaultDataText = "{}";
        draftPostGenerationWorkflowTransitionId = "";
    }

    function applyEditor(f: FormDefinition | null) {
        if (!f) {
            const fallbackContentTypeId = contentTypes[0]
                ? String(contentTypes[0].id)
                : "";
            editor = {
                ...emptyEditorState(),
                contentTypeId: fallbackContentTypeId,
            };
            fieldsText = EMPTY_FIELDS_JSON;
            defaultDataText = "{}";
            resetDraftGenerationEditor();
            sampleSubmissionText = "{}";
            publicContract = null;
            publicContractError = null;
            lastSubmission = null;
            return;
        }

        editor = {
            id: f.id,
            name: f.name,
            slug: f.slug,
            description: f.description ?? "",
            contentTypeId: String(f.contentTypeId),
            active: f.active,
            publicRead: f.publicRead,
            submissionStatus: f.submissionStatus,
            workflowTransitionId:
                f.workflowTransitionId === null
                    ? ""
                    : String(f.workflowTransitionId),
            requirePayment: f.requirePayment,
            webhookUrl: "",
            webhookSecret: "",
            successMessage: f.successMessage ?? "",
        };
        fieldsText = formatJson(f.fields, 2);
        defaultDataText = formatJson(f.defaultData, 2);
        if (f.draftGeneration) {
            draftGenerationEnabled = true;
            draftTargetContentTypeId = String(
                f.draftGeneration.targetContentTypeId,
            );
            draftWorkforceAgentId =
                f.draftGeneration.workforceAgentId === null
                    ? ""
                    : String(f.draftGeneration.workforceAgentId);
            draftAgentSoul = f.draftGeneration.agentSoul;
            draftProviderType = f.draftGeneration.provider.type;
            draftProviderModel =
                f.draftGeneration.provider.type === "deterministic"
                    ? ""
                    : f.draftGeneration.provider.model ?? "";
            draftProviderInstructions =
                f.draftGeneration.provider.type === "deterministic"
                    ? ""
                    : f.draftGeneration.provider.instructions ?? "";
            draftFieldMapText = formatJson(f.draftGeneration.fieldMap, 2);
            draftDefaultDataText = formatJson(
                f.draftGeneration.defaultData,
                2,
            );
            draftPostGenerationWorkflowTransitionId =
                f.draftGeneration.postGenerationWorkflowTransitionId === null
                    ? ""
                    : String(
                          f.draftGeneration.postGenerationWorkflowTransitionId,
                      );
        } else {
            resetDraftGenerationEditor();
        }
        sampleSubmissionText = formatJson(f.defaultData, 2);
        publicContract = null;
        publicContractError = null;
        lastSubmission = null;
    }

    async function loadEditor() {
        loading = true;
        error = null;

        try {
            const [contentTypesResponse] = await Promise.all([
                fetchApi("/content-types"),
            ]);

            contentTypes = (
                (contentTypesResponse.data as ContentType[]) ?? []
            ).sort((left, right) => left.name.localeCompare(right.name));

            try {
                const workforceResponse = await fetchApi("/workforce/agents");
                workforceAgents = (
                    (workforceResponse.data as WorkforceAgent[]) ?? []
                ).sort((left, right) => left.name.localeCompare(right.name));
                workforceAgentsError = null;
            } catch (workforceError) {
                workforceAgents = [];
                workforceAgentsError =
                    workforceError instanceof ApiError
                        ? workforceError.remediation ??
                          workforceError.message ??
                          "Tenant workforce registry unavailable."
                        : "Tenant workforce registry unavailable.";
            }

            if (formId) {
                const response = await fetchApi(`/forms/${formId}`);
                form = response.data as FormDefinition;
                applyEditor(form);
                await refreshPublicContract(form.slug);
            } else {
                form = null;
                applyEditor(null);
            }
        } catch (err) {
            error = err;
        } finally {
            loading = false;
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
                publicContractError =
                    "Public contract is not currently available.";
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
                message:
                    "Choose a target content type before saving the form.",
            });
            return;
        }

        saving = true;
        error = null;

        try {
            const fields = parseJsonInput(fieldsText, "Fields");
            const defaultData = parseObjectJsonInput(
                defaultDataText,
                "Default data",
            );
            let draftGeneration: Record<string, unknown> | null = null;
            if (draftGenerationEnabled) {
                if (!draftTargetContentTypeId.trim()) {
                    throw new Error(
                        "Choose a target content type for draft generation.",
                    );
                }

                const workforceAgentId = draftWorkforceAgentId.trim()
                    ? Number.parseInt(draftWorkforceAgentId, 10)
                    : null;
                if (
                    draftWorkforceAgentId.trim() &&
                    (workforceAgentId === null ||
                        !Number.isInteger(workforceAgentId) ||
                        workforceAgentId <= 0)
                ) {
                    throw new Error(
                        "Draft generation workforce agent must be a positive integer.",
                    );
                }

                if (workforceAgentId === null && !draftAgentSoul.trim()) {
                    throw new Error(
                        "Provide a draft generation SOUL or choose a workforce agent.",
                    );
                }

                const draftProvider =
                    workforceAgentId !== null
                        ? undefined
                        : draftProviderType === "deterministic"
                          ? { type: "deterministic" }
                          : {
                                type: draftProviderType,
                                ...(draftProviderModel.trim()
                                    ? { model: draftProviderModel.trim() }
                                    : {}),
                                ...(draftProviderInstructions.trim()
                                    ? {
                                          instructions:
                                              draftProviderInstructions.trim(),
                                      }
                                    : {}),
                            };

                draftGeneration = {
                    targetContentTypeId: Number.parseInt(
                        draftTargetContentTypeId,
                        10,
                    ),
                    ...(workforceAgentId !== null
                        ? { workforceAgentId }
                        : { agentSoul: draftAgentSoul.trim() }),
                    fieldMap: parseObjectJsonInput(
                        draftFieldMapText,
                        "Draft generation field map",
                    ),
                    defaultData: parseObjectJsonInput(
                        draftDefaultDataText,
                        "Draft generation default data",
                    ),
                    postGenerationWorkflowTransitionId:
                        draftPostGenerationWorkflowTransitionId.trim()
                            ? Number.parseInt(
                                  draftPostGenerationWorkflowTransitionId,
                                  10,
                              )
                            : null,
                    ...(draftProvider ? { provider: draftProvider } : {}),
                };
            }
            const body = {
                name: editor.name.trim(),
                slug: editor.slug.trim(),
                description: editor.description.trim() || undefined,
                contentTypeId: Number.parseInt(editor.contentTypeId, 10),
                fields,
                defaultData,
                active: editor.active,
                publicRead: editor.publicRead,
                submissionStatus:
                    editor.submissionStatus.trim() || undefined,
                workflowTransitionId: editor.workflowTransitionId.trim()
                    ? Number.parseInt(editor.workflowTransitionId, 10)
                    : null,
                requirePayment: editor.requirePayment,
                webhookUrl: editor.webhookUrl.trim() || undefined,
                webhookSecret: editor.webhookSecret.trim() || undefined,
                successMessage: editor.successMessage.trim() || undefined,
                draftGeneration,
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

            // If we just created a new form, navigate to its edit page
            if (!editor.id) {
                await goto(`/ui/forms/${saved.id}`);
            } else {
                // Reload the current form
                form = saved;
                applyEditor(saved);
                await refreshPublicContract(saved.slug);
            }
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
        if (!form) {
            return;
        }

        const formToDelete = form;
        feedbackStore.openConfirm({
            title: "Delete form",
            message: `Delete '${formToDelete.name}'? This stops future submissions for ${formToDelete.slug}.`,
            confirmLabel: "Delete form",
            confirmIntent: "danger",
            onConfirm: async () => {
                deleting = true;
                try {
                    await fetchApi(`/forms/${formToDelete.id}`, {
                        method: "DELETE",
                    });
                    feedbackStore.pushToast({
                        severity: "success",
                        title: "Form deleted",
                        message: `${formToDelete.name} no longer accepts submissions.`,
                    });
                    await goto("/ui/forms");
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
                message:
                    "Save the form and choose a domain before submitting a sample payload.",
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

<div class="space-y-6">
    <!-- Back + header -->
    <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3">
            <a
                href="/ui/forms"
                class="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            >
                <Icon src={ArrowLeft} class="h-4 w-4" />
            </a>
            <div>
                <h1 class="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                    {editor.id ? editor.name || "Edit form" : "New form"}
                </h1>
                {#if editor.id}
                    <p class="text-sm text-slate-500 dark:text-slate-400">
                        #{editor.id} · /{editor.slug}
                    </p>
                {/if}
            </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
            <Button disabled={saving} onclick={() => void saveForm()}>
                {#if saving}
                    <LoadingSpinner size="sm" />
                {:else}
                    <Icon src={ArrowPath} class="h-4 w-4" />
                {/if}
                {editor.id ? "Save" : "Create"}
            </Button>
            {#if form}
                <Button
                    variant="destructive"
                    disabled={deleting}
                    onclick={confirmDeleteSelected}
                >
                    <Icon src={Trash} class="h-4 w-4" />
                    Delete
                </Button>
            {/if}
        </div>
    </div>

    {#if error}
        <ErrorBanner
            {error}
            title="Form editor error"
            actionLabel="Retry"
            onAction={() => void loadEditor()}
        />
    {/if}

    {#if loading}
        <div class="flex min-h-[18rem] items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white/70 dark:border-slate-700 dark:bg-slate-900/30">
            <LoadingSpinner size="lg" />
        </div>
    {:else}
        <div class="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
            <!-- Left: editor fields -->
            <Surface class="space-y-5">
                <div class="grid gap-3 xl:grid-cols-2">
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

                <div class="grid gap-3 xl:grid-cols-2">
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

                <div class="grid gap-3 xl:grid-cols-2">
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

                <div class="grid gap-3 xl:grid-cols-2">
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

                <div class="grid gap-3 lg:grid-cols-3">
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

                <details class="rounded-2xl border border-slate-200 dark:border-slate-700">
                    <summary class="cursor-pointer px-4 py-2.5 text-sm font-semibold text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white select-none">
                        Data Contracts
                        <span class="ml-1 text-xs font-normal text-slate-400">Fields JSON + Default data</span>
                    </summary>
                    <div class="grid gap-4 px-4 pb-4 xl:grid-cols-2">
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Fields JSON
                            </span>
                            <Textarea bind:value={fieldsText} rows={6} />
                        </label>
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Default data JSON
                            </span>
                            <Textarea bind:value={defaultDataText} rows={6} />
                        </label>
                    </div>
                </details>

                <details class="rounded-2xl border border-slate-200/80 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/40" open={draftGenerationEnabled}>
                    <summary class="cursor-pointer px-5 py-3 text-sm font-semibold text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white select-none flex items-center justify-between gap-3">
                        <span>Draft Generation <span class="text-xs font-normal text-slate-400">Route submissions to AI agents</span></span>
                        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
                        <label class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200" onclick={(e) => e.stopPropagation()}>
                            <input
                                type="checkbox"
                                bind:checked={draftGenerationEnabled}
                            />
                            Enabled
                        </label>
                    </summary>
                    <div class="space-y-4 px-5 pb-5">

                    {#if draftGenerationEnabled}
                        <div class="grid gap-3 xl:grid-cols-2">
                            <label class="space-y-2">
                                <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                    Draft target content type
                                </span>
                                <Select bind:value={draftTargetContentTypeId}>
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
                                    Workforce agent
                                </span>
                                <Select bind:value={draftWorkforceAgentId}>
                                    <option value="">Manual SOUL / provider</option>
                                    {#if draftWorkforceAgentId &&
                                        !selectedDraftWorkforceAgent}
                                        <option value={draftWorkforceAgentId}>
                                            Unavailable workforce agent ({draftWorkforceAgentId})
                                        </option>
                                    {/if}
                                    {#each workforceAgents.filter((agent) => agent.active) as agent}
                                        <option value={String(agent.id)}>
                                            {agent.name} ({agent.slug})
                                        </option>
                                    {/each}
                                </Select>
                            </label>
                        </div>

                        {#if workforceAgentsError}
                            <div class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                                Workforce agents are unavailable right now. You can still save
                                the form with a manual SOUL/provider config. Details:
                                {workforceAgentsError}
                            </div>
                        {/if}

                        {#if selectedDraftWorkforceAgent}
                            <div class="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
                                <div class="font-medium">
                                    {selectedDraftWorkforceAgent.name} will supply the SOUL and provider defaults.
                                </div>
                                <div class="mt-1 text-emerald-800/80 dark:text-emerald-200/80">
                                    {selectedDraftWorkforceAgent.purpose}
                                </div>
                            </div>
                        {:else}
                            <div class="grid gap-3 xl:grid-cols-2">
                                <label class="space-y-2">
                                    <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                        SOUL
                                    </span>
                                    <Input
                                        bind:value={draftAgentSoul}
                                        placeholder="software-proposal-writer"
                                    />
                                </label>

                                <label class="space-y-2">
                                    <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                        Provider
                                    </span>
                                    <Select bind:value={draftProviderType}>
                                        {#each configurableDraftProviders as provider}
                                            <option value={provider.type}>
                                                {provider.label}
                                            </option>
                                        {/each}
                                    </Select>
                                </label>
                            </div>

                            <p class="text-xs text-slate-500 dark:text-slate-400">
                                {
                                    configurableDraftProviders.find(
                                        (provider) => provider.type === draftProviderType,
                                    )?.description
                                }
                            </p>

                            {#if draftProviderType !== "deterministic"}
                                <div class="grid gap-3 xl:grid-cols-2">
                                    <label class="space-y-2">
                                        <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                            Model
                                        </span>
                                        <Input
                                            bind:value={draftProviderModel}
                                            placeholder={
                                                configurableDraftProviders.find(
                                                    (provider) =>
                                                        provider.type === draftProviderType,
                                                )?.placeholderModel ?? ""
                                            }
                                        />
                                    </label>

                                    <label class="space-y-2">
                                        <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                            Extra instructions
                                        </span>
                                        <Textarea
                                            bind:value={draftProviderInstructions}
                                            rows={3}
                                            placeholder="Optional provider-specific drafting guidance."
                                        />
                                    </label>
                                </div>
                            {/if}
                        {/if}

                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Post-generation workflow transition ID
                            </span>
                            <Input
                                bind:value={draftPostGenerationWorkflowTransitionId}
                                placeholder="Optional — blank keeps items as plain drafts"
                            />
                            <p class="text-xs text-slate-400 dark:text-slate-500">Set to a review transition to route drafts to the approval queue. Asset fields forward images only.</p>
                        </label>

                        <div class="grid gap-4 xl:grid-cols-2">
                            <label class="space-y-2">
                                <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                    Draft field map JSON
                                </span>
                                <Textarea bind:value={draftFieldMapText} rows={5} />
                            </label>
                            <label class="space-y-2">
                                <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                    Draft default data JSON
                                </span>
                                <Textarea bind:value={draftDefaultDataText} rows={5} />
                            </label>
                        </div>
                    {/if}
                    </div>
                </details>

                <details class="rounded-2xl border border-slate-200 dark:border-slate-700">
                    <summary class="cursor-pointer px-4 py-2.5 text-sm font-semibold text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white select-none">
                        Sample Submission
                        <span class="ml-1 text-xs font-normal text-slate-400">Test the public endpoint</span>
                    </summary>
                    <div class="space-y-4 px-4 pb-4">
                        <label class="space-y-2">
                            <span class="text-sm font-medium text-slate-700 dark:text-slate-200">
                                Submission data JSON
                            </span>
                            <Textarea bind:value={sampleSubmissionText} rows={5} />
                        </label>

                        <div class="flex flex-wrap items-center gap-3">
                            <Button
                                disabled={submittingSample || !editor.slug.trim()}
                                size="sm"
                                onclick={() => void submitSample()}
                            >
                                {#if submittingSample}
                                    <LoadingSpinner size="sm" />
                                {:else}
                                    <Icon src={PaperAirplane} class="h-3.5 w-3.5" />
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
                    </div>
                </details>
            </Surface>

            <!-- Right: public contract -->
            <div class="space-y-6">
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
                            Refresh
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
        </div>
    {/if}
</div>
