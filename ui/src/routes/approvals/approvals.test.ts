import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ApprovalsPage from "./+page.svelte";
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

function buildTask(version: number) {
    return {
        task: {
            id: 44,
            contentItemId: 501,
            workflowTransitionId: 91,
            status: "pending",
            assignee: null,
            assigneeActorId: null,
            assigneeActorType: null,
            assigneeActorSource: null,
            createdAt: "2026-04-02T10:00:00.000Z",
            updatedAt: "2026-04-02T10:00:00.000Z",
        },
        transition: {
            id: 91,
            workflowId: 12,
            fromState: "draft",
            toState: "in_review",
            requiredRoles: ["admin"],
        },
        workflow: {
            id: 12,
            name: "Proposal Review",
        },
        contentItem: {
            id: 501,
            contentTypeId: 10,
            data: JSON.stringify({
                title: "Implementation Proposal",
                summary: "Initial generated summary.",
            }),
            status: "in_review",
            version,
            createdAt: "2026-04-02T10:00:00.000Z",
            updatedAt: "2026-04-02T10:00:00.000Z",
        },
        contentType: {
            id: 10,
            name: "Proposal Draft",
            slug: "proposal-draft",
        },
    };
}

describe("Approvals Page", () => {
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

    it("requests an agent revision and reloads the revised task", async () => {
        let queueLoads = 0;
        vi.mocked(fetchApi).mockImplementation(async (endpoint, options = {}) => {
            if (endpoint === "/review-tasks" && (!options.method || options.method === "GET")) {
                queueLoads += 1;
                return {
                    data: [buildTask(queueLoads === 1 ? 2 : 3)],
                };
            }

            if (endpoint === "/review-tasks/44/revise" && options.method === "POST") {
                return {
                    data: {
                        taskId: 44,
                        contentItemId: 501,
                        contentStatus: "in_review",
                        contentVersion: 3,
                        revisedAt: "2026-04-02T10:05:00.000Z",
                        strategy: "openai_structured_outputs_v1",
                        provider: {
                            type: "openai",
                            model: "gpt-4.1-mini",
                            responseId: "resp_123",
                        },
                    },
                };
            }

            throw new Error(`Unexpected request: ${endpoint} ${options.method ?? "GET"}`);
        });

        render(ApprovalsPage);

        await screen.findByRole("heading", {
            name: "Implementation Proposal",
        });

        await fireEvent.input(screen.getByLabelText("Agent Revision Prompt"), {
            target: {
                value: "Tighten the summary and make the rollout assumptions explicit.",
            },
        });
        await fireEvent.click(
            screen.getByRole("button", { name: "Revise With Agent" }),
        );

        await waitFor(() => {
            expect(fetchApi).toHaveBeenCalledWith(
                "/review-tasks/44/revise",
                expect.objectContaining({
                    method: "POST",
                    body: JSON.stringify({
                        prompt:
                            "Tighten the summary and make the rollout assumptions explicit.",
                    }),
                }),
            );
        });

        await waitFor(() => {
            expect(screen.getAllByText("v3").length).toBeGreaterThan(0);
        });

        expect(feedbackStore.pushToast).toHaveBeenCalledWith(
            expect.objectContaining({
                severity: "success",
                title: "Draft revised",
            }),
        );
    });
});
