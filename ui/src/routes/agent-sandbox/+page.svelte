<script lang="ts">
    import { onMount } from "svelte";
    import { deepParseJson } from "$lib/utils";
    import ErrorBanner from "$lib/components/ErrorBanner.svelte";
    import LoadingSpinner from "$lib/components/LoadingSpinner.svelte";
    import JsonCodeBlock from "$lib/components/JsonCodeBlock.svelte";

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
        options: Array<{ value: string; label: string }>;
    };

    type ResponseInsight = {
        code?: string;
        message?: string;
        remediation?: string;
        recommendedNextAction?: string;
    };

    const CONTEXT_KEY = "__wc_agent_sandbox_context";
    const DEFAULT_HEADERS = {
        "Content-Type": "application/json",
    };

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
            const response = await fetch(path, {
                headers: {
                    Accept: "application/json",
                    ...contextHeaders(),
                },
                credentials: "include",
            });

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
                nextContext.transitionId = readNumber(firstTask?.transition?.id);
            }
            if (!nextContext.contentItemId) {
                nextContext.contentItemId = readNumber(firstTask?.contentItem?.id);
            }
            if (!nextContext.contentTypeId) {
                nextContext.contentTypeId = readNumber(firstTask?.contentType?.id);
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
                key === "contentTypeSlug"
                    ? String(value)
                    : readNumber(value);

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

    function buildTemplates(ctx: SandboxContext): Record<string, TemplatePreset> {
        const contentTypeId = resolveId(ctx.contentTypeId, 1);
        const paidContentTypeId = resolveId(ctx.paidContentTypeId, contentTypeId);
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

    const scenarioTemplateMap: Record<string, { base: string; guide: string }> = {
        "scenario-lifecycle-1": {
            base: "create-blog-type",
            guide: "Scenario 1/5 (Full Content Lifecycle): Create a content type first.",
        },
        "scenario-lifecycle-2": {
            base: "create-blog-post",
            guide: "Scenario 2/5: Create a content item using the type from step 1.",
        },
        "scenario-lifecycle-3": {
            base: "update-blog-post",
            guide: "Scenario 3/5: Update the item to generate a new version.",
        },
        "scenario-lifecycle-4": {
            base: "view-item-versions",
            guide: "Scenario 4/5: List version history and pick rollback target.",
        },
        "scenario-lifecycle-5": {
            base: "rollback-item",
            guide: "Scenario 5/5: Roll back to a previous version.",
        },
        "scenario-workflow-1": {
            base: "create-workflow",
            guide: "Scenario 1/7 (Editorial Workflow): Create workflow for active content type.",
        },
        "scenario-workflow-2": {
            base: "add-workflow-transition-draft-review",
            guide: "Scenario 2/7: Add draft -> in_review transition.",
        },
        "scenario-workflow-3": {
            base: "add-workflow-transition-review-published",
            guide: "Scenario 3/7: Add in_review -> published transition.",
        },
        "scenario-workflow-4": {
            base: "create-blog-post-draft",
            guide: "Scenario 4/7: Create draft content item.",
        },
        "scenario-workflow-5": {
            base: "submit-for-review",
            guide: "Scenario 5/7: Submit draft for review with transition ID.",
        },
        "scenario-workflow-6": {
            base: "add-comment",
            guide: "Scenario 6/7: Add review feedback comment.",
        },
        "scenario-workflow-7": {
            base: "decide-review-task",
            guide: "Scenario 7/7: Decide review task (approve/reject).",
        },
        "scenario-l402-1": {
            base: "create-paid-content-type",
            guide: "Scenario 1/3 (L402): Create a paid content type with basePrice.",
        },
        "scenario-l402-2": {
            base: "l402-payment-required",
            guide: "Scenario 2/3: Attempt write without L402 auth and inspect 402 payload.",
        },
        "scenario-l402-3": {
            base: "list-payments",
            guide: "Scenario 3/3: Inspect payment records/status updates.",
        },
        "scenario-webhook-1": {
            base: "register-webhook",
            guide: "Scenario 1/4 (Webhook Integration): Register webhook endpoint.",
        },
        "scenario-webhook-2": {
            base: "create-blog-post",
            guide: "Scenario 2/4: Trigger content event that should dispatch webhook.",
        },
        "scenario-webhook-3": {
            base: "list-webhooks",
            guide: "Scenario 3/4: Verify webhook registration state.",
        },
        "scenario-webhook-4": {
            base: "delete-webhook",
            guide: "Scenario 4/4: Delete webhook registration.",
        },
        "scenario-batch-1": {
            base: "batch-create-items",
            guide: "Scenario 1/3 (Batch Operations): Batch-create items.",
        },
        "scenario-batch-2": {
            base: "batch-update-items",
            guide: "Scenario 2/3: Batch-update selected items.",
        },
        "scenario-batch-3": {
            base: "batch-delete-items",
            guide: "Scenario 3/3: Batch-delete selected items.",
        },
    };

    const templateGroups: TemplateGroup[] = [
        {
            label: "Quick Start",
            options: [
                { value: "list-content-types", label: "List Content Types" },
                { value: "create-blog-type", label: "Create Blog Type" },
                {
                    value: "create-blog-post",
                    label: "Create Valid Blog Post",
                },
                { value: "view-audit-logs", label: "View Audit Logs" },
            ],
        },
        {
            label: "Coverage: Content Types",
            options: [
                {
                    value: "create-paid-content-type",
                    label: "Create Paid Content Type",
                },
                { value: "get-content-type", label: "Get Content Type by ID" },
                {
                    value: "update-content-type",
                    label: "Update Content Type",
                },
                {
                    value: "delete-content-type",
                    label: "Delete Content Type",
                },
            ],
        },
        {
            label: "Coverage: Content Items & Versioning",
            options: [
                {
                    value: "create-blog-post-draft",
                    label: "Create Draft Item",
                },
                { value: "create-post-invalid", label: "Create Invalid Item" },
                { value: "list-blog-posts", label: "List Content Items" },
                { value: "get-content-item", label: "Get Item by ID" },
                { value: "update-blog-post", label: "Update Item" },
                { value: "delete-content-item", label: "Delete Item" },
                { value: "dry-run-create", label: "Dry Run Create" },
                { value: "view-item-versions", label: "View Versions" },
                { value: "rollback-item", label: "Rollback Item" },
                { value: "list-comments", label: "List Review Comments" },
                { value: "add-comment", label: "Add Review Comment" },
                {
                    value: "l402-payment-required",
                    label: "L402 Payment Challenge",
                },
            ],
        },
        {
            label: "Coverage: Batch Operations",
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
            label: "Coverage: Workflow & Review",
            options: [
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
                { value: "decide-review-task", label: "Decide Review Task" },
            ],
        },
        {
            label: "Coverage: API Keys & Webhooks",
            options: [
                { value: "list-api-keys", label: "List API Keys" },
                { value: "create-api-key", label: "Create API Key" },
                { value: "rotate-api-key", label: "Rotate API Key" },
                { value: "revoke-api-key", label: "Revoke API Key" },
                { value: "register-webhook", label: "Register Webhook" },
                { value: "list-webhooks", label: "List Webhooks" },
                { value: "get-webhook", label: "Get Webhook" },
                { value: "update-webhook", label: "Update Webhook" },
                { value: "delete-webhook", label: "Delete Webhook" },
            ],
        },
        {
            label: "Coverage: Domain, Policy, Search, Payments",
            options: [
                { value: "list-domains", label: "List Domains" },
                { value: "evaluate-policy", label: "Evaluate Policy" },
                { value: "semantic-search", label: "Semantic Search" },
                { value: "list-payments", label: "List Payments" },
                { value: "get-payment", label: "Get Payment by ID" },
            ],
        },
        {
            label: "Error Scenarios (AI Remediation)",
            options: [
                {
                    value: "error-missing-auth",
                    label: "Missing Authentication",
                },
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
                {
                    value: "error-cross-domain",
                    label: "Cross-Domain Access Probe",
                },
                {
                    value: "error-payment-required",
                    label: "Payment Required (402)",
                },
            ],
        },
        {
            label: "Scenario Walkthroughs",
            options: [
                {
                    value: "scenario-lifecycle-1",
                    label: "Lifecycle 1/5: Create Type",
                },
                {
                    value: "scenario-lifecycle-2",
                    label: "Lifecycle 2/5: Create Item",
                },
                {
                    value: "scenario-lifecycle-3",
                    label: "Lifecycle 3/5: Update Item",
                },
                {
                    value: "scenario-lifecycle-4",
                    label: "Lifecycle 4/5: Versions",
                },
                {
                    value: "scenario-lifecycle-5",
                    label: "Lifecycle 5/5: Rollback",
                },
                {
                    value: "scenario-workflow-1",
                    label: "Workflow 1/7: Create Workflow",
                },
                {
                    value: "scenario-workflow-2",
                    label: "Workflow 2/7: Add draft -> review",
                },
                {
                    value: "scenario-workflow-3",
                    label: "Workflow 3/7: Add review -> published",
                },
                {
                    value: "scenario-workflow-4",
                    label: "Workflow 4/7: Create Draft",
                },
                {
                    value: "scenario-workflow-5",
                    label: "Workflow 5/7: Submit Review",
                },
                {
                    value: "scenario-workflow-6",
                    label: "Workflow 6/7: Add Comment",
                },
                {
                    value: "scenario-workflow-7",
                    label: "Workflow 7/7: Approve Task",
                },
                {
                    value: "scenario-l402-1",
                    label: "L402 1/3: Create Paid Type",
                },
                {
                    value: "scenario-l402-2",
                    label: "L402 2/3: Trigger 402",
                },
                {
                    value: "scenario-l402-3",
                    label: "L402 3/3: List Payments",
                },
                {
                    value: "scenario-webhook-1",
                    label: "Webhook 1/4: Register",
                },
                {
                    value: "scenario-webhook-2",
                    label: "Webhook 2/4: Trigger Event",
                },
                {
                    value: "scenario-webhook-3",
                    label: "Webhook 3/4: List",
                },
                {
                    value: "scenario-webhook-4",
                    label: "Webhook 4/4: Delete",
                },
                {
                    value: "scenario-batch-1",
                    label: "Batch 1/3: Create",
                },
                {
                    value: "scenario-batch-2",
                    label: "Batch 2/3: Update",
                },
                {
                    value: "scenario-batch-3",
                    label: "Batch 3/3: Delete",
                },
            ],
        },
    ];

    async function refreshTemplateContext() {
        refreshingContext = true;
        sandboxContext = await hydrateSandboxContext();
        refreshingContext = false;
    }

    function resolveTemplate(name: string, context: SandboxContext): TemplatePreset | null {
        const templates = buildTemplates(context);

        if (templates[name]) {
            return templates[name];
        }

        const scenario = scenarioTemplateMap[name];
        if (!scenario) {
            return null;
        }

        const baseTemplate = templates[scenario.base];
        if (!baseTemplate) {
            return null;
        }

        return {
            ...baseTemplate,
            guide: scenario.guide,
        };
    }

    async function executeRequest() {
        if (!endpoint || !endpoint.startsWith("/api")) {
            errorMsg = "Endpoint must exist and start with '/api'";
            return;
        }

        loading = true;
        errorMsg = null;
        responseData = null;
        responseStatus = null;
        elapsedTime = null;
        responseInsight = null;

        let parsedHeaders: Record<string, string> = {};
        try {
            if (headersText.trim()) {
                parsedHeaders = normalizeHeaders(JSON.parse(headersText));
            }
        } catch {
            errorMsg = "Invalid JSON in Headers";
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
            } catch {
                errorMsg = "Invalid JSON in Request Body";
                loading = false;
                return;
            }
        }

        const start = performance.now();
        try {
            const res = await fetch(endpoint, {
                method,
                headers: parsedHeaders,
                body: bodyPayload,
                credentials: "include",
            });

            responseStatus = res.status;

            try {
                const rawJson = await res.json();
                const parsed = deepParseJson(rawJson);
                responseData = parsed;
                responseInsight = extractResponseInsight(parsed);
                captureResponseContext(endpoint, parsed);
            } catch {
                const textPayload = await res.text();
                responseData = textPayload;
                responseInsight = null;
            }
        } catch (err: any) {
            errorMsg = err.message || "Network Error";
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
    });
</script>

<svelte:head>
    <title>Agent Sandbox | WordClaw Supervisor</title>
</svelte:head>

<div class="h-full flex flex-col">
    <div class="mb-6 flex flex-col gap-4">
        <div class="flex justify-between items-end gap-4 flex-wrap">
            <div>
                <h2 class="text-2xl font-bold text-gray-900 dark:text-white">
                    Agent Sandbox
                </h2>
                <p class="text-gray-500 dark:text-gray-400 text-sm mt-1">
                    Simulate API calls, inspect AI-ready response metadata, and
                    run multi-step scenario walkthroughs.
                </p>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
                <label
                    for="template-select"
                    class="text-sm font-medium text-gray-700 dark:text-gray-300"
                    >Templates:</label
                >
                <select
                    id="template-select"
                    onchange={applyTemplate}
                    class="block rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white px-3 py-1.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-xs min-w-[320px]"
                >
                    <option value="" disabled selected
                        >Select a real-world example...</option
                    >
                    {#each templateGroups as group}
                        <optgroup label={group.label}>
                            {#each group.options as option}
                                <option value={option.value}>{option.label}</option>
                            {/each}
                        </optgroup>
                    {/each}
                </select>
                <button
                    class="px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600"
                    onclick={refreshTemplateContext}
                    disabled={refreshingContext}
                >
                    {refreshingContext ? "Refreshing..." : "Refresh IDs"}
                </button>
            </div>
        </div>

        {#if templateGuide}
            <div
                class="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-900/20 text-blue-900 dark:text-blue-200 px-3 py-2 text-xs whitespace-pre-line"
            >
                {templateGuide}
            </div>
        {/if}

        <div class="flex flex-wrap gap-2 text-[11px]">
            <span
                class="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
                >domain: {sandboxContext.domainId ?? "n/a"}</span
            >
            <span
                class="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
                >contentTypeId: {sandboxContext.contentTypeId ?? "n/a"}</span
            >
            <span
                class="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
                >contentItemId: {sandboxContext.contentItemId ?? "n/a"}</span
            >
            <span
                class="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
                >workflowId: {sandboxContext.workflowId ?? "n/a"}</span
            >
            <span
                class="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
                >transitionId: {sandboxContext.transitionId ?? "n/a"}</span
            >
            <span
                class="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
                >reviewTaskId: {sandboxContext.reviewTaskId ?? "n/a"}</span
            >
            <span
                class="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
                >webhookId: {sandboxContext.webhookId ?? "n/a"}</span
            >
            <span
                class="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
                >apiKeyId: {sandboxContext.apiKeyId ?? "n/a"}</span
            >
            <span
                class="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
                >paymentId: {sandboxContext.paymentId ?? "n/a"}</span
            >
        </div>
    </div>

    <div
        class="flex flex-col md:flex-row flex-1 gap-6 overflow-hidden min-h-[600px]"
    >
        <div
            class="w-full md:w-1/2 flex flex-col gap-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-100 dark:border-gray-700 p-5 overflow-y-auto"
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

            <div class="pt-2">
                <button
                    onclick={executeRequest}
                    disabled={loading}
                    class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                    {loading ? "Sending..." : "Send Request"}
                </button>
            </div>
        </div>

        <div
            class="w-full md:w-1/2 flex flex-col bg-gray-50 dark:bg-gray-900 rounded-lg shadow border border-gray-200 dark:border-gray-700 overflow-hidden relative"
        >
            <div
                class="bg-gray-100 dark:bg-gray-800 px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center"
            >
                <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
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
                        <span class="text-xs text-gray-500 dark:text-gray-400"
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
                            <p><strong>Code:</strong> {responseInsight.code}</p>
                        {/if}
                        {#if responseInsight.message}
                            <p>
                                <strong>Message:</strong> {responseInsight.message}
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
                    <ErrorBanner message={errorMsg} />
                {:else if responseData !== null}
                    <JsonCodeBlock value={responseData} class="m-0 w-full h-full" />
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
