<script lang="ts">
    import type { Scenario, StepResult } from "$lib/types/sandbox";
    import { Check, Circle, Loader2 } from "lucide-svelte";

    let {
        scenario,
        currentIndex,
        results,
    }: {
        scenario: Scenario;
        currentIndex: number;
        results: Map<number, StepResult>;
    } = $props();
</script>

<div class="flex flex-col space-y-4">
    <h3 class="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-2">
        Scenario Progress
    </h3>

    <div
        class="relative border-l border-slate-200 dark:border-slate-800 ml-3 space-y-6"
    >
        {#each scenario.steps as step, i}
            {@const isPast = i < currentIndex}
            {@const isCurrent = i === currentIndex}
            {@const isFuture = i > currentIndex}
            {@const result = results.get(i)}

            <div class="relative pl-6">
                <!-- Icon marker -->
                <div class="absolute -left-3 top-0">
                    {#if isPast}
                        <div
                            class="bg-indigo-500 rounded-full text-white p-1 ring-4 ring-white dark:ring-slate-900"
                        >
                            <Check class="w-3.5 h-3.5" strokeWidth={3} />
                        </div>
                    {:else if isCurrent}
                        <div
                            class="bg-white dark:bg-slate-900 rounded-full text-indigo-500 p-0.5 ring-4 ring-white dark:ring-slate-900 border-2 border-indigo-500 animate-pulse"
                        >
                            <Circle
                                class="w-4 h-4 fill-indigo-100 dark:fill-indigo-900"
                            />
                        </div>
                    {:else}
                        <div
                            class="bg-white dark:bg-slate-900 rounded-full text-slate-300 dark:text-slate-700 p-0.5 ring-4 ring-white dark:ring-slate-900 border-2 border-slate-200 dark:border-slate-800"
                        >
                            <Circle class="w-4 h-4" />
                        </div>
                    {/if}
                </div>

                <!-- Content -->
                <div class={isFuture ? "opacity-50" : ""}>
                    <h4
                        class="text-sm font-medium {isCurrent
                            ? 'text-indigo-600 dark:text-indigo-400'
                            : 'text-slate-700 dark:text-slate-300'}"
                    >
                        {step.title}
                    </h4>

                    {#if !step.narrativeOnly}
                        <div
                            class="mt-1 flex items-center gap-2 text-xs font-mono"
                        >
                            <span
                                class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                            >
                                {step.method}
                            </span>
                            <span
                                class="text-slate-500 truncate max-w-[200px]"
                                title={step.endpoint}
                            >
                                {step.endpoint}
                            </span>
                        </div>
                    {/if}

                    {#if result}
                        <div class="mt-2 text-xs flex items-center gap-2">
                            <span
                                class="{result.status >= 200 &&
                                result.status < 300
                                    ? 'text-green-600 dark:text-green-500'
                                    : 'text-red-500'} font-medium"
                            >
                                {result.status}
                            </span>
                            <span class="text-slate-400">
                                {result.elapsed.toFixed(0)}ms
                            </span>
                        </div>
                    {/if}
                </div>
            </div>
        {/each}

        {#if currentIndex >= scenario.steps.length}
            <div class="relative pl-6">
                <div class="absolute -left-3 top-0">
                    <div
                        class="bg-green-500 rounded-full text-white p-1 ring-4 ring-white dark:ring-slate-900"
                    >
                        <Check class="w-3.5 h-3.5" strokeWidth={3} />
                    </div>
                </div>
                <div>
                    <h4
                        class="text-sm font-medium text-green-600 dark:text-green-500"
                    >
                        Scenario Complete
                    </h4>
                    <p class="text-xs text-slate-500 mt-1">
                        All steps successfully verified
                    </p>
                </div>
            </div>
        {/if}
    </div>
</div>
