<script lang="ts">
    import { fetchApi, ApiError } from "$lib/api";
    import { onMount } from "svelte";
    import DataTable from "$lib/components/DataTable.svelte";
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
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

    const columns = [
        { key: "name", label: "Name", sortable: true },
        { key: "keyPrefix", label: "Key Prefix" },
        { key: "scopes", label: "Scopes" },
        { key: "lastUsedAt", label: "Last Used", sortable: true },
        { key: "actions", label: "", width: "100px" },
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
    <title>Agent Keys | WordClaw Supervisor</title>
</svelte:head>

<!-- Generate Key Result Modal -->
{#if generatedKey}
    <div
        class="fixed inset-0 bg-gray-900/75 flex items-center justify-center z-50"
    >
        <div
            class="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-lg w-full mx-4 shadow-2xl border border-gray-200 dark:border-gray-700"
        >
            <h3 class="text-xl font-bold text-gray-900 dark:text-white mb-2">
                Save this API Key
            </h3>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
                This is the only time the API key for <strong
                    class="text-gray-700 dark:text-gray-300"
                    >"{generatedKey.name}"</strong
                > will be shown. Keep it secure and treat it like a password.
            </p>
            <div
                class="bg-gray-100 dark:bg-gray-900 p-4 rounded text-center relative mb-6"
            >
                <code
                    class="text-sm font-mono text-gray-800 dark:text-gray-200 break-all select-all flex-1"
                    >{generatedKey.apiKey}</code
                >
            </div>
            <div class="flex justify-end gap-3">
                <button
                    class="px-5 py-2.5 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 transition"
                    onclick={() => {
                        navigator.clipboard.writeText(generatedKey!.apiKey);
                    }}
                >
                    Copy to Clipboard
                </button>
                <button
                    class="px-5 py-2.5 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white font-medium rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition"
                    onclick={() => (generatedKey = null)}
                >
                    Close
                </button>
            </div>
        </div>
    </div>
{/if}

<div class="h-full flex flex-col">
    <div class="flex justify-between items-center mb-6">
        <div>
            <h2 class="text-2xl font-bold text-gray-900 dark:text-white">
                Agent Keys
            </h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Manage API credentials for autonomous agents
            </p>
        </div>
        <button
            onclick={() => (showNewKeyModal = true)}
            class="px-4 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 transition shadow-sm flex items-center gap-2"
        >
            <Icon src={Plus} class="w-5 h-5" />
            Create Key
        </button>
    </div>

    <!-- Create Key Modal -->
    {#if showNewKeyModal}
        <div
            class="fixed inset-0 bg-gray-900/50 flex items-center justify-center z-40"
        >
            <div
                class="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden border border-gray-200 dark:border-gray-700"
            >
                <div
                    class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center"
                >
                    <h3
                        class="text-lg font-medium text-gray-900 dark:text-white"
                    >
                        Create Agent Key
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
                            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                            >Key Name</label
                        >
                        <input
                            id="keyName"
                            bind:value={newKeyName}
                            type="text"
                            placeholder="e.g. Content Writer Agent"
                            class="w-full rounded-md border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 px-3 py-2"
                        />
                    </div>
                    <div>
                        <span
                            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                            >Permissions</span
                        >
                        <div class="space-y-2 max-h-48 overflow-y-auto">
                            {#each availableScopes as scope}
                                <label class="flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={newKeyScopes.includes(scope)}
                                        onchange={() => toggleScope(scope)}
                                        class="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 h-4 w-4 bg-white dark:bg-gray-700"
                                    />
                                    <span
                                        class="ml-2 text-sm text-gray-700 dark:text-gray-300 font-mono bg-gray-100 dark:bg-gray-700 px-1.5 rounded"
                                        >{scope}</span
                                    >
                                </label>
                            {/each}
                        </div>
                    </div>
                </div>
                <div
                    class="px-6 py-4 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3"
                >
                    <button
                        onclick={() => (showNewKeyModal = false)}
                        class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
                        >Cancel</button
                    >
                    <button
                        onclick={createKey}
                        disabled={!newKeyName.trim() ||
                            newKeyScopes.length === 0 ||
                            creating}
                        class="px-4 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 transition disabled:opacity-50 flex items-center gap-2"
                    >
                        {#if creating}
                            <LoadingSpinner size="sm" color="white" />
                            Saving...
                        {:else}
                            Create Key
                        {/if}
                    </button>
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

    <!-- Keys List -->
    <div
        class="bg-white dark:bg-gray-800 shadow rounded-lg border border-gray-200 dark:border-gray-700 flex-1 flex flex-col overflow-hidden"
    >
        {#if loading}
            <div class="flex-1 flex justify-center items-center p-12">
                <LoadingSpinner size="lg" />
            </div>
        {:else if keys.length === 0}
            <div
                class="flex-1 flex flex-col justify-center items-center text-gray-500 p-12"
            >
                <Icon src={Key} class="w-16 h-16 text-gray-300 mb-4" />
                <p class="text-lg font-medium">No API keys yet</p>
                <p class="text-sm">
                    Create a key to grant agents access to WordClaw.
                </p>
            </div>
        {:else}
            <DataTable {columns} data={keys} keyField="id">
                {#snippet cell(ctx: any)}
                    {@const row = ctx.row}
                    {@const column = ctx.column}
                    {#if column.key === "name"}
                        <div class="flex items-center">
                            {#if row.revokedAt}
                                <span
                                    class="flex-shrink-0 h-2.5 w-2.5 rounded-full bg-red-500 mr-2"
                                    title="Revoked"
                                ></span>
                            {:else}
                                <span
                                    class="flex-shrink-0 h-2.5 w-2.5 rounded-full bg-green-500 mr-2"
                                    title="Active"
                                ></span>
                            {/if}
                            <div>
                                <div
                                    class="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-2"
                                >
                                    {row.name}
                                    {#if row.revokedAt}
                                        <span
                                            class="text-[0.6rem] uppercase tracking-wider font-bold bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-400 px-1.5 py-0.5 rounded"
                                            >Revoked</span
                                        >
                                    {/if}
                                </div>
                                <div class="text-xs text-gray-500">
                                    Created: {formatDate(row.createdAt)}
                                </div>
                            </div>
                        </div>
                    {:else if column.key === "keyPrefix"}
                        <span class="font-mono bg-gray-50 dark:bg-gray-800/50"
                            >{row.keyPrefix}••••••••</span
                        >
                    {:else if column.key === "scopes"}
                        <div class="flex flex-wrap gap-1 max-w-[200px]">
                            {#each row.scopes as scope}
                                <span
                                    class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300 font-mono"
                                    >{scope}</span
                                >
                            {/each}
                        </div>
                    {:else if column.key === "lastUsedAt"}
                        {#if row.lastUsedAt}
                            <div class="text-gray-900 dark:text-gray-200">
                                {formatDate(row.lastUsedAt).split(",")[0]}
                            </div>
                            <div class="text-xs">
                                {formatDate(row.lastUsedAt).split(",")[1]}
                            </div>
                        {:else}
                            <span class="italic text-gray-400">Never</span>
                        {/if}
                    {:else if column.key === "actions"}
                        {#if !row.revokedAt}
                            <div
                                class="flex items-center justify-end gap-3 pr-4"
                            >
                                <!-- Rotate -->
                                <button
                                    onclick={() => rotateKey(row.id)}
                                    class="text-yellow-600 hover:text-yellow-900 dark:text-yellow-400 dark:hover:text-yellow-300"
                                    title="Rotate Key"
                                >
                                    <Icon src={ArrowPath} class="w-5 h-5" />
                                </button>
                                <!-- Revoke -->
                                <button
                                    onclick={() => revokeKey(row.id)}
                                    class="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                                    title="Revoke Key"
                                >
                                    <Icon src={Trash} class="w-5 h-5" />
                                </button>
                            </div>
                        {:else}
                            <span class="text-xs text-gray-500 block text-right"
                                >Revoked on {formatDate(row.revokedAt)}</span
                            >
                        {/if}
                    {/if}
                {/snippet}
            </DataTable>
        {/if}
    </div>
</div>
