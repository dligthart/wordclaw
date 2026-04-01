<script lang="ts">
    import { fetchApi, ApiError } from "$lib/api";
    import { auth } from "$lib/auth.svelte";
    import { onMount } from "svelte";
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import DataTable from "$lib/components/DataTable.svelte";
    import Badge from "$lib/components/ui/Badge.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Input from "$lib/components/ui/Input.svelte";
    import Surface from "$lib/components/ui/Surface.svelte";
    import { Icon, Plus, XMark, Key, ArrowPath, Trash } from "svelte-hero-icons";

    type ApiKey = {
        id: number;
        name: string;
        keyPrefix: string;
        scopes: string[];
        createdBy: number | null;
        createdAt: string;
        expiresAt: string | null;
        revokedAt: string | null;
        lastUsedAt: string | null;
    };

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

    type RevealedCredential = {
        name: string;
        apiKey: string;
        description: string;
        scopes?: string[];
        bootstrap?: boolean;
        domain?: {
            id: number;
            name: string;
            hostname: string;
            createdAt: string;
        };
        endpoints?: {
            api: string | null;
            mcp: string | null;
        };
    };

    let keys = $state<ApiKey[]>([]);
    let loading = $state(true);
    let error = $state<string | null>(null);

    let newKeyName = $state("");
    let newKeyScopes = $state<string[]>(["content:read", "content:write"]);
    let showNewKeyModal = $state(false);
    let creating = $state(false);
    let providerConfigs = $state<AiProviderConfig[]>([]);
    let workforceAgents = $state<WorkforceAgent[]>([]);
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
    let showOnboardModal = $state(false);
    let onboarding = $state(false);
    let onboardTenantName = $state("");
    let onboardHostname = $state("");
    let onboardAdminEmail = $state("");
    let onboardApiKeyName = $state("");

    let revealedCredential = $state<RevealedCredential | null>(null);
    let activeKeys = $derived.by(() =>
        keys.filter((key) => !key.revokedAt),
    );
    let revokedKeys = $derived.by(() =>
        keys.filter((key) => !!key.revokedAt),
    );
    let activeKeyCount = $derived(activeKeys.length);
    let revokedKeyCount = $derived(revokedKeys.length);
    let adminKeyCount = $derived.by(
        () => activeKeys.filter((key) => key.scopes.includes("admin")).length,
    );
    let workforceAgentCount = $derived(workforceAgents.length);
    let activeWorkforceAgentCount = $derived.by(
        () => workforceAgents.filter((agent) => agent.active).length,
    );
    let canOnboardTenants = $derived(auth.user?.scope === "platform");
    let pageDescription = $derived(
        canOnboardTenants
            ? "Manage credentials for agents and operator integrations, and provision initial tenant admin access."
            : "Manage credentials for agents and operator integrations for the current tenant.",
    );

    const activeColumns = [
        { key: "name", label: "Name", sortable: true },
        { key: "keyPrefix", label: "Prefix" },
        { key: "scopes", label: "Scopes" },
        { key: "createdAt", label: "Created", sortable: true },
        { key: "lastUsedAt", label: "Last Used", sortable: true },
        { key: "_actions", label: "", width: "160px" }
    ];

    const revokedColumns = [
        { key: "name", label: "Name", sortable: true },
        { key: "keyPrefix", label: "Prefix" },
        { key: "scopes", label: "Scopes" },
        { key: "revokedAt", label: "Revoked", sortable: true },
        { key: "lastUsedAt", label: "Last Used", sortable: true }
    ];

    const availableScopes = [
        "content:read",
        "content:write",
        "audit:read",
        "admin",
    ];
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

    onMount(() => {
        loadKeys();
    });

    async function loadKeys() {
        loading = true;
        error = null;
        try {
            const keyRes = await fetchApi("/auth/keys");
            keys = keyRes.data;

            try {
                const providerRes = await fetchApi("/ai/providers");
                providerConfigs = providerRes.data;
                providerConfigsError = null;
            } catch (providerError) {
                providerConfigs = [];
                providerConfigsError =
                    providerError instanceof ApiError
                        ? providerError.remediation ??
                          providerError.message ??
                          "Tenant AI providers are unavailable."
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
                        ? workforceError.remediation ??
                          workforceError.message ??
                          "Tenant workforce registry is unavailable."
                        : "Tenant workforce registry is unavailable.";
            }
        } catch (err: any) {
            error = err.message || "Failed to load access and agent configuration";
        } finally {
            loading = false;
        }
    }

    async function createKey() {
        if (!newKeyName.trim()) return;
        creating = true;
        error = null;

        try {
            const res = await fetchApi("/auth/keys", {
                method: "POST",
                body: JSON.stringify({
                    name: newKeyName,
                    scopes: newKeyScopes,
                }),
            });
            revealedCredential = {
                name: res.data.name,
                apiKey: res.data.apiKey,
                description: `This is the only time the API key for ${res.data.name} will be shown. Treat it like a password.`,
            };
            showNewKeyModal = false;
            newKeyName = "";
            newKeyScopes = ["content:read", "content:write"];
            await loadKeys();
        } catch (err: any) {
            error = err.message || "Failed to create key";
        } finally {
            creating = false;
        }
    }

    function toggleScope(scope: string) {
        if (newKeyScopes.includes(scope)) {
            newKeyScopes = newKeyScopes.filter((s) => s !== scope);
        } else {
            newKeyScopes = [...newKeyScopes, scope];
        }
    }

    function resetOnboardingForm() {
        onboardTenantName = "";
        onboardHostname = "";
        onboardAdminEmail = "";
        onboardApiKeyName = "";
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
                ...(workforceProviderInstructions.trim() ? { instructions: workforceProviderInstructions.trim() } : {}),
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
            await loadKeys();
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
                    await loadKeys();
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
            await loadKeys();
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
                    await loadKeys();
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

    function switchSupervisorDomain(domainId: number) {
        if (typeof window === "undefined") return;

        const nextDomainId = String(domainId);
        localStorage.setItem("__wc_domain_id", nextDomainId);
        window.dispatchEvent(
            new CustomEvent("wordclaw:domains-changed", {
                detail: { selectDomainId: nextDomainId },
            }),
        );
    }

    async function createTenant() {
        if (!canOnboardTenants) {
            error = "Only platform supervisors can onboard new tenants.";
            return;
        }

        if (!onboardTenantName.trim() || !onboardHostname.trim()) return;

        onboarding = true;
        error = null;

        try {
            const res = await fetchApi("/onboard", {
                method: "POST",
                body: JSON.stringify({
                    tenantName: onboardTenantName,
                    hostname: onboardHostname,
                    adminEmail: onboardAdminEmail.trim() || undefined,
                    apiKeyName: onboardApiKeyName.trim() || undefined,
                }),
            });

            switchSupervisorDomain(res.data.domain.id);
            revealedCredential = {
                name: res.data.apiKey.name,
                apiKey: res.data.apiKey.apiKey,
                description: `This initial admin key for ${res.data.domain.name} will only be shown once. Store it securely before handing it to the tenant operator.`,
                scopes: res.data.apiKey.scopes,
                bootstrap: res.data.bootstrap,
                domain: res.data.domain,
                endpoints: res.data.endpoints,
            };
            showOnboardModal = false;
            resetOnboardingForm();
            feedbackStore.pushToast({
                severity: "success",
                title: "Tenant provisioned",
                message: `Switched supervisor context to ${res.data.domain.name}.`,
            });
            await loadKeys();
        } catch (err: any) {
            error = err.message || "Failed to onboard tenant";
        } finally {
            onboarding = false;
        }
    }

    function revokeKey(id: number) {
        feedbackStore.openConfirm({
            title: "Revoke API Key",
            message:
                "Are you sure you want to permanently revoke this API key? Any agents using this key will immediately lose access.",
            confirmLabel: "Revoke Key",
            confirmIntent: "danger",
            onConfirm: async () => {
                try {
                    await fetchApi(`/auth/keys/${id}`, { method: "DELETE" });
                    feedbackStore.pushToast({
                        severity: "success",
                        title: "Key Revoked",
                        message: "The API key was successfully revoked.",
                    });
                    await loadKeys();
                } catch (err: any) {
                    const isApiError = err instanceof ApiError;
                    feedbackStore.pushToast({
                        severity: "error",
                        title: "Failed to revoke key",
                        message: err.message || "An error occurred.",
                        code: isApiError ? err.code : undefined,
                        remediation: isApiError ? err.remediation : undefined,
                    });
                    throw err;
                }
            },
        });
    }

    function rotateKey(id: number) {
        feedbackStore.openConfirm({
            title: "Rotate API Key",
            message:
                "Rotating this key will generate a new secret and invalidate the current one. Continue?",
            confirmLabel: "Rotate Key",
            confirmIntent: "primary",
            onConfirm: async () => {
                try {
                    const res = await fetchApi(`/auth/keys/${id}`, {
                        method: "PUT",
                    });
                    revealedCredential = {
                        name: "Rotated Key",
                        apiKey: res.data.apiKey,
                        description: "The previous secret is no longer valid. Store this replacement key securely before closing this dialog.",
                    };
                    feedbackStore.pushToast({
                        severity: "success",
                        title: "Key Rotated",
                        message: "A new key secret has been generated.",
                    });
                    await loadKeys();
                } catch (err: any) {
                    const isApiError = err instanceof ApiError;
                    feedbackStore.pushToast({
                        severity: "error",
                        title: "Failed to rotate key",
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
    <title>API Keys | WordClaw Supervisor</title>
</svelte:head>

<!-- Generate Key Result Modal -->
{#if revealedCredential}
    <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75"
    >
        <div
            class="mx-4 w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-950"
        >
            <div class="flex items-start justify-between gap-4">
                <div>
                    <p class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        New secret
                    </p>
                    <h3 class="mt-2 text-xl font-semibold text-slate-900 dark:text-white">
                        Save this API Key
                    </h3>
                </div>
                <Badge variant="warning">Shown once</Badge>
            </div>
            <p class="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
                {revealedCredential.description}
            </p>
            <div
                class="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/60"
            >
                <code
                    class="block break-all font-mono text-sm text-slate-800 select-all dark:text-slate-200"
                    >{revealedCredential.apiKey}</code
                >
            </div>
            {#if revealedCredential.scopes?.length}
                <div class="mt-4">
                    <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        Initial scopes
                    </p>
                    <div class="mt-2 flex flex-wrap gap-2">
                        {#each revealedCredential.scopes as scope}
                            <Badge variant="muted" class="font-mono normal-case text-[0.65rem]">{scope}</Badge>
                        {/each}
                    </div>
                </div>
            {/if}
            {#if revealedCredential.domain}
                <div class="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/50">
                    <div class="flex items-start justify-between gap-4 flex-wrap">
                        <div>
                            <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                Tenant
                            </p>
                            <h4 class="mt-2 text-base font-semibold text-slate-900 dark:text-white">
                                {revealedCredential.domain.name}
                            </h4>
                            <p class="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
                                {revealedCredential.domain.hostname}
                            </p>
                        </div>
                        <Badge variant={revealedCredential.bootstrap ? "info" : "outline"}>
                            {revealedCredential.bootstrap ? "Bootstrap domain" : "Additional tenant"}
                        </Badge>
                    </div>
                    {#if revealedCredential.endpoints?.api || revealedCredential.endpoints?.mcp}
                        <div class="mt-4 grid gap-3">
                            {#if revealedCredential.endpoints?.api}
                                <div>
                                    <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                        API endpoint
                                    </p>
                                    <code class="mt-1 block break-all rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 select-all dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
                                        {revealedCredential.endpoints.api}
                                    </code>
                                </div>
                            {/if}
                            {#if revealedCredential.endpoints?.mcp}
                                <div>
                                    <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                        MCP endpoint
                                    </p>
                                    <code class="mt-1 block break-all rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 select-all dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
                                        {revealedCredential.endpoints.mcp}
                                    </code>
                                </div>
                            {/if}
                        </div>
                    {/if}
                </div>
            {/if}
            <div class="mt-6 flex justify-end gap-3">
                <Button
                    onclick={() => {
                        navigator.clipboard.writeText(revealedCredential!.apiKey);
                    }}
                >
                    Copy to Clipboard
                </Button>
                <Button
                    variant="secondary"
                    onclick={() => (revealedCredential = null)}
                >
                    Close
                </Button>
            </div>
        </div>
    </div>
{/if}

<div class="h-full flex flex-col">
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
            <h2 class="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                API Keys
            </h2>
            <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {pageDescription}
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">{activeKeyCount} active</Badge>
                {#if revokedKeyCount > 0}
                    <Badge variant="muted">{revokedKeyCount} revoked</Badge>
                {/if}
            </div>
        </div>
        <div class="flex flex-wrap gap-3">
            {#if canOnboardTenants}
                <Button
                    variant="outline"
                    onclick={() => (showOnboardModal = true)}
                >
                    <Icon src={Key} class="w-5 h-5" />
                    Onboard Tenant
                </Button>
            {/if}
            <Button
                onclick={() => (showNewKeyModal = true)}
            >
                <Icon src={Plus} class="w-5 h-5" />
                Create Key
            </Button>
        </div>
    </div>

    <!-- Create Key Modal -->
    {#if showNewKeyModal}
        <div
            class="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50"
        >
            <div
                class="mx-4 w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-950"
            >
                <div
                    class="flex items-center justify-between border-b border-slate-200 px-6 py-5 dark:border-slate-700"
                >
                    <h3
                        class="text-lg font-semibold text-slate-900 dark:text-white"
                    >
                        Create API Key
                    </h3>
                    <button
                        aria-label="Close dialog"
                        onclick={() => (showNewKeyModal = false)}
                        class="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
                    >
                        <Icon src={XMark} class="w-5 h-5" />
                    </button>
                </div>
                <div class="px-6 py-4 space-y-4">
                    <div>
                        <label
                            for="keyName"
                            class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                            >Key Name</label
                        >
                        <Input
                            id="keyName"
                            bind:value={newKeyName}
                            type="text"
                            placeholder="e.g. Content Writer Agent"
                        />
                    </div>
                    <div>
                        <span
                            class="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                            >Permissions</span
                        >
                        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {#each availableScopes as scope}
                                <button
                                    type="button"
                                    onclick={() => toggleScope(scope)}
                                    class={`rounded-2xl border px-3 py-2 text-left font-mono text-xs transition-colors ${
                                        newKeyScopes.includes(scope)
                                            ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950"
                                            : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300 dark:hover:bg-slate-800"
                                    }`}
                                    aria-pressed={newKeyScopes.includes(scope)}
                                >
                                    {scope}
                                </button>
                            {/each}
                        </div>
                    </div>
                </div>
                <div
                    class="flex justify-end gap-3 border-t border-slate-200 bg-slate-50/80 px-6 py-4 dark:border-slate-700 dark:bg-slate-900/40"
                >
                    <Button
                        onclick={() => (showNewKeyModal = false)}
                        variant="outline"
                    >Cancel</Button>
                    <Button
                        onclick={createKey}
                        disabled={!newKeyName.trim() ||
                            newKeyScopes.length === 0 ||
                            creating}
                    >
                        {#if creating}
                            <LoadingSpinner size="sm" color="white" />
                            Saving...
                        {:else}
                            Create Key
                        {/if}
                    </Button>
                </div>
            </div>
        </div>
    {/if}

    {#if showProviderModal}
        <div
            class="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50"
        >
            <div
                class="mx-4 w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-950"
            >
                <div
                    class="flex items-center justify-between border-b border-slate-200 px-6 py-5 dark:border-slate-700"
                >
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
                <div class="px-6 py-4 space-y-4">
                    <div>
                        <label
                            for="providerApiKey"
                            class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                            >API Key</label
                        >
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
                            >Default Model</label
                        >
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
                            <code class="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[0.72rem] text-slate-800 dark:bg-slate-800 dark:text-slate-200">{providerMeta(selectedProviderType).draftGenerationHint}</code>.
                        </p>
                    </div>
                    <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                        <p class="text-sm leading-6 text-slate-500 dark:text-slate-400">
                            The raw provider secret is never shown again after save. Reads return a masked value only.
                        </p>
                    </div>
                </div>
                <div
                    class="flex justify-end gap-3 border-t border-slate-200 bg-slate-50/80 px-6 py-4 dark:border-slate-700 dark:bg-slate-900/40"
                >
                    <Button
                        onclick={() => (showProviderModal = false)}
                        variant="outline"
                    >Cancel</Button>
                    <Button
                        onclick={saveProvider}
                        disabled={!providerApiKey.trim() || savingProvider}
                    >
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
        <div
            class="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50"
        >
            <div
                class="mx-4 w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-950"
            >
                <div
                    class="flex items-center justify-between border-b border-slate-200 px-6 py-5 dark:border-slate-700"
                >
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
                                >Agent Name</label
                            >
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
                                >Slug</label
                            >
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
                            >Purpose</label
                        >
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
                            >SOUL</label
                        >
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
                                    >Provider</label
                                >
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
                                    >Model</label
                                >
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
                                    >Provider Instructions</label
                                >
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
                            <input bind:checked={workforceActive} type="checkbox" class="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 dark:border-slate-600 dark:bg-slate-950" />
                            Agent is active and available for form-driven jobs
                        </label>
                    </div>
                </div>
                <div
                    class="flex justify-end gap-3 border-t border-slate-200 bg-slate-50/80 px-6 py-4 dark:border-slate-700 dark:bg-slate-900/40"
                >
                    <Button
                        onclick={() => {
                            showWorkforceModal = false;
                            resetWorkforceForm();
                        }}
                        variant="outline"
                    >Cancel</Button>
                    <Button
                        onclick={saveWorkforceAgent}
                        disabled={!workforceName.trim() ||
                            !workforceSlug.trim() ||
                            !workforcePurpose.trim() ||
                            !workforceSoul.trim() ||
                            savingWorkforceAgent}
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

    {#if showOnboardModal && canOnboardTenants}
        <div
            class="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50"
        >
            <div
                class="mx-4 w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-950"
            >
                <div
                    class="flex items-center justify-between border-b border-slate-200 px-6 py-5 dark:border-slate-700"
                >
                    <div>
                        <h3 class="text-lg font-semibold text-slate-900 dark:text-white">
                            Onboard Tenant
                        </h3>
                        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            Create a new domain and issue its first admin credential in one step.
                        </p>
                    </div>
                    <button
                        aria-label="Close dialog"
                        onclick={() => {
                            showOnboardModal = false;
                            resetOnboardingForm();
                        }}
                        class="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
                    >
                        <Icon src={XMark} class="w-5 h-5" />
                    </button>
                </div>
                <div class="px-6 py-4 space-y-4">
                    <div class="grid gap-4 md:grid-cols-2">
                        <div>
                            <label
                                for="tenantName"
                                class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                >Tenant Name</label
                            >
                            <Input
                                id="tenantName"
                                bind:value={onboardTenantName}
                                type="text"
                                placeholder="e.g. ACME Publishing"
                            />
                        </div>
                        <div>
                            <label
                                for="tenantHostname"
                                class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                >Hostname</label
                            >
                            <Input
                                id="tenantHostname"
                                bind:value={onboardHostname}
                                type="text"
                                placeholder="acme.example.com"
                            />
                        </div>
                    </div>
                    <div class="grid gap-4 md:grid-cols-2">
                        <div>
                            <label
                                for="tenantAdminEmail"
                                class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                >Operator Email</label
                            >
                            <Input
                                id="tenantAdminEmail"
                                bind:value={onboardAdminEmail}
                                type="email"
                                placeholder="ops@acme.example.com"
                            />
                        </div>
                        <div>
                            <label
                                for="tenantApiKeyName"
                                class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                >Initial Key Name</label
                            >
                            <Input
                                id="tenantApiKeyName"
                                bind:value={onboardApiKeyName}
                                type="text"
                                placeholder="Defaults to &quot;Tenant Admin&quot;"
                            />
                        </div>
                    </div>
                    <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                        <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                            Initial credential
                        </p>
                        <p class="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                            The first key is provisioned with
                            <code class="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[0.72rem] text-slate-800 dark:bg-slate-800 dark:text-slate-200">admin</code>
                            scope so the tenant operator can complete setup. The raw secret is shown once after provisioning.
                        </p>
                    </div>
                </div>
                <div
                    class="flex justify-end gap-3 border-t border-slate-200 bg-slate-50/80 px-6 py-4 dark:border-slate-700 dark:bg-slate-900/40"
                >
                    <Button
                        onclick={() => {
                            showOnboardModal = false;
                            resetOnboardingForm();
                        }}
                        variant="outline"
                    >Cancel</Button>
                    <Button
                        onclick={createTenant}
                        disabled={!onboardTenantName.trim() ||
                            !onboardHostname.trim() ||
                            onboarding}
                    >
                        {#if onboarding}
                            <LoadingSpinner size="sm" color="white" />
                            Provisioning...
                        {:else}
                            Create Tenant
                        {/if}
                    </Button>
                </div>
            </div>
        </div>
    {/if}

    {#if error}
        <div
            class="bg-red-50 dark:bg-red-900/30 border-l-4 border-red-500 p-4 mb-6 rounded"
        >
            <p class="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
    {/if}

    <div class="grid gap-4 lg:grid-cols-3">
        <Surface tone="subtle" class="p-4">
            <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Active keys
            </p>
            <p class="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
                {activeKeyCount}
            </p>
            <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Keys currently able to access WordClaw.
            </p>
        </Surface>
        <Surface tone="subtle" class="p-4">
            <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Admin scope
            </p>
            <p class="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
                {adminKeyCount}
            </p>
            <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Active keys with full administrative access.
            </p>
        </Surface>
        <Surface tone="subtle" class="p-4">
            <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                Revoked history
            </p>
            <p class="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
                {revokedKeyCount}
            </p>
            <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Keys kept for operator audit history.
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
                            <code class="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[0.72rem] text-slate-800 dark:bg-slate-800 dark:text-slate-200">{provider.draftGenerationHint}</code>
                        </p>
                    </div>
                </div>
            {/each}
        </div>

        {#if providerConfigsError}
            <div class="mt-5 rounded-3xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                Provider provisioning is unavailable right now. API key management and tenant bootstrap still work, but provider-backed draft-generation setup is temporarily limited. Details: {providerConfigsError}
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
                    Each agent owns a stable id/slug, a bounded purpose, a SOUL, and provider/model defaults that forms can reference through the API.
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
                Workforce agents are unavailable right now. API key management and tenant bootstrap still work, but reusable SOUL profiles cannot be managed until the workforce registry is back. Details: {workforceAgentsError}
            </div>
        {/if}
    </Surface>

    <Surface class="mt-4 flex-1 overflow-hidden p-0">
        {#if loading}
            <div class="flex items-center justify-center p-12">
                <LoadingSpinner size="lg" />
            </div>
        {:else if keys.length === 0}
            <div
                class="flex flex-col items-center justify-center p-12 text-center text-gray-500"
            >
                <Icon src={Key} class="mb-4 h-16 w-16 text-gray-300" />
                <p class="text-lg font-medium">No API keys yet</p>
                <p class="mt-1 text-sm">
                    Create a key to grant agents access to WordClaw.
                </p>
            </div>
        {:else}
            <div class="flex flex-col gap-4 p-4">
                <div class="rounded-3xl border border-slate-200 bg-white/70 p-5 dark:border-slate-700 dark:bg-slate-950/30">
                    <div class="flex items-start justify-between gap-4 flex-wrap">
                        <div>
                            <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                Active keys
                            </p>
                            <h3 class="mt-2 text-lg font-semibold text-slate-900 dark:text-white">
                                Live credentials
                            </h3>
                            <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                Rotate or revoke active keys here. New secrets are shown only once after creation or rotation.
                            </p>
                        </div>
                        <Badge variant="outline">{activeKeyCount} active</Badge>
                    </div>

                    <div class="mt-5">
                        <DataTable columns={activeColumns} data={activeKeys} keyField="id">
                            {#snippet cell({ row, column, value })}
                                {#if column.key === "name"}
                                    <div class="flex items-center gap-2">
                                        <span class="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" title="Active"></span>
                                        <span class="font-semibold text-slate-900 dark:text-white">{row.name}</span>
                                        {#if row.scopes.includes("admin")}
                                            <Badge variant="info">Admin</Badge>
                                        {/if}
                                    </div>
                                {:else if column.key === "keyPrefix"}
                                    <code class="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
                                        {row.keyPrefix}••••••••
                                    </code>
                                {:else if column.key === "scopes"}
                                    <div class="flex flex-wrap gap-1">
                                        {#each row.scopes as scope}
                                            <Badge variant="muted" class="font-mono normal-case text-[0.65rem]">{scope}</Badge>
                                        {/each}
                                    </div>
                                {:else if column.key === "createdAt" || column.key === "lastUsedAt"}
                                    <span class="text-slate-500 dark:text-slate-400">
                                        {row[column.key] ? formatDate(row[column.key]) : "Never"}
                                    </span>
                                {:else if column.key === "_actions"}
                                    <div class="flex items-center justify-end gap-2">
                                        <Button variant="outline" size="sm" onclick={() => rotateKey(row.id)}>
                                            <Icon src={ArrowPath} class="h-4 w-4" />
                                            Rotate
                                        </Button>
                                        <Button variant="destructive" size="sm" onclick={() => revokeKey(row.id)}>
                                            <Icon src={Trash} class="h-4 w-4" />
                                            Revoke
                                        </Button>
                                    </div>
                                {/if}
                            {/snippet}
                            {#snippet empty()}
                                No active keys. Create a new key to grant access.
                            {/snippet}
                        </DataTable>
                    </div>
                </div>

                <details class="rounded-3xl border border-slate-200 bg-white/60 p-5 dark:border-slate-700 dark:bg-slate-950/20">
                    <summary class="flex cursor-pointer list-none items-center justify-between gap-3">
                        <div>
                            <p class="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                                Revoked history
                            </p>
                            <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                Historical keys kept for audit and troubleshooting.
                            </p>
                        </div>
                        <Badge variant="muted">{revokedKeyCount} revoked</Badge>
                    </summary>

                    {#if revokedKeys.length > 0}
                        <div class="mt-5">
                            <DataTable columns={revokedColumns} data={revokedKeys} keyField="id">
                                {#snippet cell({ row, column, value })}
                                    {#if column.key === "name"}
                                        <div class="flex items-center gap-2">
                                            <span class="h-2.5 w-2.5 rounded-full bg-rose-500 shrink-0" title="Revoked"></span>
                                            <span class="font-semibold text-slate-900 dark:text-white">{row.name}</span>
                                            <Badge variant="danger">Revoked</Badge>
                                        </div>
                                    {:else if column.key === "keyPrefix"}
                                        <code class="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
                                            {row.keyPrefix}••••••••
                                        </code>
                                    {:else if column.key === "scopes"}
                                        <div class="flex flex-wrap gap-1">
                                            {#each row.scopes as scope}
                                                <Badge variant="muted" class="font-mono normal-case text-[0.65rem]">{scope}</Badge>
                                            {/each}
                                        </div>
                                    {:else if column.key === "revokedAt" || column.key === "lastUsedAt"}
                                        <span class="text-slate-500 dark:text-slate-400">
                                            {row[column.key] ? formatDate(row[column.key]) : "Never"}
                                        </span>
                                    {/if}
                                {/snippet}
                            </DataTable>
                        </div>
                    {/if}
                </details>
            </div>
        {/if}
    </Surface>
</div>
