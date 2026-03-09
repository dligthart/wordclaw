<script lang="ts">
    import { fetchApi, ApiError } from "$lib/api";
    import { onMount } from "svelte";
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import Badge from "$lib/components/ui/Badge.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Input from "$lib/components/ui/Input.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import Surface from "$lib/components/ui/Surface.svelte";

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
            webhookConfigured: false,
        },
    });

    async function loadConfig() {
        loading = true;
        error = null;
        try {
            const data = await fetchApi("/supervisors/l402-readiness");
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
            await fetchApi("/supervisors/l402-readiness", {
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

    const architectureOptions = [
        { value: "mock", label: "Mock (Development Only)" },
        { value: "lnbits", label: "LNbits Gateway" },
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
                config.diagnostics.hasLnbitsKey),
    );

    let isProductionReady = $derived(
        allChecked &&
            isArchReady &&
            config.architecture !== "mock" &&
            config.diagnostics.webhookConfigured,
    );
</script>

<svelte:head>
    <title>L402 Payment Readiness | WordClaw Supervisor</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-6xl flex-col gap-6">
    <div>
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            L402 Payment Readiness
        </h1>
        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Configure payment infrastructure and track operator readiness for
            WordClaw&apos;s core L402 and entitlement flows.
        </p>
    </div>

    {#if loading}
        <LoadingSpinner />
    {:else}
        {#if error}
            <ErrorBanner message={error.message || JSON.stringify(error)} />
        {/if}

        <div class="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.8fr)_320px]">
            <div class="space-y-6">
                <Surface class="space-y-5">
                    <div class="flex items-start justify-between gap-4">
                        <div>
                            <h2 class="text-lg font-semibold text-slate-900 dark:text-white">
                                Architecture Configuration
                            </h2>
                            <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                Select the supported provider and record the
                                public callback details operators will maintain.
                            </p>
                        </div>
                        <Badge
                            variant={config.architecture === "mock"
                                ? "info"
                                : "outline"}
                        >
                            {config.architecture === "mock" ? "Mock mode" : "LNbits"}
                        </Badge>
                    </div>

                    <div class="grid gap-5 md:grid-cols-2">
                        <div class="md:col-span-2">
                            <label
                                class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                for="arch">Provider</label
                            >
                            <Select id="arch" bind:value={config.architecture}>
                                {#each architectureOptions as opt}
                                    <option value={opt.value}>{opt.label}</option>
                                {/each}
                            </Select>
                        </div>

                        <div class="md:col-span-2">
                            <label
                                class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                for="webhook">Webhook Endpoint (Public)</label
                            >
                            <Input
                                id="webhook"
                                type="text"
                                placeholder="https://api.yourdomain.com/api/payments/webhooks/lnbits"
                                bind:value={config.webhookEndpoint}
                            />
                            <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                Provider settlement callbacks are routed here.
                            </p>
                        </div>

                        <div class="md:col-span-2">
                            <label
                                class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                for="secret-path">Secret Manager Path</label
                            >
                            <Input
                                id="secret-path"
                                type="text"
                                placeholder="projects/123/secrets/lnbits-key"
                                bind:value={config.secretManagerPath}
                            />
                            <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                Informational reference when provider secrets are
                                stored in an external vault.
                            </p>
                        </div>
                    </div>
                </Surface>

                <Surface class="space-y-5">
                    <div>
                        <h2 class="text-lg font-semibold text-slate-900 dark:text-white">
                            Operator Checklist
                        </h2>
                        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            Mark the non-code operational gates that must be in place
                            before moving beyond development mode.
                        </p>
                    </div>

                    <div class="space-y-3">
                        <label
                            class="flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 px-4 py-3 transition-colors hover:bg-slate-100/70 dark:border-slate-700 dark:bg-slate-900/30 dark:hover:bg-slate-900/50"
                        >
                            <input
                                type="checkbox"
                                class="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400 dark:border-slate-600 dark:bg-slate-950"
                                bind:checked={config.checklistApprovals.fundedWallet}
                            />
                            <div>
                                <span class="block text-sm font-medium text-slate-900 dark:text-slate-100">
                                    Funded Wallet & Liquidity
                                </span>
                                <span class="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                                    Treasury wallet funded with startup sats and inbound
                                    liquidity channels established.
                                </span>
                            </div>
                        </label>

                        <label
                            class="flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 px-4 py-3 transition-colors hover:bg-slate-100/70 dark:border-slate-700 dark:bg-slate-900/30 dark:hover:bg-slate-900/50"
                        >
                            <input
                                type="checkbox"
                                class="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400 dark:border-slate-600 dark:bg-slate-950"
                                bind:checked={config.checklistApprovals.dnsTlsActive}
                            />
                            <div>
                                <span class="block text-sm font-medium text-slate-900 dark:text-slate-100">
                                    DNS & TLS Configured
                                </span>
                                <span class="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                                    Public DNS route points to the webhook endpoint and TLS
                                    certificates are valid and auto-renewing.
                                </span>
                            </div>
                        </label>

                        <label
                            class="flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 px-4 py-3 transition-colors hover:bg-slate-100/70 dark:border-slate-700 dark:bg-slate-900/30 dark:hover:bg-slate-900/50"
                        >
                            <input
                                type="checkbox"
                                class="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400 dark:border-slate-600 dark:bg-slate-950"
                                bind:checked={config.checklistApprovals.custodyCompliance}
                            />
                            <div>
                                <span class="block text-sm font-medium text-slate-900 dark:text-slate-100">
                                    Custody & Compliance Approved
                                </span>
                                <span class="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                                    Tax treatment policy and wallet custody responsibilities
                                    are finalized.
                                </span>
                            </div>
                        </label>

                        <label
                            class="flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 px-4 py-3 transition-colors hover:bg-slate-100/70 dark:border-slate-700 dark:bg-slate-900/30 dark:hover:bg-slate-900/50"
                        >
                            <input
                                type="checkbox"
                                class="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400 dark:border-slate-600 dark:bg-slate-950"
                                bind:checked={config.checklistApprovals.testnetMainnetGates}
                            />
                            <div>
                                <span class="block text-sm font-medium text-slate-900 dark:text-slate-100">
                                    Launch Gates Approved
                                </span>
                                <span class="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                                    Testnet soak and rollout criteria are complete for the
                                    configured provider path.
                                </span>
                            </div>
                        </label>
                    </div>

                    <div class="flex justify-end">
                        <Button onclick={saveConfig} disabled={saving}>
                            {saving ? "Saving..." : "Save Configuration"}
                        </Button>
                    </div>
                </Surface>
            </div>

            <div class="space-y-6">
                <Surface tone="muted" class="space-y-4">
                    <h3
                        class="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400"
                    >
                        Status
                    </h3>
                    <div class="flex flex-wrap gap-2">
                        {#if isProductionReady}
                            <Badge variant="success">Production Ready</Badge>
                        {:else if config.architecture === "mock"}
                            <Badge variant="info">Development (Mock)</Badge>
                        {:else}
                            <Badge variant="warning">Needs Configuration</Badge>
                        {/if}
                        {#if allChecked}
                            <Badge variant="outline">Checklist complete</Badge>
                        {/if}
                    </div>
                    <p class="text-sm leading-6 text-slate-600 dark:text-slate-300">
                        {#if isProductionReady}
                            The current configuration and operator checklist indicate
                            readiness for production payment flows.
                        {:else if config.architecture === "mock"}
                            The system is intentionally running in development mode.
                            Switch to LNbits and complete the checklist before launch.
                        {:else}
                            Provider wiring exists, but one or more operational gates
                            are still incomplete.
                        {/if}
                    </p>
                </Surface>

                <Surface tone="muted" class="space-y-4">
                    <div>
                        <h3 class="text-base font-semibold text-slate-900 dark:text-white">
                            Diagnostics
                        </h3>
                        <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            Runtime signals from the currently selected provider path.
                        </p>
                    </div>

                    <dl class="space-y-3 text-sm">
                        <div class="flex items-center justify-between gap-4">
                            <dt class="text-slate-600 dark:text-slate-300">
                                Webhook Registered
                            </dt>
                            <dd>
                                <Badge
                                    variant={config.diagnostics.webhookConfigured
                                        ? "success"
                                        : "danger"}
                                >
                                    {config.diagnostics.webhookConfigured
                                        ? "Configured"
                                        : "Missing"}
                                </Badge>
                            </dd>
                        </div>

                        {#if config.architecture === "lnbits"}
                            <div class="flex items-center justify-between gap-4">
                                <dt class="text-slate-600 dark:text-slate-300">
                                    LNBITS_BASE_URL
                                </dt>
                                <dd>
                                    <Badge
                                        variant={config.diagnostics.hasLnbitsUrl
                                            ? "success"
                                            : "danger"}
                                    >
                                        {config.diagnostics.hasLnbitsUrl
                                            ? "Present"
                                            : "Missing"}
                                    </Badge>
                                </dd>
                            </div>
                            <div class="flex items-center justify-between gap-4">
                                <dt class="text-slate-600 dark:text-slate-300">
                                    LNBITS_ADMIN_KEY
                                </dt>
                                <dd>
                                    <Badge
                                        variant={config.diagnostics.hasLnbitsKey
                                            ? "success"
                                            : "danger"}
                                    >
                                        {config.diagnostics.hasLnbitsKey
                                            ? "Present"
                                            : "Missing"}
                                    </Badge>
                                </dd>
                            </div>
                        {/if}
                    </dl>
                </Surface>
            </div>
        </div>
    {/if}
</div>
