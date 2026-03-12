# Contributing to WordClaw

First off, thank you for considering contributing to WordClaw! It's people like you that make this an incredibly powerful, safe content runtime for AI agents.

## Getting Started

1. **Fork the repository** and clone it locally.
2. **Install dependencies:** `npm install`
3. **Database setup:** WordClaw uses PostgreSQL and pgvector. See the [Getting Started Tutorial](doc/tutorials/getting-started.md) for detailed environment setup instructions.
4. **Run migrations:** `npm run db:setup`
5. **Start the dev server:** `npm run dev`

## Good First Issues

If you are new to the project, looking for issues labeled **"good first issue"** or **"help wanted"** is the best way to get started. These issues usually have a clearly defined scope and are great for familiarizing yourself with the codebase.

## The RFC Process

Significant changes to WordClaw architecture or product direction should undergo the RFC (Request for Comments) process before implementation begins.

1. **Start small:** If you're unsure if a change requires an RFC, open a discussion or a draft PR first.
2. **Copy the template:** Duplicate `doc/rfc/0000-rfc-template.md` as `doc/rfc/proposed/XXXX-your-feature-name.md`.
3. **Draft your proposal:** Detail the motivation, the proposed design, and the alternatives considered. 
4. **Submit a PR:** Open a Pull Request containing only the proposed RFC document. 
5. **Discussion:** The community will review the RFC. Once consensus is reached, the RFC will be merged into the `proposed` folder, and implementation can begin.
6. **Implementation:** When the code is successfully merged into `main`, the RFC document should be moved to the `implemented` directory via a subsequent PR.

For a full view of the current and historical product decisions, see the [RFC overview index](doc/rfc/index.md).

## Code Standards

- **TypeScript:** We strictly use TypeScript. Ensure your code passes type checking (`npx tsc --noEmit`).
- **Formatting & Linting:** Run `npm run lint` and `npm run format` (if available) before committing. We use ESLint and Prettier.
- **Testing:** New core features and bug fixes must include tests. We run tests using Vitest. `npm run test` or `npm run test:watch`.
- **Commit Messages:** We follow strict conventional commit messages (e.g., `feat:`, `fix:`, `docs:`, `chore:`) to power our automated Semantic Release pipeline. Please read the [Agent Commit Standards](doc/guides/agent-commit-standards.md) before pushing code.

## Pull Request Process

1. Create a feature branch from `main`.
2. Ensure your branch is up to date with `main` to avoid merge conflicts.
3. Keep your PRs focused and single-purpose. 
4. Pass all CI tests (the `integration-tests.yml` and `unit-tests.yml` workflows will run automatically).
5. Address review feedback. If you disagree, politely explain your reasoning.
6. Once approved, a maintainer will squash and merge your PR into `main`.

## Security Vulnerabilities

If you discover a security vulnerability within WordClaw, please **DO NOT** open a public issue. Email the maintainers directly so we can coordinate a fix and safe disclosure. 

---
*Happy building!*
