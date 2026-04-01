import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FormsPage from "./+page.svelte";
import { fetchApi } from "$lib/api";
import { feedbackStore } from "$lib/ui-feedback.svelte";

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

describe("Forms Page", () => {
    beforeEach(() => {
        vi.clearAllMocks();
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

    it("creates a form with a workforce-backed draft generation config", async () => {
        let formsLoadCount = 0;
        vi.mocked(fetchApi).mockImplementation(async (endpoint, options = {}) => {
            if (endpoint === "/forms" && (!options.method || options.method === "GET")) {
                formsLoadCount += 1;
                return {
                    data: formsLoadCount === 1
                        ? []
                        : [{
                            id: 33,
                            domainId: 12,
                            name: "Proposal Intake",
                            slug: "proposal-intake",
                            description: "Collect proposal requirements from prospects.",
                            contentTypeId: 12,
                            contentTypeName: "Proposal Request",
                            contentTypeSlug: "proposal-request",
                            active: true,
                            publicRead: true,
                            submissionStatus: "draft",
                            workflowTransitionId: null,
                            requirePayment: false,
                            successMessage: "Thanks",
                            fields: [
                                {
                                    name: "email",
                                    label: "Email",
                                    type: "text",
                                    required: true,
                                },
                            ],
                            defaultData: {},
                            draftGeneration: {
                                targetContentTypeId: 13,
                                targetContentTypeName: "Proposal Draft",
                                targetContentTypeSlug: "proposal-draft",
                                workforceAgentId: 7,
                                workforceAgentSlug: "proposal-writer",
                                workforceAgentName: "Proposal Writer",
                                workforceAgentPurpose:
                                    "Draft software proposals from inbound forms.",
                                agentSoul: "software-proposal-writer",
                                fieldMap: {
                                    requirements: "brief",
                                },
                                defaultData: {
                                    title: "Draft proposal",
                                },
                                postGenerationWorkflowTransitionId: null,
                                provider: {
                                    type: "openai",
                                    model: "gpt-4o",
                                    instructions: "Write concise proposals.",
                                },
                            },
                            createdAt: "2026-04-01T12:00:00.000Z",
                            updatedAt: "2026-04-01T12:00:00.000Z",
                        }],
                };
            }

            if (endpoint === "/content-types") {
                return {
                    data: [
                        {
                            id: 12,
                            name: "Proposal Request",
                            slug: "proposal-request",
                            kind: "collection",
                        },
                        {
                            id: 13,
                            name: "Proposal Draft",
                            slug: "proposal-draft",
                            kind: "collection",
                        },
                    ],
                };
            }

            if (endpoint === "/workforce/agents") {
                return {
                    data: [
                        {
                            id: 7,
                            domainId: 12,
                            name: "Proposal Writer",
                            slug: "proposal-writer",
                            purpose: "Draft software proposals from inbound forms.",
                            soul: "software-proposal-writer",
                            provider: {
                                type: "openai",
                                model: "gpt-4o",
                                instructions: "Write concise proposals.",
                            },
                            active: true,
                            createdAt: "2026-04-01T12:00:00.000Z",
                            updatedAt: "2026-04-01T12:00:00.000Z",
                        },
                    ],
                };
            }

            if (endpoint === "/forms" && options.method === "POST") {
                return {
                    data: {
                        id: 33,
                        domainId: 12,
                        name: "Proposal Intake",
                        slug: "proposal-intake",
                        description: "Collect proposal requirements from prospects.",
                        contentTypeId: 12,
                        contentTypeName: "Proposal Request",
                        contentTypeSlug: "proposal-request",
                        active: true,
                        publicRead: true,
                        submissionStatus: "draft",
                        workflowTransitionId: null,
                        requirePayment: false,
                        successMessage: "Thanks",
                        fields: [
                            {
                                name: "email",
                                label: "Email",
                                type: "text",
                                required: true,
                            },
                        ],
                        defaultData: {},
                        draftGeneration: {
                            targetContentTypeId: 13,
                            targetContentTypeName: "Proposal Draft",
                            targetContentTypeSlug: "proposal-draft",
                            workforceAgentId: 7,
                            workforceAgentSlug: "proposal-writer",
                            workforceAgentName: "Proposal Writer",
                            workforceAgentPurpose:
                                "Draft software proposals from inbound forms.",
                            agentSoul: "software-proposal-writer",
                            fieldMap: {
                                requirements: "brief",
                            },
                            defaultData: {
                                title: "Draft proposal",
                            },
                            postGenerationWorkflowTransitionId: null,
                            provider: {
                                type: "openai",
                                model: "gpt-4o",
                                instructions: "Write concise proposals.",
                            },
                        },
                        createdAt: "2026-04-01T12:00:00.000Z",
                        updatedAt: "2026-04-01T12:00:00.000Z",
                    },
                };
            }

            if (endpoint === "/forms/33") {
                return {
                    data: {
                        id: 33,
                        domainId: 12,
                        name: "Proposal Intake",
                        slug: "proposal-intake",
                        description: "Collect proposal requirements from prospects.",
                        contentTypeId: 12,
                        contentTypeName: "Proposal Request",
                        contentTypeSlug: "proposal-request",
                        active: true,
                        publicRead: true,
                        submissionStatus: "draft",
                        workflowTransitionId: null,
                        requirePayment: false,
                        successMessage: "Thanks",
                        fields: [
                            {
                                name: "email",
                                label: "Email",
                                type: "text",
                                required: true,
                            },
                        ],
                        defaultData: {},
                        draftGeneration: {
                            targetContentTypeId: 13,
                            targetContentTypeName: "Proposal Draft",
                            targetContentTypeSlug: "proposal-draft",
                            workforceAgentId: 7,
                            workforceAgentSlug: "proposal-writer",
                            workforceAgentName: "Proposal Writer",
                            workforceAgentPurpose:
                                "Draft software proposals from inbound forms.",
                            agentSoul: "software-proposal-writer",
                            fieldMap: {
                                requirements: "brief",
                            },
                            defaultData: {
                                title: "Draft proposal",
                            },
                            postGenerationWorkflowTransitionId: null,
                            provider: {
                                type: "openai",
                                model: "gpt-4o",
                                instructions: "Write concise proposals.",
                            },
                        },
                        createdAt: "2026-04-01T12:00:00.000Z",
                        updatedAt: "2026-04-01T12:00:00.000Z",
                    },
                };
            }

            throw new Error(`Unexpected request: ${endpoint} ${options.method ?? "GET"}`);
        });

        render(FormsPage);

        await screen.findByText("No forms are configured for this domain yet.");

        await fireEvent.input(screen.getByLabelText("Name"), {
            target: { value: "Proposal Intake" },
        });
        await fireEvent.input(screen.getByLabelText("Slug"), {
            target: { value: "proposal-intake" },
        });
        await fireEvent.input(screen.getByLabelText("Description"), {
            target: {
                value: "Collect proposal requirements from prospects.",
            },
        });
        await fireEvent.change(screen.getByLabelText("Target content type"), {
            target: { value: "12" },
        });
        await fireEvent.click(
            screen.getByLabelText("Enable draft generation"),
        );
        await fireEvent.change(
            screen.getByLabelText("Draft target content type"),
            {
                target: { value: "13" },
            },
        );
        await fireEvent.change(screen.getByLabelText("Workforce agent"), {
            target: { value: "7" },
        });
        await fireEvent.input(
            screen.getByLabelText("Draft field map JSON"),
            {
                target: {
                    value: JSON.stringify({ requirements: "brief" }, null, 2),
                },
            },
        );
        await fireEvent.input(
            screen.getByLabelText("Draft default data JSON"),
            {
                target: {
                    value: JSON.stringify({ title: "Draft proposal" }, null, 2),
                },
            },
        );

        await fireEvent.click(screen.getByRole("button", { name: "Create form" }));

        await waitFor(() => {
            expect(fetchApi).toHaveBeenCalledWith("/forms", expect.objectContaining({
                method: "POST",
                body: JSON.stringify({
                    name: "Proposal Intake",
                    slug: "proposal-intake",
                    description: "Collect proposal requirements from prospects.",
                    contentTypeId: 12,
                    fields: [
                        {
                            name: "email",
                            label: "Email",
                            type: "text",
                            required: true,
                        },
                    ],
                    defaultData: {},
                    active: true,
                    publicRead: true,
                    submissionStatus: "draft",
                    workflowTransitionId: null,
                    requirePayment: false,
                    webhookUrl: undefined,
                    webhookSecret: undefined,
                    successMessage: undefined,
                    draftGeneration: {
                        targetContentTypeId: 13,
                        workforceAgentId: 7,
                        fieldMap: {
                            requirements: "brief",
                        },
                        defaultData: {
                            title: "Draft proposal",
                        },
                        postGenerationWorkflowTransitionId: null,
                    },
                }),
            }));
        });

        expect(feedbackStore.pushToast).toHaveBeenCalledWith(
            expect.objectContaining({
                severity: "success",
                title: "Form created",
            }),
        );
        expect(
            await screen.findByText(
                "Proposal Writer will supply the SOUL and provider defaults.",
            ),
        ).toBeTruthy();
    });
});
