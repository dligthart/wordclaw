<script lang="ts">
    import { feedbackStore } from "$lib/ui-feedback.svelte";
    import { crossfade } from "svelte/transition";
    import { flip } from "svelte/animate";
    import { quintOut } from "svelte/easing";

    const [send, receive] = crossfade({
        duration: (d) => Math.sqrt(d * 200),
        fallback(node, params) {
            const style = getComputedStyle(node);
            const transform = style.transform === "none" ? "" : style.transform;

            return {
                duration: 600,
                easing: quintOut,
                css: (t) => `
                    transform: ${transform} scale(${t}) translateY(${(1 - t) * 20}px);
                    opacity: ${t}
                `,
            };
        },
    });

    function getIconInfo(severity: string) {
        switch (severity) {
            case "success":
                return {
                    color: "text-green-400 dark:text-green-500",
                    bg: "bg-green-50 dark:bg-green-900/20",
                    path: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
                };
            case "warning":
                return {
                    color: "text-yellow-400 dark:text-yellow-500",
                    bg: "bg-yellow-50 dark:bg-yellow-900/20",
                    path: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
                };
            case "error":
                return {
                    color: "text-red-400 dark:text-red-500",
                    bg: "bg-red-50 dark:bg-red-900/20",
                    path: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z",
                };
            default: // info
                return {
                    color: "text-blue-400 dark:text-blue-500",
                    bg: "bg-blue-50 dark:bg-blue-900/20",
                    path: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
                };
        }
    }
</script>

<div
    aria-live="polite"
    class="fixed inset-0 flex items-end px-4 py-6 pointer-events-none sm:p-6 sm:items-start z-[100] flex-col-reverse sm:flex-col gap-2"
>
    {#each feedbackStore.toasts as toast (toast.id)}
        {@const icon = getIconInfo(toast.severity)}
        <div
            class="max-w-sm w-full bg-white dark:bg-gray-800 shadow-lg rounded-lg pointer-events-auto ring-1 ring-black ring-opacity-5 dark:ring-white dark:ring-opacity-10 overflow-hidden"
            in:receive={{ key: toast.id }}
            out:send={{ key: toast.id }}
            animate:flip={{ duration: 400 }}
        >
            <div class={`p-4 ${icon.bg}`}>
                <div class="flex items-start">
                    <div class="flex-shrink-0">
                        <svg
                            class={`h-6 w-6 ${icon.color}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d={icon.path}
                            />
                        </svg>
                    </div>
                    <div class="ml-3 w-0 flex-1 pt-0.5">
                        <p
                            class="text-sm font-medium text-gray-900 dark:text-white"
                        >
                            {toast.title}
                            {#if toast.code}
                                <span
                                    class="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300"
                                >
                                    {toast.code}
                                </span>
                            {/if}
                        </p>
                        {#if toast.message}
                            <p
                                class="mt-1 text-sm text-gray-500 dark:text-gray-400"
                            >
                                {toast.message}
                            </p>
                        {/if}
                        {#if toast.remediation}
                            <div
                                class="mt-3 text-sm text-gray-500 dark:text-gray-400 bg-white/50 dark:bg-gray-900/50 p-2 rounded border border-gray-200 dark:border-gray-700"
                            >
                                <span
                                    class="block font-semibold mb-1 text-gray-700 dark:text-gray-300"
                                    >Remediation:</span
                                >
                                {toast.remediation}
                            </div>
                        {/if}
                        {#if toast.action}
                            <div class="mt-3">
                                <button
                                    type="button"
                                    class={`bg-white dark:bg-gray-800 rounded-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${toast.severity === "error" ? "text-red-600 hover:text-red-500 focus:ring-red-500" : "text-blue-600 hover:text-blue-500 focus:ring-blue-500"}`}
                                    onclick={() => {
                                        toast.action?.handler();
                                        feedbackStore.dismissToast(toast.id);
                                    }}
                                >
                                    {toast.action.label}
                                </button>
                            </div>
                        {/if}
                    </div>
                    <div class="ml-4 flex-shrink-0 flex">
                        <button
                            type="button"
                            class="bg-transparent rounded-md inline-flex text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                            onclick={() => feedbackStore.dismissToast(toast.id)}
                        >
                            <span class="sr-only">Close</span>
                            <svg
                                class="h-5 w-5"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                            >
                                <path
                                    fill-rule="evenodd"
                                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                    clip-rule="evenodd"
                                />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    {/each}
</div>
