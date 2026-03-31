# RFC 0031: Reserving `/` for a Customizable Public Front Door

**Author:** Codex
**Status:** Proposed
**Date:** 2026-03-31
**Updated:** 2026-03-31
**Tracking Issue:** TBD

## 0. Current Status

As of 2026-03-31, RFC 0031 is proposed and no first-class public front door is implemented on `main`.

Current runtime context:

- `/ui`, `/api`, `/mcp`, and `/health` are the stable named surfaces today
- the public root is still available for a future landing or onboarding experience
- related website-runtime work now lives in RFC 0027, but the deployment-level public entrypoint decision is still open

## 1. Summary

WordClaw currently has clear operator and machine surfaces:

- `/ui` for the supervisor control plane
- `/api` for the REST runtime
- `/mcp` for MCP transport
- `/health` for liveness

What it does **not** have is a defined public front door. The root path `/` is effectively unclaimed in the current product story.

This RFC proposes a narrow but important decision: reserve `/` for a **deployment-scoped public experience** that can evolve between:

- a branded landing page
- a public registration or waitlist app
- a SaaS onboarding flow
- a hybrid of marketing plus onboarding

The key decision is not the exact final experience yet. The key decision is that `/` should belong to a bounded, customizable public surface rather than remain accidental space or get consumed ad hoc by unrelated features.

## 2. Motivation

### 2.1 Current Gap

The current runtime is strong for authenticated operators and machine clients, but weak as a product entry point:

- self-hosted deployments have no opinionated root experience
- hosted or SaaS-style deployments have no first-class public registration path
- the product has no stable place for branded onboarding or top-of-funnel flows
- future work could become messy if `/` is used piecemeal before ownership is defined

### 2.2 Product Need

There are at least two plausible near-term directions:

1. **A customizable landing page**
   - explain what the deployment is
   - route visitors to sign-in, docs, contact, or demo flows
   - allow branding without building a full website product

2. **A public registration or onboarding app**
   - support SaaS-style sign-up
   - collect organization, email, and tenancy preferences
   - guide new users into domain provisioning or approval workflows

Those two directions are different, but they share one architectural need: a safe, intentional public root surface.

### 2.3 Why This Should Be Decided Before Full Implementation

If `/` remains undefined, future work is likely to fragment:

- one feature may want `/register`
- another may want `/pricing`
- another may simply redirect `/` to `/ui`
- another deployment may mount a custom static site there

That creates preventable route collisions and makes the hosted story harder to evolve later.

This RFC therefore proposes a **route and product-boundary decision first**, with implementation phases that preserve optionality.

## 3. Proposal

Reserve `/` as the **public front door namespace** for the deployment.

This surface is:

- **public-facing**
- **deployment-scoped**, not tenant-scoped
- **customizable within constraints**
- **separate from the supervisor control plane**

### 3.1 Public Front Door Modes

The root experience should support a small set of explicit modes rather than one hard-coded behavior:

- `redirect`
  - sends visitors to another stable entry point such as `/ui`
  - useful for internal-only or operator-only deployments
- `landing`
  - shows a branded landing or orientation page
  - useful for product sites, demos, and self-hosted entry pages
- `onboarding`
  - shows a public registration or setup flow
  - useful for SaaS or managed-service offerings
- `hybrid`
  - combines landing content with onboarding entry points

This lets the product support both your current uncertainty and future evolution without forcing a premature bet.

### 3.2 Reserved Namespaces

This RFC does **not** change the current ownership of these routes:

- `/ui`
- `/api`
- `/mcp`
- `/health`

The public front door must never shadow or weaken those namespaces.

### 3.3 Product Boundary

This RFC does **not** propose:

- turning WordClaw into a generic website builder
- replacing `/ui` as the operator surface
- exposing tenant provisioning directly to anonymous callers without policy
- making marketing pages the new core product

The public front door is a bounded top-level experience, not a new page-builder platform.

## 4. Technical Design (Architecture)

### 4.1 Route Ownership

The runtime should treat `/` and a small set of public subpaths as one coherent surface. Suggested owned paths:

- `/`
- `/register`
- `/signup`
- `/start`
- `/contact`
- `/pricing`

Which of those paths are active depends on the configured mode. The important part is that they are reserved for the same public-experience layer.

### 4.2 Frontend Composition

The simplest long-term model is:

- keep `/ui` as the supervisor app
- add a root-level public app or route group for the front door
- share branding tokens and selected components where useful
- keep auth and policy boundaries separate

This can be implemented either as:

