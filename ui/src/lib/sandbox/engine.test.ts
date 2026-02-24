import { describe, expect, it } from "vitest";
import type { Scenario } from "$lib/types/sandbox";
import { ScenarioEngine } from "./engine.svelte";

const replayScenario: Scenario = {
    id: "replay-scenario",
    title: "Replay Scenario",
    icon: "test",
    tagline: "Replay scenario for engine tests",
    differentiator: "Tests",
    steps: [
        {
            title: "Step 1",
            narration: "Create first value",
            method: "GET",
            endpoint: "/api/one",
            captureFromResponse: {
                firstId: "data.id",
            },
        },
        {
            title: "Step 2",
            narration: "Create second value",
            method: "GET",
            endpoint: "/api/two/{{firstId}}",
            captureFromResponse: {
                secondId: "data.id",
            },
        },
        {
            title: "Step 3",
            narration: "Use second value",
            method: "GET",
            endpoint: "/api/three/{{secondId}}",
        },
    ],
};

describe("ScenarioEngine replay behavior", () => {
    it("replays a non-initial step and clears downstream results", () => {
        const engine = new ScenarioEngine();
        engine.startScenario(replayScenario);

        engine.recordResult(200, { data: { id: 101 } }, 10);
        engine.advanceStep();
        engine.recordResult(200, { data: { id: 202 } }, 15);
        engine.advanceStep();
        engine.recordResult(200, { data: { ok: true } }, 18);
        engine.advanceStep();

        expect(engine.currentStepIndex).toBe(3);
        expect(engine.stepResults.size).toBe(3);
        expect(engine.capturedVars.get("firstId")).toBe(101);
        expect(engine.capturedVars.get("secondId")).toBe(202);

        const replayReady = engine.prepareReplayAt(1);
        expect(replayReady).toBe(true);
        expect(engine.currentStepIndex).toBe(1);
        expect(engine.stepResults.has(0)).toBe(true);
        expect(engine.stepResults.has(1)).toBe(false);
        expect(engine.stepResults.has(2)).toBe(false);
        expect(engine.capturedVars.get("firstId")).toBe(101);
        expect(engine.capturedVars.has("secondId")).toBe(false);
    });

    it("round-trips scenario snapshots", () => {
        const engine = new ScenarioEngine();
        engine.startScenario(replayScenario);
        engine.recordResult(200, { data: { id: 101 } }, 12);
        engine.advanceStep();
        engine.recordResult(200, { data: { id: 202 } }, 14);
        engine.advanceStep();

        const snapshot = engine.toSnapshot();
        expect(snapshot).not.toBeNull();

        const restored = new ScenarioEngine();
        restored.startScenario(replayScenario);
        restored.restoreFromSnapshot(snapshot!);

        expect(restored.currentStepIndex).toBe(2);
        expect(restored.stepResults.size).toBe(2);
        expect(restored.stepResults.get(0)?.status).toBe(200);
        expect(restored.stepResults.get(1)?.status).toBe(200);
        expect(restored.capturedVars.get("firstId")).toBe(101);
        expect(restored.capturedVars.get("secondId")).toBe(202);
    });
});
