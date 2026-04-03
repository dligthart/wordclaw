import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gotoMock = vi.hoisted(() => vi.fn());
const fetchApiMock = vi.hoisted(() => vi.fn());
const reloadCurrentPageMock = vi.hoisted(() => vi.fn());
const pageStore = vi.hoisted(() => ({
    subscribe: (run: (value: { url: URL }) => void) => {
        run({ url: new URL("http://localhost/ui/forms") });
        return () => undefined;
    },
}));

vi.mock("$app/navigation", () => ({
    goto: gotoMock,
}));

vi.mock("$app/stores", () => ({
    page: pageStore,
}));

vi.mock("$lib/api", async () => {
    const actual = await vi.importActual<typeof import("$lib/api")>("$lib/api");
    return {
        ...actual,
        fetchApi: fetchApiMock,
    };
});

vi.mock("$lib/browser-navigation", () => ({
    reloadCurrentPage: reloadCurrentPageMock,
}));

import Layout from "./+layout.svelte";
import { auth } from "$lib/auth.svelte";

function childSnippet() {
    return createRawSnippet(() => ({
        render: () => '<div data-testid="layout-child">Child content</div>',
    }));
}

describe("Root Layout", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        auth.user = null;
        auth.loading = true;
        auth.error = null;

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
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("loads available domains once auth resolves after mount", async () => {
        fetchApiMock.mockImplementation(async (endpoint: string) => {
            if (endpoint === "/supervisors/me") {
                return {
                    id: 1,
                    email: "platform@example.com",
                    scope: "platform",
                    domainId: null,
                    domain: null,
                };
            }

            if (endpoint === "/domains") {
                return {
                    data: [
                        {
                            id: 12,
                            name: "ACME Publishing",
                            hostname: "acme.example.com",
                        },
                        {
                            id: 18,
                            name: "Beta Media",
                            hostname: "beta.example.com",
                        },
                    ],
                };
            }

            throw new Error(`Unexpected request: ${endpoint}`);
        });

        render(Layout, {
            props: {
                children: childSnippet(),
            },
        });

        await waitFor(() => {
            expect(fetchApiMock).toHaveBeenCalledWith("/domains");
        });

        expect(
            await screen.findByRole("option", { name: "ACME Publishing" }),
        ).toBeTruthy();
        expect(
            screen.getByRole("option", { name: "Beta Media" }),
        ).toBeTruthy();
        expect(localStorage.getItem("__wc_domain_id")).toBe("12");
    });

    it("reloads the current page when switching domains", async () => {
        fetchApiMock.mockImplementation(async (endpoint: string) => {
            if (endpoint === "/supervisors/me") {
                return {
                    id: 7,
                    email: "tenant@example.com",
                    scope: "tenant",
                    domainId: 12,
                    domain: {
                        id: 12,
                        name: "ACME Publishing",
                        hostname: "acme.example.com",
                    },
                };
            }

            if (endpoint === "/domains") {
                return {
                    data: [
                        {
                            id: 12,
                            name: "ACME Publishing",
                            hostname: "acme.example.com",
                        },
                        {
                            id: 18,
                            name: "Beta Media",
                            hostname: "beta.example.com",
                        },
                    ],
                };
            }

            throw new Error(`Unexpected request: ${endpoint}`);
        });

        render(Layout, {
            props: {
                children: childSnippet(),
            },
        });

        const domainSelect = await screen.findByLabelText("Select domain");
        await waitFor(() => {
            expect((domainSelect as HTMLSelectElement).disabled).toBe(false);
        });

        await fireEvent.change(domainSelect, {
            target: { value: "18" },
        });

        expect(localStorage.getItem("__wc_domain_id")).toBe("18");
        expect(reloadCurrentPageMock).toHaveBeenCalledTimes(1);
    });
});
