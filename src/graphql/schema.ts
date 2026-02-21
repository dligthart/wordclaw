export const schema = `
  scalar JSON

  """A reusable content schema definition used to validate content items."""
  type ContentType {
    """Stable numeric identifier."""
    id: ID!
    """Human-readable content type name."""
    name: String!
    """Unique machine slug."""
    slug: String!
    """Optional description for operators and agents."""
    description: String
    """JSON schema string that validates content payloads."""
    schema: JSON!
    """Creation timestamp (ISO-8601)."""
    createdAt: String
    """Last update timestamp (ISO-8601)."""
    updatedAt: String
  }

  """A versioned content entity that belongs to a content type."""
  type ContentItem {
    """Stable numeric identifier."""
    id: ID!
    """Owning content type identifier."""
    contentTypeId: ID!
    """JSON payload stored as a string."""
    data: JSON!
    """Lifecycle status."""
    status: String!
    """Monotonic version number."""
    version: Int!
    """Creation timestamp (ISO-8601)."""
    createdAt: String
    """Last update timestamp (ISO-8601)."""
    updatedAt: String
  }

  """An immutable snapshot of a prior content item state."""
  type ContentItemVersion {
    """Stable numeric identifier."""
    id: ID!
    """Referenced content item identifier."""
    contentItemId: ID!
    """Version number of the historical snapshot."""
    version: Int!
    """Historical JSON payload as a string."""
    data: JSON!
    """Historical status value."""
    status: String!
    """Snapshot timestamp (ISO-8601)."""
    createdAt: String
  }

  """An audit event emitted by content or policy operations."""
  type AuditLog {
    """Stable numeric identifier."""
    id: ID!
    """Action type such as create, update, delete, rollback."""
    action: String!
    """Entity class targeted by the action."""
    entityType: String!
    """Target entity identifier."""
    entityId: ID!
    """Optional serialized details payload."""
    details: JSON
    """Event timestamp (ISO-8601)."""
    createdAt: String
  }

  """A record of an L402 payment flow."""
  type Payment {
    """Stable numeric identifier."""
    id: ID!
    """The Lightning payment hash."""
    paymentHash: String!
    """Amount in satoshis."""
    amountSatoshis: Int!
    """Status: 'pending' or 'paid'."""
    status: String!
    """Resource path being accessed."""
    resourcePath: String!
    """The actor UUID/ID if authenticated."""
    actorId: String
    """JSON details of the request."""
    details: JSON
    """Creation timestamp (ISO-8601)."""
    createdAt: String
  }

  """A webhook registration for audit/event delivery."""
  type Webhook {
    """Stable numeric identifier."""
    id: ID!
    """Callback destination URL."""
    url: String!
    """Subscribed event patterns."""
    events: [String!]!
    """Whether delivery is currently enabled."""
    active: Boolean!
    """Creation timestamp (ISO-8601)."""
    createdAt: String
  }

  """Result envelope for delete mutations."""
  type DeleteResult {
    """Target identifier."""
    id: ID!
    """Outcome message."""
    message: String!
  }

  """Result envelope for rollback mutations."""
  type RollbackResult {
    """Content item identifier."""
    id: ID!
    """New head version after rollback."""
    version: Int!
    """Outcome message."""
    message: String!
  }

  """Input payload for batch content-item creation."""
  input BatchCreateContentItemInput {
    """Target content type identifier."""
    contentTypeId: ID!
    """JSON payload as string."""
    data: JSON!
    """Optional content status."""
    status: String
  }

  """Input payload for batch content-item updates."""
  input BatchUpdateContentItemInput {
    """Target content item identifier."""
    id: ID!
    """Optional replacement content type identifier."""
    contentTypeId: ID
    """Optional replacement JSON payload as string."""
    data: JSON
    """Optional replacement status."""
    status: String
  }

  """Per-item result in batch operations."""
  type BatchItemResult {
    """Index of the input item in the original request."""
    index: Int!
    """Whether the specific item succeeded."""
    ok: Boolean!
    """Created/updated/deleted content item identifier."""
    id: ID
    """Resulting version for create/update operations."""
    version: Int
    """Machine-readable error code for failed items."""
    code: String
    """Human-readable error message for failed items."""
    error: String
  }

  """Batch execution summary."""
  type BatchMutationResult {
    """True when transaction mode is atomic."""
    atomic: Boolean!
    """Per-item execution outcomes."""
    results: [BatchItemResult!]!
  }

  type Query {
    """List content types with limit/offset pagination."""
    contentTypes(limit: Int = 50, offset: Int = 0): [ContentType!]!
    """Get one content type by id."""
    contentType(id: ID!): ContentType
    """List content items with optional filtering and pagination."""
    contentItems(
      contentTypeId: ID,
      status: String,
      createdAfter: String,
      createdBefore: String,
      limit: Int = 50,
      offset: Int = 0
    ): [ContentItem!]!
    """Get one content item by id."""
    contentItem(id: ID!): ContentItem
    """List historical versions for a content item."""
    contentItemVersions(id: ID!): [ContentItemVersion!]!
    """List audit logs with optional filters and cursor pagination input."""
    auditLogs(entityType: String, entityId: ID, action: String, limit: Int = 50, cursor: String): [AuditLog!]!
    """List payments with limit/offset pagination."""
    payments(limit: Int = 50, offset: Int = 0): [Payment!]!
    """Get one payment by id."""
    payment(id: ID!): Payment
    """List registered webhook endpoints."""
    webhooks: [Webhook!]!
    """Get one webhook registration by id."""
    webhook(id: ID!): Webhook
  }

  type PolicyDecision {
    outcome: String!
    code: String!
    remediation: String
    metadata: JSON
    policyVersion: String!
  }

  input ResourceInput {
    type: String!
    id: String
    contentTypeId: String
  }

  type Mutation {
    """Create a content type."""
    createContentType(
      name: String!,
      slug: String!,
      description: String,
      schema: JSON!,
      dryRun: Boolean = false
    ): ContentType!
    """Update a content type."""
    updateContentType(
      id: ID!,
      name: String,
      slug: String,
      description: String,
      schema: JSON,
      dryRun: Boolean = false
    ): ContentType!
    """Delete a content type."""
    deleteContentType(id: ID!, dryRun: Boolean = false): DeleteResult!
    """Create a single content item."""
    createContentItem(
      contentTypeId: ID!,
      data: JSON!,
      status: String,
      dryRun: Boolean = false
    ): ContentItem!
    """Create multiple content items in one operation."""
    createContentItemsBatch(
      items: [BatchCreateContentItemInput!]!,
      atomic: Boolean = false,
      dryRun: Boolean = false
    ): BatchMutationResult!
    """Update a single content item."""
    updateContentItem(
      id: ID!,
      contentTypeId: ID,
      data: JSON,
      status: String,
      dryRun: Boolean = false
    ): ContentItem!
    """Update multiple content items in one operation."""
    updateContentItemsBatch(
      items: [BatchUpdateContentItemInput!]!,
      atomic: Boolean = false,
      dryRun: Boolean = false
    ): BatchMutationResult!
    """Delete a single content item."""
    deleteContentItem(id: ID!, dryRun: Boolean = false): DeleteResult!
    """Delete multiple content items in one operation."""
    deleteContentItemsBatch(ids: [ID!]!, atomic: Boolean = false, dryRun: Boolean = false): BatchMutationResult!
    """Create a webhook registration."""
    createWebhook(
      url: String!,
      events: [String!]!,
      secret: String!,
      active: Boolean = true
    ): Webhook!
    """Update a webhook registration."""
    updateWebhook(
      id: ID!,
      url: String,
      events: [String!],
      secret: String,
      active: Boolean
    ): Webhook!
    """Delete a webhook registration."""
    deleteWebhook(id: ID!): DeleteResult!
    """Rollback a content item to a previous version."""
    rollbackContentItem(id: ID!, version: Int!, dryRun: Boolean = false): RollbackResult!
    """Evaluate a policy decision without side effects."""
    policyEvaluate(operation: String!, resource: ResourceInput!): PolicyDecision!
  }
`;
