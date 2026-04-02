<script lang="ts">
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";
    import { fetchApi } from "$lib/api";
    import DataTable from "$lib/components/DataTable.svelte";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import Badge from "$lib/components/ui/Badge.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Surface from "$lib/components/ui/Surface.svelte";
    import { Icon, ArrowPath, Plus } from "svelte-hero-icons";

    import type { FormDefinition } from "./formTypes";
    import { formatDate, formatRelativeDate, formVisibilityBadges } from "./formHelpers";

    const formColumns = [
        { key: "name", label: "Form" },
        { key: "target", label: "Target" },
        { key: "status", label: "Visibility" },
        { key: "updatedAt", label: "Updated" },
    ];

    let forms = $state<FormDefinition[]>([]);
    let loading = $state(true);
    let error = $state<unknown>(null);

    onMount(() => {
        void loadForms();
    });

    async function loadForms() {
        loading = true;
        error = null;

        try {
            const response = await fetchApi("/forms");
            forms = (response.data as FormDefinition[]) ?? [];
        } catch (err) {
            error = err;
        } finally {
            loading = false;
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
            <Button variant="outline" onclick={() => void loadForms()}>
                <Icon src={ArrowPath} class="h-4 w-4" />
                Refresh
            </Button>
            <Button onclick={() => void goto("/ui/forms/new")}>
                <Icon src={Plus} class="h-4 w-4" />
                New form
            </Button>
        </div>
    </div>

    {#if error}
        <ErrorBanner
            {error}
            title="Forms workspace unavailable"
            actionLabel="Retry"
            onAction={() => void loadForms()}
        />
    {/if}

    {#if loading}
        <div class="flex min-h-[18rem] items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white/70 dark:border-slate-700 dark:bg-slate-900/30">
            <LoadingSpinner size="lg" />
        </div>
    {:else}
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
                onRowClick={(row) => void goto(`/ui/forms/${row.id}`)}
            >
                {#snippet cell({ row, column })}
                    {@const form = row as FormDefinition}
                    {#if column.key === "name"}
                        <div class="min-w-0 space-y-1">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="truncate font-semibold text-slate-900 dark:text-white">
                                    {form.name}
                                </span>
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
    {/if}
</div>
