<script lang="ts">
    import { fetchApi } from "$lib/api";
    import { onMount } from "svelte";

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

    let confirmRevokeId = $state<number | null>(null);
    let confirmRotateId = $state<number | null>(null);

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

    async function revokeKey(id: number) {
        try {
            await fetchApi(`/auth/keys/${id}`, { method: "DELETE" });
            confirmRevokeId = null;
            await loadKeys();
        } catch (err: any) {
            error = err.message || "Failed to revoke key";
        }
    }

    async function rotateKey(id: number) {
        try {
            const res = await fetchApi(`/auth/keys/${id}`, { method: "PUT" });
            generatedKey = { name: "Rotated Key", apiKey: res.data.apiKey };
            confirmRotateId = null;
            await loadKeys();
        } catch (err: any) {
            error = err.message || "Failed to rotate key";
        }
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
            class="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-lg w-full shadow-2xl border border-gray-200 dark:border-gray-700"
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
            Create Key
        </button>
    </div>

    <!-- Create Key Modal -->
    {#if showNewKeyModal}
        <div
            class="fixed inset-0 bg-gray-900/50 flex items-center justify-center z-40"
        >
            <div
                class="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md overflow-hidden border border-gray-200 dark:border-gray-700"
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
                        <svg
                            class="w-5 h-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M6 18L18 6M6 6l12 12"
                            ></path></svg
                        >
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
                            <div
                                class="animate-spin rounded-full h-4 w-4 border-b-2 border-white"
                            ></div>
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
                <div
                    class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"
                ></div>
            </div>
        {:else if keys.length === 0}
            <div
                class="flex-1 flex flex-col justify-center items-center text-gray-500 p-12"
            >
                <svg
                    class="w-16 h-16 text-gray-300 mb-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    ><path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.5"
                        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                    ></path></svg
                >
                <p class="text-lg font-medium">No API keys yet</p>
                <p class="text-sm">
                    Create a key to grant agents access to WordClaw.
                </p>
            </div>
        {:else}
            <div class="overflow-x-auto flex-1">
                <table
                    class="min-w-full divide-y divide-gray-200 dark:divide-gray-700"
                >
                    <thead class="bg-gray-50 dark:bg-gray-700">
                        <tr>
                            <th
                                scope="col"
                                class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                                >Name</th
                            >
                            <th
                                scope="col"
                                class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                                >Key Prefix</th
                            >
                            <th
                                scope="col"
                                class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                                >Scopes</th
                            >
                            <th
                                scope="col"
                                class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                                >Last Used</th
                            >
                            <th
                                scope="col"
                                class="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                                >Actions</th
                            >
                        </tr>
                    </thead>
                    <tbody
                        class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700"
                    >
                        {#each keys as key}
                            <tr
                                class="hover:bg-gray-50 dark:hover:bg-gray-750 {key.revokedAt
                                    ? 'opacity-60'
                                    : ''}"
                            >
                                <td class="px-6 py-4 whitespace-nowrap">
                                    <div class="flex items-center">
                                        {#if key.revokedAt}
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
                                                {key.name}
                                                {#if key.revokedAt}
                                                    <span
                                                        class="text-[0.6rem] uppercase tracking-wider font-bold bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-400 px-1.5 py-0.5 rounded"
                                                        >Revoked</span
                                                    >
                                                {/if}
                                            </div>
                                            <div class="text-xs text-gray-500">
                                                Created: {formatDate(
                                                    key.createdAt,
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td
                                    class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 font-mono bg-gray-50 dark:bg-gray-800/50"
                                >
                                    {key.keyPrefix}••••••••
                                </td>
                                <td
                                    class="px-6 py-4 whitespace-nowrap text-sm text-gray-500"
                                >
                                    <div
                                        class="flex flex-wrap gap-1 max-w-[200px]"
                                    >
                                        {#each key.scopes as scope}
                                            <span
                                                class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300 font-mono"
                                                >{scope}</span
                                            >
                                        {/each}
                                    </div>
                                </td>
                                <td
                                    class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400"
                                >
                                    {#if key.lastUsedAt}
                                        <div
                                            class="text-gray-900 dark:text-gray-200"
                                        >
                                            {formatDate(key.lastUsedAt).split(
                                                ",",
                                            )[0]}
                                        </div>
                                        <div class="text-xs">
                                            {formatDate(key.lastUsedAt).split(
                                                ",",
                                            )[1]}
                                        </div>
                                    {:else}
                                        <span class="italic text-gray-400"
                                            >Never</span
                                        >
                                    {/if}
                                </td>
                                <td
                                    class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium"
                                >
                                    {#if !key.revokedAt}
                                        <div
                                            class="flex items-center justify-end gap-3"
                                        >
                                            <!-- Rotate -->
                                            {#if confirmRotateId === key.id}
                                                <div
                                                    class="flex items-center gap-2 animate-pulse text-yellow-600 dark:text-yellow-400"
                                                >
                                                    <span>Sure?</span>
                                                    <button
                                                        onclick={() =>
                                                            rotateKey(key.id)}
                                                        class="text-white bg-yellow-400 dark:bg-yellow-600 px-2 py-1 rounded text-xs hover:bg-yellow-500"
                                                        >Yes</button
                                                    >
                                                    <button
                                                        onclick={() =>
                                                            (confirmRotateId =
                                                                null)}
                                                        class="text-gray-500 dark:text-gray-400 hover:text-gray-700"
                                                        >No</button
                                                    >
                                                </div>
                                            {:else}
                                                <button
                                                    onclick={() =>
                                                        (confirmRotateId =
                                                            key.id)}
                                                    class="text-yellow-600 hover:text-yellow-900 dark:text-yellow-400 dark:hover:text-yellow-300"
                                                    title="Rotate Key"
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
                                                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                                        ></path></svg
                                                    >
                                                </button>
                                            {/if}

                                            <!-- Revoke -->
                                            {#if confirmRevokeId === key.id}
                                                <div
                                                    class="flex items-center gap-2 animate-pulse text-red-600 dark:text-red-400"
                                                >
                                                    <span>Revoke?</span>
                                                    <button
                                                        onclick={() =>
                                                            revokeKey(key.id)}
                                                        class="text-white bg-red-600 px-2 py-1 rounded text-xs hover:bg-red-700"
                                                        >Yes</button
                                                    >
                                                    <button
                                                        onclick={() =>
                                                            (confirmRevokeId =
                                                                null)}
                                                        class="text-gray-500 dark:text-gray-400 hover:text-gray-700"
                                                        >No</button
                                                    >
                                                </div>
                                            {:else if confirmRotateId !== key.id}
                                                <button
                                                    onclick={() =>
                                                        (confirmRevokeId =
                                                            key.id)}
                                                    class="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                                                    title="Revoke Key"
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
                                                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                                        ></path></svg
                                                    >
                                                </button>
                                            {/if}
                                        </div>
                                    {:else}
                                        <span class="text-xs text-gray-500"
                                            >Revoked on {formatDate(
                                                key.revokedAt,
                                            )}</span
                                        >
                                    {/if}
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        {/if}
    </div>
</div>
