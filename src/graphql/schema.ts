export const schema = `
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
    schema: String!
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
    data: String!
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
    data: String!
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
    details: String
    """Event timestamp (ISO-8601)."""
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
    data: String!
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
    data: String
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
  }

  type Mutation {
    """Create a content type."""
    createContentType(
      name: String!,
      slug: String!,
      description: String,
      schema: String!,
      dryRun: Boolean = false
    ): ContentType!
    """Update a content type."""
    updateContentType(
      id: ID!,
      name: String,
      slug: String,
      description: String,
      schema: String,
      dryRun: Boolean = false
    ): ContentType!
    """Delete a content type."""
    deleteContentType(id: ID!, dryRun: Boolean = false): DeleteResult!
    """Create a single content item."""
    createContentItem(
      contentTypeId: ID!,
      data: String!,
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
      data: String,
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
    """Rollback a content item to a previous version."""
    rollbackContentItem(id: ID!, version: Int!, dryRun: Boolean = false): RollbackResult!
  }
`;
