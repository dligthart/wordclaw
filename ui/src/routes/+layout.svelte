<script lang="ts">
    import './layout.css';
    import favicon from '$lib/assets/favicon.svg';
    import { page } from '$app/stores';
    import { auth, checkAuth, logout } from '$lib/auth.svelte';
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';

    let { children } = $props();

    onMount(async () => {
        await checkAuth();
    });

    $effect(() => {
        if (!auth.loading && !auth.user && !$page.url.pathname.endsWith('/login')) {
            goto('/ui/login');
        }
    });

    async function handleLogout() {
        await logout();
        goto('/ui/login');
    }
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#if $page.url.pathname.endsWith('/login')}
    {@render children()}
{:else if auth.loading}
    <div class="h-screen w-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
    </div>
{:else if auth.user}
    <div class="flex h-screen bg-gray-100 dark:bg-gray-900 font-sans text-gray-900 dark:text-gray-100">
        <!-- Sidebar -->
        <aside class="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
            <div class="h-16 flex items-center px-6 border-b border-gray-200 dark:border-gray-700">
                <h1 class="text-xl font-bold text-gray-800 dark:text-white">WordClaw</h1>
                <span class="ml-2 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    Supervisor
                </span>
            </div>

            <nav class="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
                <a href="/ui" class="group flex items-center px-2 py-2 text-sm font-medium rounded-md {$page.url.pathname === '/ui' ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}">
                    Dashboard
                </a>
                <a href="/ui/audit-logs" class="group flex items-center px-2 py-2 text-sm font-medium rounded-md {$page.url.pathname.includes('/audit-logs') ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}">
                    Audit Logs
                </a>
                <a href="/ui/content" class="group flex items-center px-2 py-2 text-sm font-medium rounded-md {$page.url.pathname.includes('/content') ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}">
                    Content Browser
                </a>
                <a href="/ui/schema" class="group flex items-center px-2 py-2 text-sm font-medium rounded-md {$page.url.pathname.includes('/schema') ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}">
                    Schema Manager
                </a>
                <a href="/ui/keys" class="group flex items-center px-2 py-2 text-sm font-medium rounded-md {$page.url.pathname.includes('/keys') ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}">
                    Agent Keys
                </a>
                <a href="/ui/approvals" class="group flex items-center px-2 py-2 text-sm font-medium rounded-md {$page.url.pathname.includes('/approvals') ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}">
                    Approval Queue
                </a>
            </nav>

            <div class="p-4 border-t border-gray-200 dark:border-gray-700">
                <div class="flex items-center text-sm mb-4 truncate text-gray-500 dark:text-gray-400">
                    Signed in as <br><strong class="ml-1 text-gray-900 dark:text-white truncate">{auth.user.email}</strong>
                </div>
                <button onclick={handleLogout} class="w-full text-left px-2 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors">
                    Sign out
                </button>
            </div>
        </aside>

        <!-- Main Content -->
        <main class="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
            <div class="flex-1 overflow-y-auto p-8">
                {@render children()}
            </div>
        </main>
    </div>
{/if}
