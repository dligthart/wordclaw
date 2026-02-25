# Documentation Standards

This document outlines the standard conventions and structure for all documentation in the WordClaw project. Adhering to these standards ensures our documentation remains discoverable, maintainable, and highly useful for all contributors and users.

> [!IMPORTANT]
> All documentation must be created and maintained in the `doc/` directory using Markdown. We use [VitePress](https://vitepress.dev/) to generate our documentation website.

## 1. The Diátaxis Framework

We structure our documentation using the [Diátaxis framework](https://diataxis.fr/), separating documentation into four distinct quadrants based on user needs:

1. **Tutorials (`doc/tutorials/`)**: Learning-oriented. Step-by-step guides for beginners taking them from zero to success (e.g., *Getting Started Guide*).
2. **How-To Guides (`doc/guides/`)**: Goal-oriented. Step-by-step instructions for specific tasks solving a specific problem (e.g., *Blog Integration Guide*).
3. **Reference (`doc/reference/`)**: Information-oriented. Technical descriptions, API lists, schemas, and configurations. It should be succinct and accurate (e.g., *API Reference*, *Data Model*).
4. **Concepts (`doc/concepts/`)**: Understanding-oriented. Explanations of architecture, background context, and system design (e.g., *Features Outline*, *L402 Protocol*).

Always place new `.md` files in the correct quadrant folder.

## 2. API and Code Documentation

To keep our reference documentation in sync with the codebase efficiently:

* **Inline Code Documentation**: Use **TSDoc** (standard JavaScript/TypeScript comments starting with `/** ... */`) to document classes, functions, interfaces, and complex logic inside the `src/` directory.
  ```typescript
  /**
   * Generates a payment invoice for content access.
   *
   * @param userId - The ID of the user requesting access.
   * @param contentId - The ID of the requested content.
   * @returns A promise that resolves to the generated invoice.
   */
  async function generateInvoice(userId: string, contentId: string): Promise<Invoice> { ... }
  ```
* **REST APIs**: If exposing new REST endpoints, always use Fastify's native JSON Schema validation (`@fastify/swagger` and `@fastify/type-provider-typebox`). This automatically generates our OpenAPI specification and keeps the `/docs` UI synchronized without needing manual Markdown updates.

## 3. Architecture Diagrams

We prioritize "Diagrams as Code" to maintain version control and ease of editing.

* Prefer using **Mermaid.js** (` ```mermaid `) blocks directly inside Markdown files for sequences, state diagrams, and flowcharts.
* When external architectural diagrams are necessary, store the source files (e.g., Draw.io XML or SVG) in the `doc/images/diagrams/` folder and link them using relative paths (e.g., `![System Diagram](../images/diagrams/system.svg)`).

## 4. Feature Proposals and Historical Decisions

* **RFCs (Request for Comments)**: Start new feature proposals by creating a document in `doc/rfc/proposed/` following the existing numbering scheme (e.g., `0017-new-feature.md`). 
* **ADRs (Architecture Decision Records)**: *(Upcoming standard)* Major implemented architecture decisions should be captured as short, immutable records to track the "why" behind past technical choices.

## 5. Writing Style

* **Be Concise**: Get straight to the point.
* **Use Active Voice**: "The server handles requests" instead of "Requests are handled by the server".
* **Formatting**: Use bold text for UI labels or emphasis. Use code blocks for file paths, commands, and code snippets.
* **Alerts**: Use VitePress/GitHub flavored markdown alerts (like `> [!INFO]`, `> [!WARNING]`, or `> [!TIP]`) to highlight critical information.
