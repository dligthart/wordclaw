<script lang="ts">
    import "./layout.css";
    import favicon from "$lib/assets/favicon.svg";
    import { page } from "$app/stores";
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";
    import { auth, checkAuth, logout } from "$lib/auth.svelte";
    import { fetchApi } from "$lib/api";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import DomainDropdown from "$lib/components/DomainDropdown.svelte";
    import Toast from "$lib/components/Toast.svelte";
    import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Badge from "$lib/components/ui/Badge.svelte";
    import { initializeTheme, toggleTheme, type ThemeMode } from "$lib/theme";
    import { Icon } from "svelte-hero-icons";
    import {
        Home,
        ClipboardDocumentList,
        Folder,
        ArchiveBox,
        CircleStack,
        CpuChip,
        Key,
        CheckCircle,
        CodeBracketSquare,
        CreditCard,
        CheckBadge,
        Bars3,
        XMark,
    } from "svelte-hero-icons";

    let { children } = $props();

    let mobileMenuOpen = $state(false);
    let currentDomain = $state("1");
    let showExperimentalNav = $state(false);
    let showUserMenu = $state(false);
    let theme = $state<ThemeMode>("dark");
    let userMenuRef = $state<HTMLDivElement | null>(null);
    let domainOptions = $state<{ id: string; label: string }[]>([
        { id: "1", label: "Domain 1" },
        { id: "2", label: "Domain 2" },
    ]);

    type NavItem = {
        name: string;
        href: string;
        icon: typeof Home;
        match: (path: string) => boolean;
        notice?: string;
    };

    type NavGroup = {
        label: string;
        items: NavItem[];
    };

    type DomainRefreshEventDetail = {
        selectDomainId?: string;
    };

    const coreNavItems: NavItem[] = [
        { name: "Dashboard", href: "/ui", icon: Home, match: (p: string) => p === "/ui" || p === "/ui/" },
        { name: "Audit Logs", href: "/ui/audit-logs", icon: ClipboardDocumentList, match: (p: string) => p.includes("/audit-logs") },
        { name: "Content Browser", href: "/ui/content", icon: Folder, match: (p: string) => p.includes("/content") },
        { name: "Assets", href: "/ui/assets", icon: ArchiveBox, match: (p: string) => p.includes("/assets") },
        { name: "Schema Manager", href: "/ui/schema", icon: CircleStack, match: (p: string) => p.includes("/schema") },
        { name: "Forms", href: "/ui/forms", icon: ClipboardDocumentList, match: (p: string) => p.includes("/forms") },
        { name: "Agents", href: "/ui/agents", icon: CpuChip, match: (p: string) => p.includes("/agents") },
        { name: "API Keys", href: "/ui/keys", icon: Key, match: (p: string) => p.includes("/keys") },
        { name: "Approval Queue", href: "/ui/approvals", icon: CheckCircle, match: (p: string) => p.includes("/approvals") },
        { name: "Jobs", href: "/ui/jobs", icon: CircleStack, match: (p: string) => p.includes("/jobs") },
        { name: "Payments", href: "/ui/payments", icon: CreditCard, match: (p: string) => p.includes("/payments") },
        { name: "L402 Readiness", href: "/ui/l402-readiness", icon: CheckBadge, match: (p: string) => p.includes("/l402-readiness") },
    ];

    const navGroups: NavGroup[] = [
        {
            label: "Overview",
            items: coreNavItems.filter((i) => ["/ui", "/ui/audit-logs"].some((h) => i.href === h)),
        },
        {
            label: "Content",
            items: coreNavItems.filter((i) => ["/ui/content", "/ui/assets", "/ui/schema", "/ui/forms"].includes(i.href)),
        },
        {
            label: "Operations",
            items: coreNavItems.filter((i) => ["/ui/agents", "/ui/keys", "/ui/approvals", "/ui/jobs", "/ui/payments", "/ui/l402-readiness"].includes(i.href)),
        },
    ];

    const experimentalNavItems: NavItem[] = [
        {
            name: "Agent Sandbox",
            href: "/ui/agent-sandbox",
            icon: CodeBracketSquare,
            match: (p: string) => p.includes("/agent-sandbox"),
            notice: "Agent Sandbox is experimental. It remains useful for exploration and demos, but it is outside the default supported supervisor workflow.",
        },
    ];

    onMount(() => {
        theme = initializeTheme();

        const storedDomain = localStorage.getItem("__wc_domain_id");
        const storedExperimentalNav = localStorage.getItem(
            "__wc_show_experimental",
        );

        if (storedDomain) {
            currentDomain = storedDomain;
        } else {
            localStorage.setItem("__wc_domain_id", currentDomain);
        }

        showExperimentalNav = storedExperimentalNav === "true";

        void (async () => {
            await checkAuth();
            if (auth.user) {
                if (typeof auth.user.domainId === "number") {
                    currentDomain = String(auth.user.domainId);
                    localStorage.setItem("__wc_domain_id", currentDomain);
                }
                await loadDomains();
            }
        })();

        const handleDocumentClick = (event: MouseEvent) => {
            if (!showUserMenu || !userMenuRef) return;
            if (!userMenuRef.contains(event.target as Node)) {
                showUserMenu = false;
            }
        };

        const handleDomainsChanged = (event: Event) => {
            const preferredDomainId = (event as CustomEvent<DomainRefreshEventDetail>).detail?.selectDomainId;
            void loadDomains(preferredDomainId);
        };

        document.addEventListener("click", handleDocumentClick);
        window.addEventListener("wordclaw:domains-changed", handleDomainsChanged as EventListener);
        return () => {
            document.removeEventListener("click", handleDocumentClick);
            window.removeEventListener("wordclaw:domains-changed", handleDomainsChanged as EventListener);
        };
    });

    async function loadDomains(preferredDomainId?: string) {
        try {
            const res = await fetchApi("/domains");
            const fetched = (
                res.data as Array<{
                    id: number;
                    name: string;
                    hostname: string;
                }>
            ).map((domain) => ({
                id: String(domain.id),
                label: domain.name || domain.hostname || `Domain ${domain.id}`,
            }));

            if (fetched.length > 0) {
                domainOptions = fetched;
                const nextDomainId =
                    preferredDomainId &&
                    fetched.some((domain) => domain.id === preferredDomainId)
                        ? preferredDomainId
                        : currentDomain;
                currentDomain = fetched.some((domain) => domain.id === nextDomainId)
                    ? nextDomainId
                    : fetched[0].id;
                localStorage.setItem("__wc_domain_id", currentDomain);
            }
        } catch {
            // Keep fallback options when domain discovery is unavailable.
        }
    }

    async function selectDomain(domainId: string) {
        if (domainId === currentDomain) return;
        localStorage.setItem("__wc_domain_id", domainId);
        currentDomain = domainId;
        window.location.assign("/ui");
    }

    function setExperimentalVisibility(visible: boolean) {
        showExperimentalNav = visible;
        localStorage.setItem(
            "__wc_show_experimental",
            visible ? "true" : "false",
        );
    }

    function handleThemeToggle() {
        theme = toggleTheme(theme);
    }

    function handleNavClick() {
        mobileMenuOpen = false;
        showUserMenu = false;
    }

    async function handleLogout() {
        showUserMenu = false;
        await logout();
        goto("/ui/login");
    }

    function toggleMobileMenu() {
        mobileMenuOpen = !mobileMenuOpen;
    }

    function initialsFromEmail(email?: string | null) {
        if (!email) return "WC";
        const parts = email
            .split("@")[0]
            .split(/[.\-_]/)
            .filter(Boolean);
        const initials = parts
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase())
            .join("");
        return initials || email.slice(0, 2).toUpperCase();
    }

    function navLinkClass(active: boolean) {
        return active
            ? "bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-950"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white";
    }

    function navIconClass(active: boolean, experimental = false) {
        if (active) {
            return experimental
                ? "text-amber-600 dark:text-amber-500"
                : "text-white dark:text-slate-950";
        }

        return experimental
            ? "text-amber-600/80 dark:text-amber-500/80"
            : "text-slate-500 group-hover:text-slate-800 dark:text-slate-400 dark:group-hover:text-slate-200";
    }

    let currentPath = $derived($page.url.pathname);
    let isPublicRoute = $derived(
        currentPath.endsWith("/login") || currentPath.endsWith("/invite"),
    );
    let activeExperimentalItem = $derived(
        experimentalNavItems.find((item) => item.match(currentPath)) ?? null,
    );
    let shouldShowExperimentalNav = $derived(
        showExperimentalNav || activeExperimentalItem !== null,
    );
    let selectedDomainLabel = $derived(
        domainOptions.find((domain) => domain.id === currentDomain)?.label ??
            "Select domain",
    );
    let activeCoreItem = $derived(
        coreNavItems.find((item) => item.match(currentPath)) ?? null,
    );
    let activeNavItem = $derived(activeExperimentalItem ?? activeCoreItem);
    let currentViewLabel = $derived(activeNavItem?.name ?? "Dashboard");

    $effect(() => {
        if (
            !auth.loading &&
            !auth.user &&
            !isPublicRoute
        ) {
            goto("/ui/login");
        }
    });
