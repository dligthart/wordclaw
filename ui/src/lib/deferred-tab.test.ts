import { afterEach, describe, expect, it, vi } from "vitest";

import { openDeferredTab } from "./deferred-tab";

describe("openDeferredTab", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("opens a blank tab immediately and clears its opener", () => {
        const openedTab = {
            opener: window,
            location: {
                replace: vi.fn(),
            },
            close: vi.fn(),
        } as unknown as Window;

        const openSpy = vi.spyOn(window, "open").mockReturnValue(openedTab);

        const result = openDeferredTab();

        expect(openSpy).toHaveBeenCalledWith("", "_blank");
        expect(result).toBe(openedTab);
        expect(openedTab.opener).toBeNull();
    });

    it("returns null when the browser blocks the popup", () => {
        vi.spyOn(window, "open").mockReturnValue(null);

        expect(openDeferredTab()).toBeNull();
    });
});
