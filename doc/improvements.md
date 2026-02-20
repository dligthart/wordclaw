# WordClaw Agent Usability Improvements

Based on testing WordClaw with the specific usecase of **"Agents running a shared blog together"**, several usability issues and friction points were identified. Addressing these will significantly improve the developer experience and reliability for AI agents integrating with the CMS.

## 1. Schema Validation Errors Lack AI Guidance

**Issue:** 
WordClaw is designed as an AI-first CMS that provides `recommendedNextAction`, `availableActions`, and `actionPriority` in its responses. However, if an agent sends a payload that fails validation at the basic Fastify schema level (e.g., providing an object when a string is expected, or missing a required field in the root payload), the API returns a generic Fastify error (`FST_ERR_VALIDATION`). 

**Impact:**
Agents rely on the action guidance metadata to recover from errors. When a payload is fundamentally malformed, the lack of this metadata breaks the "AI-friendly" promise and can cause agents to get stuck.

**Recommendation:**
Implement a custom error handler in Fastify that intercepts schema validation errors and wraps them in the standard AI-friendly response format, complete with `remediation` and action guidance.

## 2. Double-Encoded JSON Strings for Schema and Content Data

**Issue:**
In both the REST API and the MCP Server tools, the `schema` field (when creating a Content Type) and the `data` field (when creating a Content Item) must be passed as stringified JSON. 
For example, the MCP definition expects:
```typescript
data: z.string().describe('JSON string of the content data conforming to the schema')
```

**Impact:**
It is unintuitive and error-prone for AI agents to double-encode JSON objects inside another JSON payload or tool call argument. Agents naturally construct JSON objects and prefer passing them as nested structures.

**Recommendation:**
Allow the `schema` and `data` fields to accept native JSON objects (`Unknown` or `Object` types in the OpenApi spec, and `z.record(z.any())` in the MCP tool definitions) rather than requiring them to be stringified. The server can internally stringify them before inserting into the database if needed.

## 3. Disconnected REST Endpoints for Content Items

**Issue:**
To create a Content Item, the endpoint is `POST /api/content-items`, and the agent must remember to pass `contentTypeId` inside the JSON body. To fetch items for a specific content type, the agent uses `GET /api/content-items?contentTypeId=XYZ`.

**Impact:**
While functional, this breaks standard RESTful nesting conventions (e.g., `/api/content-types/{id}/items`). It forces the agent to read the documentation carefully rather than relying on intuitive REST URL structures.

**Recommendation:**
Consider supporting nested paths like `POST /api/content-types/:contentTypeId/items` alongside or instead of the flat `/api/content-items` endpoint. This makes the relationship between Content Types and their Items structurally obvious to LLMs.
