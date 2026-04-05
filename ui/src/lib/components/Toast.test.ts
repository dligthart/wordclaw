import { render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, afterEach } from "vitest";
import Toast from "./Toast.svelte";
import { feedbackStore } from "$lib/ui-feedback.svelte";

describe("Toast", () => {
    afterEach(() => {
        // Clear all toasts
        for (const toast of [...feedbackStore.toasts]) {
            feedbackStore.dismissToast(toast.id);
        }
    });

    it("does not render toasts when none are active", () => {
        render(Toast);
        expect(screen.queryByText("Some toast")).toBeNull();
    });

    it("renders a success toast", async () => {
        render(Toast);

        feedbackStore.pushToast({
            severity: "success",
            title: "Item created",
            message: "The item was created successfully.",
            autoDismissMs: 0,
        });

        await waitFor(() => {
            expect(screen.getByText("Item created")).toBeTruthy();
            expect(
                screen.getByText("The item was created successfully."),
            ).toBeTruthy();
        });
    });

    it("renders an error toast with code and remediation", async () => {
        render(Toast);

        feedbackStore.pushToast({
            severity: "error",
            title: "Request failed",
            message: "Server returned 500",
            code: "INTERNAL_ERROR",
            remediation: "Try again later.",
            autoDismissMs: 0,
        });

        await waitFor(() => {
            expect(screen.getByText("Request failed")).toBeTruthy();
            expect(screen.getByText("INTERNAL_ERROR")).toBeTruthy();
            expect(screen.getByText("Try again later.")).toBeTruthy();
        });
    });

    it("renders a warning toast", async () => {
        render(Toast);

        feedbackStore.pushToast({
            severity: "warning",
            title: "Rate limit approaching",
            autoDismissMs: 0,
        });

        await waitFor(() => {
            expect(screen.getByText("Rate limit approaching")).toBeTruthy();
        });
    });

    it("renders an info toast", async () => {
        render(Toast);

        feedbackStore.pushToast({
            severity: "info",
            title: "Processing",
            autoDismissMs: 0,
        });

        await waitFor(() => {
            expect(screen.getByText("Processing")).toBeTruthy();
        });
    });
});
