import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(defineConfig({
    title: "WordClaw",
    base: "/wordclaw/docs/",
    outDir: ".vitepress/dist/docs",
    description: "Documentation for the WordClaw governed content runtime for AI agents and human supervisors",
    themeConfig: {
        nav: [
            { text: 'Home', link: '/' },
            { text: 'Current State', link: '/reference/current-state' },
            { text: 'Documentation', link: '/tutorials/getting-started' },
            { text: 'RFCs', link: '/rfc/' }
        ],
        sidebar: [
            {
                text: 'Tutorials',
                items: [
                    { text: 'Getting Started', link: '/tutorials/getting-started' },
                    { text: 'Build Governed Workflows', link: '/tutorials/build-governed-workflow' },
                    { text: 'Monetize L402 APIs', link: '/tutorials/monetize-l402' }
                ]
            },
            {
                text: 'Guides',
                items: [
                    { text: 'Documentation Standards', link: '/guides/documentation-standards' },
                    { text: 'Claude/OpenClaw Memory + RAG', link: '/guides/claude-openclaw-memory-rag' },
                    { text: 'CI Migrations and Tests Troubleshooting', link: '/guides/ci-migrations-troubleshooting' },
                    { text: 'Blog Integration', link: '/guides/blog-integration-guide' },
                    { text: 'CLI Guide', link: '/guides/cli-guide' },
                    { text: 'Codex Integration', link: '/guides/codex-integration/README' },
                    { text: 'Docker Deployment', link: '/guides/docker-deployment' },
                    { text: 'Demos', link: '/guides/demos' },
                    { text: 'Fly Deployment', link: '/guides/fly-deployment' },
                    { text: 'LangGraph MCP Starter', link: '/guides/langgraph-mcp-starter' },
                    { text: 'MCP Integration', link: '/guides/mcp-integration' },
                    { text: 'Native Vector RAG', link: '/guides/native-vector-rag' },
                    { text: 'OpenClaw Integration', link: '/guides/openclaw-integration/README' },
                    { text: 'Vercel Deploy Webhook', link: '/guides/vercel-deploy-webhook' }
                ]
            },
            {
                text: 'Reference',
                items: [
                    { text: 'Current State', link: '/reference/current-state' },
                    { text: 'API Reference', link: '/reference/api-reference' },
                    { text: 'Architecture Diagram', link: '/reference/architecture' },
                    { text: 'Capability Parity', link: '/reference/capability-parity' },
                    { text: 'Data Model', link: '/reference/data-model' },
                    { text: 'Drizzle Migrations', link: '/reference/drizzle-migrations' },
                    { text: 'MCP Servers', link: '/reference/mcp-servers' },
                    { text: 'Roadmap', link: '/reference/roadmap' },
                    { text: 'Runtime Configuration', link: '/reference/runtime-configuration' }
                ]
            },
            {
                text: 'Concepts',
                items: [
                    { text: 'Features Outline', link: '/concepts/features' },
                    { text: 'L402 Protocol', link: '/concepts/l402-protocol' },
                    { text: 'Product/Market Fit', link: '/concepts/product-market-fit-analysis' },
                    { text: 'Contracts vs Schemas', link: '/concepts/contracts-vs-schemas' },
                    { text: 'Actor Identity', link: '/concepts/actor-identity-propagation' },
                    { text: 'Workspace Target Resolution', link: '/concepts/workspace-target-resolution' }
                ]
            },
            {
                text: 'RFCs',
                items: [
                    { text: 'Overview', link: '/rfc/' },
                    { text: 'Feasibility Review', link: '/rfc/FEASIBILITY_REVIEW' },
                    { text: 'RFC Template', link: '/rfc/0000-rfc-template' },
                    {
                        text: 'Current Direction',
                        items: [
                            { text: '0015 Paid Content Consumption Contract (partial)', link: '/archive/rfc/0015-paid-content-consumption-contract' },
                            { text: '0017 Tenant Boundary and Contract Hardening (partial)', link: '/archive/rfc/0017-tenant-boundary-and-contract-hardening' },
                            { text: '0021 Core Product Focus and Feature Pruning (accepted)', link: '/archive/rfc/0021-core-product-focus-and-feature-pruning' },
                            { text: '0023 Media Asset Storage (rolling out)', link: '/rfc/proposed/0023-media-asset-storage' },
                            { text: '0025 Reactive Agentic Webhooks via MCP (rolling out)', link: '/rfc/proposed/0025-agentic-webhooks' }
                        ]
                    },
                    {
                        text: 'Historical / Non-Core Proposals',
                        items: [
                            { text: '0001 Blog Valuation Architecture', link: '/rfc/proposed/0001-blog-valuation-architecture' },
                            { text: '0005 Multi-Channel Distribution Orchestrator', link: '/rfc/proposed/0005-multi-channel-distribution-orchestrator' },
                            { text: '0009 Content Discovery and Consumption API (rolling out)', link: '/rfc/proposed/0009-content-discovery-and-consumption-api' },
                            { text: '0019 Internal Agentic Content Recommender Engine', link: '/rfc/proposed/0019-internal-agentic-content-recommender-engine' },
                            { text: '0016 AP2 Agentic Monetization', link: '/rfc/proposed/0016-ap2-agentic-monetization' },
                            { text: '0020 Autonomous Content Ops Agent', link: '/rfc/proposed/0020-autonomous-content-ops-agent' }
                        ]
                    },

                    {
                        text: 'Implemented Core / Optional',
                        items: [
                            { text: '0002 Agent Usability Improvements', link: '/rfc/implemented/0002-agent-usability-improvements' },
                            { text: '0003 Production Lightning Settlement', link: '/rfc/implemented/0003-production-lightning-settlement' },
                            { text: '0004 Agentic Content Licensing and Entitlements', link: '/rfc/implemented/0004-agentic-content-licensing-and-entitlements' },
                            { text: '0007 Policy-Driven Editorial Workflow', link: '/rfc/implemented/0007-policy-driven-editorial-workflow' },
                            { text: '0008 Cross-Protocol Policy Parity Framework', link: '/rfc/implemented/0008-cross-protocol-policy-parity-framework' },
                            { text: '0010 Supervisor UI Usability and Accessibility Hardening', link: '/rfc/implemented/0010-supervisor-ui-usability-and-accessibility-hardening' },
                            { text: '0011 Multi-Domain Tenant Support', link: '/rfc/implemented/0011-multi-domain-tenant-support' },
                            { text: '0012 Native Vector RAG Endpoints', link: '/rfc/implemented/0012-native-vector-rag-endpoints' },
                            { text: '0014 L402 Production Readiness Operator Runbook', link: '/rfc/implemented/0014-l402-production-readiness-operator-runbook' },
                            { text: '0018 Integration Testing in GitHub Actions', link: '/rfc/implemented/0018-integration-testing-github-actions' }
                        ]
                    },
                    {
                        text: 'Implemented Historical / Non-Core',
                        items: [
                            { text: '0006 Revenue Attribution and Agent Payouts', link: '/rfc/implemented/0006-revenue-attribution-and-agent-payouts' },
                            { text: '0013 Agent Sandbox Showcase', link: '/rfc/implemented/0013-agent-sandbox-showcase' }
                        ]
                    }
                ]
            }
        ],
        socialLinks: [
            { icon: 'github', link: 'https://github.com/dligthart/wordclaw' }
        ]
    }
}))
