import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(defineConfig({
    title: "WordClaw",
    base: "/wordclaw/docs/",
    outDir: ".vitepress/dist/docs",
    description: "Documentation for WordClaw Content API and Supervisor UI",
    themeConfig: {
        nav: [
            { text: 'Home', link: '/' },
            { text: 'Documentation', link: '/tutorials/getting-started' },
            { text: 'RFCs', link: '/rfc/' }
        ],
        sidebar: [
            {
                text: 'Tutorials',
                items: [
                    { text: 'Getting Started', link: '/tutorials/getting-started' }
                ]
            },
            {
                text: 'Guides',
                items: [
                    { text: 'Documentation Standards', link: '/guides/documentation-standards' },
                    { text: 'CI Migrations and Tests Troubleshooting', link: '/guides/ci-migrations-troubleshooting' },
                    { text: 'Blog Integration', link: '/guides/blog-integration-guide' },
                    { text: 'MCP Integration', link: '/guides/mcp-integration' }
                ]
            },
            {
                text: 'Reference',
                items: [
                    { text: 'API Reference', link: '/reference/api-reference' },
                    { text: 'Architecture Diagram', link: '/reference/architecture' },
                    { text: 'Data Model', link: '/reference/data-model' },
                    { text: 'Drizzle Migrations', link: '/reference/drizzle-migrations' },
                    { text: 'MCP Servers', link: '/reference/mcp-servers' }
                ]
            },
            {
                text: 'Concepts',
                items: [
                    { text: 'Features Outline', link: '/concepts/features' },
                    { text: 'L402 Protocol', link: '/concepts/l402-protocol' },
                    { text: 'Product/Market Fit', link: '/concepts/product-market-fit-analysis' }
                ]
            },
            {
                text: 'RFCs',
                items: [
                    { text: 'Overview', link: '/rfc/' },
                    { text: 'Feasibility Review', link: '/rfc/FEASIBILITY_REVIEW' },
                    { text: 'RFC Template', link: '/rfc/0000-rfc-template' },
                    {
                        text: 'Proposed',
                        items: [
                            { text: '0001 Blog Valuation Architecture', link: '/rfc/proposed/0001-blog-valuation-architecture' },
                            { text: '0005 Multi-Channel Distribution Orchestrator', link: '/rfc/proposed/0005-multi-channel-distribution-orchestrator' },
                            { text: '0009 Content Discovery and Consumption API', link: '/rfc/proposed/0009-content-discovery-and-consumption-api' },
                            { text: '0015 Paid Content Consumption Contract', link: '/rfc/proposed/0015-paid-content-consumption-contract' },
                            { text: '0016 AP2 Agentic Monetization', link: '/rfc/proposed/0016-ap2-agentic-monetization' }
                        ]
                    },
                    {
                        text: 'Partially Implemented',
                        items: [
                            { text: '0010 Supervisor UI Usability and Accessibility Hardening', link: '/rfc/partially-implemented/0010-supervisor-ui-usability-and-accessibility-hardening' }
                        ]
                    },
                    {
                        text: 'Implemented',
                        items: [
                            { text: '0002 Agent Usability Improvements', link: '/rfc/implemented/0002-agent-usability-improvements' },
                            { text: '0003 Production Lightning Settlement', link: '/rfc/implemented/0003-production-lightning-settlement' },
                            { text: '0004 Agentic Content Licensing and Entitlements', link: '/rfc/implemented/0004-agentic-content-licensing-and-entitlements' },
                            { text: '0006 Revenue Attribution and Agent Payouts', link: '/rfc/implemented/0006-revenue-attribution-and-agent-payouts' },
                            { text: '0007 Policy-Driven Editorial Workflow', link: '/rfc/implemented/0007-policy-driven-editorial-workflow' },
                            { text: '0008 Cross-Protocol Policy Parity Framework', link: '/rfc/implemented/0008-cross-protocol-policy-parity-framework' },
                            { text: '0011 Multi-Domain Tenant Support', link: '/rfc/implemented/0011-multi-domain-tenant-support' },
                            { text: '0012 Native Vector RAG Endpoints', link: '/rfc/implemented/0012-native-vector-rag-endpoints' },
                            { text: '0013 Agent Sandbox Showcase', link: '/rfc/implemented/0013-agent-sandbox-showcase' },
                            { text: '0014 L402 Production Readiness Operator Runbook', link: '/rfc/implemented/0014-l402-production-readiness-operator-runbook' }
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
