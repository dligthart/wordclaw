<script lang="ts">
    import { onMount } from "svelte";
    import { Icon, Check } from "svelte-hero-icons";
    import type {
        Scenario,
        ScenarioEngineSnapshot,
        StepResult,
    } from "$lib/types/sandbox";
    import { deepParseJson } from "$lib/utils";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import JsonCodeBlock from "$lib/components/JsonCodeBlock.svelte";
    import StepTimeline from "$lib/components/sandbox/StepTimeline.svelte";
    import NarrationBlock from "$lib/components/sandbox/NarrationBlock.svelte";
    import StatusBadge from "$lib/components/sandbox/StatusBadge.svelte";
    import Badge from "$lib/components/ui/Badge.svelte";
    import Button from "$lib/components/ui/Button.svelte";
    import Select from "$lib/components/ui/Select.svelte";
    import Surface from "$lib/components/ui/Surface.svelte";
    import { engine } from "$lib/sandbox/engine.svelte";
    import { SCENARIOS } from "$lib/sandbox/scenarios";

    let {
        view = "guided",
    }: {
        view?: "guided" | "advanced";
    } = $props();

    type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

    type SandboxContext = {
        domainId?: number;
        otherDomainId?: number;
        contentTypeId?: number;
        contentTypeSlug?: string;
        paidContentTypeId?: number;
        contentItemId?: number;
        workflowId?: number;
        transitionId?: number;
        reviewTaskId?: number;
        webhookId?: number;
        apiKeyId?: number;
        paymentId?: number;
    };

    type TemplatePreset = {
        method: HttpMethod;
        endpoint: string;
        body?: unknown;
        headers?: Record<string, string>;
        guide?: string;
    };

    type TemplateGroup = {
        label: string;
        archived?: boolean;
        options: Array<{ value: string; label: string }>;
    };

    type ResponseInsight = {
        code?: string;
        message?: string;
        remediation?: string;
        recommendedNextAction?: string;
    };

    type RequestCancelReason = "manual" | "timeout";

    type ActiveRequestState = {
        controller: AbortController;
        reason: RequestCancelReason | null;
    };

    type ErrorAction = "refresh-context" | null;

    const CONTEXT_KEY = "__wc_agent_sandbox_context";
    const SCENARIO_STATE_KEY = "__wc_agent_sandbox_state_v1";
    const REQUEST_TIMEOUT_MS = 15000;
    const CONTEXT_REQUEST_TIMEOUT_MS = 8000;
    const DEFAULT_HEADERS = {
        "Content-Type": "application/json",
    };
    const DEFAULT_SCENARIO =
        SCENARIOS.find((scenario) => scenario.track !== "archived") ??
        SCENARIOS[0] ??
        null;

    let method: HttpMethod = $state("GET");
    let endpoint = $state("/api/content-types");
    let jsonBody = $state("");
    let headersText = $state(JSON.stringify(DEFAULT_HEADERS, null, 2));

    let loading = $state(false);
    let refreshingContext = $state(false);
    let errorMsg = $state<string | null>(null);
    let responseData = $state<any>(null);
    let responseStatus = $state<number | null>(null);
    let elapsedTime = $state<number | null>(null);
    let responseInsight = $state<ResponseInsight | null>(null);
    let templateGuide = $state<string | null>(null);
    let sandboxContext = $state<SandboxContext>({});
    let scenarioStateReady = $state(false);
    let activeRequest = $state<ActiveRequestState | null>(null);
    let errorTitle = $state<string | null>(null);
    let errorDetails = $state<string[]>([]);
    let errorAction = $state<ErrorAction>(null);
    let contextSummaryItems = $derived.by(() =>
        [
            { label: "domain", value: sandboxContext.domainId },
            { label: "contentType", value: sandboxContext.contentTypeId },
            { label: "paidType", value: sandboxContext.paidContentTypeId },
            { label: "contentItem", value: sandboxContext.contentItemId },
            { label: "workflow", value: sandboxContext.workflowId },
            { label: "transition", value: sandboxContext.transitionId },
            { label: "reviewTask", value: sandboxContext.reviewTaskId },
            { label: "payment", value: sandboxContext.paymentId },
            { label: "apiKey", value: sandboxContext.apiKeyId },
            { label: "webhook", value: sandboxContext.webhookId },
        ].filter((item) => item.value !== undefined),
    );
    let activeScenarioIsArchived = $derived.by(
        () => engine.activeScenario?.track === "archived",
    );
    let isGuidedView = $derived(view === "guided");
    let isAdvancedView = $derived(view === "advanced");

    const CONTEXT_LABELS: Record<string, string> = {
        domain: "Domain",
        contentType: "Content type",
        paidType: "Paid content type",
        contentItem: "Content item",
        workflow: "Workflow",
        transition: "Transition",
        reviewTask: "Review task",
        payment: "Payment",
        apiKey: "API key",
        webhook: "Webhook",
    };

    const SCENARIO_TRACK_LABELS: Record<string, string> = {
        core: "Core runtime",
        l402: "L402",
        archived: "Archived demos",
    };

    function clearError() {
        errorTitle = null;
        errorMsg = null;
        errorDetails = [];
        errorAction = null;
    }

    function setError(
        message: string,
        options: {
            title?: string;
            details?: string[];
            action?: ErrorAction;
        } = {},
    ) {
        errorTitle = options.title ?? null;
        errorMsg = message;
        errorDetails = options.details ?? [];
        errorAction = options.action ?? null;
    }

    function isPlainTextPayload(payload: unknown): payload is string {
        return typeof payload === "string";
    }

    function formatContextLabel(label: string): string {
        return CONTEXT_LABELS[label] ?? label;
    }

    function formatStatusExpectation(status?: number): string {
        if (!status) {
            return "The response may vary.";
        }
        if (status >= 200 && status < 300) {
            return `Expect a successful ${status} response.`;
        }
        if (status === 402) {
            return "Expect a payment challenge before the action succeeds.";
        }
        return `Expect a handled ${status} error response.`;
    }

    let scenarioSelectGroups = $derived.by(() =>
        (["core", "l402", "archived"] as const)
            .map((track) => ({
                label: SCENARIO_TRACK_LABELS[track],
                options: SCENARIOS.filter((scenario) => scenario.track === track),
            }))
            .filter((group) => group.options.length > 0),
    );

    function handleScenarioChange(event: Event) {
        const select = event.currentTarget as HTMLSelectElement;
        const scenario = findScenarioById(select.value);
        if (scenario) {
            selectScenario(scenario);
        }
    }

    function getLatestScenarioStepIndex(): number | null {
        if (!engine.activeScenario || engine.stepResults.size === 0) {
            return null;
        }

        return engine.isComplete
            ? engine.activeScenario.steps.length - 1
            : Math.max(engine.currentStepIndex - 1, 0);
    }

    function getLatestScenarioStep() {
        const index = getLatestScenarioStepIndex();
        if (index === null || !engine.activeScenario) {
            return null;
        }
        return engine.activeScenario.steps[index] ?? null;
    }

    function getLatestScenarioResult(): StepResult | null {
        const index = getLatestScenarioStepIndex();
        if (index === null) {
            return null;
        }
        return engine.stepResults.get(index) ?? null;
    }

    function formatJsonParseError(field: string, error: unknown): string {
        const detail =
            error instanceof Error ? error.message : "Unable to parse JSON.";
        return `Invalid JSON in ${field}: ${detail}`;
    }

    async function parseResponsePayload(response: Response): Promise<unknown> {
        const rawText = await response.text();
        if (!rawText) {
            return null;
        }

        try {
            const rawJson = JSON.parse(rawText);
            return deepParseJson(rawJson);
        } catch {
            return rawText;
        }
    }

    async function fetchWithTimeout(
        path: string,
        init: RequestInit,
        options: {
            timeoutMs?: number;
            cancelable?: boolean;
        } = {},
    ): Promise<Response> {
        const controller = new AbortController();
        const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
        const trackedRequest = options.cancelable
            ? {
                  controller,
                  reason: null as RequestCancelReason | null,
              }
            : null;

        const timeoutId = setTimeout(() => {
            if (trackedRequest) {
                trackedRequest.reason = "timeout";
            }
            controller.abort();
        }, timeoutMs);

        if (trackedRequest) {
            activeRequest = trackedRequest;
        }

        try {
            return await fetch(path, {
                ...init,
                signal: controller.signal,
            });
        } catch (error) {
            if (controller.signal.aborted) {
                const reason = trackedRequest?.reason ?? "manual";
                if (reason === "timeout") {
                    throw new Error(
                        `Request timed out after ${Math.round(timeoutMs / 1000)} seconds. Cancel and retry, or verify the server is healthy.`,
                    );
                }
                throw new Error("Request cancelled.");
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
            if (trackedRequest && activeRequest?.controller === controller) {
                activeRequest = null;
            }
        }
    }

    function cancelActiveRequest() {
        if (!activeRequest) {
            return;
        }

        activeRequest.reason = "manual";
        activeRequest.controller.abort();
    }

    function readNumber(value: unknown): number | undefined {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            return undefined;
        }
        return parsed;
    }

    function resolveId(value: number | undefined, fallback: number): number {
        return typeof value === "number" && Number.isFinite(value)
            ? value
            : fallback;
    }

    function cloneDefaultHeaders() {
        return { ...DEFAULT_HEADERS };
    }

    function findScenarioById(
        scenarioId: string | null | undefined,
    ): Scenario | null {
        if (!scenarioId) return null;
        return SCENARIOS.find((scenario) => scenario.id === scenarioId) ?? null;
    }

    function extractTemplateVars(input: string): string[] {
        const vars: string[] = [];
        for (const match of input.matchAll(/\{\{\s*([^}]+)\s*\}\}/g)) {
            vars.push(match[1].trim());
        }
        return vars;
    }

    function collectUnresolvedTemplateVars(payload: unknown): string[] {
        const unresolved = new Set<string>();

        const visit = (value: unknown) => {
            if (typeof value === "string") {
                for (const token of extractTemplateVars(value)) {
                    unresolved.add(token);
                }
                return;
            }

            if (Array.isArray(value)) {
                for (const child of value) {
                    visit(child);
                }
                return;
            }

            if (value && typeof value === "object") {
                for (const child of Object.values(
                    value as Record<string, unknown>,
                )) {
                    visit(child);
                }
            }
        };

        visit(payload);
        return Array.from(unresolved);
    }

    function loadScenarioSnapshot(): ScenarioEngineSnapshot | null {
        if (typeof window === "undefined") {
            return null;
        }

        try {
            const raw = localStorage.getItem(SCENARIO_STATE_KEY);
            if (!raw) return null;

            const parsed = JSON.parse(raw);
            const snapshot = parsed?.snapshot ?? parsed;
            if (!snapshot || typeof snapshot !== "object") {
                return null;
            }

            if (typeof snapshot.scenarioId !== "string") {
                return null;
            }

            return snapshot as ScenarioEngineSnapshot;
        } catch {
            return null;
        }
    }

    function persistScenarioSnapshot() {
        if (typeof window === "undefined") {
            return;
        }

        const snapshot = engine.toSnapshot();
        if (!snapshot) {
            localStorage.removeItem(SCENARIO_STATE_KEY);
            return;
        }

        localStorage.setItem(
            SCENARIO_STATE_KEY,
            JSON.stringify({
                version: 1,
                snapshot,
            }),
        );
    }

    function syncScenarioUrl(scenarioId: string, stepIndex: number) {
        if (typeof window === "undefined") {
            return;
        }

        const url = new URL(window.location.href);
        url.searchParams.set("scenario", scenarioId);
        url.searchParams.set("step", String(stepIndex));

        const nextSearch = url.searchParams.toString();
        const nextPath = `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`;
        const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;

        if (nextPath !== currentPath) {
            window.history.replaceState(window.history.state, "", nextPath);
        }
    }

    function parseStepParam(rawStep: string | null, maxStepIndex: number): number {
        if (rawStep === null) {
            return 0;
        }

        const parsedStep = Number.parseInt(rawStep, 10);
        if (
            !Number.isInteger(parsedStep) ||
            parsedStep < 0 ||
            parsedStep > maxStepIndex
        ) {
            return 0;
        }

        return parsedStep;
    }

    function seedCapturedVarsFromContext() {
        const variableEntries = Object.entries(sandboxContext).filter(
            ([, value]) => value !== undefined && value !== null,
        );
        if (variableEntries.length === 0) return;

        let changed = false;
        const next = new Map(engine.capturedVars);
        for (const [key, value] of variableEntries) {
            if (!next.has(key)) {
                next.set(key, value);
                changed = true;
            }
        }

        if (changed) {
            engine.capturedVars = next;
        }
    }

    function resolveStepProtocolLabel(): string {
        const step = engine.currentStep;
        if (!step) return "REST";
        if (step.protocol) return step.protocol;
        if (step.endpoint === "/api/graphql") return "GRAPHQL";
        return "REST";
    }

    function deepStringify(payload: any): any {
        if (!payload || typeof payload !== "object") return payload;

        const result = { ...payload };

        if (result.schema && typeof result.schema === "object") {
            result.schema = JSON.stringify(result.schema);
        }

        if (result.data && typeof result.data === "object") {
            result.data = JSON.stringify(result.data);
        }

        return result;
    }

    function loadSandboxContext(): SandboxContext {
        if (typeof window === "undefined") {
            return {};
        }

        try {
            const raw = sessionStorage.getItem(CONTEXT_KEY);
            if (!raw) {
                return {};
            }

            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") {
                return {};
            }

            return parsed as SandboxContext;
        } catch {
            return {};
        }
    }

    function persistSandboxContext(context: SandboxContext) {
        if (typeof window === "undefined") {
            return;
        }

        sessionStorage.setItem(CONTEXT_KEY, JSON.stringify(context));
    }

    function contextHeaders(): Record<string, string> {
        const headers: Record<string, string> = {};

        if (typeof window !== "undefined") {
            const domainId = localStorage.getItem("__wc_domain_id");
            if (domainId) {
                headers["x-wordclaw-domain"] = domainId;
            }
        }

        return headers;
    }

    async function fetchSandboxData(path: string): Promise<any[] | null> {
        try {
            const response = await fetchWithTimeout(
                path,
                {
                headers: {
                    Accept: "application/json",
                    ...contextHeaders(),
                },
                credentials: "include",
                },
                {
                    timeoutMs: CONTEXT_REQUEST_TIMEOUT_MS,
                },
            );

            if (!response.ok) {
                return null;
            }

            const payload = await response.json();
            if (!payload || !Array.isArray(payload.data)) {
                return null;
            }

            return payload.data;
        } catch {
            return null;
        }
    }

    async function hydrateSandboxContext(): Promise<SandboxContext> {
        const nextContext: SandboxContext = { ...loadSandboxContext() };

        if (typeof window !== "undefined") {
            const currentDomainRaw = localStorage.getItem("__wc_domain_id");
            const currentDomain = currentDomainRaw
                ? Number.parseInt(currentDomainRaw, 10)
                : Number.NaN;
            if (Number.isFinite(currentDomain)) {
                nextContext.domainId = currentDomain;
            }
        }

        const [
            contentTypesData,
            contentItemsData,
            webhooksData,
            apiKeysData,
            reviewTasksData,
            paymentsData,
            domainsData,
        ] = await Promise.all([
            fetchSandboxData("/api/content-types?limit=50"),
            fetchSandboxData("/api/content-items?limit=50"),
            fetchSandboxData("/api/webhooks"),
            fetchSandboxData("/api/auth/keys"),
            fetchSandboxData("/api/review-tasks"),
            fetchSandboxData("/api/payments?limit=25"),
            fetchSandboxData("/api/domains"),
        ]);

        if (Array.isArray(contentTypesData) && contentTypesData.length > 0) {
            const preferredType =
                contentTypesData.find(
                    (item) =>
                        typeof item.slug === "string" &&
                        item.slug.includes("blog"),
                ) ?? contentTypesData[0];

            if (!nextContext.contentTypeId) {
                nextContext.contentTypeId = readNumber(preferredType.id);
            }

            if (!nextContext.contentTypeSlug && preferredType.slug) {
                nextContext.contentTypeSlug = String(preferredType.slug);
            }

            const pricedType =
                contentTypesData.find(
                    (item) =>
                        typeof item.basePrice === "number" &&
                        item.basePrice > 0,
                ) ??
                contentTypesData.find(
                    (item) =>
                        typeof item.slug === "string" &&
                        item.slug.includes("guest"),
                );

            if (pricedType && !nextContext.paidContentTypeId) {
                nextContext.paidContentTypeId = readNumber(pricedType.id);
            }
        }

        if (Array.isArray(contentItemsData) && contentItemsData.length > 0) {
            const preferredItem =
                contentItemsData.find(
                    (item) =>
                        readNumber(item.contentTypeId) ===
                        nextContext.contentTypeId,
                ) ?? contentItemsData[0];

            if (!nextContext.contentItemId) {
                nextContext.contentItemId = readNumber(preferredItem.id);
            }
        }

        if (Array.isArray(webhooksData) && webhooksData.length > 0) {
            if (!nextContext.webhookId) {
                nextContext.webhookId = readNumber(webhooksData[0].id);
            }
        }

        if (Array.isArray(apiKeysData) && apiKeysData.length > 0) {
            const activeKey =
                apiKeysData.find((item) => item.revokedAt == null) ??
                apiKeysData[0];
            if (!nextContext.apiKeyId) {
                nextContext.apiKeyId = readNumber(activeKey.id);
            }
        }

        if (Array.isArray(reviewTasksData) && reviewTasksData.length > 0) {
            const firstTask = reviewTasksData[0];
            if (!nextContext.reviewTaskId) {
                nextContext.reviewTaskId = readNumber(firstTask?.task?.id);
            }
            if (!nextContext.workflowId) {
                nextContext.workflowId = readNumber(firstTask?.workflow?.id);
            }
            if (!nextContext.transitionId) {
                nextContext.transitionId = readNumber(
                    firstTask?.transition?.id,
                );
            }
            if (!nextContext.contentItemId) {
                nextContext.contentItemId = readNumber(
                    firstTask?.contentItem?.id,
                );
            }
            if (!nextContext.contentTypeId) {
                nextContext.contentTypeId = readNumber(
                    firstTask?.contentType?.id,
                );
            }
        }

        if (Array.isArray(paymentsData) && paymentsData.length > 0) {
            if (!nextContext.paymentId) {
                nextContext.paymentId = readNumber(paymentsData[0].id);
            }
        }

        if (Array.isArray(domainsData) && domainsData.length > 0) {
            const currentDomainId = nextContext.domainId;
            const alternateDomain = domainsData.find(
                (item) =>
                    readNumber(item.id) !== undefined &&
                    readNumber(item.id) !== currentDomainId,
            );

            if (alternateDomain) {
                nextContext.otherDomainId = readNumber(alternateDomain.id);
            }
        }

        persistSandboxContext(nextContext);
        return nextContext;
    }

    function captureResponseContext(requestEndpoint: string, payload: any) {
        if (!payload || typeof payload !== "object") {
            return;
        }

        const nextContext: SandboxContext = { ...sandboxContext };
        let changed = false;

        const assign = (key: keyof SandboxContext, value: unknown) => {
            if (value === undefined || value === null) {
                return;
            }

            const parsed =
                key === "contentTypeSlug" ? String(value) : readNumber(value);

            if (parsed === undefined || parsed === null) {
                return;
            }

            if (nextContext[key] !== parsed) {
                nextContext[key] = parsed as never;
                changed = true;
            }
        };

        const applyRecord = (record: any) => {
            if (!record || typeof record !== "object") {
                return;
            }

            if ("slug" in record && "schema" in record) {
                assign("contentTypeId", record.id);
                assign("contentTypeSlug", record.slug);
                if (
                    typeof record.basePrice === "number" &&
                    record.basePrice > 0
                ) {
                    assign("paidContentTypeId", record.id);
                }
            }

            if (
                "contentTypeId" in record &&
                "version" in record &&
                "status" in record
            ) {
                assign("contentItemId", record.id);
                assign("contentTypeId", record.contentTypeId);
            }

            if (
                "workflowId" in record &&
                "fromState" in record &&
                "toState" in record
            ) {
                assign("transitionId", record.id);
                assign("workflowId", record.workflowId);
            }

            if (
                "active" in record &&
                "contentTypeId" in record &&
                "name" in record &&
                !("schema" in record)
            ) {
                assign("workflowId", record.id);
                assign("contentTypeId", record.contentTypeId);
            }

            if (
                "workflowTransitionId" in record &&
                "contentItemId" in record &&
                "status" in record
            ) {
                assign("reviewTaskId", record.id);
                assign("transitionId", record.workflowTransitionId);
                assign("contentItemId", record.contentItemId);
            }

            if ("url" in record && "events" in record) {
                assign("webhookId", record.id);
            }

            if ("keyPrefix" in record && "scopes" in record) {
                assign("apiKeyId", record.id);
            }

            if ("paymentHash" in record) {
                assign("paymentId", record.id);
            }

            if (record.task && typeof record.task === "object") {
                assign("reviewTaskId", record.task.id);
            }
            if (record.transition && typeof record.transition === "object") {
                assign("transitionId", record.transition.id);
            }
            if (record.workflow && typeof record.workflow === "object") {
                assign("workflowId", record.workflow.id);
            }
            if (record.contentItem && typeof record.contentItem === "object") {
                assign("contentItemId", record.contentItem.id);
                assign("contentTypeId", record.contentItem.contentTypeId);
            }
            if (record.contentType && typeof record.contentType === "object") {
                assign("contentTypeId", record.contentType.id);
            }
        };

        const data =
            payload && typeof payload === "object" && "data" in payload
                ? payload.data
                : payload;

        if (Array.isArray(data)) {
            if (data.length > 0) {
                applyRecord(data[0]);
            }
        } else if (data && typeof data === "object") {
            applyRecord(data);

            const results = (data as any).results;
            if (Array.isArray(results)) {
                const firstSuccess = results.find(
                    (item) => item && item.ok === true && item.id,
                );
                if (firstSuccess) {
                    assign("contentItemId", firstSuccess.id);
                }
            }
        }

        if (requestEndpoint.startsWith("/api/content-types")) {
            if (Array.isArray(data) && data.length > 0) {
                assign("contentTypeId", data[0].id);
                assign("contentTypeSlug", data[0].slug);
            }
        }

        if (requestEndpoint.startsWith("/api/content-items")) {
            if (Array.isArray(data) && data.length > 0) {
                assign("contentItemId", data[0].id);
                assign("contentTypeId", data[0].contentTypeId);
            }
        }

        if (changed) {
            sandboxContext = nextContext;
            persistSandboxContext(nextContext);
        }
    }

    function normalizeHeaders(parsed: unknown): Record<string, string> {
        if (!parsed || typeof parsed !== "object") {
            return {};
        }

        return Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>).map(
                ([key, value]) => [key, String(value)],
            ),
        );
    }

    function extractResponseInsight(payload: any): ResponseInsight | null {
        if (!payload || typeof payload !== "object") {
            return null;
        }

        const message =
            (typeof payload.error === "string"
                ? payload.error
                : payload.error?.message) ?? payload.message;
        const code = payload.code ?? payload.error?.code;
        const remediation =
            payload.remediation ??
            payload.error?.remediation ??
            payload.extensions?.remediation;
        const recommendedNextAction =
            payload.meta?.recommendedNextAction ??
            payload.recommendedNextAction ??
            payload.error?.details?.recommendedNextAction;

        if (!message && !code && !remediation && !recommendedNextAction) {
            return null;
        }

        return {
            ...(message ? { message: String(message) } : {}),
            ...(code ? { code: String(code) } : {}),
            ...(remediation ? { remediation: String(remediation) } : {}),
            ...(recommendedNextAction
                ? { recommendedNextAction: String(recommendedNextAction) }
                : {}),
        };
    }

    function buildTemplates(
        ctx: SandboxContext,
    ): Record<string, TemplatePreset> {
        const contentTypeId = resolveId(ctx.contentTypeId, 1);
        const paidContentTypeId = resolveId(
            ctx.paidContentTypeId,
            contentTypeId,
        );
        const contentItemId = resolveId(ctx.contentItemId, 1);
        const workflowId = resolveId(ctx.workflowId, 1);
        const transitionId = resolveId(ctx.transitionId, 1);
        const reviewTaskId = resolveId(ctx.reviewTaskId, 1);
        const webhookId = resolveId(ctx.webhookId, 1);
        const apiKeyId = resolveId(ctx.apiKeyId, 1);
        const paymentId = resolveId(ctx.paymentId, 1);
        const otherDomainId = resolveId(
            ctx.otherDomainId,
            resolveId(ctx.domainId, 1) + 1,
        );
        const duplicateSlug = ctx.contentTypeSlug || "article";

        return {
            "list-content-types": {
                method: "GET",
                endpoint: "/api/content-types",
                guide: "List available content models. Captured IDs are reused by scenario templates.",
            },
            "get-content-type": {
                method: "GET",
                endpoint: `/api/content-types/${contentTypeId}`,
                guide: "Fetch one content type by ID.",
            },
            "create-blog-type": {
                method: "POST",
                endpoint: "/api/content-types",
                body: {
                    name: "Agent Blog Post",
                    slug: `agent_blog_post_${Date.now()}`,
                    description:
                        "Scenario-ready schema for sandbox walkthroughs.",
                    schema: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                            content: { type: "string" },
                            authorAgent: { type: "string" },
                            tags: {
                                type: "array",
                                items: { type: "string" },
                            },
                        },
                        required: ["title", "content", "authorAgent"],
                    },
                },
                guide: "Creates a reusable content type and caches its ID for follow-up templates.",
            },
            "create-paid-content-type": {
                method: "POST",
                endpoint: "/api/content-types",
                body: {
                    name: "Guest Post (Paid)",
                    slug: `guest_post_paid_${Date.now()}`,
                    description:
                        "Paid publication slot to demonstrate L402 invoice challenges.",
                    basePrice: 500,
                    schema: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                            body: { type: "string" },
                            author: { type: "string" },
                        },
                        required: ["title", "body", "author"],
                    },
                },
                guide: "Use this first for the L402 scenario. It sets basePrice to trigger payment challenges.",
            },
            "update-content-type": {
                method: "PUT",
                endpoint: `/api/content-types/${contentTypeId}`,
                body: {
                    description:
                        "Updated from Agent Sandbox to demonstrate content-type lifecycle edits.",
                },
                guide: "Update a single content type by ID.",
            },
            "delete-content-type": {
                method: "DELETE",
                endpoint: `/api/content-types/${contentTypeId}`,
                guide: "Delete a content type by ID.",
            },
            "create-blog-post": {
                method: "POST",
                endpoint: "/api/content-items",
                body: {
                    contentTypeId,
                    data: {
                        title: "First steps as an Agent in WordClaw",
                        content:
                            "Hello world! We are testing the usability of this CMS for agents.",
                        authorAgent: "Agent Alpha",
                        tags: ["intro", "testing"],
                    },
                    status: "published",
                },
                guide: "Creates a published content item. Returned item ID is cached for updates, versions, and rollback.",
            },
            "create-blog-post-draft": {
                method: "POST",
                endpoint: "/api/content-items",
                body: {
                    contentTypeId,
                    data: {
                        title: "Editorial draft from Agent Sandbox",
                        content:
                            "Draft content for workflow and review scenarios.",
                        authorAgent: "Agent Reviewer",
                    },
                    status: "draft",
                },
                guide: "Creates a draft item for workflow submission steps.",
            },
            "create-post-invalid": {
                method: "POST",
                endpoint: "/api/content-items",
                body: {
                    contentTypeId,
                    data: {
                        title: "Agent B's Thoughts",
                        content: "I forgot to include my name!",
                        tags: ["oops"],
                    },
                    status: "draft",
                },
                guide: "Intentional schema error to demonstrate structured validation feedback.",
            },
            "list-blog-posts": {
                method: "GET",
                endpoint: `/api/content-items?contentTypeId=${contentTypeId}`,
                guide: "List content items for the selected content type.",
            },
            "get-content-item": {
                method: "GET",
                endpoint: `/api/content-items/${contentItemId}`,
                guide: "Fetch one content item by ID.",
            },
            "mcp-get-content-item": {
                method: "POST",
                endpoint: "/api/sandbox/mcp/execute",
                body: {
                    tool: "get_content_item",
                    args: {
                        id: contentItemId,
                    },
                },
                guide: "Run the same read through the MCP bridge used by default agent tooling.",
            },
            "update-blog-post": {
                method: "PUT",
                endpoint: `/api/content-items/${contentItemId}`,
                body: {
                    data: {
                        title: "Updated Title from Agent Sandbox",
                        content: "Updated Content",
                        authorAgent: "Agent Alpha",
                    },
                    status: "published",
                },
                guide: "Update an existing item and create a new version.",
            },
            "delete-content-item": {
                method: "DELETE",
                endpoint: `/api/content-items/${contentItemId}`,
                guide: "Delete a content item by ID.",
            },
            "dry-run-create": {
                method: "POST",
                endpoint: "/api/content-items?mode=dry_run",
                body: {
                    contentTypeId,
                    data: {
                        title: "Dry run title",
                        content: "Should not be saved",
                        authorAgent: "Agent Gamma",
                    },
                },
                guide: "Dry-run example: validates payload and policy without committing data.",
            },
            "view-item-versions": {
                method: "GET",
                endpoint: `/api/content-items/${contentItemId}/versions`,
                guide: "Show full version history before running rollback.",
            },
            "rollback-item": {
                method: "POST",
                endpoint: `/api/content-items/${contentItemId}/rollback`,
                body: {
                    version: 1,
                },
                guide: "Rollback content to a historical version.",
            },
            "list-comments": {
                method: "GET",
                endpoint: `/api/content-items/${contentItemId}/comments`,
                guide: "Read review comments for a content item.",
            },
            "add-comment": {
                method: "POST",
                endpoint: `/api/content-items/${contentItemId}/comments`,
                body: {
                    comment:
                        "Sandbox reviewer note: please tighten intro and add sourcing.",
                },
                guide: "Post a review-thread comment.",
            },
            "l402-payment-required": {
                method: "POST",
                endpoint: "/api/content-items",
                body: {
                    contentTypeId: paidContentTypeId,
                    data: {
                        title: "Paid guest post attempt",
                        body: "Triggering L402 challenge from sandbox template.",
                        author: "Agent L402",
                    },
                    status: "draft",
                },
                guide: "Expected outcome: 402 with structured invoice + macaroon challenge metadata.",
            },
            "batch-create-items": {
                method: "POST",
                endpoint: "/api/content-items/batch",
                body: {
                    atomic: true,
                    items: [
                        {
                            contentTypeId,
                            data: {
                                title: "Batch item 1",
                                content: "Created in batch operation",
                                authorAgent: "Batch Agent",
                            },
                            status: "draft",
                        },
                        {
                            contentTypeId,
                            data: {
                                title: "Batch item 2",
                                content: "Created in batch operation",
                                authorAgent: "Batch Agent",
                            },
                            status: "draft",
                        },
                    ],
                },
                guide: "Batch-create multiple items in one request.",
            },
            "batch-update-items": {
                method: "PUT",
                endpoint: "/api/content-items/batch",
                body: {
                    atomic: false,
                    items: [
                        {
                            id: contentItemId,
                            data: {
                                title: "Batch updated title",
                                content: "Updated through batch endpoint",
                                authorAgent: "Batch Agent",
                            },
                            status: "draft",
                        },
                    ],
                },
                guide: "Batch-update item metadata and status.",
            },
            "batch-delete-items": {
                method: "DELETE",
                endpoint: "/api/content-items/batch",
                body: {
                    atomic: false,
                    ids: [contentItemId],
                },
                guide: "Batch-delete supports request bodies. This template demonstrates that path.",
            },
            "view-audit-logs": {
                method: "GET",
                endpoint: "/api/audit-logs?entityType=content_item",
                guide: "Inspect audit trail entries for content lifecycle operations.",
            },
            "list-api-keys": {
                method: "GET",
                endpoint: "/api/auth/keys",
                guide: "List API keys and observe scope metadata.",
            },
            "create-api-key": {
                method: "POST",
                endpoint: "/api/auth/keys",
                body: {
                    name: `Sandbox Key ${Date.now()}`,
                    scopes: ["content:read", "content:write", "audit:read"],
                },
                guide: "Create an API key (plaintext key appears once).",
            },
            "rotate-api-key": {
                method: "PUT",
                endpoint: `/api/auth/keys/${apiKeyId}`,
                guide: "Rotate an existing API key by ID.",
            },
            "revoke-api-key": {
                method: "DELETE",
                endpoint: `/api/auth/keys/${apiKeyId}`,
                guide: "Revoke an API key by ID.",
            },
            "register-webhook": {
                method: "POST",
                endpoint: "/api/webhooks",
                body: {
                    url: "https://example.com/hooks/wordclaw",
                    events: ["content_item.create", "content_item.update"],
                    secret: "sandbox-webhook-secret",
                    active: true,
                },
                guide: "Register webhook delivery for content events.",
            },
            "list-webhooks": {
                method: "GET",
                endpoint: "/api/webhooks",
                guide: "List registered webhooks.",
            },
            "get-webhook": {
                method: "GET",
                endpoint: `/api/webhooks/${webhookId}`,
                guide: "Inspect a single webhook by ID.",
            },
            "update-webhook": {
                method: "PUT",
                endpoint: `/api/webhooks/${webhookId}`,
                body: {
                    events: ["content_item.create", "content_item.delete"],
                    active: true,
                },
                guide: "Update events and state for one webhook.",
            },
            "delete-webhook": {
                method: "DELETE",
                endpoint: `/api/webhooks/${webhookId}`,
                guide: "Delete a webhook registration.",
            },
            "create-workflow": {
                method: "POST",
                endpoint: "/api/workflows",
                body: {
                    name: `Editorial Workflow ${Date.now()}`,
                    contentTypeId,
                    active: true,
                },
                guide: "Create a workflow for the selected content type.",
            },
            "add-workflow-transition-draft-review": {
                method: "POST",
                endpoint: `/api/workflows/${workflowId}/transitions`,
                body: {
                    fromState: "draft",
                    toState: "in_review",
                    requiredRoles: ["content:write"],
                },
                guide: "Add a transition from draft to in_review.",
            },
            "add-workflow-transition-review-published": {
                method: "POST",
                endpoint: `/api/workflows/${workflowId}/transitions`,
                body: {
                    fromState: "in_review",
                    toState: "published",
                    requiredRoles: ["content:write"],
                },
                guide: "Add a transition from in_review to published.",
            },
            "get-active-workflow": {
                method: "GET",
                endpoint: `/api/content-types/${contentTypeId}/workflows/active`,
                guide: "Get the active workflow attached to a content type.",
            },
            "submit-for-review": {
                method: "POST",
                endpoint: `/api/content-items/${contentItemId}/submit`,
                body: {
                    workflowTransitionId: transitionId,
                    assignee: "supervisor",
                },
                guide: "Submit content into the review queue.",
            },
            "list-review-tasks": {
                method: "GET",
                endpoint: "/api/review-tasks",
                guide: "List pending review tasks and cache task IDs for decision templates.",
            },
            "decide-review-task": {
                method: "POST",
                endpoint: `/api/review-tasks/${reviewTaskId}/decide`,
                body: {
                    decision: "approved",
                },
                guide: "Approve or reject a review task.",
            },
            "list-domains": {
                method: "GET",
                endpoint: "/api/domains",
                guide: "List available domains for multi-tenant operations.",
            },
            "evaluate-policy": {
                method: "POST",
                endpoint: "/api/policy/evaluate",
                body: {
                    operation: "content.write",
                    resource: {
                        type: "content_item",
                        id: String(contentItemId),
                        contentTypeId: String(contentTypeId),
                    },
                },
                guide: "Evaluate policy response shape for a requested operation.",
            },
            "semantic-search": {
                method: "GET",
                endpoint: "/api/search/semantic?query=agent%20content&limit=5",
                guide: "Run semantic search against published embeddings.",
            },
            "list-payments": {
                method: "GET",
                endpoint: "/api/payments",
                guide: "List payments generated by L402 flows.",
            },
            "get-payment": {
                method: "GET",
                endpoint: `/api/payments/${paymentId}`,
                guide: "Retrieve one payment by ID.",
            },
            "error-missing-auth": {
                method: "GET",
                endpoint: "/api/content-types",
                headers: {},
                guide: "Expected class: AUTH errors. To force 401, run this after logging out (supervisor cookie bypasses API key auth).",
            },
            "error-empty-update": {
                method: "PUT",
                endpoint: `/api/content-items/${contentItemId}`,
                body: {},
                guide: "Expected class: structured 400 with EMPTY_UPDATE_BODY + remediation.",
            },
            "error-invalid-schema": {
                method: "POST",
                endpoint: "/api/content-types",
                body: {
                    name: "Invalid Schema Type",
                    slug: `invalid_schema_${Date.now()}`,
                    schema: {
                        type: "object",
                        properties: {
                            title: { type: "INVALID_TYPE" },
                        },
                    },
                },
                guide: "Expected class: schema validation error with code/remediation details.",
            },
            "error-not-found-item": {
                method: "GET",
                endpoint: "/api/content-items/999999",
                guide: "Expected class: 404 CONTENT_ITEM_NOT_FOUND.",
            },
            "error-duplicate-slug": {
                method: "POST",
                endpoint: "/api/content-types",
                body: {
                    name: "Duplicate Slug Probe",
                    slug: duplicateSlug,
                    schema: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                        },
                        required: ["title"],
                    },
                },
                guide: "Expected class: duplicate constraint error for slug collisions.",
            },
            "error-cross-domain": {
                method: "GET",
                endpoint: `/api/content-types/${contentTypeId}`,
                headers: {
                    ...cloneDefaultHeaders(),
                    "x-wordclaw-domain": String(otherDomainId),
                },
                guide: "Expected class: tenant isolation / not-found semantics when domain context is switched.",
            },
            "error-payment-required": {
                method: "POST",
                endpoint: "/api/content-items",
                body: {
                    contentTypeId: paidContentTypeId,
                    data: {
                        title: "L402 challenge probe",
                        body: "Trigger a payment-required response.",
                        author: "Agent Paywall",
                    },
                    status: "draft",
                },
                guide: "Expected class: PAYMENT_REQUIRED with invoice + macaroon metadata.",
            },
        };
    }

    const templateGroups: TemplateGroup[] = [
        {
            label: "Core: Content Runtime",
            options: [
                { value: "list-content-types", label: "List Content Types" },
                { value: "create-blog-type", label: "Create Blog Type" },
                { value: "get-content-type", label: "Get Content Type by ID" },
                {
                    value: "update-content-type",
                    label: "Update Content Type",
                },
                {
                    value: "create-blog-post",
                    label: "Create Valid Blog Post",
                },
                { value: "list-blog-posts", label: "List Content Items" },
                { value: "get-content-item", label: "Get Item by ID" },
                { value: "update-blog-post", label: "Update Item" },
                { value: "view-item-versions", label: "View Versions" },
                { value: "rollback-item", label: "Rollback Item" },
                { value: "delete-content-item", label: "Delete Item" },
                {
                    value: "delete-content-type",
                    label: "Delete Content Type",
                },
                { value: "view-audit-logs", label: "View Audit Logs" },
            ],
        },
        {
            label: "Core: Validation and Dry Run",
            options: [
                { value: "create-post-invalid", label: "Create Invalid Item" },
                { value: "dry-run-create", label: "Dry Run Create" },
                {
                    value: "error-empty-update",
                    label: "Empty Update Body",
                },
                {
                    value: "error-invalid-schema",
                    label: "Invalid Content Schema",
                },
                {
                    value: "error-not-found-item",
                    label: "Item Not Found (404)",
                },
                {
                    value: "error-duplicate-slug",
                    label: "Duplicate Content Type Slug",
                },
            ],
        },
        {
            label: "Core: Workflow and Review",
            options: [
                {
                    value: "create-blog-post-draft",
                    label: "Create Draft Item",
                },
                { value: "create-workflow", label: "Create Workflow" },
                {
                    value: "add-workflow-transition-draft-review",
                    label: "Add Transition: draft -> in_review",
                },
                {
                    value: "add-workflow-transition-review-published",
                    label: "Add Transition: in_review -> published",
                },
                {
                    value: "get-active-workflow",
                    label: "Get Active Workflow",
                },
                { value: "submit-for-review", label: "Submit for Review" },
                { value: "list-review-tasks", label: "List Review Tasks" },
                { value: "list-comments", label: "List Review Comments" },
                { value: "add-comment", label: "Add Review Comment" },
                { value: "decide-review-task", label: "Decide Review Task" },
            ],
        },
        {
            label: "Core: REST and MCP",
            options: [
                {
                    value: "mcp-get-content-item",
                    label: "Fetch Item via MCP",
                },
            ],
        },
        {
            label: "L402",
            options: [
                {
                    value: "create-paid-content-type",
                    label: "Create Paid Content Type",
                },
                {
                    value: "l402-payment-required",
                    label: "Trigger 402 Challenge",
                },
                { value: "list-payments", label: "List Payments" },
                { value: "get-payment", label: "Get Payment by ID" },
                {
                    value: "error-payment-required",
                    label: "Payment Required (402)",
                },
            ],
        },
        {
            label: "Archived: Batch Operations",
            archived: true,
            options: [
                {
                    value: "batch-create-items",
                    label: "Batch Create Items",
                },
                {
                    value: "batch-update-items",
                    label: "Batch Update Items",
                },
                {
                    value: "batch-delete-items",
                    label: "Batch Delete Items",
                },
            ],
        },
        {
            label: "Archived: API Keys and Webhooks",
            archived: true,
            options: [
                {
                    value: "list-api-keys",
                    label: "List API Keys",
                },
                {
                    value: "create-api-key",
                    label: "Create API Key",
                },
                {
                    value: "rotate-api-key",
                    label: "Rotate API Key",
                },
                {
                    value: "revoke-api-key",
                    label: "Revoke API Key",
                },
                {
                    value: "register-webhook",
                    label: "Register Webhook",
                },
                {
                    value: "list-webhooks",
                    label: "List Webhooks",
                },
                {
                    value: "get-webhook",
                    label: "Get Webhook",
                },
                {
                    value: "update-webhook",
                    label: "Update Webhook",
                },
                {
                    value: "delete-webhook",
                    label: "Delete Webhook",
                },
            ],
        },
        {
            label: "Archived: Domains, Policy, and Search",
            archived: true,
            options: [
                {
                    value: "list-domains",
                    label: "List Domains",
                },
                {
                    value: "evaluate-policy",
                    label: "Evaluate Policy",
                },
                {
                    value: "semantic-search",
                    label: "Semantic Search",
                },
            ],
        },
        {
            label: "Archived: Historical Error Probes",
            archived: true,
            options: [
                {
                    value: "error-missing-auth",
                    label: "Missing Authentication",
                },
                {
                    value: "error-cross-domain",
                    label: "Cross-Domain Access Probe",
                },
            ],
        },
    ];

    let activeTemplateGroups = $derived.by(() =>
        templateGroups.filter((group) => !group.archived),
    );

    let archivedTemplateGroups = $derived.by(() =>
        templateGroups.filter((group) => group.archived),
    );

    async function refreshTemplateContext() {
        clearError();
        refreshingContext = true;
        sandboxContext = await hydrateSandboxContext();
        seedCapturedVarsFromContext();
        refreshingContext = false;
    }

    function resolveTemplate(
        name: string,
        context: SandboxContext,
    ): TemplatePreset | null {
        const templates = buildTemplates(context);
        return templates[name] ?? null;
    }

    function selectScenario(scenario: Scenario) {
        engine.startScenario(scenario);
        seedCapturedVarsFromContext();
    }

    async function executeScenarioStep() {
        if (!engine.currentStep) return;

        loading = true;
        clearError();

        seedCapturedVarsFromContext();

        let parsedHeaders: Record<string, string> = {
            ...cloneDefaultHeaders(),
        };
        if (engine.currentStep.headers) {
            const interpolatedHeaders = Object.fromEntries(
                Object.entries(engine.currentStep.headers).map(([key, value]) => [
                    key,
                    engine.interpolateString(value),
                ]),
            );
            parsedHeaders = { ...parsedHeaders, ...interpolatedHeaders };
        }
        if (typeof window !== "undefined") {
            const domainId = localStorage.getItem("__wc_domain_id");
            if (domainId && !parsedHeaders["x-wordclaw-domain"]) {
                parsedHeaders["x-wordclaw-domain"] = domainId;
            }
        }

        if (!engine.capturedVars.has("timestamp")) {
            engine.capturedVars.set("timestamp", String(Date.now()));
        }

        const method = engine.currentStep.method;
        const endpoint = engine.interpolatedEndpoint;
        const bodyObj = engine.interpolatedBody;
        const unresolvedVars = new Set([
            ...collectUnresolvedTemplateVars(endpoint),
            ...collectUnresolvedTemplateVars(bodyObj),
            ...collectUnresolvedTemplateVars(parsedHeaders),
        ]);

        if (unresolvedVars.size > 0) {
            setError(
                "Run prerequisite steps or refresh the captured IDs, then retry.",
                {
                    title: "Scenario prerequisites missing",
                    details: Array.from(unresolvedVars).sort(),
                    action: "refresh-context",
                },
            );
            loading = false;
            return;
        }

        let bodyPayload = undefined;
        if (bodyObj) {
            bodyPayload = JSON.stringify(bodyObj);
        }

        const start = performance.now();
        try {
            const res = await fetchWithTimeout(
                endpoint,
                {
                    method,
                    headers: parsedHeaders,
                    body: bodyPayload,
                    credentials: "include",
                },
                {
                    cancelable: true,
                },
            );

            const data = await parseResponsePayload(res);

            const elapsed = Math.round(performance.now() - start);
            engine.recordResult(res.status, data, elapsed);
            captureResponseContext(endpoint, data);
            engine.advanceStep();
        } catch (err: any) {
            setError(err?.message || "Network Error");
        } finally {
            loading = false;
        }
    }

    async function replayCurrentScenarioStep() {
        if (!engine.activeScenario || loading) {
            return;
        }

        const replayIndex = engine.isComplete
            ? engine.activeScenario.steps.length - 1
            : engine.currentStepIndex;

        if (replayIndex < 0) {
            return;
        }

        if (!engine.prepareReplayAt(replayIndex)) {
            return;
        }

        await executeScenarioStep();
    }

    async function executeRequest() {
        if (!endpoint || !endpoint.startsWith("/api")) {
            errorMsg = "Endpoint must exist and start with '/api'";
            return;
        }

        loading = true;
        clearError();
        responseData = null;
        responseStatus = null;
        elapsedTime = null;
        responseInsight = null;

        let parsedHeaders: Record<string, string> = {};
        try {
            if (headersText.trim()) {
                parsedHeaders = normalizeHeaders(JSON.parse(headersText));
            }
        } catch (error) {
            setError(formatJsonParseError("Headers", error));
            loading = false;
            return;
        }

        if (typeof window !== "undefined") {
            const domainId = localStorage.getItem("__wc_domain_id");
            if (domainId && !parsedHeaders["x-wordclaw-domain"]) {
                parsedHeaders["x-wordclaw-domain"] = domainId;
            }
        }

        let bodyPayload: string | undefined;
        if (["POST", "PUT", "DELETE"].includes(method)) {
            try {
                if (jsonBody.trim()) {
                    const rawObj = JSON.parse(jsonBody);
                    bodyPayload = JSON.stringify(deepStringify(rawObj));
                }
            } catch (error) {
                setError(formatJsonParseError("Request Body", error));
                loading = false;
                return;
            }
        }

        const start = performance.now();
        try {
            const res = await fetchWithTimeout(
                endpoint,
                {
                    method,
                    headers: parsedHeaders,
                    body: bodyPayload,
                    credentials: "include",
                },
                {
                    cancelable: true,
                },
            );

            responseStatus = res.status;

            const parsed = await parseResponsePayload(res);
            responseData = parsed;
            responseInsight = extractResponseInsight(parsed);
            captureResponseContext(endpoint, parsed);
        } catch (err: any) {
            setError(err?.message || "Network Error");
        } finally {
            elapsedTime = Math.round(performance.now() - start);
            loading = false;
        }
    }

    async function applyTemplate(e: Event) {
        const select = e.target as HTMLSelectElement;
        const name = select.value;
        if (!name) return;

        const runtimeContext = await hydrateSandboxContext();
        sandboxContext = runtimeContext;

        const resolved = resolveTemplate(name, runtimeContext);
        if (!resolved) {
            errorMsg = `Unknown template: ${name}`;
            select.value = "";
            return;
        }

        method = resolved.method;
        endpoint = resolved.endpoint;
        templateGuide = resolved.guide || null;

        const headersObject = resolved.headers ?? cloneDefaultHeaders();
        headersText = JSON.stringify(headersObject, null, 2);

        if (resolved.body === undefined) {
            jsonBody = "";
        } else {
            jsonBody = JSON.stringify(resolved.body, null, 2);
        }

        select.value = "";
    }

    onMount(async () => {
        sandboxContext = await hydrateSandboxContext();
        seedCapturedVarsFromContext();
        if (SCENARIOS.length > 0) {
            const urlParams = new URLSearchParams(window.location.search);
            const requestedScenarioId = urlParams.get("scenario");
            const requestedScenario = findScenarioById(requestedScenarioId);
            const persistedSnapshot = loadScenarioSnapshot();
            const persistedScenario = findScenarioById(
                persistedSnapshot?.scenarioId,
            );

            if (requestedScenario) {
                engine.startScenario(requestedScenario);
                if (
                    persistedSnapshot &&
                    persistedScenario?.id === requestedScenario.id
                ) {
                    engine.restoreFromSnapshot(persistedSnapshot);
                } else {
                    const requestedStep = parseStepParam(
                        urlParams.get("step"),
                        requestedScenario.steps.length,
                    );

                    // Deep links without a matching saved scenario state should
                    // start at the beginning instead of jumping into a step
                    // whose captured IDs have not been created yet.
                    engine.setStepIndex(requestedStep > 0 ? 0 : requestedStep);
                }
            } else if (persistedSnapshot && persistedScenario) {
                engine.startScenario(persistedScenario);
                engine.restoreFromSnapshot(persistedSnapshot);
            } else if (DEFAULT_SCENARIO) {
                engine.startScenario(DEFAULT_SCENARIO);
            }
        }
        scenarioStateReady = true;
    });

    $effect(() => {
        if (!scenarioStateReady || typeof window === "undefined") {
            return;
        }

        const snapshot = engine.toSnapshot();
        if (!snapshot) {
            localStorage.removeItem(SCENARIO_STATE_KEY);
            return;
        }

        persistScenarioSnapshot();
        syncScenarioUrl(snapshot.scenarioId, snapshot.currentStepIndex);
    });
