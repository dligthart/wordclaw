
export const schema = `
  type ContentType {
    id: ID!
    name: String!
    slug: String!
    description: String
    schema: String!
    createdAt: String
    updatedAt: String
  }

  type ContentItem {
    id: ID!
    contentTypeId: ID!
    data: String!
    status: String!
    version: Int!
    createdAt: String
    updatedAt: String
  }

  type ContentItemVersion {
    id: ID!
    contentItemId: ID!
    version: Int!
    data: String!
    status: String!
    createdAt: String
  }

  type AuditLog {
    id: ID!
    action: String!
    entityType: String!
    entityId: ID!
    details: String
    createdAt: String
  }

  type DeleteResult {
    id: ID!
    message: String!
  }

  type RollbackResult {
    id: ID!
    version: Int!
    message: String!
  }

  type Query {
    contentTypes: [ContentType!]!
    contentType(id: ID!): ContentType
    contentItems(contentTypeId: ID): [ContentItem!]!
    contentItem(id: ID!): ContentItem
    contentItemVersions(id: ID!): [ContentItemVersion!]!
    auditLogs(entityType: String, entityId: ID, action: String, limit: Int = 50): [AuditLog!]!
  }

  type Mutation {
    createContentType(
      name: String!,
      slug: String!,
      description: String,
      schema: String!,
      dryRun: Boolean = false
    ): ContentType!
    updateContentType(
      id: ID!,
      name: String,
      slug: String,
      description: String,
      schema: String,
      dryRun: Boolean = false
    ): ContentType!
    deleteContentType(id: ID!, dryRun: Boolean = false): DeleteResult!
    createContentItem(
      contentTypeId: ID!,
      data: String!,
      status: String,
      dryRun: Boolean = false
    ): ContentItem!
    updateContentItem(
      id: ID!,
      contentTypeId: ID,
      data: String,
      status: String,
      dryRun: Boolean = false
    ): ContentItem!
    deleteContentItem(id: ID!, dryRun: Boolean = false): DeleteResult!
    rollbackContentItem(id: ID!, version: Int!, dryRun: Boolean = false): RollbackResult!
  }
`;
