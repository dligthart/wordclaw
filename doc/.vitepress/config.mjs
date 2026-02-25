import { defineConfig } from 'vitepress'

export default defineConfig({
    title: "WordClaw",
    base: "/wordclaw/docs/",
    description: "Documentation for WordClaw Content API and Supervisor UI",
    themeConfig: {
        nav: [
            { text: 'Home', link: '/' },
            { text: 'Documentation', link: '/tutorials/getting-started' }
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
            }
        ],
        socialLinks: [
            { icon: 'github', link: 'https://github.com/dligthart/wordclaw' }
        ]
    }
})