- one SvelteKit app with separated public and supervisor route groups
- or two frontend bundles served by the same Fastify process

The RFC does not require choosing that implementation immediately, but it does require that the public root be treated as a first-class app boundary rather than a one-off static file.

### 4.3 Customization Model

Customization should stay structured and bounded.

Allowed customization should focus on:

- brand name
- logo and visual theme tokens
- hero copy and CTA text
- a small set of structured sections
- destination links such as docs, contact, sign-in, or registration

Customization should **not** imply a generic visual editor or arbitrary drag-and-drop page composition.

The safest customization tiers are:

1. config-only branding
2. structured content-backed landing sections
3. optional custom frontend implementation behind the reserved root contract

### 4.4 Onboarding / Registration Semantics

If the public front door moves into registration or SaaS mode, the default contract should be cautious:

- public registration should create a **pending registration** or **signup request**
- it should not immediately mint unrestricted tenants by default
- tenant creation should remain mediated by policy, approval, payment, or automation rules

That matters because public signup is not just a UI concern. It touches:

- domain allocation
- supervisor account bootstrap
- API key issuance
- billing or plan enforcement
- spam and abuse prevention

The registration flow can later call the existing onboarding primitives, but the root surface should not bypass them.

### 4.5 Suggested Platform Contract

The implementation should likely expose a platform-level mode configuration such as:

- `PUBLIC_FRONT_DOOR_MODE`
- `PUBLIC_FRONT_DOOR_PROVIDER`
- `PUBLIC_FRONT_DOOR_REDIRECT_URL`

The exact env var names are less important than the contract shape:

- there is an explicit mode
- root behavior is not implicit
- the mode is deployment-level

### 4.6 Security Boundaries

The public front door must preserve strict separation from privileged surfaces:

- no reuse of supervisor session assumptions for anonymous visitors
- no anonymous access to operator-only provisioning actions
- explicit anti-abuse posture for signup endpoints
- rate-limiting and auditability for public registration attempts

If onboarding is introduced, it should have its own public-safe contract instead of leaking internal supervisor or platform-admin workflows into the browser.

## 5. Rollout Plan

### Phase 1: Reserve and Stabilize the Root Surface

Deliver:

- explicit product decision that `/` belongs to the public front door
- root mode configuration
- safe default behavior such as `redirect` or minimal landing
- documentation for route ownership and deployment expectations

This phase is the most important because it creates a stable contract without overcommitting on the product shape.

### Phase 2: Add a Built-In Landing Experience

Deliver:

- branded landing page mode
- config-driven copy and CTA customization
- optional structured content source for landing sections

This gives self-hosted and demo deployments a useful public entry point without requiring SaaS registration yet.

### Phase 3: Add Public Registration / SaaS Onboarding

Deliver:

- public signup or waitlist form
- pending-registration workflow
- approval, payment, or verification hooks
- handoff into tenant onboarding once allowed

This phase should only ship once the operator and policy model is clear enough to support public provisioning safely.

## 6. Alternatives Considered

### 6.1 Leave `/` Undefined

Rejected because it preserves avoidable ambiguity and increases the chance of future collisions.

### 6.2 Always Redirect `/` to `/ui`

Useful for some internal deployments, but too narrow as the only contract. It blocks a future public product entry point and makes SaaS-style onboarding harder to add cleanly.

### 6.3 Require an External Website for All Public Flows

This remains a valid deployment option, but it should not be the only story. WordClaw should still own its root contract even if some deployments point it at an external frontend.

### 6.4 Build a Full CMS-Style Website Builder

Rejected. That would conflict with the product boundary from RFC 0021 and the anti-page-builder framing from RFC 0027.

## 7. Open Questions

- Should the default root mode for self-hosted installs be `redirect` or a lightweight landing page?
- Should public registration create a pending request, a paused tenant, or a fully provisioned tenant?
- Should the public front door be customized only through config, or also through structured WordClaw content types?
- Is the first SaaS-oriented step a waitlist, a registration flow, or a full onboarding wizard?
- Should root customization be part of the core product, or optional deployment packaging?

## 8. Recommendation

Accept the route-reservation decision now:

- `/` is the public front door
- `/ui` remains the supervisor control plane
- `/api`, `/mcp`, and `/health` remain reserved machine and runtime surfaces

Defer the final product choice between landing page, registration app, and SaaS onboarding until after the root contract exists.

That keeps the architecture clean, supports hosted ambitions, and preserves room for a branded public experience without forcing WordClaw into a generic website-builder posture.
