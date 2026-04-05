import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, initializeTheme, toggleTheme } from "./theme";

describe("theme", () => {
    beforeEach(() => {
        vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
            matches: true,
            media: "(prefers-color-scheme: dark)",
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));

        const storage = new Map<string, string>();
        vi.stubGlobal("localStorage", {
            getItem: vi.fn((key: string) => storage.get(key) ?? null),
            setItem: vi.fn((key: string, value: string) => {
                storage.set(key, value);
            }),
            removeItem: vi.fn((key: string) => {
                storage.delete(key);
            }),
            clear: vi.fn(() => {
                storage.clear();
            }),
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.documentElement.classList.remove("dark");
    });

    describe("applyTheme", () => {
        it("applies dark theme to the document", () => {
            const result = applyTheme("dark");
            expect(result).toBe("dark");
            expect(document.documentElement.classList.contains("dark")).toBe(true);
            expect(document.documentElement.style.colorScheme).toBe("dark");
        });

        it("applies light theme to the document", () => {
            applyTheme("light");
            expect(document.documentElement.classList.contains("dark")).toBe(false);
            expect(document.documentElement.style.colorScheme).toBe("light");
        });

        it("persists theme to localStorage", () => {
            applyTheme("dark");
            expect(localStorage.setItem).toHaveBeenCalledWith("__wc_theme", "dark");
        });
    });

    describe("initializeTheme", () => {
        it("uses stored theme when available", () => {
            localStorage.setItem("__wc_theme", "light");
            const result = initializeTheme();
            expect(result).toBe("light");
        });

        it("falls back to system preference when no stored theme", () => {
            const result = initializeTheme();
            expect(result).toBe("dark");
        });

        it("uses light when system prefers light", () => {
            vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
                matches: false,
                media: "(prefers-color-scheme: dark)",
            }));
            const result = initializeTheme();
            expect(result).toBe("light");
        });
    });

    describe("toggleTheme", () => {
        it("toggles from dark to light", () => {
            const result = toggleTheme("dark");
            expect(result).toBe("light");
        });

        it("toggles from light to dark", () => {
            const result = toggleTheme("light");
            expect(result).toBe("dark");
        });

        it("detects current theme from document when no argument given", () => {
            document.documentElement.classList.add("dark");
            const result = toggleTheme();
            expect(result).toBe("light");
        });
    });
});
