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
                title: "Create Scenario Content Type",
                narration: "Create a deterministic schema fixture so the error flow does not depend on hardcoded IDs.",
                method: "POST",
                endpoint: "/api/content-types",
                body: {
                    name: "Scenario Error Fixture",
                    slug: "scenario_error_fixture_{{timestamp}}",
                    description: "Error remediation scenario fixture",
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
                title: "Trigger Schema Validation Error",
                narration: "Unlike traditional CMSes that return opaque 400 errors, WordClaw returns structured `remediation` metadata. Let's omit the required `content` field.",
                method: "POST",
                endpoint: "/api/content-items",
                body: {
                    contentTypeId: "{{contentTypeId}}",
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
                    contentTypeId: "{{contentTypeId}}",
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
                title: "Create Workflow Content Type",
                narration: "Create a dedicated content type for this scenario so workflow behavior is deterministic.",
                method: "POST",
                endpoint: "/api/content-types",
                body: {
                    name: "Scenario Workflow Post",
                    slug: "scenario_workflow_post_{{timestamp}}",
                    schema: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                            content: { type: "string" }
                        },
                        required: ["title", "content"]
                    }
                },
                expectedStatus: 201,
                captureFromResponse: { "workflowContentTypeId": "data.id" }
            },
            {
                title: "Create Editorial Workflow",
                narration: "Attach a workflow to the scenario content type.",
                method: "POST",
                endpoint: "/api/workflows",
                body: {
                    name: "Scenario Editorial Workflow {{timestamp}}",
                    contentTypeId: "{{workflowContentTypeId}}",
                    active: true
                },
                expectedStatus: 201,
                captureFromResponse: { "workflowId": "data.id" }
            },
            {
                title: "Add Draft to Review Transition",
                narration: "Define the transition an agent must use when submitting draft content.",
                method: "POST",
                endpoint: "/api/workflows/{{workflowId}}/transitions",
                body: {
                    fromState: "draft",
                    toState: "in_review",
                    requiredRoles: ["content:write"]
                },
                expectedStatus: 201,
                captureFromResponse: { "workflowTransitionId": "data.id" }
            },
            {
                title: "Create Item in Draft Context",
                narration: "Items subject to workflows must start in an initial state, typically `draft`.",
                method: "POST",
                endpoint: "/api/content-items",
                body: {
                    contentTypeId: "{{workflowContentTypeId}}",
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
                body: {
                    workflowTransitionId: "{{workflowTransitionId}}",
                    assignee: "editor"
                },
                expectedStatus: 201
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
                title: "Create Shared Fixture via REST",
                narration: "Create a deterministic content type used by all protocol calls in this scenario.",
                method: "POST",
                endpoint: "/api/content-types",
                protocol: "REST",
                body: {
                    name: "Scenario Parity Type",
                    slug: "scenario_parity_type_{{timestamp}}",
                    schema: {
                        type: "object",
                        properties: {
                            title: { type: "string" }
                        },
                        required: ["title"]
                    }
                },
                expectedStatus: 201,
                captureFromResponse: { "parityContentTypeId": "data.id" }
            },
            {
                title: "Create via REST",
                narration: "Agents can interact using standard REST endpoints.",
                method: "POST",
                endpoint: "/api/content-items",
                protocol: "REST",
                body: {
                    contentTypeId: "{{parityContentTypeId}}",
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
                protocol: "GRAPHQL",
                body: {
                    query: "{ contentItem(id: {{parityItemId}}) { id data } }"
                },
                expectedStatus: 200
            },
            {
                title: "Fetch via MCP Tool",
                narration: "Use the sandbox MCP bridge to execute the same read operation through a tool-style call.",
                method: "POST",
                endpoint: "/api/sandbox/mcp/execute",
                protocol: "MCP",
                body: {
                    tool: "get_content_item",
                    args: {
                        id: "{{parityItemId}}"
                    }
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
                title: "Discover Available Domains",
                narration: "Capture available domain IDs. If `domainBId` is missing, create a second domain before running the final isolation check.",
                method: "GET",
                endpoint: "/api/domains",
                expectedStatus: 200,
                captureFromResponse: {
                    "domainBId": "data[1].id"
                }
            },
            {
                title: "Create Type in Active Domain",
                narration: "Create a domain-scoped fixture in the active tenant and capture both type ID and owning domain.",
                method: "POST",
                endpoint: "/api/content-types",
                body: {
                    name: "Scenario Tenant Fixture",
                    slug: "scenario_tenant_fixture_{{timestamp}}",
                    schema: {
                        type: "object",
                        properties: {
                            title: { type: "string" }
                        },
                        required: ["title"]
                    }
                },
                expectedStatus: 201,
                captureFromResponse: {
                    "tenantScopedTypeId": "data.id",
                    "domainAId": "data.domainId"
                }
            },
            {
                title: "Read Fixture in Domain A",
                narration: "The fixture must be visible when querying with the owning domain context.",
                method: "GET",
                endpoint: "/api/content-types/{{tenantScopedTypeId}}",
                headers: {
                    "x-wordclaw-domain": "{{domainAId}}"
                },
                expectedStatus: 200
            },
            {
                title: "Verify Domain B Isolation",
                narration: "The same fixture should not be visible in a different tenant context.",
                method: "GET",
                endpoint: "/api/content-types/{{tenantScopedTypeId}}",
                headers: {
                    "x-wordclaw-domain": "{{domainBId}}"
                },
                expectedStatus: 404
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
