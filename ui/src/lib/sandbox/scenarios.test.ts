import { describe, expect, it } from "vitest";
import { SCENARIOS } from "./scenarios";

describe("sandbox scenarios", () => {
    it("includes an executable MCP step in tri-protocol parity", () => {
        const triProtocol = SCENARIOS.find(
            (scenario) => scenario.id === "tri-protocol",
        );
        expect(triProtocol).toBeDefined();

        const mcpStep = triProtocol?.steps.find(
            (step) =>
                step.protocol === "MCP" &&
                step.endpoint === "/api/sandbox/mcp/execute",
        );
        expect(mcpStep).toBeDefined();
    });

    it("avoids hardcoded fallback IDs in scenario definitions", () => {
        const serializedScenarios = JSON.stringify(SCENARIOS);
        expect(serializedScenarios).not.toContain('"contentTypeId":1');
        expect(serializedScenarios).not.toContain('"x-wordclaw-domain":"9999"');
    });

    it("uses explicit domain A/B placeholders for tenant isolation", () => {
        const multiTenant = SCENARIOS.find(
            (scenario) => scenario.id === "multi-tenant",
        );
        expect(multiTenant).toBeDefined();

        const tenantIsolationStep = multiTenant?.steps.find(
            (step) => step.title === "Verify Domain B Isolation",
        );
        expect(tenantIsolationStep?.headers?.["x-wordclaw-domain"]).toBe(
            "{{domainBId}}",
        );
    });
});
