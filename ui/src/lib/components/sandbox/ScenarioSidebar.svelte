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

    // Group scenarios by differentiator
    let groupedScenarios = $derived.by(() => {
        const groups = new Map<string, Scenario[]>();
        for (const s of scenarios) {
            if (!groups.has(s.differentiator)) {
                groups.set(s.differentiator, []);
            }
            groups.get(s.differentiator)!.push(s);
        }
        return Array.from(groups.entries());
    });
</script>

<div
    class="flex flex-col h-full bg-slate-50/50 dark:bg-slate-900/50 border-r border-slate-200 dark:border-slate-800 overflow-y-auto w-64 shrink-0"
>
    <div class="p-4 border-b border-slate-200 dark:border-slate-800">
        <h2
            class="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2"
        >
            <PlayCircle class="w-4 h-4 text-indigo-500" />
            Guided Scenarios
        </h2>
        <p class="text-xs text-slate-500 mt-1">
            Interactive walkthroughs of WordClaw features
        </p>
    </div>

    <div class="p-3 space-y-6">
        {#each groupedScenarios as [groupName, groupScenarios]}
            <div>
                <h3
                    class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 px-2"
                >
                    {groupName}
                </h3>
                <div class="space-y-1">
                    {#each groupScenarios as scenario}
                        {@const isActive = activeScenarioId === scenario.id}
                        <button
                            onclick={() => onSelect(scenario)}
                            class="w-full text-left px-3 py-2 rounded-md transition-colors text-sm flex flex-col gap-1 border {isActive
                                ? 'bg-indigo-50 border-indigo-200 dark:bg-indigo-900/20 dark:border-indigo-800'
                                : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800'}"
                        >
                            <div
                                class="flex items-center justify-between w-full"
                            >
                                <span
                                    class="font-medium {isActive
                                        ? 'text-indigo-700 dark:text-indigo-300'
                                        : 'text-slate-700 dark:text-slate-300'}"
                                >
                                    {scenario.title}
                                </span>
                                {#if isActive}
                                    <ChevronRight
                                        class="w-3.5 h-3.5 text-indigo-500"
                                    />
                                {/if}
                            </div>
                            <span
                                class="text-[11px] leading-tight {isActive
                                    ? 'text-indigo-600/70 dark:text-indigo-400/70'
                                    : 'text-slate-500'}"
                            >
                                {scenario.tagline}
                            </span>
                        </button>
                    {/each}
                </div>
            </div>
        {/each}
    </div>
</div>
