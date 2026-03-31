import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InvitePage from "./+page.svelte";

const gotoMock = vi.hoisted(() => vi.fn());
const fetchApiMock = vi.hoisted(() => vi.fn());
const checkAuthMock = vi.hoisted(() => vi.fn());

vi.mock("$app/navigation", () => ({
    goto: gotoMock,
}));

vi.mock("$lib/api", () => ({
    fetchApi: fetchApiMock,
}));

vi.mock("$lib/auth.svelte", () => ({
    checkAuth: checkAuthMock,
}));

describe("Invite Page", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.history.replaceState({}, "", "/ui/invite?token=invite-token-123");
    });

    it("loads invite details and accepts the invite", async () => {
        fetchApiMock.mockImplementation(async (endpoint: string, options?: RequestInit) => {
            if (endpoint === "/supervisors/invite/invite-token-123") {
                return {
                    email: "new-operator@example.com",
                    scope: "tenant",
                    domainId: 12,
                    domain: {
                        id: 12,
                        name: "ACME Publishing",
                        hostname: "acme.example.com",
                    },
                    expiresAt: "2026-04-03T16:00:00.000Z",
                };
            }

            if (endpoint === "/supervisors/invite/accept" && options?.method === "POST") {
                return {
                    ok: true,
                    supervisor: {
                        id: 18,
                        email: "new-operator@example.com",
                        scope: "tenant",
                        domainId: 12,
                        domain: {
                            id: 12,
                            name: "ACME Publishing",
                            hostname: "acme.example.com",
                        },
                    },
                };
            }

            throw new Error(`Unexpected request: ${endpoint}`);
        });

        render(InvitePage);

        expect(await screen.findByText("new-operator@example.com")).toBeTruthy();
        expect(screen.getByText("Scope: ACME Publishing")).toBeTruthy();

        await fireEvent.input(screen.getByLabelText("Password"), {
            target: { value: "super-secret-123" },
        });
        await fireEvent.input(screen.getByLabelText("Confirm Password"), {
            target: { value: "super-secret-123" },
        });
        await fireEvent.click(
            screen.getByRole("button", { name: "Create supervisor account" }),
        );

        await waitFor(() => {
            expect(fetchApiMock).toHaveBeenCalledWith("/supervisors/invite/accept", {
                method: "POST",
                body: JSON.stringify({
                    token: "invite-token-123",
                    password: "super-secret-123",
                }),
            });
        });
        expect(checkAuthMock).toHaveBeenCalledTimes(1);
        expect(gotoMock).toHaveBeenCalledWith("/ui");
    });
});
