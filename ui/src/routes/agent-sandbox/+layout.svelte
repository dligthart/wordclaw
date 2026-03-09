<script lang="ts">
    import { page } from "$app/stores";
    import Badge from "$lib/components/ui/Badge.svelte";

    let { children } = $props();

    const navItems = [
        { href: "/ui/agent-sandbox/scenarios", label: "Guided Scenarios" },
        { href: "/ui/agent-sandbox/request-lab", label: "Request Lab" },
    ];

    function navLinkClass(active: boolean) {
        return active
            ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950"
            : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white";
    }
</script>

<div class="mx-auto flex max-w-7xl flex-col gap-6">
    <div class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center gap-2">
            <Badge variant="warning">Experimental</Badge>
            <Badge variant="outline">Split into simpler pages</Badge>
        </div>

        <div class="space-y-2">
            <h1 class="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
                Agent Sandbox
            </h1>
            <p class="max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                Use the sandbox in two human-facing modes: guided walkthroughs when you want a
                step-by-step demo, and request lab when you want to explore calls manually. The
                old single-page lab is intentionally broken apart here.
            </p>
        </div>

        <nav class="flex flex-wrap gap-2">
            {#each navItems as item}
                {@const isActive = $page.url.pathname === item.href}
                <a
                    href={item.href}
                    class={`inline-flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${navLinkClass(isActive)}`}
                >
                    {item.label}
                </a>
            {/each}
        </nav>
    </div>

    <div>
        {@render children()}
    </div>
</div>
