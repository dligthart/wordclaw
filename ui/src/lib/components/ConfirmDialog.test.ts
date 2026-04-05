import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi, afterEach } from "vitest";
import ConfirmDialog from "./ConfirmDialog.svelte";
import { feedbackStore } from "$lib/ui-feedback.svelte";

describe("ConfirmDialog", () => {
    afterEach(() => {
        feedbackStore.closeConfirm();
    });

    it("does not render when no confirm request is active", () => {
        render(ConfirmDialog);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("renders the dialog when a confirm request is opened", async () => {
        render(ConfirmDialog);

        feedbackStore.openConfirm({
            title: "Delete item",
            message: "Are you sure you want to delete this item?",
            confirmLabel: "Delete",
            confirmIntent: "danger",
            onConfirm: async () => {},
        });

        await waitFor(() => {
            expect(screen.getByRole("dialog")).toBeTruthy();
        });

        expect(screen.getByText("Delete item")).toBeTruthy();
        expect(
            screen.getByText("Are you sure you want to delete this item?"),
        ).toBeTruthy();
        expect(screen.getByText("Delete")).toBeTruthy();
        expect(screen.getByText("Cancel")).toBeTruthy();
    });

    it("calls onConfirm and closes on confirm click", async () => {
        const onConfirm = vi.fn().mockResolvedValue(undefined);
        render(ConfirmDialog);

        feedbackStore.openConfirm({
            title: "Confirm action",
            message: "Proceed?",
            confirmLabel: "Yes",
            confirmIntent: "primary",
            onConfirm,
        });

        await waitFor(() => {
            expect(screen.getByText("Yes")).toBeTruthy();
        });

        await fireEvent.click(screen.getByText("Yes"));

        await waitFor(() => {
            expect(onConfirm).toHaveBeenCalledOnce();
            expect(screen.queryByRole("dialog")).toBeNull();
        });
    });

    it("closes on cancel click", async () => {
        render(ConfirmDialog);

        feedbackStore.openConfirm({
            title: "Confirm",
            message: "Proceed?",
            confirmLabel: "OK",
            confirmIntent: "primary",
            onConfirm: async () => {},
        });

        await waitFor(() => {
            expect(screen.getByText("Cancel")).toBeTruthy();
        });

        await fireEvent.click(screen.getByText("Cancel"));

        await waitFor(() => {
            expect(screen.queryByRole("dialog")).toBeNull();
        });
    });
});
