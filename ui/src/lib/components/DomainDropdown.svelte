<script lang="ts">
    import { Button, Dropdown, DropdownItem } from "flowbite-svelte";
    import { Icon } from "svelte-hero-icons";
    import { ChevronDown, Check } from "svelte-hero-icons";

    type DomainOption = {
        id: string;
        label: string;
    };

    let {
        currentDomain,
        onSelect,
        options = [
            { id: "1", label: "Domain 1" },
            { id: "2", label: "Domain 2" },
        ] as DomainOption[],
    }: {
        currentDomain: string;
        onSelect: (domainId: string) => void | Promise<void>;
        options?: DomainOption[];
    } = $props();

    const triggerId = "domain-menu";

    const selectedLabel = $derived(
        options.find((option) => option.id === currentDomain)?.label ?? "Select",
    );
</script>

<div
    class="hidden sm:flex items-center gap-2 pr-4 lg:pr-6 border-r border-gray-200 dark:border-gray-700"
>
    <span class="text-sm font-medium text-gray-500 dark:text-gray-400"
        >Domain:</span
    >
    <Button
        id={triggerId}
        color="alternative"
        size="sm"
        class="w-36 justify-between shrink-0 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-100"
    >
        {selectedLabel}
        <Icon
            src={ChevronDown}
            class="w-4 h-4 ml-2 text-gray-500 dark:text-gray-300"
        />
    </Button>
    <Dropdown triggeredBy={"#" + triggerId} class="w-36 shadow-lg z-50">
        {#each options as option (option.id)}
            <DropdownItem
                onclick={() => onSelect(option.id)}
                class="list-none marker:hidden"
            >
                <div class="flex items-center justify-between w-full">
                    {option.label}
                    {#if currentDomain === option.id}
                        <Icon
                            src={Check}
                            class="w-4 h-4 text-blue-600 dark:text-blue-400"
                        />
                    {/if}
                </div>
            </DropdownItem>
        {/each}
    </Dropdown>
</div>
