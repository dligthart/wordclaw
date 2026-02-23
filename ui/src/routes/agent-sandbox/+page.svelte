<script lang="ts">
    import { onMount } from "svelte";
    import { auth } from "$lib/auth.svelte";

    type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

    let method: HttpMethod = $state("GET");
    let endpoint = $state("/api/content-types");
    let jsonBody = $state("");
    let headersText = $state('{\n  "Content-Type": "application/json"\n}');

    let loading = $state(false);
    let errorMsg = $state<string | null>(null);
    let responseData = $state<any>(null);
    let responseStatus = $state<number | null>(null);
    let elapsedTime = $state<number | null>(null);

    function tryParseDeep(value: any): any {
        if (typeof value === "string") {
            try {
                const parsed = JSON.parse(value);
                if (typeof parsed === "object" && parsed !== null) {
                    return tryParseDeep(parsed);
                }
            } catch {
                // Not JSON
            }
            return value;
        } else if (Array.isArray(value)) {
            return value.map((item) => tryParseDeep(item));
        } else if (typeof value === "object" && value !== null) {
            const result: any = {};
            for (const key in value) {
                result[key] = tryParseDeep(value[key]);
            }
            return result;
        }
        return value;
    }

    function deepStringify(payload: any): any {
        if (!payload || typeof payload !== "object") return payload;

        const result = { ...payload };

        // The API expects 'schema' inside ContentTypes and 'data' inside ContentItems to be JSON strings
        if (result.schema && typeof result.schema === "object") {
            result.schema = JSON.stringify(result.schema);
        }

        if (result.data && typeof result.data === "object") {
            result.data = JSON.stringify(result.data);
        }

        return result;
    }

    // Custom fetch so we can see structured JSON errors (like remediation) gracefully
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

        let parsedHeaders: Record<string, string> = {};
        try {
            if (headersText.trim()) {
                parsedHeaders = JSON.parse(headersText);
            }
        } catch (e) {
            errorMsg = "Invalid JSON in Headers";
            loading = false;
            return;
        }

        // Auto-inject domain context if available to prevent TENANT_ISOLATION_VIOLATION
        if (typeof window !== "undefined") {
            const domainId = localStorage.getItem("__wc_domain_id");
            if (domainId) {
                parsedHeaders["x-wordclaw-domain"] = domainId;
            }
        }

        let bodyPayload = undefined;
        if (["POST", "PUT"].includes(method)) {
            try {
                if (jsonBody.trim()) {
                    // Try parsing just to ensure it's valid JSON before sending as string
                    const rawObj = JSON.parse(jsonBody);
                    bodyPayload = JSON.stringify(deepStringify(rawObj));
                }
            } catch (e) {
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
            });

            responseStatus = res.status;

            try {
                const rawJson = await res.json();
                responseData = tryParseDeep(rawJson);
            } catch {
                responseData = await res.text();
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

        let dynamicContentTypeId = 1;

        // Try to fetch real content type ID to make templates robust
        if (
            name.includes("blog-post") ||
            name.includes("dry-run") ||
            name.includes("post-invalid") ||
            name.includes("l402")
        ) {
            try {
                const res = await fetch("/api/content-types");
                if (res.ok) {
                    const data = await res.json();
                    if (data.data && data.data.length > 0) {
                        const targetSlug = name.includes("l402")
                            ? "guest-post"
                            : "agent_blog_post";
                        const targetType = data.data.find(
                            (t: any) => t.slug && t.slug.startsWith(targetSlug),
                        );
                        dynamicContentTypeId = targetType
                            ? targetType.id
                            : data.data[data.data.length - 1].id; // Fallback
                    }
                }
            } catch (err) {
                console.error(
                    "Failed to fetch content types for template",
                    err,
                );
            }
        }

        if (name === "list-content-types") {
            method = "GET";
            endpoint = "/api/content-types";
            jsonBody = "";
        } else if (name === "create-blog-type") {
            method = "POST";
            endpoint = "/api/content-types";
            jsonBody = JSON.stringify(
                {
                    name: "Agent Blog Post",
                    slug: "agent_blog_post",
                    schema: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                            content: { type: "string" },
                            authorAgent: { type: "string" },
                            tags: { type: "array", items: { type: "string" } },
                        },
                        required: ["title", "content", "authorAgent"],
                    },
                },
                null,
                2,
            );
        } else if (name === "create-blog-post") {
            method = "POST";
            endpoint = "/api/content-items";
            jsonBody = JSON.stringify(
                {
                    contentTypeId: dynamicContentTypeId,
                    data: {
                        title: "First steps as an Agent in WordClaw",
                        content:
                            "Hello world! We are testing the usability of this CMS for agents.",
                        authorAgent: "Agent Alpha",
                        tags: ["intro", "testing"],
                    },
                    status: "published",
                },
                null,
                2,
            );
        } else if (name === "create-post-invalid") {
            method = "POST";
            endpoint = "/api/content-items";
            jsonBody = JSON.stringify(
                {
                    contentTypeId: dynamicContentTypeId,
                    data: {
                        title: "Agent B's Thoughts",
                        content: "I forgot to include my name!",
                        tags: ["oops"],
                    },
                    status: "draft",
                },
                null,
                2,
            );
        } else if (name === "list-blog-posts") {
            method = "GET";
            endpoint = `/api/content-items?contentTypeId=${dynamicContentTypeId}`;
            jsonBody = "";
        } else if (name === "l402-payment-required") {
            method = "POST";
            endpoint = "/api/content-items";
            jsonBody = JSON.stringify(
                {
                    contentTypeId: dynamicContentTypeId,
                    data: {
                        title: "My paid Guest Post",
                        body: "I am ready to pay for this placement",
                        author: "Agent L402",
                    },
                    status: "draft",
                },
                null,
                2,
            );
            headersText = JSON.stringify(
                {
                    "Content-Type": "application/json",
                },
                null,
                2,
            );
        } else if (name === "update-blog-post") {
            method = "PUT";
            endpoint = "/api/content-items/1"; // Using ID 1 as standard assumption for an item ID
            jsonBody = JSON.stringify(
                {
                    data: {
                        title: "Updated Title",
                        content: "Updated Content",
                        authorAgent: "Agent Alpha",
                    },
                    status: "published",
                },
                null,
                2,
            );
        } else if (name === "dry-run-create") {
            method = "POST";
            endpoint = "/api/content-items?mode=dry_run";
            jsonBody = JSON.stringify(
                {
                    contentTypeId: dynamicContentTypeId,
                    data: {
                        title: "Dry run title",
                        content: "Should not be saved",
                        authorAgent: "Agent Gamma",
                    },
                },
                null,
                2,
            );
        } else if (name === "view-audit-logs") {
            method = "GET";
            endpoint = "/api/audit-logs?entityType=content_item";
            jsonBody = "";
        }

        // Reset the select dropdown to its default state after applying
        select.value = "";
    }
