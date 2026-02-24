import type {
    Scenario,
    ScenarioEngineSnapshot,
    ScenarioStep,
    ScenarioStepResultSnapshot,
    StepResult,
} from "$lib/types/sandbox";

export class ScenarioEngine {
    activeScenario = $state<Scenario | null>(null);
    currentStepIndex = $state(0);
    stepResults = $state<Map<number, StepResult>>(new Map());
    capturedVars = $state<Map<string, any>>(new Map());

    startScenario(scenario: Scenario) {
        this.activeScenario = scenario;
        this.currentStepIndex = 0;
        this.stepResults = new Map();
        this.capturedVars = new Map();
    }

    resetScenario() {
        if (this.activeScenario) {
            this.startScenario(this.activeScenario);
        }
    }

    clearScenario() {
        this.activeScenario = null;
        this.currentStepIndex = 0;
        this.stepResults = new Map();
        this.capturedVars = new Map();
    }

    get currentStep(): ScenarioStep | null {
        if (!this.activeScenario) return null;
        if (this.currentStepIndex >= this.activeScenario.steps.length) return null;
        return this.activeScenario.steps[this.currentStepIndex];
    }

    get isComplete(): boolean {
        if (!this.activeScenario) return false;
        return this.currentStepIndex >= this.activeScenario.steps.length;
    }

    // A simple json path resolver. Supports arrays and dot notation: e.g. "data[0].id" or "data.id"
    resolvePath(obj: any, path: string): any {
        if (!obj || typeof obj !== "object") return undefined;
        try {
            // Replace brackets with dots to normalize: data[0].id -> data.0.id
            const normalizedPath = path.replace(/\[(\d+)\]/g, ".$1");
            const parts = normalizedPath.split(".");
            let current = obj;
            for (const part of parts) {
                if (current === undefined || current === null) return undefined;
                current = current[part];
            }
            return current;
        } catch {
            return undefined;
        }
    }

    recordResult(status: number, data: any, elapsed: number) {
        if (!this.activeScenario || !this.currentStep) return;

        const result: StepResult = { status, data, elapsed };
        this.stepResults.set(this.currentStepIndex, result);
        // Force reactivity update
        this.stepResults = new Map(this.stepResults);

        // Capture variables
        if (this.currentStep.captureFromResponse) {
            for (const [varName, path] of Object.entries(this.currentStep.captureFromResponse)) {
                const val = this.resolvePath(data, path);
                if (val !== undefined) {
                    this.capturedVars.set(varName, val);
                }
            }
            // Force reactivity update
            this.capturedVars = new Map(this.capturedVars);
        }
    }

    setStepIndex(index: number) {
        if (!this.activeScenario) return;
        const maxIndex = this.activeScenario.steps.length;
        if (!Number.isInteger(index) || index < 0 || index > maxIndex) {
            this.currentStepIndex = 0;
            return;
        }
        this.currentStepIndex = index;
    }

    removeStepResultsFrom(startIndex: number) {
        if (!this.activeScenario) return;
        let changed = false;
        const next = new Map(this.stepResults);
        for (const index of next.keys()) {
            if (index >= startIndex) {
                next.delete(index);
                changed = true;
            }
        }
        if (changed) {
            this.stepResults = next;
            this.rebuildCapturedVarsFromResults();
        }
    }

    prepareReplayAt(stepIndex: number): boolean {
        if (!this.activeScenario) return false;
        const maxStep = this.activeScenario.steps.length - 1;
        if (maxStep < 0) return false;

        const clamped = Math.max(0, Math.min(stepIndex, maxStep));
        this.setStepIndex(clamped);
        this.removeStepResultsFrom(clamped);
        return true;
    }

    advanceStep() {
        if (this.activeScenario && this.currentStepIndex < this.activeScenario.steps.length) {
            this.currentStepIndex++;
        }
    }

