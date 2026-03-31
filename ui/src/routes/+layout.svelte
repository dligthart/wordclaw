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
        Key,
        CheckCircle,
        CodeBracketSquare,
        CreditCard,
        CheckBadge,
        Bars3,
        XMark,
    } from "svelte-hero-icons";

    let { children } = $props();

    let isSidebarOpen = $state(false);
    let isSidebarCollapsed = $state(false);
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

    type DomainRefreshEventDetail = {
        selectDomainId?: string;
    };

    const coreNavItems: NavItem[] = [
        {
            name: "Dashboard",
            href: "/ui",
            icon: Home,
            match: (p: string) => p === "/ui" || p === "/ui/",
        },
        {
            name: "Audit Logs",
            href: "/ui/audit-logs",
            icon: ClipboardDocumentList,
            match: (p: string) => p.includes("/audit-logs"),
        },
        {
            name: "Content Browser",
            href: "/ui/content",
            icon: Folder,
            match: (p: string) => p.includes("/content"),
        },
        {
            name: "Assets",
            href: "/ui/assets",
            icon: ArchiveBox,
            match: (p: string) => p.includes("/assets"),
        },
        {
            name: "Schema Manager",
            href: "/ui/schema",
            icon: CircleStack,
            match: (p: string) => p.includes("/schema"),
        },
        {
            name: "Forms",
            href: "/ui/forms",
            icon: ClipboardDocumentList,
            match: (p: string) => p.includes("/forms"),
        },
        {
            name: "API Keys",
            href: "/ui/keys",
            icon: Key,
            match: (p: string) => p.includes("/keys"),
        },
        {
            name: "Approval Queue",
            href: "/ui/approvals",
            icon: CheckCircle,
            match: (p: string) => p.includes("/approvals"),
        },
        {
            name: "Jobs",
            href: "/ui/jobs",
            icon: CircleStack,
            match: (p: string) => p.includes("/jobs"),
        },
        {
            name: "Payments",
            href: "/ui/payments",
            icon: CreditCard,
            match: (p: string) => p.includes("/payments"),
        },
        {
            name: "L402 Readiness",
            href: "/ui/l402-readiness",
            icon: CheckBadge,
            match: (p: string) => p.includes("/l402-readiness"),
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
        const storedSidebarCollapsed = localStorage.getItem(
            "__wc_sidebar_collapsed",
        );
        const storedExperimentalNav = localStorage.getItem(
            "__wc_show_experimental",
        );

        if (storedDomain) {
            currentDomain = storedDomain;
        } else {
            localStorage.setItem("__wc_domain_id", currentDomain);
        }

        isSidebarCollapsed = storedSidebarCollapsed === "true";
        showExperimentalNav = storedExperimentalNav === "true";

        void (async () => {
            await checkAuth();
            if (auth.user) {
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
        window.location.assign(
            $page.url.pathname + $page.url.search + $page.url.hash,
        );
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
        isSidebarOpen = false;
        showUserMenu = false;
    }

    function toggleSidebarCollapsed() {
        isSidebarCollapsed = !isSidebarCollapsed;
        localStorage.setItem(
            "__wc_sidebar_collapsed",
            isSidebarCollapsed ? "true" : "false",
        );
    }

    async function handleLogout() {
        showUserMenu = false;
        await logout();
        goto("/ui/login");
    }

    function toggleSidebar() {
        isSidebarOpen = !isSidebarOpen;
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
    let currentViewGroupLabel = $derived(
        activeExperimentalItem ? "Experimental surface" : "Core control plane",
    );
    let sidebarDesktopWidthClass = $derived(
        isSidebarCollapsed ? "md:w-[4.75rem]" : "md:w-[16rem]",
    );
    let mainDesktopOffsetClass = $derived(
        isSidebarCollapsed ? "md:pl-[4.75rem]" : "md:pl-[16rem]",
    );

    $effect(() => {
        if (
            !auth.loading &&
            !auth.user &&
            !$page.url.pathname.endsWith("/login")
        ) {
            goto("/ui/login");
        }
    });
</script>

<svelte:head>
    <link rel="icon" href={favicon} />
</svelte:head>

{#if $page.url.pathname.endsWith("/login")}
    {@render children()}
{:else if auth.loading}
    <div
        class="flex h-screen w-screen items-center justify-center bg-slate-100 dark:bg-slate-950"
    >
        <LoadingSpinner size="xl" />
    </div>
{:else if auth.user}
    <div class="min-h-screen bg-transparent text-slate-900 dark:text-slate-100">
        {#if isSidebarOpen}
            <button
                type="button"
                class="fixed inset-0 z-30 bg-slate-950/70 backdrop-blur-sm md:hidden"
                onclick={toggleSidebar}
                aria-label="Close navigation overlay"
            ></button>
        {/if}

        <aside
            class={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-200/80 bg-white/96 shadow-2xl transition-[width,transform] duration-200 ease-out dark:border-slate-800 dark:bg-slate-950/96 md:translate-x-0 ${sidebarDesktopWidthClass} ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
            <div
                class="flex h-16 items-center border-b border-slate-200/80 px-3 dark:border-slate-800"
            >
                <div
                    class={`flex items-center gap-3 ${isSidebarCollapsed ? "justify-center" : ""}`}
                >
                    <a
                        href="/ui"
                        class={`flex min-w-0 items-center gap-3 ${isSidebarCollapsed ? "justify-center" : ""}`}
                    >
                        <span
                            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold uppercase tracking-[0.18em] text-white shadow-sm"
                        >
                            WC
                        </span>
                        {#if !isSidebarCollapsed}
                            <div class="min-w-0">
                                <div
                                    class="truncate text-[1.05rem] font-semibold tracking-tight text-slate-900 dark:text-white"
                                >
                                    WordClaw
                                </div>
                                <div
                                    class="mt-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400"
                                >
                                    Supervisor
                                </div>
                            </div>
                        {/if}
                    </a>
                </div>
            </div>

            <div
                class="wc-shell-scroll flex flex-1 flex-col overflow-y-auto px-3 py-4"
            >
                <div class="flex-1 space-y-5">
                    <section>
                        {#if !isSidebarCollapsed}
                            <p
                                class="px-2 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400"
                            >
                                Core Control Plane
                            </p>
                        {/if}
                        <nav
                            class={`space-y-1 ${isSidebarCollapsed ? "" : "mt-2.5"}`}
                        >
                            {#each coreNavItems as item}
                                {@const isActive = item.match(currentPath)}
                                <a
                                    href={item.href}
                                    class={`group flex items-center rounded-xl text-sm font-medium transition-colors ${isSidebarCollapsed ? "mx-auto h-11 w-11 justify-center" : "gap-3 px-3 py-2.5"} ${navLinkClass(isActive)}`}
                                    onclick={handleNavClick}
                                    title={item.name}
                                    aria-label={item.name}
                                >
                                    <Icon
                                        src={item.icon}
                                        class={`shrink-0 ${isSidebarCollapsed ? "h-5 w-5" : "h-[1.05rem] w-[1.05rem]"} ${navIconClass(isActive)}`}
                                    />
                                    {#if !isSidebarCollapsed}
                                        <span class="truncate">{item.name}</span
                                        >
                                    {/if}
                                </a>
                            {/each}
                        </nav>
                    </section>

                    <div class="mt-auto">
                        {#if shouldShowExperimentalNav}
                            <section
                                class={`${isSidebarCollapsed ? "border-t border-slate-200 pt-4 dark:border-slate-800" : "rounded-2xl border border-amber-200/70 bg-amber-50/60 p-3.5 dark:border-amber-900/40 dark:bg-amber-950/20"}`}
                            >
                                {#if !isSidebarCollapsed}
                                    <div
                                        class="flex items-center justify-between gap-3"
                                    >
                                        <p
                                            class="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-amber-700 dark:text-amber-300"
                                        >
                                            Experimental
                                        </p>
                                        {#if !activeExperimentalItem}
                                            <button
                                                type="button"
                                                class="text-xs font-medium text-slate-500 transition-colors hover:text-amber-700 dark:text-slate-400 dark:hover:text-amber-300"
                                                onclick={() =>
                                                    setExperimentalVisibility(
                                                        false,
                                                    )}
                                            >
                                                Hide
                                            </button>
                                        {/if}
                                    </div>
                                    <p
                                        class="mt-2.5 text-sm leading-6 text-slate-600 dark:text-slate-400"
                                    >
                                        These pages remain available for
                                        exploration, but they sit outside the
                                        default supported workflow.
                                    </p>
                                {/if}
                                <nav
                                    class={`${isSidebarCollapsed ? "space-y-1" : "mt-3 space-y-1"}`}
                                >
                                    {#each experimentalNavItems as item}
                                        {@const isActive =
                                            item.match(currentPath)}
                                        <a
                                            href={item.href}
                                            class={`group flex items-center rounded-xl text-sm font-medium transition-colors ${isSidebarCollapsed ? "mx-auto h-11 w-11 justify-center" : "gap-3 px-3 py-2.5"} ${navLinkClass(isActive)}`}
                                            onclick={handleNavClick}
                                            title={item.name}
                                            aria-label={item.name}
                                        >
                                            <Icon
                                                src={item.icon}
                                                class={`shrink-0 ${isSidebarCollapsed ? "h-5 w-5" : "h-[1.05rem] w-[1.05rem]"} ${navIconClass(isActive, true)}`}
                                            />
                                            {#if !isSidebarCollapsed}
                                                <span class="truncate"
                                                    >{item.name}</span
                                                >
                                            {/if}
                                        </a>
                                    {/each}
                                </nav>
                            </section>
                        {:else if !isSidebarCollapsed}
                            <section
                                class="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/45"
                            >
                                <p
                                    class="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400"
                                >
                                    Experimental Hidden
                                </p>
                                <p
                                    class="mt-2.5 text-sm leading-6 text-slate-500 dark:text-slate-400"
                                >
                                    Incubator pages are hidden by default so
                                    navigation stays focused on supported
                                    workflows.
                                </p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    class="mt-4 w-full justify-center"
                                    onclick={() =>
                                        setExperimentalVisibility(true)}
                                >
                                    Show experimental pages
                                </Button>
                            </section>
                        {:else}
                            <section
                                class="border-t border-slate-200 pt-4 dark:border-slate-800"
                            >
                                <button
                                    type="button"
                                    class="mx-auto flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900/70 dark:hover:text-white"
                                    onclick={() =>
                                        setExperimentalVisibility(true)}
                                    title="Show experimental pages"
                                    aria-label="Show experimental pages"
                                >
                                    <svg
                                        class="h-5 w-5"
                                        viewBox="0 0 20 20"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="1.8"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                    >
                                        <path d="M10 4v12"></path>
                                        <path d="M4 10h12"></path>
                                    </svg>
                                </button>
                            </section>
                        {/if}
                    </div>
                </div>
            </div>
        </aside>

        <div
            class={`min-h-screen transition-[padding-left] duration-200 ease-out ${mainDesktopOffsetClass}`}
        >
            <header
                class="sticky top-0 z-30 border-b border-slate-200/80 bg-white/88 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/72"
            >
                <div class="flex h-16 items-center gap-3 px-5 sm:px-7 lg:px-10">
                    <button
                        type="button"
                        class="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white md:hidden"
                        onclick={toggleSidebar}
                        aria-label={isSidebarOpen
                            ? "Close navigation"
                            : "Open navigation"}
                    >
                        <Icon
                            src={isSidebarOpen ? XMark : Bars3}
                            class="h-5 w-5"
                        />
                    </button>

                    <button
                        type="button"
                        class="hidden h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white md:inline-flex"
                        onclick={toggleSidebarCollapsed}
                        aria-label={isSidebarCollapsed
                            ? "Expand sidebar"
                            : "Collapse sidebar"}
                        title={isSidebarCollapsed
                            ? "Expand sidebar"
                            : "Collapse sidebar"}
                    >
                        <svg
                            class="h-4 w-4"
                            viewBox="0 0 20 20"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.8"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        >
                            {#if isSidebarCollapsed}
                                <path d="m7 5 5 5-5 5"></path>
                            {:else}
                                <path d="m13 5-5 5 5 5"></path>
                            {/if}
                        </svg>
                    </button>

                    <div
                        class="hidden h-4 w-px bg-slate-200 dark:bg-slate-800 md:block"
                    ></div>

                    <div class="min-w-0 flex-1">
                        <div class="flex min-w-0 items-center gap-2 text-sm">
                            <span
                                class="hidden truncate text-slate-500 dark:text-slate-400 md:block"
                            >
                                {currentViewGroupLabel}
                            </span>
                            <span
                                class="hidden text-slate-300 dark:text-slate-700 md:block"
                            >
                                /
                            </span>
                            <span
                                class="truncate font-medium text-slate-900 dark:text-white"
                            >
                                {currentViewLabel}
                            </span>
                        </div>
                    </div>

                    <div class="ml-auto flex items-center gap-2.5">
                        <DomainDropdown
                            {currentDomain}
                            onSelect={selectDomain}
                            options={domainOptions}
                        />

                        <button
                            type="button"
                            class="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white"
                            onclick={handleThemeToggle}
                            aria-label="Toggle theme"
                            title={theme === "dark"
                                ? "Switch to light mode"
                                : "Switch to dark mode"}
                        >
                            {#if theme === "dark"}
                                <svg
                                    class="h-5 w-5"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.8"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                >
                                    <circle cx="12" cy="12" r="4"></circle>
                                    <path d="M12 2v2"></path>
                                    <path d="M12 20v2"></path>
                                    <path d="m4.93 4.93 1.41 1.41"></path>
                                    <path d="m17.66 17.66 1.41 1.41"></path>
                                    <path d="M2 12h2"></path>
                                    <path d="M20 12h2"></path>
                                    <path d="m6.34 17.66-1.41 1.41"></path>
                                    <path d="m19.07 4.93-1.41 1.41"></path>
                                </svg>
                            {:else}
                                <svg
                                    class="h-5 w-5"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.8"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                >
                                    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"
                                    ></path>
                                </svg>
                            {/if}
                        </button>

                        <div bind:this={userMenuRef} class="relative">
                            <button
                                type="button"
                                class="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950/70 dark:hover:bg-slate-900"
                                onclick={(event) => {
                                    event.stopPropagation();
                                    showUserMenu = !showUserMenu;
                                }}
                                aria-label="Open user menu"
                                aria-expanded={showUserMenu}
                            >
                                <div class="hidden min-w-0 text-right sm:block">
                                    <div
                                        class="truncate text-[0.82rem] font-medium leading-4 text-slate-800 dark:text-slate-100"
                                    >
                                        {auth.user?.email}
                                    </div>
                                    <div
                                        class="truncate pt-0.5 text-[0.65rem] leading-3 text-slate-500 dark:text-slate-400"
                                    >
                                        {selectedDomainLabel}
                                    </div>
                                </div>
                                <span
                                    class="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                >
                                    {initialsFromEmail(auth.user?.email)}
                                </span>
                            </button>

                            {#if showUserMenu}
                                <div
                                    class="absolute right-0 top-full z-50 mt-2 w-72 rounded-md border border-slate-200 bg-white p-1 shadow-2xl dark:border-slate-800 dark:bg-slate-950"
                                >
                                    <div
                                        class="rounded-sm bg-slate-50/80 px-3 py-3 dark:bg-slate-900/60"
                                    >
                                        <div
                                            class="text-sm font-medium text-slate-900 dark:text-slate-100"
                                        >
                                            {auth.user?.email}
                                        </div>
                                        <div
                                            class="mt-1 text-xs text-slate-500 dark:text-slate-400"
                                        >
                                            WordClaw Supervisor
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        class="mt-1 flex w-full items-center justify-between rounded-sm px-3 py-2.5 text-left text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
                                        onclick={handleLogout}
                                    >
                                        Sign out
                                        <svg
                                            class="h-4 w-4"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="1.8"
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                        >
                                            <path
                                                d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
                                            ></path>
                                            <path d="m16 17 5-5-5-5"></path>
                                            <path d="M21 12H9"></path>
                                        </svg>
                                    </button>
                                </div>
                            {/if}
                        </div>
                    </div>
                </div>
            </header>

            <main class="min-h-[calc(100vh-4rem)]">
                <div
                    class="wc-page-scroll mx-auto max-w-[76rem] px-5 py-7 sm:px-7 lg:px-10"
                >
                    {@render children()}
                </div>
            </main>
        </div>
    </div>

    <Toast />
    <ConfirmDialog />
{/if}
