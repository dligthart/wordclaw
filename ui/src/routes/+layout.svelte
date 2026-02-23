<script lang="ts">
    import "./layout.css";
    import favicon from "$lib/assets/favicon.svg";
    import { page } from "$app/stores";
    import { auth, checkAuth, logout } from "$lib/auth.svelte";
    import { fetchApi } from "$lib/api";
    import DomainDropdown from "$lib/components/DomainDropdown.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    import Toast from "$lib/components/Toast.svelte";
    import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
    import { Icon } from "svelte-hero-icons";
    import {
        Home,
        ClipboardDocumentList,
        Folder,
        CircleStack,
        Key,
        CheckCircle,
        CodeBracketSquare,
        CreditCard,
        XMark,
        Bars3,
        MagnifyingGlass,
        Bell,
    } from "svelte-hero-icons";
    import {
        Navbar,
        NavBrand,
        NavHamburger,
        Sidebar,
        SidebarGroup,
        SidebarItem,
        SidebarWrapper,
        Select,
        Button,
        Dropdown,
        DropdownItem,
        DropdownHeader,
        DropdownDivider,
        Avatar,
        DarkMode,
    } from "flowbite-svelte";

    let { children } = $props();
    let isSidebarOpen = $state(false);
    let currentDomain = $state("1");
    let domainOptions = $state<{ id: string; label: string }[]>([
        { id: "1", label: "Domain 1" },
        { id: "2", label: "Domain 2" },
    ]);

    onMount(async () => {
        const stored = localStorage.getItem("__wc_domain_id");
        if (stored) currentDomain = stored;
        await checkAuth();
        if (auth.user) {
            await loadDomains();
        }
    });

    async function loadDomains() {
        try {
            const res = await fetchApi("/domains");
            const fetched = (res.data as Array<{ id: number; name: string; hostname: string }>).map(
                (domain) => ({
                    id: String(domain.id),
                    label: domain.name || domain.hostname || `Domain ${domain.id}`,
                }),
            );
            if (fetched.length > 0) {
                domainOptions = fetched;
                if (!fetched.some((domain) => domain.id === currentDomain)) {
                    currentDomain = fetched[0].id;
                    localStorage.setItem("__wc_domain_id", currentDomain);
                }
            }
        } catch {
            // Keep fallback options when domain discovery is unavailable.
        }
    }

    async function selectDomain(domainId: string) {
        if (domainId === currentDomain) return;
        localStorage.setItem("__wc_domain_id", domainId);
        currentDomain = domainId;
        await goto($page.url.pathname + $page.url.search, {
            invalidateAll: true,
            replaceState: true,
            noScroll: true,
        });
    }

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

    // Nav Definitions mapping route substrings to Heroicons & names
    const navItems = [
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
            name: "Schema Manager",
            href: "/ui/schema",
            icon: CircleStack,
            match: (p: string) => p.includes("/schema"),
        },
        {
            name: "Agent Keys",
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
            name: "Agent Sandbox",
            href: "/ui/agent-sandbox",
            icon: CodeBracketSquare,
            match: (p: string) => p.includes("/agent-sandbox"),
        },
        {
            name: "Payments",
            href: "/ui/payments",
            icon: CreditCard,
            match: (p: string) => p.includes("/payments"),
        },
    ];

    let currentPath = $derived($page.url.pathname);

    // Active drawer function
    const toggleSidebar = () => {
        isSidebarOpen = !isSidebarOpen;
    };
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#if $page.url.pathname.endsWith("/login")}
    {@render children()}
{:else if auth.loading}
    <div
        class="h-screen w-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900"
    >
        <LoadingSpinner size="xl" />
    </div>
{:else if auth.user}
    <div
        class="min-h-screen bg-gray-50 dark:bg-gray-900 font-sans text-gray-900 dark:text-white"
    >
        <!-- Navbar Header -->
        <Navbar
            fluid={true}
            class="fixed w-full z-50 top-0 left-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5"
        >
            <NavBrand href="/ui" class="gap-3">
                <span
                    class="rounded bg-blue-600 px-2 py-1 text-xs font-bold text-white tracking-widest"
                    title="WordClaw Supervisor">WC</span
                >
                <span
                    class="self-center whitespace-nowrap text-xl font-semibold dark:text-white hidden sm:block"
                    >WordClaw SUPV</span
                >
            </NavBrand>
            <div class="flex items-center gap-4 md:order-2">
                <DomainDropdown
                    currentDomain={currentDomain}
                    onSelect={selectDomain}
                    options={domainOptions}
                />

                <!-- Dark Mode Toggle -->
                <DarkMode
                    class="text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 rounded-lg text-sm p-2"
                />

                <!-- Profile dropdown -->
                <Avatar id="user-menu" class="cursor-pointer" />
                <Dropdown triggeredBy="#user-menu">
                    <DropdownHeader class="px-4 py-3">
                        <span
                            class="block text-sm font-semibold text-gray-900 dark:text-white"
                            >{auth.user?.email}</span
                        >
                        <span
                            class="block truncate text-sm font-medium text-gray-500 dark:text-gray-400"
                            >WordClaw Supervisor</span
                        >
                    </DropdownHeader>
                    <DropdownDivider />
                    <DropdownItem
                        onclick={handleLogout}
                        class="text-red-600 dark:text-red-500 font-medium"
                        >Sign out</DropdownItem
                    >
                </Dropdown>

                <NavHamburger onclick={toggleSidebar} class="ml-2 md:hidden" />
            </div>
        </Navbar>

        <div class="flex overflow-hidden pt-16">
            <!-- Mobile Backdrop -->
            {#if isSidebarOpen}
                <div
                    class="fixed inset-0 z-30 bg-gray-900/50 dark:bg-gray-900/80 md:hidden"
                    onclick={toggleSidebar}
                    aria-hidden="true"
                ></div>
            {/if}

            <!-- Sidebar Component -->
            <Sidebar
                isOpen={isSidebarOpen}
                disableBreakpoints={true}
                class="fixed left-0 top-0 z-40 w-64 h-screen pt-16 bg-white border-r border-gray-200 transition-transform {isSidebarOpen
                    ? 'translate-x-0'
                    : '-translate-x-full'} md:translate-x-0 dark:bg-gray-800 dark:border-gray-700"
            >
                <SidebarWrapper
                    class="bg-transparent dark:bg-transparent px-3 py-4 overflow-y-auto"
                >
                    <SidebarGroup class="space-y-2">
                        {#each navItems as item}
                            <SidebarItem
                                label={item.name}
                                href={item.href}
                                active={item.match(currentPath)}
                                class="flex items-center p-2 text-gray-900 rounded-lg dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 group"
                            >
                                {#snippet icon()}
                                    <Icon
                                        src={item.icon}
                                        class="w-5 h-5 text-gray-500 transition duration-75 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white {item.match(
                                            currentPath,
                                        )
                                            ? 'text-blue-600 dark:text-blue-500'
                                            : ''}"
                                    />
                                {/snippet}
                            </SidebarItem>
                        {/each}
                    </SidebarGroup>
                </SidebarWrapper>
            </Sidebar>

            <!-- Main Content Area -->
            <main
                class="relative w-full h-[calc(100vh-4rem)] overflow-y-auto bg-gray-50 dark:bg-gray-900 md:ml-64 p-4 pt-8 lg:p-8 lg:pt-10 transition-all"
            >
                <div class="max-w-7xl mx-auto h-full">
                    {@render children()}
                </div>
            </main>
        </div>
    </div>

    <Toast />
    <ConfirmDialog />
{/if}
