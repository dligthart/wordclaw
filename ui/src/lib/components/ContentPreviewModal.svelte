<script lang="ts">
    import { deepParseJson } from "$lib/utils";
    import { fetchApi, ApiError } from "$lib/api";
    import {
        resolveContentLabel,
        resolveContentSubtitle,
    } from "$lib/content-label";
    import Badge from "$lib/components/ui/Badge.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import {
        Icon,
        XMark,
        DocumentText,
        ClipboardDocument,
        Check,
        PencilSquare,
        ArrowPath,
    } from "svelte-hero-icons";

    type ContentItemLike = {
        id: number;
        data: any;
        status?: string;
        version?: number;
        createdAt?: string;
        updatedAt?: string;
    };

    type ContentTypeLike = {
        id?: number;
        name: string;
        slug?: string;
    };

    let {
        open = false,
        contentItem = null,
        contentType = null,
        taskId = null,
        onclose,
        onrevised,
    }: {
        open: boolean;
        contentItem: ContentItemLike | null;
        contentType: ContentTypeLike | null;
        taskId: number | null;
        onclose: () => void;
        onrevised?: (result: {
            contentItemId: number;
            contentVersion: number;
        }) => void;
    } = $props();

    let copied = $state(false);

    /* ─── Inline revision state ─── */
    let editingFieldKey = $state<string | null>(null);
    let fieldRevisionPrompt = $state("");
    let fieldRevising = $state(false);
    let fieldRevisionError = $state<string | null>(null);
    /** Tracks fields that were just revised with a brief success indicator */
    let revisedFieldKeys = $state<Set<string>>(new Set());

    /* ─── Derived field rendering ─── */

    type RenderedField = {
        key: string;
        label: string;
        value: string;
        isLong: boolean;
        isUrl: boolean;
        isArray: boolean;
        arrayItems?: string[];
    };

    let structuredData = $derived.by(() => {
        if (!contentItem) return null;
        const parsed = deepParseJson(contentItem.data);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return null;
        }
        return parsed as Record<string, unknown>;
    });

    let renderedFields = $derived.by((): RenderedField[] => {
        if (!structuredData) return [];
        const fields: RenderedField[] = [];

        for (const [key, value] of Object.entries(structuredData)) {
            if (value === null || value === undefined) continue;

            const label = humanizeFieldName(key);

            if (Array.isArray(value)) {
                const items = value.map((item) =>
                    typeof item === "object" && item !== null
                        ? JSON.stringify(item)
                        : String(item),
                );
                fields.push({
                    key,
                    label,
                    value: items.join(", "),
                    isLong: false,
                    isUrl: false,
                    isArray: true,
                    arrayItems: items,
                });
            } else if (typeof value === "object" && value !== null) {
                const json = JSON.stringify(value, null, 2);
                fields.push({
                    key,
                    label,
                    value: json,
                    isLong: true,
                    isUrl: false,
                    isArray: false,
                });
            } else {
                const strVal = String(value);
                const isUrl =
                    typeof value === "string" &&
                    (strVal.startsWith("http://") ||
                        strVal.startsWith("https://"));
                const isLong = strVal.length > 120;
                fields.push({
                    key,
                    label,
                    value: strVal,
                    isLong,
                    isUrl,
                    isArray: false,
                });
            }
        }

        return fields;
    });

    let headline = $derived.by(() => {
        if (!contentItem) return "Content Preview";
        return resolveContentLabel(contentItem, contentType ?? undefined);
    });

    let subtitle = $derived.by(() => {
        if (!contentItem) return null;
        return resolveContentSubtitle(contentItem, contentType ?? undefined);
    });

    function humanizeFieldName(key: string): string {
        return key
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .replace(/[_-]/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    function formatStatusLabel(status: string): string {
        return status
            .split("_")
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ");
    }

    function resolveStatusVariant(
        status: string,
    ): "muted" | "success" | "warning" | "danger" {
        if (status === "published") return "success";
        if (status === "in_review") return "warning";
        if (status === "rejected" || status === "archived") return "danger";
        return "muted";
    }

    function handleBackdropClick() {
        if (fieldRevising) return;
        onclose();
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            if (editingFieldKey && !fieldRevising) {
                cancelFieldEdit();
                event.stopPropagation();
                return;
            }
            if (!fieldRevising) {
                onclose();
            }
        }
    }

    function handleCopyAll() {
        if (!structuredData) return;
        const text = JSON.stringify(structuredData, null, 2);
        navigator.clipboard.writeText(text).then(() => {
            copied = true;
            setTimeout(() => (copied = false), 2000);
        });
    }

    /* ─── Inline revision logic ─── */

    function startFieldEdit(fieldKey: string) {
        editingFieldKey = fieldKey;
        fieldRevisionPrompt = "";
        fieldRevisionError = null;
    }

    function cancelFieldEdit() {
        editingFieldKey = null;
        fieldRevisionPrompt = "";
        fieldRevisionError = null;
    }

    async function submitFieldRevision() {
        if (!taskId || !editingFieldKey || !fieldRevisionPrompt.trim()) return;

        const fieldLabel = humanizeFieldName(editingFieldKey);
        const prompt = `Revise the '${fieldLabel}' field (key: ${editingFieldKey}): ${fieldRevisionPrompt.trim()}`;
        const editedKey = editingFieldKey;

        fieldRevising = true;
        fieldRevisionError = null;

        try {
            const response = await fetchApi(
                `/review-tasks/${taskId}/revise`,
                {
                    method: "POST",
                    body: JSON.stringify({ prompt }),
                },
            );
            const result = response.data as {
                contentItemId: number;
                contentVersion: number;
            };

            // Mark the field as revised
            revisedFieldKeys = new Set([...revisedFieldKeys, editedKey]);
            setTimeout(() => {
                revisedFieldKeys = new Set(
                    [...revisedFieldKeys].filter((k) => k !== editedKey),
                );
            }, 4000);

            editingFieldKey = null;
            fieldRevisionPrompt = "";

            // Notify parent to reload data and update the modal content
            onrevised?.(result);
        } catch (err: any) {
            fieldRevisionError =
                err instanceof ApiError
                    ? err.message
                    : "Failed to request revision. Please try again.";
        } finally {
            fieldRevising = false;
        }
    }
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

{#if open && contentItem}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-gray-900/60 backdrop-blur-sm p-4 sm:p-6 md:p-10"
        onclick={handleBackdropClick}
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="relative w-full max-w-3xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200/80 dark:border-slate-700 overflow-hidden my-auto"
            role="dialog"
            aria-modal="true"
            aria-label="Content Preview"
            tabindex="-1"
            onclick={(e) => e.stopPropagation()}
        >
            <!-- Header -->
            <div
                class="sticky top-0 z-10 border-b border-slate-200/80 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm px-5 py-4 sm:px-6"
            >
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2 flex-wrap">
                            <Icon
                                src={DocumentText}
                                class="w-5 h-5 text-slate-400 dark:text-slate-500 shrink-0"
                            />
                            <h3
                                class="text-lg font-semibold tracking-tight text-gray-900 dark:text-white truncate"
                            >
                                {headline}
                            </h3>
                        </div>
                        {#if subtitle}
                            <p
                                class="mt-0.5 text-sm text-slate-500 dark:text-slate-400 truncate pl-7"
                            >
                                {subtitle}
                            </p>
                        {/if}
                        <div class="mt-2 flex items-center gap-1.5 flex-wrap pl-7">
                            {#if contentType}
                                <Badge variant="outline" class="whitespace-nowrap"
                                    >{contentType.name}</Badge
                                >
                            {/if}
                            <Badge variant="outline" class="whitespace-nowrap"
                                >#{contentItem.id}</Badge
                            >
                            {#if contentItem.version != null}
                                <Badge variant="muted" class="whitespace-nowrap"
                                    >v{contentItem.version}</Badge
                                >
                            {/if}
                            {#if contentItem.status}
                                <Badge
                                    variant={resolveStatusVariant(
                                        contentItem.status,
                                    )}
                                    class="whitespace-nowrap"
                                >
                                    {formatStatusLabel(contentItem.status)}
                                </Badge>
                            {/if}
                        </div>
                    </div>
                    <button
                        class="shrink-0 rounded-lg p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors"
                        aria-label="Close preview"
                        onclick={onclose}
                        disabled={fieldRevising}
                    >
                        <Icon src={XMark} class="w-5 h-5" />
                    </button>
                </div>
            </div>

            <!-- Body -->
            <div class="px-5 py-5 sm:px-6 space-y-1">
                {#if renderedFields.length === 0}
                    <div
                        class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-400"
                    >
                        No structured data available for this item.
                    </div>
                {:else}
                    <div class="divide-y divide-slate-100 dark:divide-slate-800">
                        {#each renderedFields as field (field.key)}
                            <div class="py-3 first:pt-0 last:pb-0 group/field">
                                <!-- Field header: label + edit button -->
                                <div class="flex items-center justify-between gap-2 mb-1">
                                    <dt
                                        class="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500 flex items-center gap-1.5"
                                    >
                                        {field.label}
                                        {#if revisedFieldKeys.has(field.key)}
                                            <span
                                                class="inline-flex items-center gap-0.5 text-[0.6rem] font-semibold text-emerald-600 dark:text-emerald-400 normal-case tracking-normal animate-pulse"
                                            >
                                                <Icon
                                                    src={Check}
                                                    class="w-3 h-3"
                                                />
                                                Updated
                                            </span>
                                        {/if}
                                    </dt>
                                    {#if taskId && editingFieldKey !== field.key}
                                        <button
                                            class="opacity-0 group-hover/field:opacity-100 focus:opacity-100 shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.6rem] font-medium text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:text-slate-500 dark:hover:text-blue-400 dark:hover:bg-blue-950/30 transition-all"
                                            title="Request AI revision for this field"
                                            aria-label="Revise {field.label}"
                                            onclick={() =>
                                                startFieldEdit(field.key)}
                                            disabled={fieldRevising}
                                        >
                                            <Icon
                                                src={PencilSquare}
                                                class="w-3 h-3"
                                            />
                                            Revise
                                        </button>
                                    {/if}
                                </div>

                                <!-- Field value -->
                                <dd class="min-w-0">
                                    {#if field.isArray && field.arrayItems}
                                        <div class="flex flex-wrap gap-1.5">
                                            {#each field.arrayItems as item}
                                                <span
                                                    class="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                                >
                                                    {item}
                                                </span>
                                            {/each}
                                        </div>
                                    {:else if field.isUrl}
                                        <a
                                            href={field.value}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            class="text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 underline underline-offset-2 break-all"
                                        >
                                            {field.value}
                                        </a>
                                    {:else if field.isLong}
                                        <div
                                            class="rounded-lg border border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-950/30 p-3 overflow-x-auto"
                                        >
                                            <pre
                                                class="text-xs leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words font-mono">{field.value}</pre>
                                        </div>
                                    {:else}
                                        <p
                                            class="text-sm leading-relaxed text-slate-700 dark:text-slate-200 whitespace-pre-line break-words"
                                        >
                                            {field.value}
                                        </p>
                                    {/if}
                                </dd>

                                <!-- Inline revision prompt (shown when editing this field) -->
                                {#if editingFieldKey === field.key}
                                    <div
                                        class="mt-2.5 rounded-lg border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900/50 dark:bg-blue-950/20"
                                    >
                                        <div
                                            class="flex items-center gap-1.5 mb-2"
                                        >
                                            <Icon
                                                src={PencilSquare}
                                                class="w-3.5 h-3.5 text-blue-500 dark:text-blue-400"
                                            />
                                            <span
                                                class="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-blue-600 dark:text-blue-400"
                                            >
                                                Revise {field.label}
                                            </span>
                                        </div>
                                        <textarea
                                            class="w-full rounded-md border border-blue-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-blue-800 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-500 resize-y"
                                            rows={2}
                                            placeholder="Describe how this field should be changed…"
                                            bind:value={fieldRevisionPrompt}
                                            disabled={fieldRevising}
                                        ></textarea>

                                        {#if fieldRevisionError}
                                            <p
                                                class="mt-1.5 text-xs text-rose-600 dark:text-rose-400"
                                            >
                                                {fieldRevisionError}
                                            </p>
                                        {/if}

                                        <div
                                            class="mt-2 flex items-center justify-end gap-2"
                                        >
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onclick={cancelFieldEdit}
                                                disabled={fieldRevising}
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                variant="default"
                                                size="sm"
                                                onclick={submitFieldRevision}
                                                disabled={fieldRevising ||
                                                    !fieldRevisionPrompt.trim()}
                                            >
                                                {#if fieldRevising}
                                                    <LoadingSpinner
                                                        size="sm"
                                                        color="white"
                                                    />
                                                    Revising…
                                                {:else}
                                                    <Icon
                                                        src={ArrowPath}
                                                        class="w-3.5 h-3.5"
                                                    />
                                                    Revise Field
                                                {/if}
                                            </Button>
                                        </div>
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>

            <!-- Footer -->
            <div
                class="sticky bottom-0 border-t border-slate-200/80 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-sm px-5 py-3 sm:px-6 flex items-center justify-between gap-3"
            >
                <button
                    class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors"
                    onclick={handleCopyAll}
                >
                    {#if copied}
                        <Icon src={Check} class="w-3.5 h-3.5 text-emerald-500" />
                        <span class="text-emerald-600 dark:text-emerald-400"
                            >Copied!</span
                        >
                    {:else}
                        <Icon src={ClipboardDocument} class="w-3.5 h-3.5" />
                        Copy JSON
                    {/if}
                </button>
                <Button
                    variant="outline"
                    size="sm"
                    onclick={onclose}
                    disabled={fieldRevising}
                >
                    Close
                </Button>
            </div>
        </div>
    </div>
{/if}