    // Interpolate {{vars}} in a string
    interpolateString(str: string): string {
        if (!str) return str;
        return str.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
            const trimmedName = varName.trim();
            if (this.capturedVars.has(trimmedName)) {
                return String(this.capturedVars.get(trimmedName));
            }
            return match;
        });
    }

    // Deep interpolate an object (mutates a copy)
    interpolateObject(obj: any): any {
        if (obj === null || obj === undefined) return obj;
        if (typeof obj === "string") {
            const interpolated = this.interpolateString(obj);
            // If the original string was an exact match like "{{id}}" and it parses as number, convert it
            // Simple heuristic to not pass "123" as string when it was meant to be a number ID.
            if (obj.match(/^\{\{[^}]+\}\}$/) && !isNaN(Number(interpolated))) {
                return Number(interpolated);
            }
            return interpolated;
        }
        if (Array.isArray(obj)) {
            return obj.map(item => this.interpolateObject(item));
        }
        if (typeof obj === "object") {
            const result: Record<string, any> = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = this.interpolateObject(value);
            }
            return result;
        }
        return obj;
    }

    get interpolatedEndpoint(): string {
        const step = this.currentStep;
        if (!step || !step.endpoint) return "";
        return this.interpolateString(step.endpoint);
    }

    get interpolatedBody(): Record<string, any> | undefined {
        const step = this.currentStep;
        if (!step || !step.body) return undefined;
        return this.interpolateObject(step.body);
    }

    toSnapshot(): ScenarioEngineSnapshot | null {
        if (!this.activeScenario) return null;
        const stepResults: ScenarioStepResultSnapshot[] = Array.from(this.stepResults.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([index, result]) => ({ index, result }));
        return {
            scenarioId: this.activeScenario.id,
            currentStepIndex: this.currentStepIndex,
            stepResults,
            capturedVars: Array.from(this.capturedVars.entries()),
        };
    }

    restoreFromSnapshot(snapshot: Partial<ScenarioEngineSnapshot>) {
        if (!this.activeScenario) return;
        const maxIndex = this.activeScenario.steps.length;

        const restoredResults = new Map<number, StepResult>();
        if (Array.isArray(snapshot.stepResults)) {
            for (const candidate of snapshot.stepResults) {
                const index = Number(candidate?.index);
                if (!Number.isInteger(index) || index < 0 || index >= maxIndex) {
                    continue;
                }
                const result = candidate?.result;
                if (!result || typeof result !== "object") {
                    continue;
                }
                restoredResults.set(index, {
                    status: Number(result.status),
                    data: result.data,
                    elapsed: Number(result.elapsed),
                });
            }
        }
        this.stepResults = restoredResults;

        if (Array.isArray(snapshot.capturedVars)) {
            const nextCaptured = new Map<string, any>();
            for (const entry of snapshot.capturedVars) {
                if (!Array.isArray(entry) || entry.length !== 2) continue;
                const key = String(entry[0]);
                nextCaptured.set(key, entry[1]);
            }
            this.capturedVars = nextCaptured;
        } else {
            this.rebuildCapturedVarsFromResults();
        }

        const maybeIndex = Number(snapshot.currentStepIndex);
        if (Number.isInteger(maybeIndex) && maybeIndex >= 0 && maybeIndex <= maxIndex) {
            this.currentStepIndex = maybeIndex;
        } else {
            this.currentStepIndex = 0;
        }
    }

    private rebuildCapturedVarsFromResults() {
        if (!this.activeScenario) {
            this.capturedVars = new Map();
            return;
        }

        const timestamp = this.capturedVars.get("timestamp");
        const nextCaptured = new Map<string, any>();
        for (const [index, result] of Array.from(this.stepResults.entries()).sort(
            (a, b) => a[0] - b[0],
        )) {
            const step = this.activeScenario.steps[index];
            if (!step?.captureFromResponse) continue;
            for (const [varName, path] of Object.entries(step.captureFromResponse)) {
                const value = this.resolvePath(result.data, path);
                if (value !== undefined) {
                    nextCaptured.set(varName, value);
                }
            }
        }

        if (timestamp !== undefined) {
            nextCaptured.set("timestamp", timestamp);
        }

        this.capturedVars = nextCaptured;
    }
}

// Ensure it's a singleton in svelte 5 context
export const engine = new ScenarioEngine();
