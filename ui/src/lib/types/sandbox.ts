export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
export type ScenarioProtocol = "REST" | "GRAPHQL" | "MCP";

export type ScenarioStep = {
    title: string;
    narration: string;
    method: HttpMethod;
    endpoint: string;
    protocol?: ScenarioProtocol;
    body?: Record<string, any>;
    headers?: Record<string, string>;
    expectedStatus?: number;
    captureFromResponse?: {
        [varName: string]: string; // JSONPath-like, e.g., "data.id"
    };
    narrativeOnly?: boolean;
};

export type Scenario = {
    id: string;
    title: string;
    icon: string;
    tagline: string;
    differentiator: string;
    steps: ScenarioStep[];
};

export type StepResult = {
    status: number;
    data: any;
    elapsed: number;
};

export type ScenarioStepResultSnapshot = {
    index: number;
    result: StepResult;
};

export type ScenarioEngineSnapshot = {
    scenarioId: string;
    currentStepIndex: number;
    stepResults: ScenarioStepResultSnapshot[];
    capturedVars: Array<[string, any]>;
};
