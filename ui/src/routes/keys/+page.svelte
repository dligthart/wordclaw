<script lang="ts">
    import { fetchApi, ApiError } from "$lib/api";
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

    let keys = $state<ApiKey[]>([]);
    let loading = $state(true);
    let error = $state<string | null>(null);

    let newKeyName = $state("");
    let newKeyScopes = $state<string[]>(["content:read", "content:write"]);
    let showNewKeyModal = $state(false);
    let creating = $state(false);

    let generatedKey = $state<{ name: string; apiKey: string } | null>(null);
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

    onMount(() => {
        loadKeys();
    });

    async function loadKeys() {
        loading = true;
        error = null;
        try {
            const res = await fetchApi("/auth/keys");
            keys = res.data;
        } catch (err: any) {
            error = err.message || "Failed to load keys";
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
            generatedKey = { name: res.data.name, apiKey: res.data.apiKey };
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
                    generatedKey = {
                        name: "Rotated Key",
                        apiKey: res.data.apiKey,
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
</script>

<svelte:head>
    <title>API Keys | WordClaw Supervisor</title>
</svelte:head>

<!-- Generate Key Result Modal -->
{#if generatedKey}
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
                This is the only time the API key for
                <strong class="text-slate-700 dark:text-slate-200">{generatedKey.name}</strong>
                will be shown. Treat it like a password.
            </p>
            <div
                class="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/60"
            >
                <code
                    class="block break-all font-mono text-sm text-slate-800 select-all dark:text-slate-200"
                    >{generatedKey.apiKey}</code
                >
            </div>
            <div class="mt-6 flex justify-end gap-3">
                <Button
                    onclick={() => {
                        navigator.clipboard.writeText(generatedKey!.apiKey);
                    }}
                >
                    Copy to Clipboard
                </Button>
                <Button
                    variant="secondary"
                    onclick={() => (generatedKey = null)}
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
                Manage credentials for agents and operator integrations.
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">{activeKeyCount} active</Badge>
                {#if revokedKeyCount > 0}
                    <Badge variant="muted">{revokedKeyCount} revoked</Badge>
                {/if}
            </div>
        </div>
        <Button
            onclick={() => (showNewKeyModal = true)}
        >
            <Icon src={Plus} class="w-5 h-5" />
            Create Key
        </Button>
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
