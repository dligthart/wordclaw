<script lang="ts">
    import { onMount } from "svelte";

    import { fetchApi, ApiError } from "$lib/api";
    import { auth } from "$lib/auth.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import Badge from "$lib/components/ui/Badge.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Input from "$lib/components/ui/Input.svelte";
    import Surface from "$lib/components/ui/Surface.svelte";
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import { Icon, CpuChip, Plus, Trash, XMark } from "svelte-hero-icons";

    type ConfigurableProviderType = "openai" | "anthropic" | "gemini";

    type AiProviderConfig = {
        id: number;
        domainId: number;
        provider: ConfigurableProviderType;
        configured: boolean;
        maskedApiKey: string;
        defaultModel: string | null;
        settings: Record<string, unknown>;
        createdAt: string;
        updatedAt: string;
    };

    type WorkforceAgentProvider =
        | {
              type: "deterministic";
          }
        | {
              type: "openai";
              model?: string;
              instructions?: string;
          }
        | {
              type: "anthropic";
              model?: string;
              instructions?: string;
          }
        | {
              type: "gemini";
              model?: string;
              instructions?: string;
          };

    type WorkforceAgent = {
        id: number;
        domainId: number;
        name: string;
        slug: string;
        purpose: string;
        soul: string;
        provider: WorkforceAgentProvider;
        active: boolean;
        createdAt: string;
        updatedAt: string;
    };

    let providerConfigs = $state<AiProviderConfig[]>([]);
    let workforceAgents = $state<WorkforceAgent[]>([]);
    let loading = $state(true);
    let error = $state<string | null>(null);
    let providerConfigsError = $state<string | null>(null);
    let workforceAgentsError = $state<string | null>(null);

    let showProviderModal = $state(false);
    let savingProvider = $state(false);
    let selectedProviderType = $state<ConfigurableProviderType>("openai");
    let providerApiKey = $state("");
    let providerDefaultModel = $state("");

    let showWorkforceModal = $state(false);
    let savingWorkforceAgent = $state(false);
    let editingWorkforceAgentId = $state<number | null>(null);
    let workforceName = $state("");
    let workforceSlug = $state("");
    let workforcePurpose = $state("");
    let workforceSoul = $state("");
    let workforceProviderType = $state<"deterministic" | ConfigurableProviderType>("deterministic");
    let workforceProviderModel = $state("");
    let workforceProviderInstructions = $state("");
    let workforceActive = $state(true);

    const configurableProviders: Array<{
        type: ConfigurableProviderType;
        label: string;
        description: string;
        draftGenerationHint: string;
        placeholderModel: string;
    }> = [
        {
            type: "openai",
            label: "OpenAI",
            description: "Structured-output drafting over the OpenAI Responses API.",
            draftGenerationHint: "draftGeneration.provider.type=openai",
            placeholderModel: "gpt-4o",
        },
        {
            type: "anthropic",
            label: "Claude",
            description: "Structured drafting over Anthropic tool-schema output.",
            draftGenerationHint: "draftGeneration.provider.type=anthropic",
            placeholderModel: "claude-sonnet-4-20250514",
        },
        {
            type: "gemini",
            label: "Gemini",
            description: "Structured drafting over Gemini JSON-schema output.",
            draftGenerationHint: "draftGeneration.provider.type=gemini",
            placeholderModel: "gemini-2.5-flash",
        },
    ];

    let configuredProviderCount = $derived.by(
        () => providerConfigs.filter((config) => config.configured).length,
    );
    let workforceAgentCount = $derived(workforceAgents.length);
    let activeWorkforceAgentCount = $derived.by(
        () => workforceAgents.filter((agent) => agent.active).length,
    );
    let pageDescription = $derived(
        auth.user?.scope === "platform"
            ? "Provision tenant-scoped external AI credentials and reusable workforce agents for the active domain. WordClaw access keys and tenant onboarding remain under API Keys."
            : "Provision external AI credentials and reusable workforce agents for the current tenant. WordClaw access keys remain under API Keys.",
    );

    onMount(() => {
        loadProvisioning();
    });

    async function loadProvisioning() {
        loading = true;
        error = null;

        try {
            try {
                const providerRes = await fetchApi("/ai/providers");
                providerConfigs = providerRes.data;
                providerConfigsError = null;
            } catch (providerError) {
                providerConfigs = [];
                providerConfigsError =
                    providerError instanceof ApiError
                        ? providerError.remediation
                            ?? providerError.message
                            ?? "Tenant AI providers are unavailable."
                        : "Tenant AI providers are unavailable.";
            }

            try {
                const workforceRes = await fetchApi("/workforce/agents");
                workforceAgents = workforceRes.data;
                workforceAgentsError = null;
            } catch (workforceError) {
                workforceAgents = [];
                workforceAgentsError =
                    workforceError instanceof ApiError
                        ? workforceError.remediation
                            ?? workforceError.message
                            ?? "Tenant workforce registry is unavailable."
                        : "Tenant workforce registry is unavailable.";
            }
        } finally {
            loading = false;
        }
    }

    function getProviderConfig(type: ConfigurableProviderType) {
        return providerConfigs.find((config) => config.provider === type) ?? null;
    }

    function providerLabel(type: ConfigurableProviderType) {
        return configurableProviders.find((provider) => provider.type === type)?.label ?? type;
    }

    function providerMeta(type: ConfigurableProviderType | "deterministic") {
        return configurableProviders.find((provider) => provider.type === type) ?? configurableProviders[0];
    }

    function openProviderModal(type: ConfigurableProviderType) {
        selectedProviderType = type;
        providerApiKey = "";
        providerDefaultModel = getProviderConfig(type)?.defaultModel ?? "";
        showProviderModal = true;
    }

    async function saveProvider() {
        if (!providerApiKey.trim()) return;

        savingProvider = true;
        error = null;
        try {
            await fetchApi(`/ai/providers/${selectedProviderType}`, {
                method: "PUT",
                body: JSON.stringify({
                    apiKey: providerApiKey,
                    defaultModel: providerDefaultModel.trim() || null,
                }),
            });
            showProviderModal = false;
            providerApiKey = "";
            feedbackStore.pushToast({
                severity: "success",
                title: getProviderConfig(selectedProviderType) ? "Provider updated" : "Provider configured",
                message: `${providerLabel(selectedProviderType)} draft-generation credentials were saved for the current tenant.`,
            });
            await loadProvisioning();
        } catch (err: any) {
            error = err.message || "Failed to save AI provider";
        } finally {
            savingProvider = false;
        }
    }

    function deleteProvider(type: ConfigurableProviderType) {
        feedbackStore.openConfirm({
            title: `Delete ${providerLabel(type)} Provider`,
            message:
                `Deleting this provider will make ${providerLabel(type)}-backed draft-generation jobs fail for the current tenant until the credential is configured again.`,
            confirmLabel: "Delete Provider",
            confirmIntent: "danger",
            onConfirm: async () => {
                try {
                    await fetchApi(`/ai/providers/${type}`, { method: "DELETE" });
                    feedbackStore.pushToast({
                        severity: "success",
                        title: "Provider deleted",
                        message: `The ${providerLabel(type)} credential was removed for the current tenant.`,
                    });
                    await loadProvisioning();
                } catch (err: any) {
                    const isApiError = err instanceof ApiError;
                    feedbackStore.pushToast({
                        severity: "error",
                        title: "Failed to delete provider",
                        message: err.message || "An error occurred.",
                        code: isApiError ? err.code : undefined,
                        remediation: isApiError ? err.remediation : undefined,
                    });
                    throw err;
                }
            },
        });
    }

    function slugify(value: string) {
        return value
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 80);
    }

    function resetWorkforceForm() {
        editingWorkforceAgentId = null;
        workforceName = "";
        workforceSlug = "";
        workforcePurpose = "";
        workforceSoul = "";
        workforceProviderType = "deterministic";
        workforceProviderModel = "";
        workforceProviderInstructions = "";
        workforceActive = true;
    }

    function openWorkforceModal(agent: WorkforceAgent | null = null) {
        if (agent) {
            editingWorkforceAgentId = agent.id;
            workforceName = agent.name;
            workforceSlug = agent.slug;
            workforcePurpose = agent.purpose;
            workforceSoul = agent.soul;
            workforceProviderType = agent.provider.type;
            workforceProviderModel = agent.provider.type === "deterministic" ? "" : agent.provider.model ?? "";
            workforceProviderInstructions = agent.provider.type === "deterministic" ? "" : agent.provider.instructions ?? "";
            workforceActive = agent.active;
        } else {
            resetWorkforceForm();
        }

        showWorkforceModal = true;
    }

    function buildWorkforceProviderPayload(): WorkforceAgentProvider {
        if (workforceProviderType !== "deterministic") {
            return {
                type: workforceProviderType,
                ...(workforceProviderModel.trim() ? { model: workforceProviderModel.trim() } : {}),
                ...(workforceProviderInstructions.trim()
                    ? { instructions: workforceProviderInstructions.trim() }
                    : {}),
            };
        }

        return {
            type: "deterministic",
        };
    }

    async function saveWorkforceAgent() {
        if (!workforceName.trim() || !workforceSlug.trim() || !workforcePurpose.trim() || !workforceSoul.trim()) {
            return;
        }

        savingWorkforceAgent = true;
        error = null;

        const endpoint = editingWorkforceAgentId === null
            ? "/workforce/agents"
            : `/workforce/agents/${editingWorkforceAgentId}`;
        const method = editingWorkforceAgentId === null ? "POST" : "PUT";

        try {
            await fetchApi(endpoint, {
                method,
                body: JSON.stringify({
                    name: workforceName.trim(),
                    slug: workforceSlug.trim(),
                    purpose: workforcePurpose.trim(),
                    soul: workforceSoul.trim(),
                    provider: buildWorkforceProviderPayload(),
                    active: workforceActive,
                }),
            });
            showWorkforceModal = false;
            feedbackStore.pushToast({
                severity: "success",
                title: editingWorkforceAgentId === null ? "Agent created" : "Agent updated",
                message: "The tenant workforce profile was saved.",
            });
            resetWorkforceForm();
            await loadProvisioning();
        } catch (err: any) {
            error = err.message || "Failed to save workforce agent";
        } finally {
            savingWorkforceAgent = false;
        }
    }

    function deleteWorkforceAgent(agent: WorkforceAgent) {
        feedbackStore.openConfirm({
            title: "Delete Workforce Agent",
            message:
                `Deleting ${agent.name} will break any forms still referencing ${agent.slug} until they are reconfigured.`,
            confirmLabel: "Delete Agent",
            confirmIntent: "danger",
            onConfirm: async () => {
                try {
                    await fetchApi(`/workforce/agents/${agent.id}`, { method: "DELETE" });
                    feedbackStore.pushToast({
                        severity: "success",
                        title: "Agent deleted",
                        message: `${agent.name} was removed from the tenant workforce.`,
                    });
                    await loadProvisioning();
                } catch (err: any) {
                    const isApiError = err instanceof ApiError;
                    feedbackStore.pushToast({
                        severity: "error",
                        title: "Failed to delete agent",
                        message: err.message || "An error occurred.",
                        code: isApiError ? err.code : undefined,
                        remediation: isApiError ? err.remediation : undefined,
                    });
                    throw err;
                }
            },
        });
    }

    function formatDate(d: string | null) {
        if (!d) return "Never";
        return new Date(d).toLocaleString();
    }

    function describeWorkforceProvider(provider: WorkforceAgentProvider) {
        if (provider.type === "openai") {
            return provider.model ? `OpenAI / ${provider.model}` : "OpenAI / tenant default model";
        }

        if (provider.type === "anthropic") {
            return provider.model ? `Claude / ${provider.model}` : "Claude / tenant default model";
        }

        if (provider.type === "gemini") {
            return provider.model ? `Gemini / ${provider.model}` : "Gemini / tenant default model";
        }

        return "Deterministic mapper";
    }
