<script lang="ts">
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";
    import Surface from "$lib/components/ui/Surface.svelte";

    onMount(() => {
        const url = new URL(window.location.href);
        if (url.searchParams.has("scenario") || url.searchParams.has("step")) {
            void goto(`/ui/agent-sandbox/scenarios${url.search}`, {
                replaceState: true,
            });
        }
    });
</script>

<svelte:head>
    <title>Agent Sandbox Overview | WordClaw Supervisor</title>
</svelte:head>

<div class="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
    <Surface class="space-y-5">
        <div class="space-y-2">
            <h2 class="text-xl font-semibold text-slate-900 dark:text-white">
                Choose a starting point
            </h2>
            <p class="text-sm leading-6 text-slate-500 dark:text-slate-400">
                The sandbox is no longer one giant page. Pick the mode that matches what you are
                trying to do.
            </p>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
            <a
                href="/ui/agent-sandbox/scenarios"
                class="rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950/50 dark:hover:bg-slate-900"
            >
                <p class="text-sm font-semibold text-slate-900 dark:text-white">
                    Guided Scenarios
                </p>
                <p class="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                    Follow curated walkthroughs for content lifecycle, validation, editorial review,
                    and L402. Best when you want the system to explain each next step.
                </p>
            </a>

            <a
                href="/ui/agent-sandbox/request-lab"
                class="rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950/50 dark:hover:bg-slate-900"
            >
                <p class="text-sm font-semibold text-slate-900 dark:text-white">
                    Request Lab
                </p>
                <p class="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                    Start from templates or write one-off REST requests manually. Best when you are
                    debugging payloads, response contracts, or auth context.
                </p>
            </a>
        </div>
    </Surface>

    <Surface tone="muted" class="space-y-4">
        <div>
            <h2 class="text-base font-semibold text-slate-900 dark:text-white">
                How to use it
            </h2>
            <p class="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                The sandbox is meant to explain the system, not expose every internal switch at once.
            </p>
        </div>

        <ol class="space-y-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            <li>1. Start in Guided Scenarios if you are new to the product flow.</li>
            <li>2. Use Request Lab once you know which endpoint or payload you want to inspect.</li>
            <li>3. Refresh IDs whenever the demo data has changed underneath you.</li>
        </ol>
    </Surface>
</div>
