import { describe, expect, it } from "vitest";
import {
    inferActorType,
    inferActorSource,
    formatActorTypeLabel,
    formatActorSourceLabel,
    actorVariant,
    resolveActorIdentity,
} from "./actors";

describe("actors", () => {
    describe("inferActorType", () => {
        it("returns explicit actorType when provided", () => {
            expect(inferActorType("any-id", "supervisor")).toBe("supervisor");
        });

        it("infers api_key from prefix", () => {
            expect(inferActorType("api_key:42")).toBe("api_key");
        });

        it("infers env_key from prefix", () => {
            expect(inferActorType("env_key:MASTER")).toBe("env_key");
        });

        it("infers supervisor from prefix", () => {
            expect(inferActorType("supervisor:1")).toBe("supervisor");
        });

        it("infers mcp from mcp-local", () => {
            expect(inferActorType("mcp-local")).toBe("mcp");
        });

        it("infers anonymous", () => {
            expect(inferActorType("anonymous")).toBe("anonymous");
        });

        it("infers system", () => {
            expect(inferActorType("system")).toBe("system");
        });

        it("infers api_key from numeric ID", () => {
            expect(inferActorType("123")).toBe("api_key");
        });

        it("returns null for unrecognized actor ID", () => {
            expect(inferActorType("unknown-format")).toBeNull();
        });

        it("returns null for null inputs", () => {
            expect(inferActorType(null, null)).toBeNull();
        });
    });

    describe("inferActorSource", () => {
        it("returns explicit source when provided", () => {
            expect(inferActorSource("api_key:1", "api_key", "custom")).toBe("custom");
        });

        it("infers db for api_key type", () => {
            expect(inferActorSource("api_key:1")).toBe("db");
        });

        it("infers env for env_key type", () => {
            expect(inferActorSource("env_key:X")).toBe("env");
        });

        it("infers cookie for supervisor type", () => {
            expect(inferActorSource("supervisor:1")).toBe("cookie");
        });

        it("infers local for mcp type", () => {
            expect(inferActorSource("mcp-local")).toBe("local");
        });

        it("infers anonymous for anonymous type", () => {
            expect(inferActorSource("anonymous")).toBe("anonymous");
        });

        it("infers system for system type", () => {
            expect(inferActorSource("system")).toBe("system");
        });

        it("returns null for unknown type", () => {
            expect(inferActorSource("unknown-format")).toBeNull();
        });
    });

    describe("formatActorTypeLabel", () => {
        it("returns API key for api_key", () => {
            expect(formatActorTypeLabel("api_key")).toBe("API key");
        });

        it("returns Env key for env_key", () => {
            expect(formatActorTypeLabel("env_key")).toBe("Env key");
        });

        it("returns MCP for mcp", () => {
            expect(formatActorTypeLabel("mcp")).toBe("MCP");
        });

        it("title-cases other types", () => {
            expect(formatActorTypeLabel("external_requester")).toBe("External Requester");
        });

        it("returns null for null", () => {
            expect(formatActorTypeLabel(null)).toBeNull();
        });
    });

    describe("formatActorSourceLabel", () => {
        it("maps known sources", () => {
            expect(formatActorSourceLabel("db")).toBe("DB");
            expect(formatActorSourceLabel("env")).toBe("Env");
            expect(formatActorSourceLabel("cookie")).toBe("Cookie");
            expect(formatActorSourceLabel("local")).toBe("Local");
            expect(formatActorSourceLabel("anonymous")).toBe("Anonymous");
            expect(formatActorSourceLabel("system")).toBe("System");
            expect(formatActorSourceLabel("test")).toBe("Test");
        });

        it("title-cases unknown sources", () => {
            expect(formatActorSourceLabel("proposal_portal")).toBe("Proposal Portal");
        });

        it("returns null for null", () => {
            expect(formatActorSourceLabel(null)).toBeNull();
        });
    });

    describe("actorVariant", () => {
        it("returns info for supervisor", () => {
            expect(actorVariant("supervisor")).toBe("info");
        });

        it("returns muted for api_key", () => {
            expect(actorVariant("api_key")).toBe("muted");
        });

        it("returns warning for anonymous", () => {
            expect(actorVariant("anonymous")).toBe("warning");
        });

        it("returns danger for system", () => {
            expect(actorVariant("system")).toBe("danger");
        });

        it("returns outline for env_key", () => {
            expect(actorVariant("env_key")).toBe("outline");
        });

        it("returns muted for unknown type", () => {
            expect(actorVariant("custom")).toBe("muted");
        });
    });

    describe("resolveActorIdentity", () => {
        it("resolves a supervisor actor", () => {
            const result = resolveActorIdentity({
                actorId: "supervisor:1",
                actorType: "supervisor",
                actorSource: "cookie",
            });
            expect(result.actorType).toBe("supervisor");
            expect(result.actorTypeLabel).toBe("Supervisor");
            expect(result.actorSourceLabel).toBe("Cookie");
            expect(result.isFallback).toBe(false);
        });

        it("falls back to api_key from legacy user ID", () => {
            const result = resolveActorIdentity({
                legacyUserId: 42,
            });
            expect(result.actorId).toBe("api_key:42");
            expect(result.actorType).toBe("api_key");
            expect(result.isLegacyFallback).toBe(true);
        });

        it("returns fallback when no identity is available", () => {
            const result = resolveActorIdentity({});
            expect(result.isFallback).toBe(true);
            expect(result.fallbackLabel).toBe("System / unauthenticated");
        });

        it("uses custom fallback label", () => {
            const result = resolveActorIdentity({}, "Unknown actor");
            expect(result.fallbackLabel).toBe("Unknown actor");
        });
    });
});