</script>

<svelte:head>
    <title>Agent Provisioning | WordClaw Supervisor</title>
</svelte:head>

{#if showProviderModal}
    <div class="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50">
        <div class="mx-4 w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-950">
            <div class="flex items-center justify-between border-b border-slate-200 px-6 py-5 dark:border-slate-700">
                <div>
                    <h3 class="text-lg font-semibold text-slate-900 dark:text-white">
                        Configure {providerLabel(selectedProviderType)} Provider
                    </h3>
                    <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Store the current tenant's provider credential for background draft-generation jobs.
                    </p>
                </div>
                <button
                    aria-label="Close dialog"
                    onclick={() => (showProviderModal = false)}
                    class="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
                >
                    <Icon src={XMark} class="w-5 h-5" />
                </button>
            </div>
            <div class="space-y-4 px-6 py-4">
                <div>
                    <label
                        for="providerApiKey"
                        class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                    >
                        API Key
                    </label>
                    <Input
                        id="providerApiKey"
                        bind:value={providerApiKey}
                        type="password"
                        placeholder={selectedProviderType === "openai"
                            ? "sk-..."
                            : selectedProviderType === "anthropic"
                                ? "sk-ant-..."
                                : "AIza..."}
                    />
                </div>
                <div>
                    <label
                        for="providerDefaultModel"
                        class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                    >
                        Default Model
                    </label>
                    <Input
                        id="providerDefaultModel"
                        bind:value={providerDefaultModel}
                        type="text"
                        placeholder={providerMeta(selectedProviderType).placeholderModel}
                    />
                </div>
                <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                    <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        Usage
                    </p>
                    <p class="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                        {providerMeta(selectedProviderType).description}
                        Reference it from forms or workforce agents with
                        <code class="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[0.72rem] text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                            {providerMeta(selectedProviderType).draftGenerationHint}
                        </code>.
                    </p>
                </div>
                <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                    <p class="text-sm leading-6 text-slate-500 dark:text-slate-400">
                        The raw provider secret is never shown again after save. Reads return a masked value only.
                    </p>
                </div>
            </div>
            <div class="flex justify-end gap-3 border-t border-slate-200 bg-slate-50/80 px-6 py-4 dark:border-slate-700 dark:bg-slate-900/40">
                <Button onclick={() => (showProviderModal = false)} variant="outline">
                    Cancel
                </Button>
                <Button onclick={saveProvider} disabled={!providerApiKey.trim() || savingProvider}>
                    {#if savingProvider}
                        <LoadingSpinner size="sm" color="white" />
                        Saving...
                    {:else}
                        Save Provider
                    {/if}
                </Button>
            </div>
        </div>
    </div>
{/if}

{#if showWorkforceModal}
    <div class="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50">
        <div class="mx-4 w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-950">
            <div class="flex items-center justify-between border-b border-slate-200 px-6 py-5 dark:border-slate-700">
                <div>
                    <h3 class="text-lg font-semibold text-slate-900 dark:text-white">
                        {editingWorkforceAgentId === null ? "Add Workforce Agent" : "Edit Workforce Agent"}
                    </h3>
                    <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Define a tenant-managed agent profile with a bounded SOUL, purpose, and provider/model defaults.
                    </p>
                </div>
                <button
                    aria-label="Close dialog"
                    onclick={() => {
                        showWorkforceModal = false;
                        resetWorkforceForm();
                    }}
                    class="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
                >
                    <Icon src={XMark} class="w-5 h-5" />
                </button>
            </div>
            <div class="space-y-4 px-6 py-4">
                <div class="grid gap-4 md:grid-cols-2">
                    <div>
                        <label
                            for="workforceName"
                            class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                        >
                            Agent Name
                        </label>
                        <Input
                            id="workforceName"
                            bind:value={workforceName}
                            type="text"
                            placeholder="Software Proposal Writer"
                            oninput={(event) => {
                                const value = (event.currentTarget as HTMLInputElement).value;
                                workforceName = value;
                                if (editingWorkforceAgentId === null && !workforceSlug.trim()) {
                                    workforceSlug = slugify(value);
                                }
                            }}
                        />
                    </div>
                    <div>
                        <label
                            for="workforceSlug"
                            class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                        >
                            Slug
                        </label>
                        <Input
                            id="workforceSlug"
                            bind:value={workforceSlug}
                            type="text"
                            placeholder="software-proposal-writer"
                        />
                    </div>
                </div>
                <div>
                    <label
                        for="workforcePurpose"
                        class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                    >
                        Purpose
                    </label>
                    <textarea
                        id="workforcePurpose"
                        bind:value={workforcePurpose}
                        rows="3"
                        class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-slate-300"
                        placeholder="Draft software development proposals from inbound requirement submissions."
                    ></textarea>
                </div>
                <div>
                    <label
                        for="workforceSoul"
                        class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                    >
                        SOUL
                    </label>
                    <textarea
                        id="workforceSoul"
                        bind:value={workforceSoul}
                        rows="5"
                        class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-slate-300"
                        placeholder="You are a senior solution consultant who produces concise, accurate software proposals grounded in the submitted requirements."
                    ></textarea>
                </div>
                <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                    <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        Runtime defaults
                    </p>
                    <div class="mt-3 grid gap-4 md:grid-cols-3">
                        <div>
                            <label
                                for="workforceProviderType"
                                class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                            >
                                Provider
                            </label>
                            <select
                                id="workforceProviderType"
                                bind:value={workforceProviderType}
                                class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-slate-300"
                            >
                                <option value="deterministic">Deterministic</option>
                                {#each configurableProviders as provider}
                                    <option value={provider.type}>{provider.label}</option>
                                {/each}
                            </select>
                        </div>
                        <div class="md:col-span-2">
                            <label
                                for="workforceProviderModel"
                                class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                            >
                                Model
                            </label>
                            <Input
                                id="workforceProviderModel"
                                bind:value={workforceProviderModel}
                                type="text"
                                placeholder={workforceProviderType === "deterministic"
                                    ? "Not used for deterministic"
                                    : providerMeta(workforceProviderType).placeholderModel}
                                disabled={workforceProviderType === "deterministic"}
                            />
                        </div>
                    </div>
                    {#if workforceProviderType !== "deterministic"}
                        <div class="mt-4">
                            <label
                                for="workforceProviderInstructions"
                                class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                            >
                                Provider Instructions
                            </label>
                            <textarea
                                id="workforceProviderInstructions"
                                bind:value={workforceProviderInstructions}
                                rows="3"
                                class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-slate-300"
                                placeholder="Produce a concise proposal with explicit assumptions and next steps."
                            ></textarea>
                        </div>
                    {/if}
                    <label class="mt-4 flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                        <input
                            bind:checked={workforceActive}
                            type="checkbox"
                            class="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 dark:border-slate-600 dark:bg-slate-950"
                        />
                        Agent is active and available for form-driven jobs
                    </label>
                </div>
            </div>
            <div class="flex justify-end gap-3 border-t border-slate-200 bg-slate-50/80 px-6 py-4 dark:border-slate-700 dark:bg-slate-900/40">
                <Button
                    onclick={() => {
                        showWorkforceModal = false;
                        resetWorkforceForm();
                    }}
                    variant="outline"
                >
                    Cancel
                </Button>
                <Button
                    onclick={saveWorkforceAgent}
                    disabled={!workforceName.trim()
                        || !workforceSlug.trim()
                        || !workforcePurpose.trim()
                        || !workforceSoul.trim()
                        || savingWorkforceAgent}
                >
                    {#if savingWorkforceAgent}
                        <LoadingSpinner size="sm" color="white" />
                        Saving...
                    {:else}
                        Save Agent
                    {/if}
                </Button>
            </div>
        </div>
    </div>
{/if}

<div class="h-full flex flex-col">
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
            <h2 class="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                Agent Provisioning
            </h2>
            <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {pageDescription}
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">{configuredProviderCount} providers</Badge>
                <Badge variant="muted">{workforceAgentCount} workforce agents</Badge>
            </div>
        </div>
    </div>

    {#if error}
        <div class="mb-6 rounded border-l-4 border-red-500 bg-red-50 p-4 dark:bg-red-900/30">
            <p class="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
    {/if}

    {#if loading}
        <Surface class="flex items-center justify-center p-12">
            <LoadingSpinner size="lg" />
        </Surface>
    {:else}
        <!-- ── AI Providers — compact table ── -->
        <Surface class="p-5">
            <div class="flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <h3 class="text-base font-semibold text-slate-900 dark:text-white">
                        AI Providers
                    </h3>
                    <p class="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                        Tenant-scoped model credentials
                    </p>
                </div>
                <Badge variant="outline">{configuredProviderCount} of {configurableProviders.length} configured</Badge>
            </div>

            <div class="mt-4 overflow-x-auto">
                <table class="w-full text-sm">
                    <thead>
                        <tr class="border-b border-slate-200 dark:border-slate-700">
                            <th class="pb-2 pr-4 text-left text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Provider</th>
                            <th class="pb-2 pr-4 text-left text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Status</th>
                            <th class="pb-2 pr-4 text-left text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Model</th>
                            <th class="pb-2 pr-4 text-left text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Key</th>
                            <th class="pb-2 pr-4 text-left text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Updated</th>
                            <th class="pb-2 text-right text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each configurableProviders as provider}
                            {@const config = getProviderConfig(provider.type)}
                            <tr class="border-b border-slate-100 last:border-0 dark:border-slate-800">
                                <td class="py-3 pr-4">
                                    <div class="flex items-center gap-2">
                                        <span class="font-medium text-slate-900 dark:text-white">{provider.label}</span>
                                        <button
                                            onclick={(e) => {
                                                const el = e.currentTarget;
                                                const tip = el.querySelector('.provider-tip');
                                                if (tip) tip.classList.toggle('hidden');
                                            }}
                                            class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-200 text-[0.6rem] font-semibold text-slate-500 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-slate-600 relative"
                                            title={provider.draftGenerationHint}
                                        >
                                            i
                                            <span class="provider-tip hidden absolute left-6 top-0 z-10 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                                {provider.draftGenerationHint}
                                            </span>
                                        </button>
                                    </div>
                                </td>
                                <td class="py-3 pr-4">
                                    <Badge variant={config ? "info" : "outline"}>
                                        {config ? "Configured" : "Not configured"}
                                    </Badge>
                                </td>
                                <td class="py-3 pr-4 text-slate-700 dark:text-slate-300">
                                    {config?.defaultModel ?? "—"}
                                </td>
                                <td class="py-3 pr-4 font-mono text-xs text-slate-500 dark:text-slate-400">
                                    {config?.maskedApiKey ?? "—"}
                                </td>
                                <td class="py-3 pr-4 text-slate-500 dark:text-slate-400 text-xs">
                                    {config ? formatDate(config.updatedAt) : "—"}
                                </td>
                                <td class="py-3 text-right">
                                    <div class="flex items-center justify-end gap-2">
                                        <Button variant="outline" size="sm" onclick={() => openProviderModal(provider.type)}>
                                            {config ? "Update" : `Configure ${provider.label}`}
                                        </Button>
                                        {#if config}
                                            <Button variant="destructive" size="sm" onclick={() => deleteProvider(provider.type)}>
                                                <Icon src={Trash} class="h-3.5 w-3.5" />
                                            </Button>
                                        {/if}
                                    </div>
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>

            {#if providerConfigsError}
                <div class="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                    Provider provisioning is unavailable right now. Details: {providerConfigsError}
                </div>
            {/if}
        </Surface>

        <!-- ── Workforce Agents — compact list with collapsible SOUL ── -->
        <Surface class="mt-4 p-5">
            <div class="flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <h3 class="text-base font-semibold text-slate-900 dark:text-white">
                        Workforce Agents
                    </h3>
                    <p class="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                        Reusable SOUL profiles that forms reference by slug.
                        <Badge variant="outline" class="ml-1">{workforceAgentCount} total</Badge>
                        <Badge variant="muted" class="ml-1">{activeWorkforceAgentCount} active</Badge>
                    </p>
                </div>
                <Button variant="outline" onclick={() => openWorkforceModal()}>
                    <Icon src={Plus} class="w-4 h-4" />
                    Add Agent
                </Button>
            </div>

            {#if workforceAgents.length === 0}
                <div class="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-400">
                    No workforce agents yet. Create one to define a reusable agent profile.
                </div>
            {:else}
                <div class="mt-4 space-y-3">
                    {#each workforceAgents as agent}
                        <div class="rounded-2xl border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-900/30">
                            <!-- Agent header row -->
                            <div class="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
                                <div class="flex items-center gap-3 min-w-0">
                                    <div class="flex items-center gap-2">
                                        <h4 class="text-sm font-semibold text-slate-900 dark:text-white">{agent.name}</h4>
                                        <Badge variant={agent.active ? "info" : "outline"}>
                                            {agent.active ? "Active" : "Inactive"}
                                        </Badge>
                                        {#if agent.provider.type !== "deterministic" && !getProviderConfig(agent.provider.type)}
                                            <Badge variant="outline">Needs credential</Badge>
                                        {/if}
                                    </div>
                                    <span class="hidden sm:inline font-mono text-xs text-slate-400 dark:text-slate-500">
                                        {agent.slug} · #{agent.id}
                                    </span>
                                </div>
                                <div class="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                                    <span class="hidden md:inline">{describeWorkforceProvider(agent.provider)}</span>
                                    <span class="hidden lg:inline">· {formatDate(agent.updatedAt)}</span>
                                    <div class="flex items-center gap-1.5">
                                        <Button variant="outline" size="sm" onclick={() => openWorkforceModal(agent)}>
                                            Edit
                                        </Button>
                                        <Button variant="destructive" size="sm" onclick={() => deleteWorkforceAgent(agent)}>
                                            <Icon src={Trash} class="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            <!-- Purpose (always visible, compact) -->
                            <div class="border-t border-slate-200 px-4 py-2 dark:border-slate-700">
                                <p class="text-sm text-slate-600 dark:text-slate-300 leading-snug">{agent.purpose}</p>
                            </div>

                            <!-- Collapsible SOUL + instructions -->
                            <details class="border-t border-slate-200 dark:border-slate-700">
                                <summary class="cursor-pointer px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300 select-none">
                                    SOUL & Instructions
                                </summary>
                                <div class="px-4 pb-3">
                                    <div class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950/50">
                                        <p class="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">SOUL</p>
                                        <p class="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-300">{agent.soul}</p>
                                        {#if agent.provider.type !== "deterministic" && agent.provider.instructions}
                                            <div class="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
                                                <p class="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Provider Instructions</p>
                                                <p class="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-slate-300">{agent.provider.instructions}</p>
                                            </div>
                                        {/if}
                                    </div>
                                </div>
                            </details>
                        </div>
                    {/each}
                </div>
            {/if}

            {#if workforceAgentsError}
                <div class="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                    Workforce agents are unavailable right now. Details: {workforceAgentsError}
                </div>
            {/if}
        </Surface>
    {/if}
</div>
