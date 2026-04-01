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
        <div class="grid gap-4 lg:grid-cols-3">
            <Surface tone="subtle" class="p-4">
                <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Configured providers
                </p>
                <p class="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
                    {configuredProviderCount}
                </p>
                <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    External model credentials stored for the active tenant.
                </p>
            </Surface>
            <Surface tone="subtle" class="p-4">
                <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Workforce agents
                </p>
                <p class="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
                    {workforceAgentCount}
                </p>
                <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Reusable tenant agents with stable ids, purpose, and SOUL.
                </p>
            </Surface>
            <Surface tone="subtle" class="p-4">
                <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    Active workforce
                </p>
                <p class="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
                    {activeWorkforceAgentCount}
                </p>
                <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Agents currently available to form-driven jobs and workflows.
                </p>
            </Surface>
        </div>

        <Surface class="mt-4 p-5">
            <div class="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        AI Providers
                    </p>
                    <h3 class="mt-2 text-lg font-semibold text-slate-900 dark:text-white">
                        Tenant-scoped model credentials
                    </h3>
                    <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Provider-backed draft-generation jobs resolve credentials from the active tenant instead of a global server key.
                    </p>
                </div>
            </div>

            <div class="mt-5 grid gap-4 xl:grid-cols-3">
                {#each configurableProviders as provider}
                    <div class="rounded-3xl border border-slate-200 bg-slate-50/70 p-5 dark:border-slate-700 dark:bg-slate-900/30">
                        <div class="flex items-start justify-between gap-4 flex-wrap">
                            <div>
                                <div class="flex items-center gap-2">
                                    <h4 class="text-base font-semibold text-slate-900 dark:text-white">{provider.label}</h4>
                                    <Badge variant={getProviderConfig(provider.type) ? "info" : "outline"}>
                                        {getProviderConfig(provider.type) ? "Configured" : "Not configured"}
                                    </Badge>
                                </div>
                                <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                    {provider.description}
                                </p>
                            </div>
                            <div class="flex items-center gap-2">
                                <Button variant="outline" size="sm" onclick={() => openProviderModal(provider.type)}>
                                    {getProviderConfig(provider.type) ? `Update ${provider.label}` : `Configure ${provider.label}`}
                                </Button>
                                {#if getProviderConfig(provider.type)}
                                    <Button variant="destructive" size="sm" onclick={() => deleteProvider(provider.type)}>
                                        <Icon src={Trash} class="h-4 w-4" />
                                        Delete
                                    </Button>
                                {/if}
                            </div>
                        </div>

                        <div class="mt-4 grid gap-4 md:grid-cols-3">
                            <div>
                                <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                    Stored key
                                </p>
                                <p class="mt-2 font-mono text-sm text-slate-800 dark:text-slate-200">
                                    {getProviderConfig(provider.type)?.maskedApiKey ?? "Not configured"}
                                </p>
                            </div>
                            <div>
                                <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                    Default model
                                </p>
                                <p class="mt-2 text-sm text-slate-800 dark:text-slate-200">
                                    {getProviderConfig(provider.type)?.defaultModel ?? "Provider or worker fallback"}
                                </p>
                            </div>
                            <div>
                                <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                    Last updated
                                </p>
                                <p class="mt-2 text-sm text-slate-800 dark:text-slate-200">
                                    {getProviderConfig(provider.type)
                                        ? formatDate(getProviderConfig(provider.type)?.updatedAt ?? null)
                                        : "Never"}
                                </p>
                            </div>
                        </div>

                        <div class="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/50">
                            <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                Form / agent reference
                            </p>
                            <p class="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                <code class="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[0.72rem] text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                                    {provider.draftGenerationHint}
                                </code>
                            </p>
                        </div>
                    </div>
                {/each}
            </div>

            {#if providerConfigsError}
                <div class="mt-5 rounded-3xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                    Provider provisioning is unavailable right now. Provider-backed draft-generation setup is temporarily limited. Details: {providerConfigsError}
                </div>
            {/if}
        </Surface>

        <Surface class="mt-4 p-5">
            <div class="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        Workforce Agents
                    </p>
                    <h3 class="mt-2 text-lg font-semibold text-slate-900 dark:text-white">
                        Tenant-managed SOUL profiles
                    </h3>
                    <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Each agent owns a stable id or slug, a bounded purpose, a SOUL, and provider/model defaults that forms can reference through the API.
                    </p>
                    <div class="mt-3 flex flex-wrap gap-2">
                        <Badge variant="outline">{workforceAgentCount} total</Badge>
                        <Badge variant="muted">{activeWorkforceAgentCount} active</Badge>
                    </div>
                </div>
                <Button variant="outline" onclick={() => openWorkforceModal()}>
                    <Icon src={Plus} class="w-5 h-5" />
                    Add Agent
                </Button>
            </div>

            {#if workforceAgents.length === 0}
                <div class="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-400">
                    No workforce agents yet. Create one to define a reusable tenant agent profile with a specific SOUL and provider/model defaults.
                </div>
            {:else}
                <div class="mt-5 grid gap-4">
                    {#each workforceAgents as agent}
                        <div class="rounded-3xl border border-slate-200 bg-slate-50/70 p-5 dark:border-slate-700 dark:bg-slate-900/30">
                            <div class="flex items-start justify-between gap-4 flex-wrap">
                                <div>
                                    <div class="flex items-center gap-2 flex-wrap">
                                        <h4 class="text-base font-semibold text-slate-900 dark:text-white">{agent.name}</h4>
                                        <Badge variant={agent.active ? "info" : "outline"}>
                                            {agent.active ? "Active" : "Inactive"}
                                        </Badge>
                                    </div>
                                    <p class="mt-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                                        {agent.slug} · #{agent.id}
                                    </p>
                                </div>
                                <div class="flex items-center gap-2">
                                    <Button variant="outline" size="sm" onclick={() => openWorkforceModal(agent)}>
                                        Edit
                                    </Button>
                                    <Button variant="destructive" size="sm" onclick={() => deleteWorkforceAgent(agent)}>
                                        <Icon src={Trash} class="h-4 w-4" />
                                        Delete
                                    </Button>
                                </div>
                            </div>

                            <p class="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
                                {agent.purpose}
                            </p>

                            <div class="mt-4 grid gap-4 md:grid-cols-3">
                                <div>
                                    <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                        Provider / Model
                                    </p>
                                    <p class="mt-2 text-sm text-slate-800 dark:text-slate-200">
                                        {describeWorkforceProvider(agent.provider)}
                                    </p>
                                </div>
                                <div>
                                    <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                        Updated
                                    </p>
                                    <p class="mt-2 text-sm text-slate-800 dark:text-slate-200">
                                        {formatDate(agent.updatedAt)}
                                    </p>
                                </div>
                                <div>
                                    <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                        Provisioning
                                    </p>
                                    <p class="mt-2 text-sm text-slate-800 dark:text-slate-200">
                                        {agent.provider.type !== "deterministic" && !getProviderConfig(agent.provider.type)
                                            ? "Needs provider credential"
                                            : "Ready"}
                                    </p>
                                </div>
                            </div>

                            <div class="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/50">
                                <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                    SOUL
                                </p>
                                <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-300">
                                    {agent.soul}
                                </p>
                                {#if agent.provider.type !== "deterministic" && agent.provider.instructions}
                                    <div class="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
                                        <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                            Provider Instructions
                                        </p>
                                        <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">
                                            {agent.provider.instructions}
                                        </p>
                                    </div>
                                {/if}
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}

            {#if workforceAgentsError}
                <div class="mt-5 rounded-3xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                    Workforce agents are unavailable right now. Forms can still use direct provider overrides, but reusable SOUL profiles cannot be managed until the workforce registry is back. Details: {workforceAgentsError}
                </div>
            {/if}
        </Surface>
    {/if}
</div>
