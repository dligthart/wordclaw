import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import KeysPage from "./+page.svelte";
import { fetchApi } from "$lib/api";
import { feedbackStore } from "$lib/ui-feedback.svelte";

const authState = vi.hoisted(() => ({
    auth: {
        user: null as null | {
            id: number;
            email: string;
            scope: "platform" | "tenant";
            domainId: number | null;
            domain: {
                id: number;
                name: string;
                hostname: string;
            } | null;
        },
        loading: false,
        error: null,
    },
}));

vi.mock("$lib/api", () => ({
    fetchApi: vi.fn(),
    ApiError: class extends Error {
        code = "API_ERROR";
        remediation?: string;
    },
}));

vi.mock("$lib/ui-feedback.svelte", () => ({
    feedbackStore: {
        openConfirm: vi.fn(),
        pushToast: vi.fn(),
    },
}));

vi.mock("$lib/auth.svelte", () => authState);

describe("Keys Page", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authState.auth.user = {
            id: 1,
            email: "platform@example.com",
            scope: "platform",
            domainId: null,
            domain: null,
        };
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

    it("submits tenant onboarding and reveals the bootstrap credential", async () => {
        let authKeyLoads = 0;
        vi.mocked(fetchApi).mockImplementation(async (endpoint, options = {}) => {
            if (endpoint === "/auth/keys" && (!options.method || options.method === "GET")) {
                authKeyLoads += 1;
                return {
                    data: authKeyLoads === 1
                        ? []
                        : [{
                            id: 91,
                            name: "ACME Publishing Admin",
                            keyPrefix: "wcak_123456",
                            scopes: ["admin"],
                            createdBy: null,
                            createdAt: "2026-03-31T10:00:00.000Z",
                            expiresAt: null,
                            revokedAt: null,
                            lastUsedAt: null,
                        }],
                };
            }

            if (endpoint === "/onboard" && options.method === "POST") {
                return {
                    data: {
                        bootstrap: true,
                        domain: {
                            id: 12,
                            name: "ACME Publishing",
                            hostname: "acme.example.com",
                            createdAt: "2026-03-31T10:00:00.000Z",
                        },
                        apiKey: {
                            id: 91,
                            name: "ACME Publishing Admin",
                            keyPrefix: "wcak_123456",
                            scopes: ["admin"],
                            expiresAt: null,
                            apiKey: "wcak_secret_value",
                        },
                        endpoints: {
                            api: "https://runtime.example.test/api",
                            mcp: "https://runtime.example.test/mcp",
                        },
                    },
                };
            }

            throw new Error(`Unexpected request: ${endpoint} ${options.method ?? "GET"}`);
        });

        render(KeysPage);

        await screen.findByText("No API keys yet");

        await fireEvent.click(screen.getByRole("button", { name: "Onboard Tenant" }));
        await fireEvent.input(screen.getByLabelText("Tenant Name"), {
            target: { value: "ACME Publishing" },
        });
        await fireEvent.input(screen.getByLabelText("Hostname"), {
            target: { value: "acme.example.com" },
        });
        await fireEvent.input(screen.getByLabelText("Operator Email"), {
            target: { value: "ops@acme.example.com" },
        });
        await fireEvent.input(screen.getByLabelText("Initial Key Name"), {
            target: { value: "ACME Publishing Admin" },
        });

        await fireEvent.click(screen.getByRole("button", { name: "Create Tenant" }));

        await waitFor(() => {
            expect(fetchApi).toHaveBeenCalledWith("/onboard", expect.objectContaining({
                method: "POST",
                body: JSON.stringify({
                    tenantName: "ACME Publishing",
                    hostname: "acme.example.com",
                    adminEmail: "ops@acme.example.com",
                    apiKeyName: "ACME Publishing Admin",
                }),
            }));
        });

        expect(await screen.findByText("Save this API Key")).toBeTruthy();
        expect(screen.getByText("ACME Publishing")).toBeTruthy();
        expect(screen.getByText("acme.example.com")).toBeTruthy();
        expect(screen.getByText("https://runtime.example.test/api")).toBeTruthy();
        expect(screen.getByText("https://runtime.example.test/mcp")).toBeTruthy();
        expect(screen.getByText("wcak_secret_value")).toBeTruthy();
        expect(localStorage.getItem("__wc_domain_id")).toBe("12");
        expect(feedbackStore.pushToast).toHaveBeenCalledWith(expect.objectContaining({
            severity: "success",
            title: "Tenant provisioned",
        }));
    });

    it("hides tenant onboarding controls for tenant-scoped supervisors", async () => {
        authState.auth.user = {
            id: 7,
            email: "tenant-admin@example.com",
            scope: "tenant",
            domainId: 12,
            domain: {
                id: 12,
                name: "ACME Publishing",
                hostname: "acme.example.com",
            },
        };

        vi.mocked(fetchApi).mockResolvedValue({
            data: [],
        });

        render(KeysPage);

        await screen.findByText("No API keys yet");

        expect(
            screen.queryByRole("button", { name: "Onboard Tenant" }),
        ).toBeNull();
        expect(
            screen.getByText(
                "Manage credentials for agents and operator integrations for the current tenant.",
            ),
        ).toBeTruthy();
    });
});
