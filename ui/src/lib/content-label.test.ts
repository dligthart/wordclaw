import { describe, expect, it } from "vitest";
import {
    resolveContentLabel,
    resolveContentSubtitle,
    resolveContentSummary,
    resolveContentSlug,
    resolveContentAttribution,
    resolveStructuredFieldCount,
    resolveContentTaskSummary,
    parseStructuredData,
    pickFirstString,
    truncate,
} from "./content-label";

describe("content-label", () => {
    describe("resolveContentLabel", () => {
        it("returns a title field from JSON string data", () => {
            const item = {
                id: 1,
                data: JSON.stringify({ title: "My Proposal", body: "..." }),
            };
            expect(resolveContentLabel(item)).toBe("My Proposal");
        });

        it("returns a name field when title is absent", () => {
            const item = {
                id: 2,
                data: JSON.stringify({ name: "Report Q4" }),
            };
            expect(resolveContentLabel(item)).toBe("Report Q4");
        });

        it("returns headline field", () => {
            const item = {
                id: 3,
                data: JSON.stringify({ headline: "Breaking News" }),
            };
            expect(resolveContentLabel(item)).toBe("Breaking News");
        });

        it("falls back to contentType name + id when no label field matches", () => {
            const item = { id: 42, data: JSON.stringify({ foo: "bar" }) };
            expect(resolveContentLabel(item, { name: "Article" })).toBe(
                "Article #42",
            );
        });

        it("falls back to Item #id when no content type is provided", () => {
            const item = { id: 99, data: JSON.stringify({ foo: "bar" }) };
            expect(resolveContentLabel(item)).toBe("Item #99");
        });

        it("handles object data (already parsed) directly", () => {
            const item = {
                id: 1,
                data: { title: "Already Parsed" },
            };
            expect(resolveContentLabel(item)).toBe("Already Parsed");
        });

        it("handles null data gracefully", () => {
            const item = { id: 5, data: null };
            expect(resolveContentLabel(item)).toBe("Item #5");
        });

        it("handles non-object data gracefully", () => {
            const item = { id: 6, data: "plain string" };
            expect(resolveContentLabel(item)).toBe("Item #6");
        });

        it("truncates very long labels", () => {
            const longTitle = "A".repeat(200);
            const item = {
                id: 1,
                data: JSON.stringify({ title: longTitle }),
            };
            const label = resolveContentLabel(item);
            expect(label.length).toBeLessThanOrEqual(120);
            expect(label.endsWith("…")).toBe(true);
        });
    });

    describe("resolveContentSubtitle", () => {
        it("returns a subtitle field that differs from the label", () => {
            const item = {
                id: 1,
                data: JSON.stringify({
                    title: "Proposal",
                    companyName: "ACME Corp",
                }),
            };
            expect(resolveContentSubtitle(item)).toBe("ACME Corp");
        });

        it("skips subtitle if it matches the primary label", () => {
            const item = {
                id: 1,
                data: JSON.stringify({
                    name: "Same Value",
                    projectName: "Same Value",
                }),
            };
            expect(resolveContentSubtitle(item)).toBeNull();
        });

        it("returns null when no subtitle fields are found", () => {
            const item = {
                id: 1,
                data: JSON.stringify({ title: "Just a title" }),
            };
            expect(resolveContentSubtitle(item)).toBeNull();
        });

        it("returns null for null data", () => {
            const item = { id: 1, data: null };
            expect(resolveContentSubtitle(item)).toBeNull();
        });
    });

    describe("resolveContentSummary", () => {
        it("returns summary field", () => {
            const item = {
                id: 1,
                data: JSON.stringify({
                    title: "X",
                    summary: "This is the summary.",
                }),
            };
            expect(resolveContentSummary(item)).toBe("This is the summary.");
        });

        it("falls back to description field", () => {
            const item = {
                id: 1,
                data: JSON.stringify({
                    title: "X",
                    description: "Description text.",
                }),
            };
            expect(resolveContentSummary(item)).toBe("Description text.");
        });

        it("returns null when no summary fields exist", () => {
            const item = {
                id: 1,
                data: JSON.stringify({ title: "X", email: "x@y.com" }),
            };
            expect(resolveContentSummary(item)).toBeNull();
        });
    });

    describe("resolveContentSlug", () => {
        it("returns slug field", () => {
            const item = {
                id: 1,
                data: JSON.stringify({ slug: "my-post" }),
            };
            expect(resolveContentSlug(item)).toBe("my-post");
        });

        it("returns null when no slug field exists", () => {
            const item = {
                id: 1,
                data: JSON.stringify({ title: "X" }),
            };
            expect(resolveContentSlug(item)).toBeNull();
        });
    });

    describe("resolveContentAttribution", () => {
        it("returns author field", () => {
            const item = {
                id: 1,
                data: JSON.stringify({ author: "Jane Doe" }),
            };
            expect(resolveContentAttribution(item)).toBe("Jane Doe");
        });

        it("falls back to owner when no author", () => {
            const item = {
                id: 1,
                data: JSON.stringify({ owner: "Tech Lead" }),
            };
            expect(resolveContentAttribution(item)).toBe("Tech Lead");
        });

        it("returns null when no attribution fields exist", () => {
            const item = {
                id: 1,
                data: JSON.stringify({ title: "X" }),
            };
            expect(resolveContentAttribution(item)).toBeNull();
        });
    });

    describe("resolveStructuredFieldCount", () => {
        it("counts the structured fields", () => {
            const item = {
                id: 1,
                data: JSON.stringify({ a: 1, b: 2, c: 3 }),
            };
            expect(resolveStructuredFieldCount(item)).toBe(3);
        });

        it("returns null for null data", () => {
            const item = { id: 1, data: null };
            expect(resolveStructuredFieldCount(item)).toBeNull();
        });
    });

    describe("resolveContentTaskSummary", () => {
        it("returns summary when available", () => {
            const item = {
                id: 1,
                data: JSON.stringify({ summary: "Ready for review." }),
            };
            expect(resolveContentTaskSummary(item)).toBe("Ready for review.");
        });

        it("falls back to field count message", () => {
            const item = {
                id: 1,
                data: JSON.stringify({ x: 1 }),
            };
            expect(resolveContentTaskSummary(item)).toBe(
                "1 structured field submitted. Open the payload only if you need the raw content.",
            );
        });

        it("uses plural for multiple fields", () => {
            const item = {
                id: 1,
                data: JSON.stringify({ x: 1, y: 2 }),
            };
            expect(resolveContentTaskSummary(item)).toContain("2 structured fields");
        });

        it("returns default message for null data", () => {
            const item = { id: 1, data: null };
            expect(resolveContentTaskSummary(item)).toBe(
                "Review the submitted payload before moving this item through the workflow.",
            );
        });
    });

    describe("parseStructuredData", () => {
        it("parses a JSON string", () => {
            expect(parseStructuredData('{"a": 1}')).toEqual({ a: 1 });
        });

        it("returns null for arrays", () => {
            expect(parseStructuredData("[1, 2]")).toBeNull();
        });

        it("returns null for non-string non-object values", () => {
            expect(parseStructuredData(42)).toBeNull();
        });

        it("returns objects directly", () => {
            expect(parseStructuredData({ key: "val" })).toEqual({ key: "val" });
        });
    });

    describe("pickFirstString", () => {
        it("returns the first non-empty matching key", () => {
            const record = { a: "", b: "  ", c: "found" };
            expect(pickFirstString(record, ["a", "b", "c"])).toBe("found");
        });

        it("returns null if no matching keys found", () => {
            expect(pickFirstString({ a: 1 }, ["b"])).toBeNull();
        });

        it("returns null for null record", () => {
            expect(pickFirstString(null, ["a"])).toBeNull();
        });
    });

    describe("truncate", () => {
        it("does not truncate short strings", () => {
            expect(truncate("hello", 10)).toBe("hello");
        });

        it("truncates long strings with ellipsis", () => {
            const result = truncate("A".repeat(200), 50);
            expect(result.length).toBe(50);
            expect(result.endsWith("…")).toBe(true);
        });
    });
});