</script>

<svelte:head>
    <link rel="icon" href={favicon} />
</svelte:head>

{#if isPublicRoute}
    {@render children()}
{:else if auth.loading}
    <div
        class="flex h-screen w-screen items-center justify-center bg-slate-100 dark:bg-slate-950"
    >
        <LoadingSpinner size="xl" />
    </div>
{:else if auth.user}
    <div class="min-h-screen bg-transparent text-slate-900 dark:text-slate-100">
        <!-- Top header bar -->
        <header
            class="sticky top-0 z-40 border-b border-slate-200/80 bg-white/92 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/88"
        >
            <!-- Row 1: Logo + actions -->
            <div class="flex h-14 items-center gap-4 px-4 sm:px-6 lg:px-8">
                <a href="/ui" class="flex shrink-0 items-center gap-2.5">
                    <span
                        class="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-xs font-bold uppercase tracking-[0.15em] text-white shadow-sm"
                    >
                        WC
                    </span>
                    <span class="hidden text-[0.95rem] font-semibold tracking-tight text-slate-900 dark:text-white sm:block">
                        WordClaw
                    </span>
                </a>

                <div class="h-5 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block"></div>

                <span class="text-sm font-medium text-slate-900 dark:text-white sm:hidden">
                    {currentViewLabel}
                </span>

                <div class="ml-auto flex items-center gap-2">
                    <DomainDropdown
                        {currentDomain}
                        onSelect={selectDomain}
                        options={domainOptions}
                    />

                    <button
                        type="button"
                        class="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                        onclick={handleThemeToggle}
                        aria-label="Toggle theme"
                        title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                    >
                        {#if theme === "dark"}
                            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="4"></circle>
                                <path d="M12 2v2"></path><path d="M12 20v2"></path>
                                <path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path>
                                <path d="M2 12h2"></path><path d="M20 12h2"></path>
                                <path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path>
                            </svg>
                        {:else}
                            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"></path>
                            </svg>
                        {/if}
                    </button>

                    <div bind:this={userMenuRef} class="relative">
                        <button
                            type="button"
                            class="flex h-8 items-center gap-2 rounded-md px-2 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                            onclick={(event) => { event.stopPropagation(); showUserMenu = !showUserMenu; }}
                            aria-label="Open user menu"
                            aria-expanded={showUserMenu}
                        >
                            <span class="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[0.6rem] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                                {initialsFromEmail(auth.user?.email)}
                            </span>
                            <span class="hidden max-w-[10rem] truncate text-xs font-medium text-slate-700 dark:text-slate-300 sm:block">
                                {auth.user?.email}
                            </span>
                        </button>

                        {#if showUserMenu}
                            <div class="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-800 dark:bg-slate-950">
                                <div class="rounded-sm bg-slate-50/80 px-3 py-2.5 dark:bg-slate-900/60">
                                    <div class="text-sm font-medium text-slate-900 dark:text-slate-100">{auth.user?.email}</div>
                                    <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                        {selectedDomainLabel} · WordClaw Supervisor
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    class="mt-1 flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
                                    onclick={handleLogout}
                                >
                                    Sign out
                                    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                                        <path d="m16 17 5-5-5-5"></path>
                                        <path d="M21 12H9"></path>
                                    </svg>
                                </button>
                            </div>
                        {/if}
                    </div>

                    <!-- Mobile hamburger -->
                    <button
                        type="button"
                        class="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white md:hidden"
                        onclick={toggleMobileMenu}
                        aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
                    >
                        <Icon src={mobileMenuOpen ? XMark : Bars3} class="h-5 w-5" />
                    </button>
                </div>
            </div>

            <!-- Row 2: Nav links (desktop) -->
            <nav class="hidden items-center gap-0.5 overflow-x-auto px-4 pb-2 sm:px-6 md:flex lg:px-8">
                {#each navGroups as group, groupIdx}
                    {#if groupIdx > 0}
                        <div class="mx-1.5 h-4 w-px shrink-0 bg-slate-200 dark:bg-slate-800"></div>
                    {/if}
                    {#each group.items as item}
                        {@const isActive = item.match(currentPath)}
                        <a
                            href={item.href}
                            class={`group flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.8rem] font-medium transition-colors ${isActive ? "bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-950" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"}`}
                            onclick={handleNavClick}
                        >
                            <Icon src={item.icon} class={`h-3.5 w-3.5 ${navIconClass(isActive)}`} />
                            {item.name}
                        </a>
                    {/each}
                {/each}

                {#if shouldShowExperimentalNav}
                    <div class="mx-1.5 h-4 w-px shrink-0 bg-amber-300/50 dark:bg-amber-800/50"></div>
                    {#each experimentalNavItems as item}
                        {@const isActive = item.match(currentPath)}
                        <a
                            href={item.href}
                            class={`group flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.8rem] font-medium transition-colors ${isActive ? "bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-950" : "text-amber-600/80 hover:bg-amber-50 hover:text-amber-800 dark:text-amber-400/80 dark:hover:bg-amber-950/30 dark:hover:text-amber-300"}`}
                            onclick={handleNavClick}
                        >
                            <Icon src={item.icon} class={`h-3.5 w-3.5 ${navIconClass(isActive, true)}`} />
                            {item.name}
                        </a>
                    {/each}
                    <button
                        type="button"
                        class="ml-0.5 shrink-0 rounded px-1.5 py-1 text-[0.65rem] font-medium text-slate-400 transition-colors hover:text-amber-700 dark:text-slate-500 dark:hover:text-amber-300"
                        onclick={() => setExperimentalVisibility(false)}
                    >
                        Hide
                    </button>
                {:else}
                    <button
                        type="button"
                        class="ml-1 flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[0.75rem] font-medium text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
                        onclick={() => setExperimentalVisibility(true)}
                    >
                        <svg class="h-3 w-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M10 4v12"></path><path d="M4 10h12"></path>
                        </svg>
                        Lab
                    </button>
                {/if}
            </nav>

            <!-- Mobile nav dropdown -->
            {#if mobileMenuOpen}
                <nav class="border-t border-slate-200/60 bg-white px-4 py-3 dark:border-slate-800/60 dark:bg-slate-950 md:hidden">
                    {#each navGroups as group, groupIdx}
                        {#if groupIdx > 0}
                            <div class="my-2 h-px bg-slate-200/60 dark:bg-slate-800/60"></div>
                        {/if}
                        <p class="px-2 pb-1 pt-2 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                            {group.label}
                        </p>
                        {#each group.items as item}
                            {@const isActive = item.match(currentPath)}
                            <a
                                href={item.href}
                                class={`flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${isActive ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}
                                onclick={handleNavClick}
                            >
                                <Icon src={item.icon} class={`h-4 w-4 ${navIconClass(isActive)}`} />
                                {item.name}
                            </a>
                        {/each}
                    {/each}
                    {#if shouldShowExperimentalNav}
                        <div class="my-2 h-px bg-amber-200/60 dark:bg-amber-900/40"></div>
                        <p class="px-2 pb-1 pt-2 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-amber-600 dark:text-amber-400">
                            Lab
                        </p>
                        {#each experimentalNavItems as item}
                            {@const isActive = item.match(currentPath)}
                            <a
                                href={item.href}
                                class={`flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${isActive ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950" : "text-amber-600/80 hover:bg-amber-50 dark:text-amber-400/80 dark:hover:bg-amber-950/30"}`}
                                onclick={handleNavClick}
                            >
                                <Icon src={item.icon} class={`h-4 w-4 ${navIconClass(isActive, true)}`} />
                                {item.name}
                            </a>
                        {/each}
                    {/if}
                </nav>
            {/if}
        </header>

        <main class="min-h-[calc(100vh-7rem)]">
            <div class="wc-page-scroll mx-auto max-w-[80rem] px-4 py-6 sm:px-6 lg:px-8">
                {@render children()}
            </div>
        </main>
    </div>

    <Toast />
    <ConfirmDialog />
{/if}
