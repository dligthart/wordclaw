import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ErrorBanner from "./ErrorBanner.svelte";

describe("ErrorBanner", () => {
    it("renders a title and error message from an Error object", () => {
        render(ErrorBanner, {
            props: {
                title: "Something went wrong",
                error: new Error("Connection failed"),
            },
        });
        expect(screen.getByText("Something went wrong")).toBeTruthy();
        expect(screen.getByText("Connection failed")).toBeTruthy();
    });

    it("renders a string error directly", () => {
        render(ErrorBanner, {
            props: {
                error: "Plain string error",
            },
        });
        expect(screen.getByText("Plain string error")).toBeTruthy();
    });

    it("renders a message prop when no error is provided", () => {
        render(ErrorBanner, {
            props: {
                message: "Fallback message",
            },
        });
        expect(screen.getByText("Fallback message")).toBeTruthy();
    });

    it("renders error code and remediation", () => {
        const apiError = {
            message: "Not found",
            code: "NOT_FOUND",
            remediation: "Check the resource ID.",
        };
        render(ErrorBanner, {
            props: { error: apiError },
        });
        expect(screen.getByText("Not found")).toBeTruthy();
        expect(screen.getByText("NOT_FOUND")).toBeTruthy();
        expect(screen.getByText("Check the resource ID.")).toBeTruthy();
    });

    it("renders details list", () => {
        render(ErrorBanner, {
            props: {
                message: "Multiple issues",
                details: ["Issue 1", "Issue 2"],
            },
        });
        expect(screen.getByText("Issue 1")).toBeTruthy();
        expect(screen.getByText("Issue 2")).toBeTruthy();
    });

    it("renders an action button and calls onAction", async () => {
        const onAction = vi.fn();
        render(ErrorBanner, {
            props: {
                message: "Error occurred",
                actionLabel: "Retry",
                onAction,
            },
        });
        const button = screen.getByText("Retry");
        expect(button).toBeTruthy();
        await fireEvent.click(button);
        expect(onAction).toHaveBeenCalledOnce();
    });

    it("has role=alert for accessibility", () => {
        render(ErrorBanner, {
            props: { message: "Test" },
        });
        expect(screen.getByRole("alert")).toBeTruthy();
    });

    it("renders code and remediation from props when no error object", () => {
        render(ErrorBanner, {
            props: {
                message: "Some error",
                code: "ERR_CODE",
                remediation: "Try again later.",
            },
        });
        expect(screen.getByText("ERR_CODE")).toBeTruthy();
        expect(screen.getByText("Try again later.")).toBeTruthy();
    });
});
