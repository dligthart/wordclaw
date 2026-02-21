<script lang="ts">
    import { fetchApi } from "$lib/api";
    import { auth, checkAuth } from "$lib/auth.svelte";
    import { goto } from "$app/navigation";
    import { base } from "$app/paths";
    import { onMount } from "svelte";

    let email = $state("");
    let password = $state("");
    let error = $state<string | null>(null);
    let loading = $state(false);

    onMount(async () => {
        await checkAuth();
        if (auth.user) {
            goto("/ui");
        }
    });

    async function handleLogin(e: Event) {
        e.preventDefault();
        loading = true;
        error = null;

        try {
            await fetchApi("/supervisors/login", {
                method: "POST",
                body: JSON.stringify({ email, password }),
            });
            await checkAuth();
            if (auth.user) {
                goto("/ui");
            }
        } catch (err: any) {
            error = err.message || "Failed to login";
        } finally {
            loading = false;
        }
    }
</script>

<div
    class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8"
>
    <div
        class="max-w-md w-full space-y-8 bg-white dark:bg-gray-800 p-8 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700"
    >
        <div class="flex flex-col items-center">
            <img
                src="{base}/images/logos/wordclaw-logo-transparent.png"
                alt="WordClaw Logo"
                class="w-24 h-auto"
            />
            <h2
                class="mt-6 text-center text-3xl font-extrabold text-gray-900 dark:text-white"
            >
                WordClaw Supervisor
            </h2>
            <p
                class="mt-2 text-center text-sm text-gray-600 dark:text-gray-400"
            >
                Sign in to manage and audit content agents
            </p>
        </div>
        <form class="mt-8 space-y-6" onsubmit={handleLogin}>
            <div class="rounded-md shadow-sm -space-y-px gap-4 flex flex-col">
                <div>
                    <label for="email-address" class="sr-only"
                        >Email address</label
                    >
                    <input
                        id="email-address"
                        name="email"
                        type="email"
                        autocomplete="email"
                        required
                        class="appearance-none rounded-md relative block w-full px-3 py-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                        placeholder="Email address"
                        bind:value={email}
                        disabled={loading}
                    />
                </div>
                <div>
                    <label for="password" class="sr-only">Password</label>
                    <input
                        id="password"
                        name="password"
                        type="password"
                        autocomplete="current-password"
                        required
                        class="appearance-none rounded-md relative block w-full px-3 py-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                        placeholder="Password"
                        bind:value={password}
                        disabled={loading}
                    />
                </div>
            </div>

            {#if error}
                <div
                    class="bg-red-50 dark:bg-red-900/30 border-l-4 border-red-400 p-4 rounded"
                >
                    <div class="flex">
                        <div class="ml-3">
                            <p class="text-sm text-red-700 dark:text-red-400">
                                {error}
                            </p>
                        </div>
                    </div>
                </div>
            {/if}

            <div>
                <button
                    type="submit"
                    disabled={loading}
                    class="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                >
                    {#if loading}
                        Signing in...
                    {:else}
                        Sign in
                    {/if}
                </button>
            </div>
        </form>
    </div>
</div>
