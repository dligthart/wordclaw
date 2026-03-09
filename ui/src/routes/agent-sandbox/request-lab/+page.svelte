<script lang="ts">
    import SandboxWorkspace from "$lib/components/sandbox/SandboxWorkspace.svelte";
</script>

<svelte:head>
    <title>Request Lab | Agent Sandbox</title>
</svelte:head>

<div class="space-y-4">
    <div class="space-y-2">
        <h2 class="text-xl font-semibold text-slate-900 dark:text-white">
            Request Lab
        </h2>
        <p class="text-sm leading-6 text-slate-500 dark:text-slate-400">
            Use templates for common requests, then inspect or edit the method, endpoint, headers,
            and payload before sending the call.
        </p>
    </div>

    <SandboxWorkspace view="advanced" />
</div>
