<script lang="ts">
    import type { Scenario, StepResult } from "$lib/types/sandbox";
    import { Check, Circle } from "lucide-svelte";

    let {
        scenario,
        currentIndex,
        results,
    }: {
        scenario: Scenario;
        currentIndex: number;
        results: Map<number, StepResult>;
    } = $props();

    let stepRefs: Array<HTMLDivElement | null> = [];

    function resolveProtocolLabel(step: Scenario["steps"][number]): string {
        if (step.protocol) return step.protocol;
        if (step.endpoint === "/api/graphql") return "GRAPHQL";
        return "REST";
    }

    function activeStepIndex(): number {
        return currentIndex >= scenario.steps.length
            ? Math.max(scenario.steps.length - 1, 0)
            : currentIndex;
    }

    $effect(() => {
        const target = stepRefs[activeStepIndex()];
        if (!target) {
            return;
        }

        target.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
            inline: "center",
        });
    });
</script>

<div class="flex flex-col gap-4">
    <h3 class="mb-1 text-sm font-semibold text-slate-800 dark:text-slate-200">
        Scenario Progress
    </h3>

    <div class="overflow-x-auto pb-2">
        <div class="flex min-w-full snap-x snap-mandatory items-stretch gap-3">
        {#each scenario.steps as step, i}
            {@const isPast = i < currentIndex}
            {@const isCurrent = i === currentIndex}
            {@const isFuture = i > currentIndex}
            {@const result = results.get(i)}

            <div
                bind:this={stepRefs[i]}
                class={`min-w-[18rem] max-w-[18rem] snap-center rounded-2xl border p-4 transition-colors ${
                    isCurrent
                        ? "border-indigo-500 bg-indigo-50/80 dark:border-indigo-400 dark:bg-indigo-950/30"
                        : isPast
                          ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20"
                          : "border-slate-200 bg-white/80 dark:border-slate-700 dark:bg-slate-950/30"
                } ${isFuture ? "opacity-70" : ""}`}
            >
                <div class="flex items-start justify-between gap-3">
                    <div class="flex items-center gap-3">
                        {#if isPast}
                            <div
                                class="rounded-full bg-indigo-500 p-1 text-white"
                            >
                                <Check class="h-3.5 w-3.5" strokeWidth={3} />
                            </div>
                        {:else if isCurrent}
                            <div
                                class="rounded-full border-2 border-indigo-500 bg-white p-0.5 text-indigo-500 dark:bg-slate-900"
                            >
                                <Circle
                                    class="h-4 w-4 fill-indigo-100 dark:fill-indigo-900"
                                />
                            </div>
                        {:else}
                            <div
                                class="rounded-full border-2 border-slate-200 bg-white p-0.5 text-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-600"
                            >
                                <Circle class="h-4 w-4" />
                            </div>
                        {/if}

                        <span class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                            {i + 1}
                        </span>
                    </div>

                    {#if result}
                        <span
                            class={`text-xs font-medium ${
                                result.status >= 200 && result.status < 300
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-rose-500"
                            }`}
                        >
                            {result.status}
                        </span>
                    {/if}
                </div>

                <div class="mt-4">
                    <h4
                        class={`text-sm font-medium ${
                            isCurrent
                                ? "text-indigo-700 dark:text-indigo-300"
                                : "text-slate-800 dark:text-slate-200"
                        }`}
                    >
                        {step.title}
                    </h4>

                    <div class="mt-3 flex flex-wrap items-center gap-2 text-xs font-mono">
                        {#if step.narrativeOnly}
                            <span
                                class="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-200 border border-amber-200 dark:border-amber-800"
                            >
                                Info Only
                            </span>
                        {:else}
                            <span
                                class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                            >
                                {resolveProtocolLabel(step)}
                            </span>
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
                        {/if}
                    </div>

                    {#if result}
                        <div class="mt-3 flex items-center gap-2 text-xs">
                            <span class="text-slate-400">
                                {result.elapsed.toFixed(1)}ms
                            </span>
                        </div>
                    {/if}
                </div>
            </div>
        {/each}

        {#if currentIndex >= scenario.steps.length}
            <div
                class="min-w-[18rem] max-w-[18rem] snap-center rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20"
            >
                <div class="flex items-start justify-between gap-3">
                    <div class="rounded-full bg-green-500 p-1 text-white">
                        <Check class="w-3.5 h-3.5" strokeWidth={3} />
                    </div>
                    <span class="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                        Complete
                    </span>
                </div>
                <div class="mt-4">
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
</div>
