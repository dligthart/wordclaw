<script lang="ts">
    import { goto } from "$app/navigation";
    import { base } from "$app/paths";
    import { onMount } from "svelte";

    import { fetchApi } from "$lib/api";
    import { checkAuth } from "$lib/auth.svelte";

    type InvitePreview = {
        email: string;
        scope: "platform" | "tenant";
        domainId: number | null;
        domain: {
            id: number;
            name: string;
            hostname: string;
        } | null;
        expiresAt: string;
    };

    let invite = $state<InvitePreview | null>(null);
    let inviteToken = $state("");
    let password = $state("");
    let confirmPassword = $state("");
    let error = $state<string | null>(null);
    let loadingInvite = $state(true);
    let accepting = $state(false);

    const inviteScopeLabel = $derived(
        invite?.scope === "tenant"
            ? invite.domain?.name ?? invite.domain?.hostname ?? "Tenant workspace"
            : "Platform supervisor",
    );

    const expiresAtLabel = $derived(
        invite ? new Date(invite.expiresAt).toLocaleString() : "",
    );

    onMount(() => {
        void loadInvite();
    });

    async function loadInvite() {
        loadingInvite = true;
        error = null;

        const params = new URLSearchParams(window.location.search);
        const token = params.get("token")?.trim() ?? "";
        inviteToken = token;

        if (!token) {
            invite = null;
            error = "Invite token missing. Request a fresh supervisor invite link.";
            loadingInvite = false;
            return;
        }

        try {
            invite = (await fetchApi(
                `/supervisors/invite/${encodeURIComponent(token)}`,
            )) as InvitePreview;
        } catch (err: any) {
            invite = null;
            error = err?.message || "Failed to load supervisor invite.";
        } finally {
            loadingInvite = false;
        }
    }

    async function acceptInvite(event: Event) {
        event.preventDefault();
        if (!inviteToken || !invite) return;

        if (password !== confirmPassword) {
            error = "Passwords do not match.";
            return;
        }

        accepting = true;
        error = null;

        try {
            await fetchApi("/supervisors/invite/accept", {
                method: "POST",
                body: JSON.stringify({
                    token: inviteToken,
                    password,
                }),
            });
            await checkAuth();
            goto("/ui");
        } catch (err: any) {
            error = err?.message || "Failed to accept supervisor invite.";
        } finally {
            accepting = false;
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
                Accept Supervisor Invite
            </h2>
            <p
                class="mt-2 text-center text-sm text-gray-600 dark:text-gray-400"
            >
                Complete setup for your WordClaw supervisor account
            </p>
        </div>

        {#if loadingInvite}
            <div
                class="rounded-md border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
                Loading invite details...
            </div>
        {:else if invite}
            <div class="space-y-6">
                <div
                    class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm dark:border-slate-700 dark:bg-slate-900"
                >
                    <div class="font-medium text-slate-900 dark:text-white">
                        {invite.email}
                    </div>
                    <div class="mt-2 text-slate-600 dark:text-slate-300">
                        Scope: {inviteScopeLabel}
                    </div>
                    <div class="mt-1 text-slate-500 dark:text-slate-400">
                        Expires: {expiresAtLabel}
                    </div>
                </div>

                <form class="space-y-4" onsubmit={acceptInvite}>
                    <div>
                        <label
                            for="password"
                            class="block text-sm font-medium text-gray-700 dark:text-gray-200"
                        >
                            Password
                        </label>
                        <input
                            id="password"
                            name="password"
                            type="password"
                            autocomplete="new-password"
                            required
                            minlength="8"
                            class="mt-1 appearance-none rounded-md relative block w-full px-3 py-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                            placeholder="Create a password"
                            bind:value={password}
                            disabled={accepting}
                        />
                    </div>

                    <div>
                        <label
                            for="confirm-password"
                            class="block text-sm font-medium text-gray-700 dark:text-gray-200"
                        >
                            Confirm Password
                        </label>
                        <input
                            id="confirm-password"
                            name="confirm-password"
                            type="password"
                            autocomplete="new-password"
                            required
                            minlength="8"
                            class="mt-1 appearance-none rounded-md relative block w-full px-3 py-3 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                            placeholder="Confirm password"
                            bind:value={confirmPassword}
                            disabled={accepting}
                        />
                    </div>

                    {#if error}
                        <div
                            class="bg-red-50 dark:bg-red-900/30 border-l-4 border-red-400 p-4 rounded"
                        >
                            <p class="text-sm text-red-700 dark:text-red-400">
                                {error}
                            </p>
                        </div>
                    {/if}

                    <button
                        type="submit"
                        disabled={accepting}
                        class="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                    >
                        {#if accepting}
                            Creating account...
                        {:else}
                            Create supervisor account
                        {/if}
                    </button>
                </form>
            </div>
        {:else}
            <div class="space-y-4">
                <div
                    class="bg-red-50 dark:bg-red-900/30 border-l-4 border-red-400 p-4 rounded"
                >
                    <p class="text-sm text-red-700 dark:text-red-400">
                        {error ?? "This invite is no longer available."}
                    </p>
                </div>
                <button
                    type="button"
                    class="group relative w-full flex justify-center py-3 px-4 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 transition-colors duration-200"
                    onclick={() => goto("/ui/login")}
                >
                    Go to sign in
                </button>
            </div>
        {/if}
    </div>
</div>
