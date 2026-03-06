<script lang="ts">
    import { onMount } from "svelte";
    import { Icon, Check } from "svelte-hero-icons";
    import type { Scenario, ScenarioEngineSnapshot } from "$lib/types/sandbox";
    import { deepParseJson } from "$lib/utils";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import JsonCodeBlock from "$lib/components/JsonCodeBlock.svelte";
    import ScenarioSidebar from "$lib/components/sandbox/ScenarioSidebar.svelte";
    import StepTimeline from "$lib/components/sandbox/StepTimeline.svelte";
    import NarrationBlock from "$lib/components/sandbox/NarrationBlock.svelte";
    import StatusBadge from "$lib/components/sandbox/StatusBadge.svelte";
    import { engine } from "$lib/sandbox/engine.svelte";
    import { SCENARIOS } from "$lib/sandbox/scenarios";

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
    let activeTab = $state<"guided" | "advanced">("guided");
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
        activeTab = "guided";
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
                const requestedStep = parseStepParam(
                    urlParams.get("step"),
                    requestedScenario.steps.length,
                );
                engine.setStepIndex(requestedStep);
                activeTab = "guided";
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

<svelte:head>
    <title>Agent Sandbox (Experimental) | WordClaw Supervisor</title>
</svelte:head>

<div class="h-full flex flex-col max-w-7xl w-full mx-auto">
    <div class="mb-6 flex flex-col gap-4">
        <div class="flex justify-between items-end gap-4 flex-wrap">
            <div>
                <h2 class="text-2xl font-bold text-gray-900 dark:text-white">
                    Agent Sandbox (Experimental)
                </h2>
                <p class="text-gray-500 dark:text-gray-400 text-sm mt-1">
                    Focused on the supported runtime path: core content
                    operations, workflow review, REST/MCP surfaces, and L402.
                    Historical demos stay available under archived sections.
                </p>
            </div>
            <div
                class="flex w-full lg:w-auto flex-col sm:flex-row items-stretch sm:items-end gap-3"
            >
                <div class="min-w-0">
                    <label
                        for="template-select"
                        class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400"
                        >Active Templates</label
                    >
                    <select
                        id="template-select"
                        onchange={applyTemplate}
                        class="block w-full sm:w-auto min-w-0 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white px-3 py-1.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-xs sm:min-w-[320px]"
                    >
                        <option value="" disabled selected
                            >Select a core or L402 example...</option
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
                    </select>
                </div>
                <button
                    class="px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
                    onclick={refreshTemplateContext}
                    disabled={refreshingContext}
                    aria-busy={refreshingContext}
                >
                    {refreshingContext ? "Refreshing..." : "Refresh IDs"}
                </button>
            </div>
        </div>

        {#if archivedTemplateGroups.length > 0}
            <details
                class="rounded-lg border border-gray-200 bg-white/70 dark:border-gray-700 dark:bg-gray-800/40"
            >
                <summary
                    class="cursor-pointer list-none px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-200"
                >
                    Archived Templates
                </summary>
                <div
                    class="border-t border-gray-200 px-4 py-3 dark:border-gray-700 flex flex-col gap-3 lg:flex-row lg:items-end"
                >
                    <p class="text-xs leading-5 text-gray-500 dark:text-gray-400 lg:max-w-md">
                        Historical module, enterprise, and legacy demo requests
                        that are outside the focused core runtime and L402 path.
                    </p>
                    <div class="min-w-0">
                        <label
                            for="archived-template-select"
                            class="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400"
                            >Archived Templates</label
                        >
                        <select
                            id="archived-template-select"
                            onchange={applyTemplate}
                            class="block w-full sm:w-auto min-w-0 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white px-3 py-1.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-xs sm:min-w-[320px]"
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
                        </select>
                    </div>
                </div>
            </details>
        {/if}

        {#if templateGuide}
            <div
                class="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-900/20 text-blue-900 dark:text-blue-200 px-3 py-2 text-xs whitespace-pre-line"
            >
                {templateGuide}
            </div>
        {/if}

        {#if contextSummaryItems.length > 0}
            <div
                class="rounded-lg border border-gray-200 bg-gray-50/60 dark:border-gray-700 dark:bg-gray-800/50 p-3"
            >
                <p
                    class="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400"
                >
                    Captured Context
                </p>
                <dl
                    class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 text-xs"
                    aria-label="Captured sandbox context"
                >
                    {#each contextSummaryItems as item}
                        <div
                            class="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 px-3 py-2"
                        >
                            <dt class="font-medium text-gray-500 dark:text-gray-400">
                                {item.label}
                            </dt>
                            <dd
                                class="mt-1 font-mono text-gray-800 dark:text-gray-100"
                            >
                                {item.value}
                            </dd>
                        </div>
                    {/each}
                </dl>
            </div>
        {:else}
            <div
                class="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-4 py-3 text-xs text-gray-500 dark:text-gray-400"
            >
                Run a scenario or apply a template to hydrate IDs for follow-up
                requests.
            </div>
        {/if}
    </div>

    <div
        class="mb-4 flex gap-4 border-b border-gray-200 dark:border-gray-700"
        role="tablist"
        aria-label="Sandbox modes"
    >
        <button
            id="sandbox-tab-guided"
            role="tab"
            type="button"
            aria-selected={activeTab === "guided"}
            aria-controls="sandbox-panel-guided"
            tabindex={activeTab === "guided" ? 0 : -1}
            class="pb-2 px-1 text-sm font-medium border-b-2 {activeTab ===
            'guided'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}"
            onclick={() => (activeTab = "guided")}
        >
            Guided Scenarios
        </button>
        <button
            id="sandbox-tab-advanced"
            role="tab"
            type="button"
            aria-selected={activeTab === "advanced"}
            aria-controls="sandbox-panel-advanced"
            tabindex={activeTab === "advanced" ? 0 : -1}
            class="pb-2 px-1 text-sm font-medium border-b-2 {activeTab ===
            'advanced'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'}"
            onclick={() => (activeTab = "advanced")}
        >
            Advanced Requests
        </button>
    </div>

    {#if activeTab === "guided"}
        <div
            id="sandbox-panel-guided"
            role="tabpanel"
            aria-labelledby="sandbox-tab-guided"
            tabindex="0"
            class="flex-1"
        >
        <div
            class="flex flex-col lg:flex-row flex-1 gap-6 overflow-visible lg:overflow-hidden min-h-[600px] pb-6"
        >
            <ScenarioSidebar
                scenarios={SCENARIOS}
                activeScenarioId={engine.activeScenario?.id || null}
                onSelect={selectScenario}
            />

            <div
                class="w-full lg:w-1/2 flex flex-col gap-4 overflow-y-auto lg:pr-2"
            >
                {#if engine.activeScenario && engine.currentStep}
                    {#if activeScenarioIsArchived}
                        <div
                            class="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-100"
                        >
                            <p class="font-medium">Archived scenario</p>
                            <p class="mt-1 text-xs leading-5">
                                {engine.activeScenario.archiveReason ??
                                    "This walkthrough is retained for historical reference and is outside the focused core runtime + L402 sandbox path."}
                            </p>
                        </div>
                    {/if}
                    <NarrationBlock
                        title={engine.currentStep.title}
                        narration={engine.currentStep.narration}
                    />

                    <div
                        class="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-100 dark:border-gray-700 p-5 flex flex-col gap-4"
                    >
                        <h3
                            class="text-lg font-semibold border-b border-gray-200 dark:border-gray-700 pb-2"
                        >
                            Execute Request
                        </h3>

                        <div class="flex gap-3 text-sm font-mono items-center">
                            <span
                                class="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded font-semibold text-gray-800 dark:text-gray-200"
                                >{resolveStepProtocolLabel()}</span
                            >
                            <span
                                class="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded font-semibold text-gray-800 dark:text-gray-200"
                                >{engine.currentStep.method}</span
                            >
                            <span
                                class="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded flex-1 truncate text-gray-600 dark:text-gray-300"
                                >{engine.interpolatedEndpoint}</span
                            >
                        </div>

                        {#if engine.interpolatedBody}
                            <div class="mt-2 text-sm">
                                <p
                                    class="block text-xs font-semibold text-gray-500 mb-1"
                                    >PAYLOAD</p
                                >
                                <JsonCodeBlock
                                    value={engine.interpolatedBody}
                                    class="m-0 !bg-gray-50 dark:!bg-gray-900 border border-gray-200 dark:border-gray-800"
                                />
                            </div>
                        {/if}

                        <div class="pt-4 mt-auto grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <button
                                onclick={executeScenarioStep}
                                disabled={loading}
                                class="w-full py-2.5 px-4 shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 transition-colors"
                            >
                                {loading ? "Executing Step..." : "Run Step"}
                            </button>
                            {#if loading}
                                <button
                                    type="button"
                                    onclick={cancelActiveRequest}
                                    class="w-full py-2.5 px-4 shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 rounded-md transition-colors"
                                >
                                    Cancel Request
                                </button>
                            {:else}
                                <button
                                    onclick={replayCurrentScenarioStep}
                                    class="w-full py-2.5 px-4 shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 rounded-md transition-colors"
                                >
                                    Replay Step
                                </button>
                            {/if}
                        </div>
                    </div>
                {:else if engine.isComplete && engine.activeScenario}
                    <div
                        class="flex flex-col items-center justify-center p-12 text-center h-full bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-100 dark:border-gray-700"
                    >
                        <div
                            class="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4"
                        >
                            <Icon src={Check} class="w-8 h-8" />
                        </div>
                        <h2
                            class="text-2xl font-bold mb-2 text-gray-800 dark:text-white"
                        >
                            Scenario Complete
                        </h2>
                        <p class="text-gray-500 dark:text-gray-400 mb-6">
                            You successfully completed all steps in "{engine
                                .activeScenario.title}".
                        </p>
                        <div class="flex flex-wrap gap-2 justify-center">
                            <button
                                onclick={replayCurrentScenarioStep}
                                class="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                                >Replay Last Step</button
                            >
                            <button
                                onclick={() => engine.resetScenario()}
                                class="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                                >Play Again</button
                            >
                        </div>
                    </div>
                {:else}
                    <div
                        class="flex items-center justify-center h-full text-gray-400 dark:text-gray-500"
                    >
                        Select a scenario from the sidebar to begin.
                    </div>
                {/if}
            </div>

            <div
                class="w-full lg:w-[35%] flex flex-col bg-gray-50 dark:bg-gray-900 rounded-lg shadow border border-gray-200 dark:border-gray-700 overflow-hidden relative"
            >
                {#if engine.activeScenario}
                    <div class="p-6 overflow-y-auto flex-1">
                        <StepTimeline
                            scenario={engine.activeScenario}
                            currentIndex={engine.currentStepIndex}
                            results={engine.stepResults}
                        />
                    </div>
                    {#if errorMsg}
                        <div
                            class="border-t border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800"
                        >
                            <ErrorBanner
                                title={errorTitle ?? undefined}
                                message={errorMsg}
                                details={errorDetails}
                                actionLabel={errorAction === "refresh-context"
                                    ? "Refresh IDs"
                                    : undefined}
                                onAction={errorAction === "refresh-context"
                                    ? refreshTemplateContext
                                    : undefined}
                            />
                        </div>
                    {/if}
                    {#if engine.stepResults.size > 0 && engine.currentStepIndex > 0}
                        {@const lastResult = engine.stepResults.get(
                            engine.currentStepIndex - 1,
                        )}
                        <div
                            class="border-t border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800 mt-auto"
                        >
                            <div class="flex items-center justify-between mb-2">
                                <h4
                                    class="font-semibold text-sm text-gray-700 dark:text-gray-300"
                                >
                                    Last Response Output
                                </h4>
                                <StatusBadge
                                    expectedStatus={engine.activeScenario.steps[
                                        engine.currentStepIndex - 1
                                    ].expectedStatus}
                                    actualStatus={lastResult?.status}
                                />
                            </div>
                            <div
                                class="mt-3 max-h-[300px] overflow-auto border border-gray-100 dark:border-gray-700 rounded"
                            >
                                {#if isPlainTextPayload(lastResult?.data)}
                                    <pre
                                        class="m-0 p-4 text-xs font-mono text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-900 overflow-x-auto whitespace-pre-wrap break-words"
                                    ><code>{lastResult?.data}</code></pre>
                                {:else}
                                    <JsonCodeBlock
                                        value={lastResult?.data}
                                        class="m-0 text-xs !bg-gray-50 dark:!bg-gray-900"
                                    />
                                {/if}
                            </div>
                        </div>
                    {/if}
                    {#if loading}
                        <div
                            class="absolute inset-0 bg-white/50 dark:bg-gray-900/50 flex flex-col items-center justify-center gap-3 backdrop-blur-sm"
                        >
                            <LoadingSpinner size="xl" />
                            <p
                                class="text-sm font-medium text-gray-700 dark:text-gray-200"
                            >
                                Executing request...
                            </p>
                        </div>
                    {/if}
                {/if}
            </div>
        </div>
        </div>
    {:else}
        <div
            id="sandbox-panel-advanced"
            role="tabpanel"
            aria-labelledby="sandbox-tab-advanced"
            tabindex="0"
            class="flex-1"
        >
        <div
            class="flex flex-col lg:flex-row flex-1 gap-6 overflow-visible lg:overflow-hidden min-h-[600px]"
        >
            <div
                class="w-full lg:w-1/2 flex flex-col gap-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-100 dark:border-gray-700 p-5 overflow-y-auto"
            >
                <h3
                    class="text-lg font-semibold text-gray-800 dark:text-gray-200 border-b border-gray-200 dark:border-gray-700 pb-2"
                >
                    Request Formulation
                </h3>

                <div class="flex gap-3">
                    <select
                        bind:value={method}
                        aria-label="HTTP Method"
                        class="block w-32 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm"
                    >
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="DELETE">DELETE</option>
                    </select>
                    <input
                        type="text"
                        bind:value={endpoint}
                        placeholder="/api/..."
                        aria-label="API Endpoint"
                        class="block flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm font-mono"
                    />
                </div>

                <div class="flex flex-col flex-1 gap-4">
                    <div class="flex flex-col">
                        <label
                            for="headers-input"
                            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                            >Headers (JSON)</label
                        >
                        <textarea
                            id="headers-input"
                            bind:value={headersText}
                            rows="4"
                            class="block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm font-mono"
                        ></textarea>
                    </div>

                    {#if method !== "GET"}
                        <div class="flex flex-col flex-1">
                            <label
                                for="body-input"
                                class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                                >Body (JSON)</label
                            >
                            <textarea
                                id="body-input"
                                bind:value={jsonBody}
                                class="block w-full flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm font-mono resize-none"
                            ></textarea>
                        </div>
                    {/if}
                </div>

                <div class="pt-2 flex gap-2">
                    <button
                        onclick={executeRequest}
                        disabled={loading}
                        class="flex-1 flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                        {loading ? "Sending..." : "Send Request"}
                    </button>
                    {#if loading}
                        <button
                            type="button"
                            onclick={cancelActiveRequest}
                            class="py-2 px-4 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600"
                        >
                            Cancel
                        </button>
                    {/if}
                </div>
            </div>

            <div
                class="w-full lg:w-1/2 flex flex-col bg-gray-50 dark:bg-gray-900 rounded-lg shadow border border-gray-200 dark:border-gray-700 overflow-hidden relative"
            >
                <div
                    class="bg-gray-100 dark:bg-gray-800 px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center"
                >
                    <h3
                        class="text-sm font-semibold text-gray-700 dark:text-gray-300"
                    >
                        Response
                    </h3>
                    <div class="flex items-center gap-3">
                        {#if responseStatus !== null}
                            <span
                                class="text-xs font-bold px-2 py-0.5 rounded {responseStatus >=
                                    200 && responseStatus < 300
                                    ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400'
                                    : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400'}"
                            >
                                {responseStatus}
                            </span>
                        {/if}
                        {#if elapsedTime !== null}
                            <span
                                class="text-xs text-gray-500 dark:text-gray-400"
                                >{elapsedTime}ms</span
                            >
                        {/if}
                    </div>
                </div>

                <div class="flex-1 overflow-auto p-4 flex flex-col">
                    {#if responseInsight}
                        <div
                            class="mb-3 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-900/20 p-3 text-xs text-amber-900 dark:text-amber-200"
                        >
                            {#if responseInsight.code}
                                <p>
                                    <strong>Code:</strong>
                                    {responseInsight.code}
                                </p>
                            {/if}
                            {#if responseInsight.message}
                                <p>
                                    <strong>Message:</strong>
                                    {responseInsight.message}
                                </p>
                            {/if}
                            {#if responseInsight.remediation}
                                <p>
                                    <strong>Remediation:</strong>
                                    {responseInsight.remediation}
                                </p>
                            {/if}
                            {#if responseInsight.recommendedNextAction}
                                <p>
                                    <strong>Recommended Next Action:</strong>
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
                                ? "Refresh IDs"
                                : undefined}
                            onAction={errorAction === "refresh-context"
                                ? refreshTemplateContext
                                : undefined}
                        />
                    {:else if responseData !== null}
                        {#if isPlainTextPayload(responseData)}
                            <pre
                                class="m-0 w-full h-full rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4 text-xs font-mono text-gray-800 dark:text-gray-200 overflow-x-auto whitespace-pre-wrap break-words"
                            ><code>{responseData}</code></pre>
                        {:else}
                            <JsonCodeBlock
                                value={responseData}
                                class="m-0 w-full h-full"
                            />
                        {/if}
                    {:else if !loading}
                        <div
                            class="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm"
                        >
                            Submit a request to see the response payload.
                        </div>
                    {/if}

                    {#if loading}
                        <div
                            class="absolute inset-0 bg-white/50 dark:bg-gray-900/50 flex items-center justify-center backdrop-blur-sm"
                        >
                            <LoadingSpinner size="xl" />
                        </div>
                    {/if}
                </div>
            </div>
        </div>
        </div>
    {/if}
</div>
