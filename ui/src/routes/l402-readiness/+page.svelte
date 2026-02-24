<script lang="ts">
    import { fetchApi, ApiError } from "$lib/api";
    import { onMount } from "svelte";
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import Toast from "$lib/components/Toast.svelte";

    let loading = $state(true);
    let saving = $state(false);
    let error: ApiError | null = $state(null);

    let config = $state({
        architecture: "mock",
        webhookEndpoint: "",
        secretManagerPath: "",
        checklistApprovals: {
            fundedWallet: false,
            dnsTlsActive: false,
            custodyCompliance: false,
            testnetMainnetGates: false,
        },
        diagnostics: {
            hasLnbitsUrl: false,
            hasLnbitsKey: false,
            hasLndMacaroon: false,
            webhookConfigured: false,
        },
    });

    async function loadConfig() {
        loading = true;
        error = null;
        try {
            const data = await fetchApi("/api/supervisors/l402-readiness");
            config.architecture = data.architecture;
            config.webhookEndpoint = data.webhookEndpoint || "";
            config.secretManagerPath = data.secretManagerPath || "";
            config.checklistApprovals = Object.assign(
                config.checklistApprovals,
                data.checklistApprovals || {},
            );
            config.diagnostics = data.diagnostics || config.diagnostics;
        } catch (e) {
            error = e as ApiError;
        } finally {
            loading = false;
        }
    }

    async function saveConfig() {
        saving = true;
        error = null;
        try {
            await fetchApi("/api/supervisors/l402-readiness", {
                method: "PUT",
                body: JSON.stringify({
                    architecture: config.architecture,
                    webhookEndpoint: config.webhookEndpoint,
                    secretManagerPath: config.secretManagerPath,
                    checklistApprovals: config.checklistApprovals,
                }),
            });
            feedbackStore.pushToast({
                title: "Configuration saved successfully",
                severity: "success",
            });
            await loadConfig();
        } catch (e) {
            error = e as ApiError;
            feedbackStore.pushToast({
                title: "Failed to save configuration",
                severity: "error",
            });
        } finally {
            saving = false;
        }
    }

    onMount(loadConfig);

    let architectureOptions = [
        { value: "mock", label: "Mock (Development Only)" },
        { value: "lnbits", label: "LNbits Gateway" },
        { value: "lnd", label: "Direct LND Node" },
    ];

    let allChecked = $derived(
        config.checklistApprovals.fundedWallet &&
            config.checklistApprovals.dnsTlsActive &&
            config.checklistApprovals.custodyCompliance &&
            config.checklistApprovals.testnetMainnetGates,
    );

    let isArchReady = $derived(
        config.architecture === "mock" ||
            (config.architecture === "lnbits" &&
                config.diagnostics.hasLnbitsUrl &&
                config.diagnostics.hasLnbitsKey) ||
            (config.architecture === "lnd" &&
                config.diagnostics.hasLndMacaroon),
    );

    let isProductionReady = $derived(
        allChecked &&
            isArchReady &&
            config.architecture !== "mock" &&
            config.diagnostics.webhookConfigured,
    );
</script>

