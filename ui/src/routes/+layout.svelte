<script lang="ts">
    import "./layout.css";
    import favicon from "$lib/assets/favicon.svg";
    import { page } from "$app/stores";
    import { auth, checkAuth, logout } from "$lib/auth.svelte";
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    import Toast from "$lib/components/Toast.svelte";
    import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";

    let { children } = $props();
    let isMobileMenuOpen = $state(false);

    onMount(async () => {
        await checkAuth();
    });

    $effect(() => {
        if (
            !auth.loading &&
            !auth.user &&
            !$page.url.pathname.endsWith("/login")
        ) {
            goto("/ui/login");
        }
    });

    async function handleLogout() {
        await logout();
        goto("/ui/login");
    }
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#if $page.url.pathname.endsWith("/login")}
    {@render children()}
{:else if auth.loading}
    <div
        class="h-screen w-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900"
    >
        <div
            class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"
        ></div>
    </div>
{:else if auth.user}
    <div
        class="flex h-screen overflow-hidden bg-gray-100 dark:bg-gray-900 font-sans text-gray-900 dark:text-gray-100"
    >
        <!-- Off-canvas menu for mobile -->
        {#if isMobileMenuOpen}
            <div
                class="fixed inset-0 flex z-40 md:hidden"
                role="dialog"
                aria-modal="true"
            >
                <div
                    class="fixed inset-0 bg-gray-600 bg-opacity-75"
                    aria-hidden="true"
                    onclick={() => (isMobileMenuOpen = false)}
                ></div>
                <div
                    class="relative flex-1 flex flex-col max-w-xs w-full bg-white dark:bg-gray-800"
                >
                    <div class="absolute top-0 right-0 -mr-12 pt-2">
                        <button
                            type="button"
                            class="ml-1 flex items-center justify-center h-10 w-10 rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white"
                            onclick={() => (isMobileMenuOpen = false)}
                        >
                            <span class="sr-only">Close sidebar</span>
                            <svg
                                class="h-6 w-6 text-white"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                aria-hidden="true"
                            >
                                <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M6 18L18 6M6 6l12 12"
                                />
                            </svg>
                        </button>
                    </div>
                    <div
                        class="h-16 flex items-center px-6 border-b border-gray-200 dark:border-gray-700"
                    >
                        <h1
                            class="text-xl font-bold text-gray-800 dark:text-white"
                        >
                            WordClaw
                        </h1>
                        <span
                            class="ml-2 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                            >Supervisor</span
                        >
                    </div>
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                    <nav
                        class="flex-1 px-4 py-6 space-y-1 overflow-y-auto"
                        onclick={() => (isMobileMenuOpen = false)}
                    >
                        <!-- Navigation links will be injected here using a helper block -->
                        {@render NavLinks()}
                    </nav>
                    <div
                        class="p-4 border-t border-gray-200 dark:border-gray-700"
                    >
                        <div
                            class="flex items-center text-sm mb-4 truncate text-gray-500 dark:text-gray-400"
                        >
                            Signed in as <br /><strong
                                class="ml-1 text-gray-900 dark:text-white truncate"
                                >{auth.user.email}</strong
                            >
                        </div>
                        <button
                            onclick={handleLogout}
                            class="w-full text-left px-2 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                            >Sign out</button
                        >
                    </div>
                </div>
                <div class="flex-shrink-0 w-14" aria-hidden="true"></div>
            </div>
        {/if}

        <!-- Static sidebar for desktop -->
        <aside class="hidden md:flex md:flex-shrink-0">
            <div
                class="flex flex-col w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700"
            >
                <div
                    class="h-16 flex items-center px-6 border-b border-gray-200 dark:border-gray-700 mt-0"
                >
                    <h1 class="text-xl font-bold text-gray-800 dark:text-white">
                        WordClaw
                    </h1>
                    <span
                        class="ml-2 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                        >Supervisor</span
                    >
                </div>
                <!-- Navigation links -->
                <nav class="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
                    {@render NavLinks()}
                </nav>
                <div class="p-4 border-t border-gray-200 dark:border-gray-700">
                    <div
                        class="flex items-center text-sm mb-4 truncate text-gray-500 dark:text-gray-400"
                    >
                        Signed in as <br /><strong
                            class="ml-1 text-gray-900 dark:text-white truncate"
                            >{auth.user.email}</strong
                        >
                    </div>
                    <button
                        onclick={handleLogout}
                        class="w-full text-left px-2 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                        >Sign out</button
                    >
                </div>
            </div>
        </aside>

        <!-- Main Content -->
        <main
            class="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900"
        >
            <!-- Mobile header sticky -->
            <div
                class="md:hidden flex items-center justify-between h-16 px-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shrink-0"
            >
                <div class="flex items-center">
                    <h1 class="text-lg font-bold text-gray-800 dark:text-white">
                        WordClaw
                    </h1>
                    <span
                        class="ml-2 px-2 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                        >SUPV</span
                    >
                </div>
                <button
                    type="button"
                    class="-mr-2 inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500"
                    onclick={() => (isMobileMenuOpen = true)}
                >
                    <span class="sr-only">Open sidebar</span>
                    <svg
                        class="h-6 w-6"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M4 6h16M4 12h16M4 18h16"
                        />
                    </svg>
                </button>
            </div>

            <div class="flex-1 overflow-y-auto p-4 md:p-8">
                <div class="max-w-7xl mx-auto w-full">
                    {@render children()}
                </div>
            </div>
        </main>
    </div>

    <!-- Feedback Store Mounts -->
    <Toast />
    <ConfirmDialog />

    {#snippet NavLinks()}
        {@const currentPath = $page.url.pathname}
        <a
            href="/ui"
            class="group flex items-center px-2 py-2 text-sm font-medium rounded-md {currentPath ===
            '/'
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}"
            >Dashboard</a
        >
        <a
            href="/ui/audit-logs"
            class="group flex items-center px-2 py-2 text-sm font-medium rounded-md {currentPath.includes(
                '/audit-logs',
            )
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}"
            >Audit Logs</a
        >
        <a
            href="/ui/content"
            class="group flex items-center px-2 py-2 text-sm font-medium rounded-md {currentPath.includes(
                '/content',
            )
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}"
            >Content Browser</a
        >
        <a
            href="/ui/schema"
            class="group flex items-center px-2 py-2 text-sm font-medium rounded-md {currentPath.includes(
                '/schema',
            )
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}"
            >Schema Manager</a
        >
        <a
            href="/ui/keys"
            class="group flex items-center px-2 py-2 text-sm font-medium rounded-md {currentPath.includes(
                '/keys',
            )
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}"
            >Agent Keys</a
        >
        <a
            href="/ui/approvals"
            class="group flex items-center px-2 py-2 text-sm font-medium rounded-md {currentPath.includes(
                '/approvals',
            )
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}"
            >Approval Queue</a
        >
        <a
            href="/ui/agent-sandbox"
            class="group flex items-center px-2 py-2 text-sm font-medium rounded-md {currentPath.includes(
                '/agent-sandbox',
            )
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}"
            >Agent Sandbox</a
        >
        <a
            href="/ui/payments"
            class="group flex items-center px-2 py-2 text-sm font-medium rounded-md {currentPath.includes(
                '/payments',
            )
                ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}"
            >Payments</a
        >
    {/snippet}
{/if}
