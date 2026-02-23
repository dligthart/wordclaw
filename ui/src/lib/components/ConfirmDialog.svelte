<script lang="ts">
    import { feedbackStore } from "$lib/ui-feedback.svelte";

    let isSubmitting = $state(false);

    async function handleConfirm() {
        if (!feedbackStore.confirmRequest) return;

        isSubmitting = true;
        try {
            await feedbackStore.confirmRequest.onConfirm();
            feedbackStore.closeConfirm();
        } catch (err) {
            feedbackStore.pushToast({
                severity: "error",
                title: "Action Failed",
                message: err instanceof Error ? err.message : String(err),
            });
            feedbackStore.closeConfirm();
        } finally {
            isSubmitting = false;
        }
    }
</script>

{#if feedbackStore.confirmRequest}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 backdrop-blur-sm transition-opacity"
        onclick={() => {
            if (!isSubmitting) feedbackStore.closeConfirm();
        }}
    >
        <div
            class="w-full max-w-md bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden transform transition-all scale-100 opacity-100"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-headline"
            tabindex="-1"
            onclick={(e) => e.stopPropagation()}
        >
            <div class="px-6 py-5">
                <div class="flex items-start">
                    <div
                        class={`flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-full ${feedbackStore.confirmRequest.confirmIntent === "danger" ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400" : "bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400"}`}
                    >
                        {#if feedbackStore.confirmRequest.confirmIntent === "danger"}
                            <svg
                                class="h-6 w-6"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                                />
                            </svg>
                        {:else}
                            <svg
                                class="h-6 w-6"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                            </svg>
                        {/if}
                    </div>
                    <div class="ml-4 mt-0 text-left">
                        <h3
                            class="text-lg leading-6 font-medium text-gray-900 dark:text-white"
                            id="modal-headline"
                        >
                            {feedbackStore.confirmRequest.title}
                        </h3>
                        <div class="mt-2">
                            <p
                                class="text-sm text-gray-500 dark:text-gray-400 whitespace-pre-wrap"
                            >
                                {feedbackStore.confirmRequest.message}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
            <div
                class="bg-gray-50 dark:bg-gray-900/50 px-6 py-4 flex justify-end space-x-3"
            >
                <button
                    type="button"
                    disabled={isSubmitting}
                    class="inline-flex justify-center rounded-md border border-gray-300 dark:border-gray-600 px-4 py-2 bg-white dark:bg-gray-800 text-base font-medium text-gray-700 dark:text-gray-300 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed sm:text-sm"
                    onclick={() => feedbackStore.closeConfirm()}
                >
                    Cancel
                </button>
                <button
                    type="button"
                    disabled={isSubmitting}
                    class={`inline-flex justify-center rounded-md border border-transparent px-4 py-2 text-base font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-50 sm:text-sm disabled:opacity-75 disabled:cursor-wait ${feedbackStore.confirmRequest.confirmIntent === "danger" ? "bg-red-600 hover:bg-red-700 focus:ring-red-500" : "bg-primary-600 hover:bg-primary-700 focus:ring-primary-500"} dark:focus:ring-offset-gray-900`}
                    onclick={handleConfirm}
                >
                    {#if isSubmitting}
                        <svg
                            class="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                            fill="none"
                            viewBox="0 0 24 24"
                        >
                            <circle
                                class="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                stroke-width="4"
                            ></circle>
                            <path
                                class="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            ></path>
                        </svg>
                        Processing...
                    {:else}
                        {feedbackStore.confirmRequest.confirmLabel}
                    {/if}
                </button>
            </div>
        </div>
    </div>
{/if}
