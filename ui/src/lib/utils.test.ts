import { describe, expect, it } from "vitest";
import { deepParseJson, formatJson } from "./utils";

describe("utils", () => {
    describe("deepParseJson", () => {
        it("parses a JSON string into an object", () => {
            expect(deepParseJson('{"a": 1}')).toEqual({ a: 1 });
        });

        it("recursively parses nested JSON strings", () => {
            const inner = JSON.stringify({ nested: true });
            const outer = JSON.stringify({ data: inner });
            const result = deepParseJson(outer);
            expect(result).toEqual({ data: { nested: true } });
        });

        it("returns non-JSON strings as-is", () => {
            expect(deepParseJson("hello world")).toBe("hello world");
        });

        it("parses arrays", () => {
            const arr = [1, JSON.stringify({ x: 2 })];
            const result = deepParseJson(arr);
            expect(result).toEqual([1, { x: 2 }]);
        });

        it("passes through numbers", () => {
            expect(deepParseJson(42)).toBe(42);
        });

        it("passes through null", () => {
            expect(deepParseJson(null)).toBeNull();
        });

        it("passes through boolean", () => {
            expect(deepParseJson(true)).toBe(true);
        });

        it("handles objects with nested JSON values", () => {
            const obj = { a: JSON.stringify({ b: 1 }), c: "plain" };
            const result = deepParseJson(obj);
            expect(result).toEqual({ a: { b: 1 }, c: "plain" });
        });
    });

    describe("formatJson", () => {
        it("formats an object as indented JSON", () => {
            const result = formatJson({ a: 1 }, 2);
            expect(result).toBe('{\n  "a": 1\n}');
        });

        it("returns 'null' for null input", () => {
            expect(formatJson(null)).toBe("null");
        });

        it("returns 'undefined' for undefined input", () => {
            expect(formatJson(undefined)).toBe("undefined");
        });

        it("deep-parses nested JSON strings before formatting", () => {
            const nested = JSON.stringify({ inner: true });
            const result = formatJson({ data: nested });
            const parsed = JSON.parse(result);
            expect(parsed.data).toEqual({ inner: true });
        });

        it("returns plain string as-is when not valid JSON", () => {
            expect(formatJson("plain text")).toBe("plain text");
        });
    });
});
