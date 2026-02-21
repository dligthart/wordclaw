# RFC 0002: Agent Usability & API Improvements

**Author:** AI Assistant  
**Status:** Proposed  
**Date:** 2026-02-21  

## 1. Summary
This RFC proposes four structural and architectural improvements to the WordClaw API and payload processing to reduce friction for AI agents. This includes AI-friendly schema validation errors, native JSON payload support, RESTful nested routing, and decoupled L402 pricing interfaces.

## 2. Motivation
During testing of the "Agents running a shared blog together" use case, several usability friction points were identified. Agents occasionally failed to recover from basic payload validation errors or struggled to format nested stringified JSON correctly. Addressing these issues will make WordClaw more resilient and intuitive for autonomous agents interacting with it via REST or MCP.

## 3. Proposal

### 3.1 AI-Friendly Schema Validation Errors
**Problem:** Fastify returns generic `FST_ERR_VALIDATION` errors when payload structures are malformed, omitting the standard WordClaw `remediation` metadata.
**Solution:** Implement a custom Fastify error handler that intercepts schema validation errors and wraps them in the standard AI-friendly response format, providing context-aware `remediation` and action guidance.

### 3.2 Native JSON for Schema and Content Data
**Problem:** The `schema` field (Content Types) and `data` field (Content Items) require double-encoded stringified JSON, which is error-prone for LLMs.
**Solution:** Modify the OpenAPI spec, Fastify route schemas, and MCP tool definitions to accept native JSON objects (e.g., `Unknown` or `Object`). The server will stringify these payloads internally before persisting them to the database.

### 3.3 Nested REST Endpoints for Content Items
**Problem:** Content items are created at the flat `/api/content-items` path, requiring agents to pass `contentTypeId` in the body.
**Solution:** Expose structurally obvious nested REST routes. Introduce `POST /api/content-types/:contentTypeId/items` alongside the flat endpoint to follow standard conventions.

### 3.4 Decoupled L402 Pricing Interface
**Problem:** The current L402 dynamic pricing `getPrice(request)` interface is tightly coupled to the HTTP request object, hindering its application in other transports (like MCP directly).
**Solution:** Decouple pricing logic by implementing a generic `ResourceIdentifier` or `WorkloadEstimator` interface. This allows identical L402 pricing calculations regardless of transport protocol.

## 4. Technical Design (Architecture)

### Error Handler
```typescript
fastify.setErrorHandler(function (error, request, reply) {
  if (error.validation) {
    return reply.status(400).send({
      error: 'Bad Request',
      code: 'VALIDATION_ERROR',
      message: error.message,
      remediation: 'Review the provided JSON payload against the endpoint specification. Ensure all required fields are present and properly typed.',
      meta: {
        recommendedNextAction: 'Correct the payload and retry',
        actionPriority: 'high'
      }
    });
  }
  // fallback to default
  reply.send(error);
});
```

### Protocol Changes
*   **Database:** No changes required; the ORM will still text-encode the JSON types if strictly required by SQLite constraint, though Drizzle often handles this transparently.
*   **Routes:** Route definitions using `@sinclair/typebox` will be updated from `Type.String()` to `Type.Unknown()` for payload data fields.

## 5. Alternatives Considered
*   **Status Quo:** Keep stringified JSON and generic errors. Discarded because it directly impedes the product's primary value proposition (an AI-first CMS). 
*   **Prompt Engineering:** Providing extensive definitions in system prompts to warn agents about the quirks. Discarded as it is less reliable than fixing the API boundaries.

## 6. Security & Privacy Implications
Accepting nested JSON structures instead of strings slightly increases the risk of deep-object denial-of-service (Payload depth exhaustion). We must ensure Fastify's default `bodyLimit` and recursion depth settings are suitably configured. Custom error handlers must also ensure they do not leak sensitive stack traces.

## 7. Rollout Plan / Milestones
*   **Phase 1:** Update Fastify error handler (Proposal 3.1).
*   **Phase 2:** Refactor TypeBox schemas and MCP definitions for native JSON (Proposal 3.2).
*   **Phase 3:** Introduce nested REST routes (Proposal 3.3).
*   **Phase 4:** Refactor L402 Options interface (Proposal 3.4).
