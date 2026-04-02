<script lang="ts">
    import { page } from "$app/state";
    import FormEditor from "../FormEditor.svelte";

    let formId = $derived(Number.parseInt(page.params.id ?? "", 10));
</script>

<svelte:head>
    <title>Edit Form | WordClaw UI</title>
</svelte:head>

{#key formId}
    <FormEditor {formId} />
{/key}