</script>

<svelte:head>
    <title>Agent Sandbox | WordClaw Supervisor</title>
</svelte:head>

<div class="h-full flex flex-col">
    <div class="mb-6 flex justify-between items-end">
        <div>
            <h2 class="text-2xl font-bold text-gray-900 dark:text-white">
                Agent Sandbox
            </h2>
            <p class="text-gray-500 dark:text-gray-400 text-sm mt-1">
                Simulate and inspect API calls to visualize WordClaw's
                AI-friendly responses.
            </p>
        </div>
        <div class="flex items-center gap-2">
            <label
                for="template-select"
                class="text-sm font-medium text-gray-700 dark:text-gray-300"
                >Templates:</label
            >
            <select
                id="template-select"
                onchange={applyTemplate}
                class="block rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white px-3 py-1.5 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-xs"
            >
                <option value="" disabled selected
                    >Select a real-world example...</option
                >
                <optgroup label="Content Types">
                    <option value="list-content-types"
                        >List Content Types</option
                    >
                    <option value="create-blog-type"
                        >Create 'Blog Post' Type</option
                    >
                </optgroup>
                <optgroup label="Content Items (Blog)">
                    <option value="create-blog-post"
                        >Create Valid Blog Post</option
                    >
                    <option value="create-post-invalid"
                        >Create Invalid Post (Missing Field)</option
                    >
                    <option value="l402-payment-required"
                        >L402 Payment Required (Guest Post)</option
                    >
                    <option value="list-blog-posts">List Blog Posts</option>
                    <option value="update-blog-post"
                        >Update Existing Post</option
                    >
                    <option value="dry-run-create">Dry Run Creation</option>
                </optgroup>
                <optgroup label="System">
                    <option value="view-audit-logs">View Item Audit Logs</option
                    >
                </optgroup>
            </select>
        </div>
    </div>

    <div class="flex flex-1 gap-6 overflow-hidden min-h-[600px]">
        <!-- Left Panel: Request -->
        <div
            class="w-1/2 flex flex-col gap-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-100 dark:border-gray-700 p-5 overflow-y-auto"
        >
            <h3
                class="text-lg font-semibold text-gray-800 dark:text-gray-200 border-b border-gray-200 dark:border-gray-700 pb-2"
            >
                Request formulation
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
                        rows="3"
                        class="block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:text-sm font-mono"
                    ></textarea>
                </div>

                {#if method !== "GET" && method !== "DELETE"}
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

        <!-- Right Panel: Response -->
        <div
            class="w-1/2 flex flex-col bg-gray-50 dark:bg-gray-900 rounded-lg shadow border border-gray-200 dark:border-gray-700 overflow-hidden relative"
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
                        <span class="text-xs text-gray-500 dark:text-gray-400"
                            >{elapsedTime}ms</span
                        >
                    {/if}
                </div>
            </div>

            <div class="flex-1 overflow-auto p-4 flex flex-col">
                {#if errorMsg}
                    <div
                        class="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-4 rounded-md border border-red-200 dark:border-red-800 font-mono text-sm"
                    >
                        {errorMsg}
                    </div>
                {:else if responseData !== null}
                    <pre
                        class="bg-gray-800 text-gray-100 p-4 rounded-md overflow-x-auto text-sm font-mono shadow-inner border border-gray-700 m-0 w-full h-full"><code
                            class="whitespace-pre"
                            >{typeof responseData === "object"
                                ? JSON.stringify(responseData, null, 2)
                                : responseData}</code
                        ></pre>
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
                        <div
                            class="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"
                        ></div>
                    </div>
                {/if}
            </div>
        </div>
    </div>
</div>
