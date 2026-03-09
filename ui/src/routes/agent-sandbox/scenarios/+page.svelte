<script lang="ts">
    import SandboxWorkspace from "$lib/components/sandbox/SandboxWorkspace.svelte";
</script>

<svelte:head>
    <title>Guided Scenarios | Agent Sandbox</title>
</svelte:head>

<div class="space-y-4">
    <div class="space-y-2">
        <h2 class="text-xl font-semibold text-slate-900 dark:text-white">
            Guided Scenarios
        </h2>
        <p class="text-sm leading-6 text-slate-500 dark:text-slate-400">
            Pick a scenario on the left, then execute one step at a time. The right side shows
            progress and the most recent response so you always know where you are in the flow.
        </p>
    </div>

    <SandboxWorkspace view="guided" />
</div>
