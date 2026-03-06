<script lang="ts">
    import type { Scenario } from "$lib/types/sandbox";
    import { ChevronRight, PlayCircle } from "lucide-svelte";

    let {
        scenarios,
        activeScenarioId,
        onSelect,
    }: {
        scenarios: Scenario[];
        activeScenarioId: string | null;
        onSelect: (s: Scenario) => void;
    } = $props();

    const TRACK_META = {
        core: {
            title: "Core Runtime",
            description:
                "Focused walkthroughs for content, validation, workflow, and supported agent surfaces.",
        },
        l402: {
            title: "L402",
            description:
                "Paid-content flows that remain part of the focused product story.",
        },
    } as const;

    function groupScenariosByDifferentiator(list: Scenario[]) {
        const groups = new Map<string, Scenario[]>();
        for (const scenario of list) {
            if (!groups.has(scenario.differentiator)) {
                groups.set(scenario.differentiator, []);
            }
            groups.get(scenario.differentiator)!.push(scenario);
        }
        return Array.from(groups.entries());
    }

    let activeScenarioGroups = $derived.by(() =>
        (Object.entries(TRACK_META) as Array<
            [keyof typeof TRACK_META, (typeof TRACK_META)[keyof typeof TRACK_META]]
        >)
            .map(([track, meta]) => ({
                track,
                ...meta,
                groups: groupScenariosByDifferentiator(
                    scenarios.filter((scenario) => scenario.track === track),
                ),
            }))
            .filter((section) => section.groups.length > 0),
    );

    let archivedScenarioGroups = $derived.by(() =>
        groupScenariosByDifferentiator(
            scenarios.filter((scenario) => scenario.track === "archived"),
        ),
    );

    let archivedHasActiveScenario = $derived.by(() =>
        scenarios.some(
            (scenario) =>
                scenario.track === "archived" &&
                scenario.id === activeScenarioId,
        ),
    );

    function scenarioButtonClass(isActive: boolean): string {
        return `w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
            isActive
                ? "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20"
                : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950/40 dark:hover:bg-slate-900"
        }`;
    }

    function scenarioTitleClass(isActive: boolean): string {
        return isActive
            ? "text-blue-700 dark:text-blue-300"
            : "text-slate-800 dark:text-slate-100";
    }

    function scenarioTaglineClass(isActive: boolean): string {
        return isActive
            ? "text-blue-700/80 dark:text-blue-300/80"
            : "text-slate-500 dark:text-slate-400";
    }
</script>

<div
    class="flex h-full w-full shrink-0 flex-col overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/50 lg:w-72"
>
    <div class="border-b border-slate-200 p-4 dark:border-slate-800">
        <h2
            class="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200"
        >
            <PlayCircle class="h-4 w-4 text-indigo-500" />
            Guided Scenarios
        </h2>
        <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Active walkthroughs are limited to core runtime and L402 use cases.
        </p>
    </div>

    <div class="space-y-5 p-3">
        {#each activeScenarioGroups as section}
            <section class="space-y-3">
                <div class="px-2">
                    <h3
                        class="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400"
                    >
                        {section.title}
                    </h3>
                    <p class="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                        {section.description}
                    </p>
                </div>

                <div class="space-y-3">
                    {#each section.groups as [groupName, groupScenarios]}
                        <div class="space-y-1.5">
                            {#if section.groups.length > 1}
                                <p
                                    class="px-2 text-[0.68rem] font-medium uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500"
                                >
                                    {groupName}
                                </p>
                            {/if}

                            {#each groupScenarios as scenario}
                                {@const isActive = activeScenarioId === scenario.id}
                                <button
                                    onclick={() => onSelect(scenario)}
                                    aria-pressed={isActive}
                                    class={scenarioButtonClass(isActive)}
                                >
                                    <div
                                        class="flex items-center justify-between gap-3"
                                    >
                                        <span
                                            class={`text-sm font-medium ${scenarioTitleClass(
                                                isActive,
                                            )}`}
                                        >
                                            {scenario.title}
                                        </span>
                                        {#if isActive}
                                            <ChevronRight
                                                class="h-3.5 w-3.5 text-blue-500"
                                            />
                                        {/if}
                                    </div>
                                    <p
                                        class={`mt-1 text-xs leading-5 ${scenarioTaglineClass(
                                            isActive,
                                        )}`}
                                    >
                                        {scenario.tagline}
                                    </p>
                                </button>
                            {/each}
                        </div>
                    {/each}
                </div>
            </section>
        {/each}

        {#if archivedScenarioGroups.length > 0}
            <details
                class="rounded-lg border border-slate-200 bg-white/70 dark:border-slate-800 dark:bg-slate-950/30"
                open={archivedHasActiveScenario}
            >
                <summary
                    class="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200"
                >
                    Archived Demos
                </summary>
                <div class="space-y-3 border-t border-slate-200 px-3 py-3 dark:border-slate-800">
                    <p class="px-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                        Historical and non-core walkthroughs kept for reference.
                    </p>
                    {#each archivedScenarioGroups as [groupName, groupScenarios]}
                        <div class="space-y-1.5">
                            <p
                                class="px-1 text-[0.68rem] font-medium uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500"
                            >
                                {groupName}
                            </p>
                            {#each groupScenarios as scenario}
                                {@const isActive = activeScenarioId === scenario.id}
                                <button
                                    onclick={() => onSelect(scenario)}
                                    aria-pressed={isActive}
                                    class={scenarioButtonClass(isActive)}
                                >
                                    <div
                                        class="flex items-center justify-between gap-3"
                                    >
                                        <span
                                            class={`text-sm font-medium ${scenarioTitleClass(
                                                isActive,
                                            )}`}
                                        >
                                            {scenario.title}
                                        </span>
                                        {#if isActive}
                                            <ChevronRight
                                                class="h-3.5 w-3.5 text-blue-500"
                                            />
                                        {/if}
                                    </div>
                                    <p
                                        class={`mt-1 text-xs leading-5 ${scenarioTaglineClass(
                                            isActive,
                                        )}`}
                                    >
                                        {scenario.tagline}
                                    </p>
                                    {#if scenario.archiveReason}
                                        <p class="mt-2 text-[0.7rem] leading-5 text-slate-500 dark:text-slate-400">
                                            {scenario.archiveReason}
                                        </p>
                                    {/if}
                                </button>
                            {/each}
                        </div>
                    {/each}
                </div>
            </details>
        {/if}
    </div>
</div>
