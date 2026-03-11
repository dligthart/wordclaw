# Conceptual Deep Dive: Actor Identity Propagation

WordClaw is a multi-actor system. Every API key, supervisor session, and integration worker executes within the bounds of a well-defined identity context. Because agents may spawn sub-agents or rely on third-party webhook processors, maintaining airtight identity context is paramount for both security scoping and strict audit provenance.

## The `CurrentActorSnapshot`

Rather than relying purely on generic authentication headers, WordClaw resolves every inbound request down to a canonical `CurrentActorSnapshot`.

This snapshot provides answers to three critical questions:
1.  **Who is acting?** (`actorId`, `actorType`)
2.  **Where can they act?** (`domainId`)
3.  **What can they do there?** (`scopes`, `roles`)

### Actor Types
An actor fundamentally represents the entity holding the credential:

-   `supervisor`: A human admin or operator authenticated via the UI dashboard layer.
-   `api_key`: A machine agent or developer executing operations via a scoped token.
-   `system`: The internal WordClaw background worker or reconciliation job.

## Identity Flow State

When an agent requests `GET /api/identity` or runs `wordclaw capabilities whoami`, it doesn't just receive "200 Success". It receives its full Actor snapshot. 

This snapshot is the exact data object that propagates down through the service layer.

For example, when an API Key attempts to author content:
1.  **Middleware extraction**: The WordClaw Auth middleware detects the `x-api-key` header, validates its database record, and extracts the explicit `scopes` and bound `domainId`.
2.  **Service Context Injection**: The instantiated `CurrentActorSnapshot` is passed down as a strict parameter to the `ContentService.createItem()` function.
3.  **Policy Evaluation**: The service evaluates whether the snapshot contains the absolute bare minimum `content:write` scope. If the Content Type specifies an explicit workflow policy blocking that specific actor, the operation halts.
4.  **Audit Commitment**: If successful, the database transaction writes the new content *and simultaneously* creates an `AuditLog` record perfectly bound to the `actorId` and `actorType` from the snapshot.

The result is cryptographically secure, undeniable provenance.

## API Key Scopes

Because WordClaw isolates tenant data, an API key is strictly bound to a singular domain. 

Within that domain, its capabilities are dictated by simple string-based scopes:
-   `content:read`
-   `content:write`
-   `workflow:approve`
-   `integration:admin`
-   `system:read`

By verifying identity recursively against these explicit roles instead of arbitrary permissions, we guarantee that no stray webhook or unprivileged agent script can accidentally execute an untargeted database wipe or unauthorize an L402 invoice settlement!
