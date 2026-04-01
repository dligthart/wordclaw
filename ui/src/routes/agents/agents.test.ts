import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AgentsPage from "./+page.svelte";
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

describe("Agents Page", () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
    });

    it("keeps agent provisioning available when provider and workforce registries fail", async () => {
        vi.mocked(fetchApi).mockImplementation(async (endpoint, options = {}) => {
            if (endpoint === "/ai/providers" && (!options.method || options.method === "GET")) {
                throw new Error('Failed query: select "id" from "ai_provider_configs"');
            }

            if (endpoint === "/workforce/agents" && (!options.method || options.method === "GET")) {
                throw new Error('Failed query: select "id" from "workforce_agents"');
            }

            throw new Error(`Unexpected request: ${endpoint} ${options.method ?? "GET"}`);
        });

        render(AgentsPage);

        expect(await screen.findByText("Agent Provisioning")).toBeTruthy();
        expect(screen.queryByText("Agent provisioning unavailable")).toBeNull();
        expect(
            await screen.findByText(/Provider provisioning is unavailable right now\./),
        ).toBeTruthy();
        expect(
            screen.getByText(/Workforce agents are unavailable right now\./),
        ).toBeTruthy();
    });

    it("configures a tenant-scoped OpenAI provider", async () => {
        let providerLoads = 0;
        vi.mocked(fetchApi).mockImplementation(async (endpoint, options = {}) => {
            if (endpoint === "/ai/providers" && (!options.method || options.method === "GET")) {
                providerLoads += 1;
                return {
                    data: providerLoads === 1
                        ? []
                        : [{
                            id: 41,
                            domainId: 12,
                            provider: "openai",
                            configured: true,
                            maskedApiKey: "sk-o...7890",
                            defaultModel: "gpt-4o",
                            settings: {},
                            createdAt: "2026-04-01T10:00:00.000Z",
                            updatedAt: "2026-04-01T10:00:00.000Z",
                        }],
                };
            }

            if (endpoint === "/workforce/agents" && (!options.method || options.method === "GET")) {
                return {
                    data: [],
                };
            }

            if (endpoint === "/ai/providers/openai" && options.method === "PUT") {
                return {
                    data: {
                        id: 41,
                        domainId: 12,
                        provider: "openai",
                        configured: true,
                        maskedApiKey: "sk-o...7890",
                        defaultModel: "gpt-4o",
                        settings: {},
                        createdAt: "2026-04-01T10:00:00.000Z",
                        updatedAt: "2026-04-01T10:00:00.000Z",
                    },
                };
            }

            throw new Error(`Unexpected request: ${endpoint} ${options.method ?? "GET"}`);
        });

        render(AgentsPage);

        await screen.findByText("Tenant-scoped model credentials");
        expect(screen.getAllByText("Not configured").length).toBeGreaterThan(0);

        await fireEvent.click(screen.getByRole("button", { name: "Configure OpenAI" }));
        await fireEvent.input(screen.getByLabelText("API Key"), {
            target: { value: "sk-openai-1234567890" },
        });
        await fireEvent.input(screen.getByLabelText("Default Model"), {
            target: { value: "gpt-4o" },
        });
        await fireEvent.click(screen.getByRole("button", { name: "Save Provider" }));

        await waitFor(() => {
            expect(fetchApi).toHaveBeenCalledWith("/ai/providers/openai", expect.objectContaining({
                method: "PUT",
                body: JSON.stringify({
                    apiKey: "sk-openai-1234567890",
                    defaultModel: "gpt-4o",
                }),
            }));
        });

        expect(await screen.findByText("Configured")).toBeTruthy();
        expect(screen.getByText("sk-o...7890")).toBeTruthy();
        expect(feedbackStore.pushToast).toHaveBeenCalledWith(expect.objectContaining({
            severity: "success",
            title: "Provider configured",
        }));
    });

    it("creates a workforce agent with OpenAI model defaults", async () => {
        let workforceLoads = 0;
        vi.mocked(fetchApi).mockImplementation(async (endpoint, options = {}) => {
            if (endpoint === "/ai/providers" && (!options.method || options.method === "GET")) {
                return {
                    data: [{
                        id: 41,
                        domainId: 12,
                        provider: "openai",
                        configured: true,
                        maskedApiKey: "sk-o...7890",
                        defaultModel: "gpt-4o",
                        settings: {},
                        createdAt: "2026-04-01T10:00:00.000Z",
                        updatedAt: "2026-04-01T10:00:00.000Z",
                    }],
                };
            }

            if (endpoint === "/workforce/agents" && (!options.method || options.method === "GET")) {
                workforceLoads += 1;
                return {
                    data: workforceLoads === 1
                        ? []
                        : [{
                            id: 7,
                            domainId: 12,
                            name: "Software Proposal Writer",
                            slug: "software-proposal-writer",
                            purpose: "Draft software proposals from inbound requirement forms.",
                            soul: "You are a senior solution consultant who writes grounded software proposals.",
                            provider: {
                                type: "openai",
                                model: "gpt-4o",
                                instructions: "Produce concise proposals with assumptions.",
                            },
                            active: true,
                            createdAt: "2026-04-01T10:00:00.000Z",
                            updatedAt: "2026-04-01T10:00:00.000Z",
                        }],
                };
            }

            if (endpoint === "/workforce/agents" && options.method === "POST") {
                return {
                    data: {
                        id: 7,
                    },
                };
            }

            throw new Error(`Unexpected request: ${endpoint} ${options.method ?? "GET"}`);
        });

        render(AgentsPage);

        await screen.findByText(/No workforce agents yet/);

        await fireEvent.click(screen.getByRole("button", { name: "Add Agent" }));
        await fireEvent.input(screen.getByLabelText("Agent Name"), {
            target: { value: "Software Proposal Writer" },
        });
        await fireEvent.input(screen.getByLabelText("Slug"), {
            target: { value: "software-proposal-writer" },
        });
        await fireEvent.input(screen.getByLabelText("Purpose"), {
            target: { value: "Draft software proposals from inbound requirement forms." },
        });
        await fireEvent.input(screen.getByLabelText("SOUL"), {
            target: { value: "You are a senior solution consultant who writes grounded software proposals." },
        });
        await fireEvent.change(screen.getByLabelText("Provider"), {
            target: { value: "openai" },
        });
        await fireEvent.input(screen.getByLabelText("Model"), {
            target: { value: "gpt-4o" },
        });
        await fireEvent.input(screen.getByLabelText("Provider Instructions"), {
            target: { value: "Produce concise proposals with assumptions." },
        });

        await fireEvent.click(screen.getByRole("button", { name: "Save Agent" }));

        await waitFor(() => {
            expect(fetchApi).toHaveBeenCalledWith("/workforce/agents", expect.objectContaining({
                method: "POST",
                body: JSON.stringify({
                    name: "Software Proposal Writer",
                    slug: "software-proposal-writer",
                    purpose: "Draft software proposals from inbound requirement forms.",
                    soul: "You are a senior solution consultant who writes grounded software proposals.",
                    provider: {
                        type: "openai",
                        model: "gpt-4o",
                        instructions: "Produce concise proposals with assumptions.",
                    },
                    active: true,
                }),
            }));
        });

        expect(await screen.findByText("Software Proposal Writer")).toBeTruthy();
        expect(screen.getByText("software-proposal-writer · #7")).toBeTruthy();
        expect(screen.getByText("OpenAI / gpt-4o")).toBeTruthy();
        expect(feedbackStore.pushToast).toHaveBeenCalledWith(expect.objectContaining({
            severity: "success",
            title: "Agent created",
        }));
    });
});
