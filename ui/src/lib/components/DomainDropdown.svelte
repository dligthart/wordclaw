<script lang="ts">
    type DomainOption = {
        id: string;
        label: string;
    };

    let {
        currentDomain,
        onSelect,
        options = [] as DomainOption[],
    }: {
        currentDomain: string;
        onSelect: (domainId: string) => void | Promise<void>;
        options?: DomainOption[];
    } = $props();

    let pending = $state(false);

    async function handleChange(event: Event) {
        const nextDomain = (event.currentTarget as HTMLSelectElement).value;
        if (!nextDomain || nextDomain === currentDomain) return;

        pending = true;
        try {
            await onSelect(nextDomain);
        } finally {
            pending = false;
        }
    }
</script>

<div class="flex items-center gap-2">
    <span class="hidden text-[0.7rem] font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400 lg:block">
        Domain
    </span>
    <div class="relative min-w-[11rem]">
        <select
            value={currentDomain}
            onchange={handleChange}
            disabled={pending || options.length === 0}
            aria-label="Select domain"
            class="h-9 w-full appearance-none rounded-md border border-slate-200 bg-white px-3 pr-9 text-sm font-medium text-slate-700 shadow-sm transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:cursor-wait disabled:opacity-70 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-100 dark:focus:border-slate-500 dark:focus:ring-slate-800 [appearance:none] [-webkit-appearance:none] [-moz-appearance:none] [background-image:none]"
        >
            {#if options.length === 0}
                <option value={currentDomain} disabled>Loading domains...</option>
            {:else}
                {#each options as option (option.id)}
                    <option value={option.id}>{option.label}</option>
                {/each}
            {/if}
        </select>
        <div class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400 dark:text-slate-500">
            <svg
                class="h-4 w-4"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <path d="m5 7 5 5 5-5"></path>
            </svg>
        </div>
    </div>
</div>