</script>

<div class="h-full w-full max-w-7xl space-y-6">
    {#if isGuidedView}
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div class="space-y-1">
                <p class="text-sm font-medium text-slate-900 dark:text-slate-100">
                    Guided walkthrough
                </p>
                <p class="text-sm leading-6 text-slate-500 dark:text-slate-400">
                    Choose a scenario, then run one step at a time.
                </p>
            </div>
            <Button
                variant="outline"
                size="sm"
                onclick={refreshTemplateContext}
                disabled={refreshingContext}
                aria-busy={refreshingContext}
                class="shrink-0"
            >
                {refreshingContext ? "Refreshing..." : "Refresh demo data"}
            </Button>
        </div>
    {:else if isAdvancedView}
        <div class="flex flex-col gap-4">
            <Surface tone="muted" class="space-y-4">
                <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div class="space-y-2">
                        <p class="text-sm font-medium text-slate-900 dark:text-slate-100">
                            Request lab
                        </p>
                        <p class="max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                            Use this page when you already know the request you want to inspect.
                            Start from a template, adjust the method or payload, then read the
                            response without the guided storytelling layer.
                        </p>
                    </div>
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div class="min-w-0">
                            <label
                                for="template-select"
                                class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                >Core and L402 templates</label
                            >
                            <Select
                                id="template-select"
                                onchange={applyTemplate}
                                class="block min-w-0 w-full sm:w-auto sm:min-w-[340px]"
                            >
                                <option value="" disabled selected
                                    >Select a starting template...</option
                                >
                                {#each activeTemplateGroups as group}
                                    <optgroup label={group.label}>
                                        {#each group.options as option}
                                            <option value={option.value}
                                                >{option.label}</option
                                            >
                                        {/each}
                                    </optgroup>
                                {/each}
                            </Select>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onclick={refreshTemplateContext}
                            disabled={refreshingContext}
                            aria-busy={refreshingContext}
                        >
                            {refreshingContext ? "Refreshing..." : "Refresh demo data"}
                        </Button>
                    </div>
                </div>

                {#if templateGuide}
                    <Surface tone="subtle" class="px-4 py-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                        {templateGuide}
                    </Surface>
                {/if}

                {#if archivedTemplateGroups.length > 0}
                    <details
                        class="rounded-2xl border border-slate-200 bg-white/70 dark:border-slate-700 dark:bg-slate-900/30"
                    >
                        <summary
                            class="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200"
                        >
                            Archived templates
                        </summary>
                        <div class="space-y-3 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
                            <p class="text-xs leading-5 text-slate-500 dark:text-slate-400">
                                Historical requests kept for reference. They sit outside the focused
                                content-runtime and L402 path.
                            </p>
                            <div class="min-w-0">
                                <label
                                    for="archived-template-select"
                                    class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                    >Archived examples</label
                                >
                                <Select
                                    id="archived-template-select"
                                    onchange={applyTemplate}
                                    class="block min-w-0 w-full sm:w-auto sm:min-w-[340px]"
                                >
                                    <option value="" disabled selected
                                        >Load archived example...</option
                                    >
                                    {#each archivedTemplateGroups as group}
                                        <optgroup label={group.label}>
                                            {#each group.options as option}
                                                <option value={option.value}
                                                    >{option.label}</option
                                                >
                                            {/each}
                                        </optgroup>
                                    {/each}
                                </Select>
                            </div>
                        </div>
                    </details>
                {/if}
            </Surface>

            {#if contextSummaryItems.length > 0}
                <details
                    class="rounded-2xl border border-slate-200 bg-white/80 dark:border-slate-700 dark:bg-slate-900/20"
                >
                    <summary
                        class="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200"
                    >
                        Demo data IDs currently in use
                    </summary>
                    <div class="border-t border-slate-200 px-4 py-3 dark:border-slate-700">
                        <dl
                            class="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4"
                            aria-label="Captured sandbox context"
                        >
                            {#each contextSummaryItems as item}
                                <div
                                    class="rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-950/50"
                                >
                                    <dt class="font-medium text-slate-500 dark:text-slate-400">
                                        {formatContextLabel(item.label)}
                                    </dt>
                                    <dd
                                        class="mt-1 font-mono text-slate-800 dark:text-slate-100"
                                    >
                                        {item.value}
                                    </dd>
                                </div>
                            {/each}
                        </dl>
                    </div>
                </details>
            {:else}
                <Surface tone="muted" class="border-dashed px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                    No demo data is cached yet. Use <span class="font-medium text-slate-700 dark:text-slate-200">Refresh demo data</span>
                    before you continue.
                </Surface>
            {/if}
        </div>
    {/if}

    {#if isGuidedView}
        <div class="space-y-4">
            {#if engine.activeScenario}
                <Surface class="space-y-5">
                    <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr),18rem] lg:items-start">
                        <div class="space-y-2">
                            <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                Scenario
                            </p>
                            <div class="max-w-xl">
                                <Select
                                    aria-label="Scenario selector"
                                    value={engine.activeScenario.id}
                                    onchange={handleScenarioChange}
                                >
                                    {#each scenarioSelectGroups as group}
                                        <optgroup label={group.label}>
                                            {#each group.options as scenario}
                                                <option value={scenario.id}>{scenario.title}</option>
                                            {/each}
                                        </optgroup>
                                    {/each}
                                </Select>
                            </div>
                            <div class="flex flex-wrap items-center gap-2">
                                <p class="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                                    {engine.activeScenario.title}
                                </p>
                                {#if engine.activeScenario.track === "l402"}
                                    <Badge variant="outline">L402</Badge>
                                {/if}
                                {#if activeScenarioIsArchived}
                                    <Badge variant="warning">Archived</Badge>
                                {/if}
                            </div>
                            <p class="text-sm leading-6 text-slate-500 dark:text-slate-400">
                                {engine.activeScenario.tagline}
                            </p>
                            {#if activeScenarioIsArchived}
                                <p class="text-xs leading-5 text-amber-700 dark:text-amber-300">
                                    {engine.activeScenario.archiveReason ??
                                        "This walkthrough is retained for historical reference and sits outside the focused sandbox path."}
                                </p>
                            {/if}
                        </div>

                        <div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-950/30">
                            <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                                Overview
                            </p>
                            <div class="mt-4 flex flex-wrap gap-2">
                                <Badge variant="outline">{engine.activeScenario.steps.length} steps</Badge>
                                <Badge variant="muted">
                                    {engine.isComplete ? "Completed" : `Current: step ${engine.currentStepIndex + 1}`}
                                </Badge>
                                <Badge variant="muted">{engine.stepResults.size} finished</Badge>
                            </div>
                            <p class="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">
                                Pick a scenario, read the current step, then run it before moving on.
                            </p>
                        </div>
                    </div>
                </Surface>
            {/if}

            {#if engine.activeScenario}
                <Surface tone="subtle" class="sticky top-4 z-10 space-y-4 backdrop-blur supports-[backdrop-filter]:bg-white/85 dark:supports-[backdrop-filter]:bg-slate-950/75">
                    <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div class="space-y-1">
                            <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                                Progress
                            </p>
                            <p class="text-sm leading-6 text-slate-500 dark:text-slate-400">
                                Follow the steps in order. Use “Run this step” to advance the walkthrough.
                            </p>
                        </div>
                        {#if getLatestScenarioStep() && getLatestScenarioResult()}
                            <StatusBadge
                                expectedStatus={getLatestScenarioStep()?.expectedStatus}
                                actualStatus={getLatestScenarioResult()?.status}
                            />
                        {/if}
                    </div>
                    <StepTimeline
                        scenario={engine.activeScenario}
                        currentIndex={engine.currentStepIndex}
                        results={engine.stepResults}
                    />
                </Surface>
            {/if}

            {#if engine.activeScenario && engine.currentStep}
                <Surface class="space-y-5">
                        <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div class="space-y-2">
                                <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                    Step {engine.currentStepIndex + 1} of {engine.activeScenario.steps.length}
                                </p>
                                <h3 class="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                                    {engine.currentStep.title}
                                </h3>
                                <p class="text-sm leading-6 text-slate-500 dark:text-slate-400">
                                    {formatStatusExpectation(engine.currentStep.expectedStatus)}
                                </p>
                            </div>

                            <div class="flex flex-wrap items-center gap-2">
                                <Badge variant="outline">{resolveStepProtocolLabel()}</Badge>
                                <Badge variant="muted">{engine.currentStep.method}</Badge>
                                {#if engine.currentStep.expectedStatus}
                                    <Badge variant="outline">Expect {engine.currentStep.expectedStatus}</Badge>
                                {/if}
                            </div>
                        </div>

                        <NarrationBlock
                            title={engine.currentStep.title}
                            narration={engine.currentStep.narration}
                        />

                        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr),16rem]">
                            <div class="space-y-3">
                                <div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/40">
                                    <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                                        Request
                                    </p>
                                    <div class="mt-3 flex flex-wrap items-center gap-2">
                                        <Badge variant="outline">{resolveStepProtocolLabel()}</Badge>
                                        <Badge variant="muted">{engine.currentStep.method}</Badge>
                                    </div>
                                    <p class="mt-3 rounded-xl bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
                                        {engine.interpolatedEndpoint}
                                    </p>
                                </div>

                                {#if engine.interpolatedBody}
                                    <details
                                        class="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950/40"
                                    >
                                        <summary
                                            class="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200"
                                        >
                                            View request payload
                                        </summary>
                                        <div class="border-t border-slate-200 p-4 dark:border-slate-700">
                                            <JsonCodeBlock
                                                value={engine.interpolatedBody}
                                                class="m-0 border border-slate-200 !bg-slate-50 dark:border-slate-800 dark:!bg-slate-950/70"
                                            />
                                        </div>
                                    </details>
                                {/if}

                                {#if contextSummaryItems.length > 0}
                                    <details
                                        class="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950/40"
                                    >
                                        <summary
                                            class="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200"
                                        >
                                            View demo data IDs
                                        </summary>
                                        <div class="grid gap-2 border-t border-slate-200 p-4 text-xs sm:grid-cols-2 dark:border-slate-700">
                                            {#each contextSummaryItems as item}
                                                <div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950/50">
                                                    <p class="font-medium text-slate-500 dark:text-slate-400">
                                                        {formatContextLabel(item.label)}
                                                    </p>
                                                    <p class="mt-1 font-mono text-slate-800 dark:text-slate-100">
                                                        {item.value}
                                                    </p>
                                                </div>
                                            {/each}
                                        </div>
                                    </details>
                                {/if}
                            </div>

                            <div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-950/30">
                                <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                                    Actions
                                </p>
                                <div class="mt-4 flex flex-col gap-2">
                                    <Button
                                        onclick={executeScenarioStep}
                                        disabled={loading}
                                        class="w-full"
                                    >
                                        {loading ? "Running step..." : "Run this step"}
                                    </Button>
                                    {#if loading}
                                        <Button
                                            type="button"
                                            onclick={cancelActiveRequest}
                                            variant="outline"
                                            class="w-full"
                                        >
                                            Cancel request
                                        </Button>
                                    {:else}
                                        <Button
                                            onclick={replayCurrentScenarioStep}
                                            variant="outline"
                                            class="w-full"
                                        >
                                            Run step again
                                        </Button>
                                    {/if}
                                </div>
                                <p class="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">
                                    Run the current request, then review the outcome below before moving on.
                                </p>
                            </div>
                        </div>
                </Surface>
            {:else if engine.isComplete && engine.activeScenario}
                <Surface class="flex flex-col items-center justify-center gap-4 py-12 text-center">
                    <div
                        class="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300"
                    >
                        <Icon src={Check} class="h-8 w-8" />
                    </div>
                    <div class="space-y-2">
                        <h2 class="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                            Scenario complete
                        </h2>
                        <p class="max-w-lg text-sm leading-6 text-slate-500 dark:text-slate-400">
                            You completed every step in "{engine.activeScenario.title}".
                            Replay the last step if you want to inspect the final response again,
                            or reset the walkthrough and start from the beginning.
                        </p>
                    </div>
                    <div class="flex flex-wrap gap-2 justify-center">
                        <Button
                            onclick={replayCurrentScenarioStep}
                            variant="outline"
                        >
                            Replay last step
                        </Button>
                        <Button
                            onclick={() => engine.resetScenario()}
                            variant="outline"
                        >
                            Start over
                        </Button>
                    </div>
                </Surface>
            {:else}
                <Surface tone="muted" class="flex min-h-[24rem] items-center justify-center text-center text-sm text-slate-500 dark:text-slate-400">
                    Choose a scenario to start the walkthrough.
                </Surface>
            {/if}

            {#if errorMsg || getLatestScenarioResult()}
                <Surface tone="muted" class="space-y-4">
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div class="space-y-1">
                            <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                                Latest outcome
                            </p>
                            <h4 class="text-base font-semibold text-slate-900 dark:text-white">
                                {#if errorMsg}
                                    The last request needs attention
                                {:else}
                                    Last step completed
                                {/if}
                            </h4>
                        </div>
                        {#if getLatestScenarioStep() && getLatestScenarioResult()}
                            <StatusBadge
                                expectedStatus={getLatestScenarioStep()?.expectedStatus}
                                actualStatus={getLatestScenarioResult()?.status}
                            />
                        {/if}
                    </div>

                    {#if errorMsg}
                        <ErrorBanner
                            title={errorTitle ?? undefined}
                            message={errorMsg}
                            details={errorDetails}
                            actionLabel={errorAction === "refresh-context"
                                ? "Refresh demo data"
                                : undefined}
                            onAction={errorAction === "refresh-context"
                                ? refreshTemplateContext
                                : undefined}
                        />
                    {/if}

                    {#if getLatestScenarioResult()}
                        {@const lastStepIndex = getLatestScenarioStepIndex()}
                        {@const lastStep = getLatestScenarioStep()}
                        {@const lastResult = getLatestScenarioResult()}
                        {#if lastResult}
                            {@const lastInsight = extractResponseInsight(lastResult.data)}

                            <div class="grid gap-3 sm:grid-cols-3">
                                <div class="rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-950/40">
                                    <p class="text-xs uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                                        Step
                                    </p>
                                    <p class="mt-2 text-sm font-medium text-slate-900 dark:text-white">
                                        {lastStepIndex !== null ? lastStepIndex + 1 : "?"}. {lastStep?.title}
                                    </p>
                                </div>
                                <div class="rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-950/40">
                                    <p class="text-xs uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                                        Status
                                    </p>
                                    <p class="mt-2 text-sm font-medium text-slate-900 dark:text-white">
                                        {lastResult.status}
                                    </p>
                                </div>
                                <div class="rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-950/40">
                                    <p class="text-xs uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                                        Time
                                    </p>
                                    <p class="mt-2 text-sm font-medium text-slate-900 dark:text-white">
                                        {lastResult.elapsed.toFixed(1)} ms
                                    </p>
                                </div>
                            </div>

                            {#if lastInsight}
                                <div
                                    class="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm leading-6 text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-100"
                                >
                                    {#if lastInsight.code}
                                        <p><strong>Code:</strong> {lastInsight.code}</p>
                                    {/if}
                                    {#if lastInsight.message}
                                        <p><strong>Message:</strong> {lastInsight.message}</p>
                                    {/if}
                                    {#if lastInsight.remediation}
                                        <p><strong>Remediation:</strong> {lastInsight.remediation}</p>
                                    {/if}
                                    {#if lastInsight.recommendedNextAction}
                                        <p>
                                            <strong>Recommended next action:</strong>
                                            {lastInsight.recommendedNextAction}
                                        </p>
                                    {/if}
                                </div>
                            {/if}

                            <details
                                class="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950/40"
                            >
                                <summary
                                    class="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200"
                                >
                                    View raw response
                                </summary>
                                <div class="border-t border-slate-200 p-4 dark:border-slate-700">
                                    {#if isPlainTextPayload(lastResult.data)}
                                        <pre
                                            class="m-0 overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs font-mono text-slate-800 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-200"
                                        ><code>{lastResult.data}</code></pre>
                                    {:else}
                                        <JsonCodeBlock
                                            value={lastResult.data}
                                            class="m-0"
                                        />
                                    {/if}
                                </div>
                            </details>
                        {/if}
                    {/if}
                </Surface>
            {/if}
        </div>
    {:else if isAdvancedView}
        <div class="grid gap-6 xl:grid-cols-[minmax(0,1.05fr),minmax(0,0.95fr)]">
            <div class="space-y-4">
                <Surface class="space-y-5">
                    <div class="space-y-2">
                        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                            Request builder
                        </p>
                        <h3 class="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                            Compose a sandbox request
                        </h3>
                        <p class="text-sm leading-6 text-slate-500 dark:text-slate-400">
                            Adjust the method, endpoint, headers, and JSON payload before sending
                            the request. This page is meant for manual exploration after you
                            understand the main walkthroughs.
                        </p>
                    </div>

                    <div class="grid gap-3 sm:grid-cols-[9rem,minmax(0,1fr)]">
                        <div>
                            <label
                                for="method-select"
                                class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                >Method</label
                            >
                            <Select id="method-select" bind:value={method}>
                                <option value="GET">GET</option>
                                <option value="POST">POST</option>
                                <option value="PUT">PUT</option>
                                <option value="DELETE">DELETE</option>
                            </Select>
                        </div>
                        <div>
                            <label
                                for="endpoint-input"
                                class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                >Endpoint</label
                            >
                            <input
                                id="endpoint-input"
                                type="text"
                                bind:value={endpoint}
                                placeholder="/api/..."
                                aria-label="API Endpoint"
                                class="block h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-500 dark:focus:ring-slate-800"
                            />
                        </div>
                    </div>

                    <details
                        class="rounded-2xl border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-950/30"
                    >
                        <summary
                            class="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200"
                        >
                            Request headers
                        </summary>
                        <div class="border-t border-slate-200 p-4 dark:border-slate-700">
                            <label
                                for="headers-input"
                                class="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                >Headers (JSON)</label
                            >
                            <textarea
                                id="headers-input"
                                bind:value={headersText}
                                rows="5"
                                class="block w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 font-mono text-sm text-slate-900 shadow-sm transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-slate-500 dark:focus:ring-slate-800"
                            ></textarea>
                        </div>
                    </details>

                    {#if method !== "GET"}
                        <details
                            open
                            class="rounded-2xl border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-950/30"
                        >
                            <summary
                                class="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200"
                            >
                                Request payload
                            </summary>
                            <div class="border-t border-slate-200 p-4 dark:border-slate-700">
                                <label
                                    for="body-input"
                                    class="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
                                    >Body (JSON)</label
                                >
                                <textarea
                                    id="body-input"
                                    bind:value={jsonBody}
                                    rows="14"
                                    class="block w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 font-mono text-sm text-slate-900 shadow-sm transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:border-slate-500 dark:focus:ring-slate-800"
                                ></textarea>
                            </div>
                        </details>
                    {/if}

                    <div class="flex flex-col gap-2 sm:flex-row">
                        <Button
                            onclick={executeRequest}
                            disabled={loading}
                            class="sm:min-w-[10rem]"
                        >
                            {loading ? "Sending..." : "Send request"}
                        </Button>
                        {#if loading}
                            <Button
                                type="button"
                                onclick={cancelActiveRequest}
                                variant="outline"
                            >
                                Cancel
                            </Button>
                        {/if}
                    </div>
                </Surface>
            </div>

            <div class="space-y-4">
                <Surface tone="muted" class="relative space-y-4">
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div class="space-y-1">
                            <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                                Response
                            </p>
                            <h3 class="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                                {#if responseData !== null || errorMsg}
                                    Request complete
                                {:else}
                                    Waiting for a request
                                {/if}
                            </h3>
                        </div>
                        <div class="flex items-center gap-2">
                            {#if responseStatus !== null}
                                <Badge variant={responseStatus >= 200 && responseStatus < 300 ? "success" : "warning"}>
                                    {responseStatus}
                                </Badge>
                            {/if}
                            {#if elapsedTime !== null}
                                <Badge variant="muted">{elapsedTime} ms</Badge>
                            {/if}
                        </div>
                    </div>

                    {#if responseInsight}
                        <div
                            class="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm leading-6 text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-100"
                        >
                            {#if responseInsight.code}
                                <p><strong>Code:</strong> {responseInsight.code}</p>
                            {/if}
                            {#if responseInsight.message}
                                <p><strong>Message:</strong> {responseInsight.message}</p>
                            {/if}
                            {#if responseInsight.remediation}
                                <p><strong>Remediation:</strong> {responseInsight.remediation}</p>
                            {/if}
                            {#if responseInsight.recommendedNextAction}
                                <p>
                                    <strong>Recommended next action:</strong>
                                    {responseInsight.recommendedNextAction}
                                </p>
                            {/if}
                        </div>
                    {/if}

                    {#if errorMsg}
                        <ErrorBanner
                            title={errorTitle ?? undefined}
                            message={errorMsg}
                            details={errorDetails}
                            actionLabel={errorAction === "refresh-context"
                                ? "Refresh demo data"
                                : undefined}
                            onAction={errorAction === "refresh-context"
                                ? refreshTemplateContext
                                : undefined}
                        />
                    {:else if responseData !== null}
                        <details
                            open
                            class="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950/40"
                        >
                            <summary
                                class="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200"
                            >
                                View response body
                            </summary>
                            <div class="border-t border-slate-200 p-4 dark:border-slate-700">
                                {#if isPlainTextPayload(responseData)}
                                    <pre
                                        class="m-0 w-full overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs font-mono text-slate-800 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-200"
                                    ><code>{responseData}</code></pre>
                                {:else}
                                    <JsonCodeBlock
                                        value={responseData}
                                        class="m-0 w-full"
                                    />
                                {/if}
                            </div>
                        </details>
                    {:else if !loading}
                        <div
                            class="flex min-h-[16rem] items-center justify-center rounded-2xl border border-dashed border-slate-200 px-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400"
                        >
                            Send a request to inspect the response shape here.
                        </div>
                    {/if}

                    {#if loading}
                        <div
                            class="absolute inset-0 flex items-center justify-center bg-white/75 backdrop-blur-sm dark:bg-slate-950/75"
                        >
                            <LoadingSpinner size="xl" />
                        </div>
                    {/if}
                </Surface>

                <Surface tone="subtle" class="space-y-3">
                    <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                        Good uses for request lab
                    </p>
                    <ul class="space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                        <li>1. Compare response shapes across endpoints.</li>
                        <li>2. Reproduce a payload problem after a guided walkthrough.</li>
                        <li>3. Inspect L402 or MCP bridge behavior without the full scenario flow.</li>
                    </ul>
                </Surface>
            </div>
        </div>
    {/if}
</div>