<div class="space-y-6 max-w-5xl">
    <div>
        <h1 class="text-2xl font-semibold text-gray-900 dark:text-white">
            L402 Operator Readiness
        </h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Configure lightning node architecture and track production readiness
            checklists for L402 payments (RFC 0014).
        </p>
    </div>

    {#if loading}
        <LoadingSpinner />
    {:else}
        {#if error}
            <ErrorBanner message={error.message || JSON.stringify(error)} />
        {/if}

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div class="lg:col-span-2 space-y-6">
                <!-- Architecture Config -->
                <div class="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
                    <h2
                        class="text-lg font-medium text-gray-900 dark:text-white mb-4"
                    >
                        Architecture Configuration
                    </h2>

                    <div class="space-y-4">
                        <div>
                            <label
                                class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                                for="arch">Provider</label
                            >
                            <select
                                id="arch"
                                class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                bind:value={config.architecture}
                            >
                                {#each architectureOptions as opt}
                                    <option value={opt.value}
                                        >{opt.label}</option
                                    >
                                {/each}
                            </select>
                        </div>

                        <div>
                            <label
                                class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                                for="webhook">Webhook Endpoint (Public)</label
                            >
                            <input
                                type="text"
                                id="webhook"
                                placeholder="https://api.yourdomain.com/api/payments/webhooks/lnbits"
                                class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                bind:value={config.webhookEndpoint}
                            />
                            <p class="mt-1 text-xs text-gray-500">
                                Provider settlement callbacks are routed here.
                            </p>
                        </div>

                        <div>
                            <label
                                class="block text-sm font-medium text-gray-700 dark:text-gray-300"
                                for="secret-path">Secret Manager Path</label
                            >
                            <input
                                type="text"
                                id="secret-path"
                                placeholder="projects/123/secrets/lnbits-key"
                                class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                bind:value={config.secretManagerPath}
                            />
                            <p class="mt-1 text-xs text-gray-500">
                                Path to credentials if using external vaults
                                (informational).
                            </p>
                        </div>
                    </div>
                </div>

                <!-- Readiness Checklist -->
                <div class="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
                    <h2
                        class="text-lg font-medium text-gray-900 dark:text-white mb-4"
                    >
                        Operator Checklist
                    </h2>
                    <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
                        Mark operations tasks as completed for production
                        graduation.
                    </p>

                    <div class="space-y-3">
                        <label
                            class="flex items-start space-x-3 cursor-pointer"
                        >
                            <input
                                type="checkbox"
                                class="h-5 w-5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                                bind:checked={
                                    config.checklistApprovals.fundedWallet
                                }
                            />
                            <div>
                                <span
                                    class="block text-sm font-medium text-gray-900 dark:text-gray-100"
                                    >Funded Wallet & Liquidity</span
                                >
                                <span class="block text-xs text-gray-500"
                                    >Treasury wallet funded with startup sats
                                    and inbound liquidity channels established.</span
                                >
                            </div>
                        </label>

                        <label
                            class="flex items-start space-x-3 cursor-pointer"
                        >
                            <input
                                type="checkbox"
                                class="h-5 w-5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                                bind:checked={
                                    config.checklistApprovals.dnsTlsActive
                                }
                            />
                            <div>
                                <span
                                    class="block text-sm font-medium text-gray-900 dark:text-gray-100"
                                    >DNS & TLS Configured</span
                                >
                                <span class="block text-xs text-gray-500"
                                    >Public DNS route points to webhook
                                    endpoint, TLS certificates are valid and
                                    auto-renewing.</span
                                >
                            </div>
                        </label>

                        <label
                            class="flex items-start space-x-3 cursor-pointer"
                        >
                            <input
                                type="checkbox"
                                class="h-5 w-5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                                bind:checked={
                                    config.checklistApprovals.custodyCompliance
                                }
                            />
                            <div>
                                <span
                                    class="block text-sm font-medium text-gray-900 dark:text-gray-100"
                                    >Custody & Compliance Appoved</span
                                >
                                <span class="block text-xs text-gray-500"
                                    >Tax treatment policy and wallet custody
                                    responsibilities are finalized.</span
                                >
                            </div>
                        </label>

                        <label
                            class="flex items-start space-x-3 cursor-pointer"
                        >
                            <input
                                type="checkbox"
                                class="h-5 w-5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                                bind:checked={
                                    config.checklistApprovals
                                        .testnetMainnetGates
                                }
                            />
                            <div>
                                <span
                                    class="block text-sm font-medium text-gray-900 dark:text-gray-100"
                                    >Launch Gates approved</span
                                >
                                <span class="block text-xs text-gray-500"
                                    >Passed testnet soak criteria and approved
                                    for mainnet exposure percentage.</span
                                >
                            </div>
                        </label>
                    </div>

                    <div class="mt-6">
                        <button
                            type="button"
                            class="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                            onclick={saveConfig}
                            disabled={saving}
                        >
                            {saving ? "Saving..." : "Save Configuration"}
                        </button>
                    </div>
                </div>
            </div>

            <!-- Side Panel Diagnostics -->
            <div class="space-y-6">
                <!-- Status Badge -->
                <div class="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
                    <h3
                        class="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide"
                    >
                        Status
                    </h3>
                    <div class="mt-2 flex items-center">
                        {#if isProductionReady}
                            <span
                                class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                            >
                                Production Ready
                            </span>
                        {:else if config.architecture === "mock"}
                            <span
                                class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                            >
                                Development (Mock)
                            </span>
                        {:else}
                            <span
                                class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                            >
                                Needs Configuration
                            </span>
                        {/if}
                    </div>
                </div>

                <!-- Backend Diagnostics -->
                <div class="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
                    <h3
                        class="text-lg font-medium text-gray-900 dark:text-white mb-4"
                    >
                        Diagnostics
                    </h3>
                    <ul class="space-y-3">
                        <li class="flex items-center justify-between">
                            <span
                                class="text-sm text-gray-600 dark:text-gray-300"
                                >Webhook Registered</span
                            >
                            {#if config.diagnostics.webhookConfigured}
                                <span class="text-green-500">✅</span>
                            {:else}
                                <span class="text-red-500">❌</span>
                            {/if}
                        </li>
                        {#if config.architecture === "lnbits"}
                            <li class="flex items-center justify-between">
                                <span
                                    class="text-sm text-gray-600 dark:text-gray-300"
                                    >LNbits URL ENV</span
                                >
                                {#if config.diagnostics.hasLnbitsUrl}
                                    <span class="text-green-500">✅</span>
                                {:else}
                                    <span class="text-red-500">❌</span>
                                {/if}
                            </li>
                            <li class="flex items-center justify-between">
                                <span
                                    class="text-sm text-gray-600 dark:text-gray-300"
                                    >LNbits Key ENV</span
                                >
                                {#if config.diagnostics.hasLnbitsKey}
                                    <span class="text-green-500">✅</span>
                                {:else}
                                    <span class="text-red-500">❌</span>
                                {/if}
                            </li>
                        {/if}
                        {#if config.architecture === "lnd"}
                            <li class="flex items-center justify-between">
                                <span
                                    class="text-sm text-gray-600 dark:text-gray-300"
                                    >LND Macaroon ENV</span
                                >
                                {#if config.diagnostics.hasLndMacaroon}
                                    <span class="text-green-500">✅</span>
                                {:else}
                                    <span class="text-red-500">❌</span>
                                {/if}
                            </li>
                        {/if}
                    </ul>
                </div>
            </div>
        </div>
    {/if}
</div>
