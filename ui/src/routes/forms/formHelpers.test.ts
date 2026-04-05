import { describe, expect, it, vi } from "vitest";
import {
    formatDate,
    formatRelativeDate,
    formVisibilityBadges,
    parseJsonInput,
    parseObjectJsonInput,
    emptyEditorState,
    currentDomainId,
} from "./formHelpers";

describe("formHelpers", () => {
    describe("formatDate", () => {
        it("returns a formatted date string", () => {
            const result = formatDate("2026-04-01T12:00:00.000Z");
            expect(typeof result).toBe("string");
            expect(result).not.toBe("Unknown");
        });

        it("returns Unknown for null", () => {
            expect(formatDate(null)).toBe("Unknown");
        });

        it("returns Unknown for invalid date", () => {
            expect(formatDate("not-a-date")).toBe("Unknown");
        });
    });

    describe("formatRelativeDate", () => {
        it("returns Unknown for null", () => {
            expect(formatRelativeDate(null)).toBe("Unknown");
        });

        it("returns Unknown for invalid date", () => {
            expect(formatRelativeDate("bad-date")).toBe("Unknown");
        });

        it("returns Just now for very recent dates", () => {
            const now = new Date().toISOString();
            expect(formatRelativeDate(now)).toBe("Just now");
        });

        it("returns hours ago for recent dates", () => {
            const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
            expect(formatRelativeDate(twoHoursAgo)).toBe("2h ago");
        });

        it("returns days ago for older dates", () => {
            const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
            expect(formatRelativeDate(threeDaysAgo)).toBe("3d ago");
        });
    });

    describe("formVisibilityBadges", () => {
        it("returns Active and Public badges for enabled forms", () => {
            const form = {
                active: true,
                publicRead: true,
                requirePayment: false,
            } as any;
            const badges = formVisibilityBadges(form);
            expect(badges).toContain("Active");
            expect(badges).toContain("Public contract");
            expect(badges).toContain("No payment");
        });

        it("returns Inactive and Private badges for disabled forms", () => {
            const form = {
                active: false,
                publicRead: false,
                requirePayment: true,
            } as any;
            const badges = formVisibilityBadges(form);
            expect(badges).toContain("Inactive");
            expect(badges).toContain("Private contract");
            expect(badges).toContain("L402 gated");
        });
    });

    describe("parseJsonInput", () => {
        it("parses valid JSON", () => {
            expect(parseJsonInput('{"key": "value"}', "Test")).toEqual({
                key: "value",
            });
        });

        it("parses JSON arrays", () => {
            expect(parseJsonInput("[1, 2, 3]", "Test")).toEqual([1, 2, 3]);
        });

        it("throws on invalid JSON", () => {
            expect(() => parseJsonInput("not json", "Fields")).toThrow(
                /Fields must be valid JSON/,
            );
        });
    });

    describe("parseObjectJsonInput", () => {
        it("parses valid JSON objects", () => {
            expect(parseObjectJsonInput('{"a": 1}', "Config")).toEqual({
                a: 1,
            });
        });

        it("throws on JSON arrays", () => {
            expect(() => parseObjectJsonInput("[1]", "Data")).toThrow(
                /Data must be a JSON object/,
            );
        });

        it("throws on primitive JSON values", () => {
            expect(() => parseObjectJsonInput('"hello"', "Data")).toThrow(
                /Data must be a JSON object/,
            );
        });
    });

    describe("emptyEditorState", () => {
        it("returns expected defaults", () => {
            const state = emptyEditorState();
            expect(state.id).toBeNull();
            expect(state.name).toBe("");
            expect(state.slug).toBe("");
            expect(state.active).toBe(true);
            expect(state.publicRead).toBe(true);
            expect(state.submissionStatus).toBe("draft");
            expect(state.requirePayment).toBe(false);
        });
    });

    describe("currentDomainId", () => {
        function stubStorage(value: string | null) {
            const storage = new Map<string, string>();
            if (value !== null) storage.set("__wc_domain_id", value);
            vi.stubGlobal("localStorage", {
                getItem: vi.fn((key: string) => storage.get(key) ?? null),
                setItem: vi.fn(),
                removeItem: vi.fn(),
                clear: vi.fn(),
            });
        }

        it("returns null when localStorage has no domain ID", () => {
            stubStorage(null);
            expect(currentDomainId()).toBeNull();
        });

        it("returns parsed domain ID from localStorage", () => {
            stubStorage("42");
            expect(currentDomainId()).toBe(42);
        });

        it("returns null for invalid domain ID", () => {
            stubStorage("abc");
            expect(currentDomainId()).toBeNull();
        });
    });
});
