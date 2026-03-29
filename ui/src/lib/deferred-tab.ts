export type DeferredTab = Pick<Window, "close"> & {
    location: Pick<Location, "replace">;
    opener: Window | null;
};

export function openDeferredTab(): DeferredTab | null {
    if (typeof window === "undefined" || typeof window.open !== "function") {
        return null;
    }

    const openedTab = window.open("", "_blank");
    if (!openedTab) {
        return null;
    }

    try {
        openedTab.opener = null;
    } catch {
        // Ignore browsers that do not allow mutating opener on the returned proxy.
    }

    return openedTab as DeferredTab;
}
