<script lang="ts">
    import Badge from "$lib/components/ui/Badge.svelte";
    import {
        actorVariant,
        resolveActorIdentity,
        type ActorIdentityLike,
    } from "$lib/actors";

    let {
        actorId = null,
        actorType = null,
        actorSource = null,
        legacyUserId = null,
        fallback = "System / unauthenticated",
        compact = false,
        showSource = true,
        class: className = "",
    }: ActorIdentityLike & {
        fallback?: string;
        compact?: boolean;
        showSource?: boolean;
        class?: string;
    } = $props();

    const display = $derived(
        resolveActorIdentity(
            { actorId, actorType, actorSource, legacyUserId },
            fallback,
        ),
    );
</script>

<div class={`min-w-0 ${compact ? "flex flex-wrap items-center gap-2" : "space-y-1"} ${className}`}>
    {#if display.actorId}
        <span
            class={`block min-w-0 truncate font-mono text-[0.72rem] ${display.isLegacyFallback ? "text-slate-500 dark:text-slate-400" : "text-slate-800 dark:text-slate-100"}`}
            title={display.actorId}
        >
            {display.actorId}
        </span>
    {:else}
        <span class="block text-sm italic text-slate-400 dark:text-slate-500">
            {display.fallbackLabel}
        </span>
    {/if}

    {#if display.actorTypeLabel || (showSource && display.actorSourceLabel)}
        <div class="flex flex-wrap items-center gap-1.5">
            {#if display.actorTypeLabel}
                <Badge variant={actorVariant(display.actorType)}>
                    {display.actorTypeLabel}
                </Badge>
            {/if}
            {#if showSource && display.actorSourceLabel}
                <Badge variant="outline">{display.actorSourceLabel}</Badge>
            {/if}
        </div>
    {/if}
</div>
