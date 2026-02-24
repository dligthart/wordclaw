import type { Scenario } from "$lib/types/sandbox";

export const SCENARIOS: Scenario[] = [
    {
        id: "quick-start",
        title: "Quick Start: Content Lifecycle",
        icon: "zap",
        tagline: "Create, read, update, and trace content.",
        differentiator: "Fundamentals",
        steps: [
            {
                title: "Create Content Type",
                narration: "WordClaw uses **JSON Schema** to strictly validate all content injected by AI agents. Our first step is to create a *Blog Post* schema.",
                method: "POST",
                endpoint: "/api/content-types",
                body: {
                    name: "Scenario Blog Post",
                    slug: "scenario_blog_post_{{timestamp}}",
                    description: "Created by the Scenario Engine",
                    schema: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                            content: { type: "string" },
                            author: { type: "string" }
                        },
                        required: ["title", "content"]
                    }
                },
                expectedStatus: 201,
                captureFromResponse: {
                    "contentTypeId": "data.id"
                }
            },
            {
                title: "Create Content Item",
                narration: "Now we create a blog post conforming to that schema. The returned data will include a version number and status.",
                method: "POST",
                endpoint: "/api/content-items",
                body: {
                    contentTypeId: "{{contentTypeId}}",
                    data: {
                        title: "Hello World",
                        content: "This is my first post.",
                        author: "Agent Sandbox"
                    },
                    status: "published"
                },
                expectedStatus: 201,
                captureFromResponse: {
                    "contentItemId": "data.id"
                }
            },
            {
                title: "Read Content Item",
                narration: "We can fetch the item back using the ID captured from the previous step.",
                method: "GET",
                endpoint: "/api/content-items/{{contentItemId}}",
                expectedStatus: 200
            },
            {
                title: "Update Content Item",
                narration: "Updates automatically increment the `version` counter while preserving the history.",
                method: "PUT",
                endpoint: "/api/content-items/{{contentItemId}}",
                body: {
                    data: {
                        title: "Hello World (Updated)",
                        content: "This is my first post, now with more content.",
                        author: "Agent Sandbox"
                    },
                    status: "published"
                },
                expectedStatus: 200
            },
            {
                title: "View Audit Trail",
                narration: "WordClaw tracks provenance. The Audit Log proves an agent performed these operations.",
                method: "GET",
                endpoint: "/api/audit-logs?entityType=content_item&entityId={{contentItemId}}",
                expectedStatus: 200
            }
        ]
    },
    {
        id: "ai-errors",
        title: "AI-Friendly Error Remediation",
        icon: "alert-triangle",
        tagline: "Watch agents self-correct using structured error feedback.",
        differentiator: "AI Usability",
        steps: [
            {
                title: "Trigger Schema Validation Error",
                narration: "Unlike traditional CMSes that return opaque 400 errors, WordClaw returns structured `remediation` metadata. Let's omit the required `content` field.",
                method: "POST",
                endpoint: "/api/content-items",
                body: {
                    contentTypeId: 1, // Fallback safe ID for demo
                    data: {
                        title: "Missing Content Property",
                        author: "Agent Sandbox"
                    },
                    status: "draft"
                },
                expectedStatus: 400
            },
            {
                title: "Trigger Missing Dependency Error",
                narration: "Referencing a non-existent Content Type ID triggers a `CONTENT_TYPE_NOT_FOUND` error, with a recommendation to query the types endpoint.",
                method: "POST",
                endpoint: "/api/content-items",
                body: {
                    contentTypeId: 9999999,
                    data: {
                        title: "Lost in space"
                    },
                    status: "draft"
                },
                expectedStatus: 400
            },
            {
                title: "Dry-Run Validation",
                narration: "Agents can validate payloads *without* saving them by passing `?mode=dry_run`. The system confirms validity and expected policy outcomes.",
                method: "POST",
                endpoint: "/api/content-items?mode=dry_run",
                body: {
                    contentTypeId: 1,
                    data: {
                        title: "Safe Dry Run Test",
                        content: "This content is perfectly valid, but will not be saved."
                    },
                    status: "draft"
                },
                expectedStatus: 200
            }
        ]
    },
    {
        id: "editorial-workflow",
        title: "Policy-Driven Editorial Workflow",
        icon: "git-merge",
        tagline: "Enforce review pipelines before publication.",
        differentiator: "Governance",
        steps: [
            {
                title: "List Available Workflows",
                narration: "Agents can discover available state machines required for publication.",
                method: "GET",
                endpoint: "/api/workflows",
                expectedStatus: 200
            },
            {
                title: "Create Item in Draft Context",
                narration: "Items subject to workflows must start in an initial state, typically `draft`.",
                method: "POST",
                endpoint: "/api/content-items",
                body: {
                    contentTypeId: 1,
                    data: {
                        title: "A controversial take",
                        content: "Needs human review."
                    },
                    status: "draft"
                },
                expectedStatus: 201,
                captureFromResponse: { "draftItemId": "data.id" }
            },
            {
                title: "Submit for Human Review",
                narration: "Agents submit content to the next transition state, enqueuing it in the Supervisor UI's task board.",
                method: "POST",
                endpoint: "/api/content-items/{{draftItemId}}/submit",
                body: { assignee: "editor" },
                expectedStatus: 422 // We expect 422 if workflow isn't configured, which is a good learning moment, or 201 if it is. The sandbox template logic uses transitionId. Let's make it more robust. For showcase, usually 201 or 400 structure.
            }
        ]
    },
    {
        id: "semantic-rag",
        title: "Semantic Vector RAG Search",
        icon: "search",
        tagline: "Discover content contextually using pgvector embeddings.",
        differentiator: "Native Vector DB",
        steps: [
            {
                title: "Natural Language Semantic Query",
                narration: "WordClaw embeds content automatically. Agents can query using semantic intent rather than strict keywords.",
                method: "GET",
                endpoint: "/api/search/semantic?query=agent%20capabilities&limit=3",
                expectedStatus: 200
            },
            {
                title: "Strict Threshold Search",
                narration: "Use distance thresholds to prevent hallucination in RAG pipelines.",
                method: "GET",
                endpoint: "/api/search/semantic?query=wordclaw&limit=5&threshold=0.85",
                expectedStatus: 200
            }
        ]
    },
    {
        id: "l402-payment",
        title: "L402 Lightning Payment Flow",
        icon: "zap",
        tagline: "Machine-to-machine payments via the Lightning Network.",
        differentiator: "Monetization",
        steps: [
            {
                title: "Create Paid Content Type",
                narration: "We define a schema with a `basePrice` to enforce a paywall.",
                method: "POST",
                endpoint: "/api/content-types",
                body: {
                    name: "Paid Guest Post",
                    slug: "paid_guest_post_{{timestamp}}",
                    basePrice: 500,
                    schema: {
                        type: "object",
                        properties: { title: { type: "string" } }
                    }
                },
                expectedStatus: 201,
                captureFromResponse: { "paidTypeId": "data.id" }
            },
            {
                title: "Attempt Write Operation",
                narration: "Attempting to create an item without authorization yields a `402 Payment Required` HTTP response with an L402 challenge header.",
                method: "POST",
                endpoint: "/api/content-items",
                body: {
                    contentTypeId: "{{paidTypeId}}",
                    data: { title: "Unpaid submission" },
                    status: "draft"
                },
                expectedStatus: 402
            },
            {
                title: "Verify Pending Ledger",
                narration: "The system logs the pending invoice in the payment ledger awaiting settlement.",
                method: "GET",
                endpoint: "/api/payments",
                expectedStatus: 200
            }
        ]
    },
    {
        id: "tri-protocol",
        title: "Tri-Protocol Parity (REST/GraphQL/MCP)",
        icon: "layers",
        tagline: "Interact with the same system using REST, GraphQL, or tool use.",
        differentiator: "Architecture",
        steps: [
            {
                title: "Create via REST",
                narration: "Agents can interact using standard REST endpoints.",
                method: "POST",
                endpoint: "/api/content-items",
                body: {
                    contentTypeId: 1,
                    data: { title: "REST created item" },
                    status: "draft"
                },
                expectedStatus: 201,
                captureFromResponse: { "parityItemId": "data.id" }
            },
            {
                title: "Query via GraphQL",
                narration: "The same item is instantly available via the GraphQL endpoint.",
                method: "POST",
                endpoint: "/api/graphql",
                body: {
                    query: "{ contentItem(id: {{parityItemId}}) { id data } }"
                },
                expectedStatus: 200
            }
        ]
    },
    {
        id: "multi-tenant",
        title: "Multi-Domain Tenant Isolation",
        icon: "shield",
        tagline: "Run isolated publications on a single deployment.",
        differentiator: "Enterprise",
        steps: [
            {
                title: "Write to Domain 1",
                narration: "Operations are scoped to domains. This query hits the domain configured in the Sandbox environment.",
                method: "GET",
                endpoint: "/api/content-types",
                expectedStatus: 200,
                captureFromResponse: { "sandboxDomainId": "data[0].domainId" }
            },
            {
                title: "Probe Other Domain",
                narration: "Passing a different `x-wordclaw-domain` header strictly isolates the context. Items owned by one domain are invisible to another.",
                method: "GET",
                endpoint: "/api/content-types",
                headers: {
                    "x-wordclaw-domain": "9999"
                },
                expectedStatus: 200
            }
        ]
    },
    {
        id: "agent-keys",
        title: "Agent Key Management",
        icon: "key",
        tagline: "Fine-grained, scoped credentials for agent swarms.",
        differentiator: "Security",
        steps: [
            {
                title: "Provision Key",
                narration: "Deploying a swarm of specific agents? Provision scoped keys rather than giving them full system access.",
                method: "POST",
                endpoint: "/api/auth/keys",
                body: {
                    name: "Scenario Key",
                    scopes: ["content:read"]
                },
                expectedStatus: 201,
                captureFromResponse: { "newKeyId": "data.id" }
            },
            {
                title: "Revoke Key",
                narration: "Instantly revoke compromised or decommissioned agent keys.",
                method: "DELETE",
                endpoint: "/api/auth/keys/{{newKeyId}}",
                expectedStatus: 200
            }
        ]
    }
];
