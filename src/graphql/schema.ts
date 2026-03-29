import { isExperimentalAgentRunsEnabled } from '../config/runtime-features.js';

const agentRunTypeDefs = isExperimentalAgentRunsEnabled() ? `
  """A single deterministic action within an autonomous run."""
  type AgentRunStep {
    id: ID!
    runId: ID!
    domainId: ID!
    stepIndex: Int!
    stepKey: String!
    actionType: String!
    status: String!
    requestSnapshot: JSON
    responseSnapshot: JSON
    errorMessage: String
    startedAt: String
    completedAt: String
    createdAt: String
    updatedAt: String
  }

  """A resumable checkpoint persisted during run execution."""
  type AgentRunCheckpoint {
    id: ID!
    runId: ID!
    domainId: ID!
    checkpointKey: String!
    payload: JSON!
    createdAt: String
  }

  """An autonomous content-operations execution instance."""
  type AgentRun {
    id: ID!
    domainId: ID!
    definitionId: ID
    goal: String!
    runType: String!
    status: String!
    requestedBy: String
    metadata: JSON
    startedAt: String
    completedAt: String
    createdAt: String
    updatedAt: String
    steps: [AgentRunStep!]!
    checkpoints: [AgentRunCheckpoint!]!
  }

  """Reusable template for autonomous run creation."""
  type AgentRunDefinition {
    id: ID!
    domainId: ID!
    name: String!
    runType: String!
    strategyConfig: JSON!
    active: Boolean!
    createdAt: String
    updatedAt: String
  }
` : '';

const agentRunQueryDefs = isExperimentalAgentRunsEnabled() ? `
    """List autonomous runs for the current domain."""
    agentRuns(status: String, runType: String, definitionId: ID, limit: Int = 50, offset: Int = 0): [AgentRun!]!
    """Get one autonomous run with steps/checkpoints by id."""
    agentRun(id: ID!): AgentRun
    """List autonomous run definitions for the current domain."""
    agentRunDefinitions(active: Boolean, runType: String, limit: Int = 50, offset: Int = 0): [AgentRunDefinition!]!
    """Get one autonomous run definition by id."""
    agentRunDefinition(id: ID!): AgentRunDefinition
` : '';

const agentRunMutationDefs = isExperimentalAgentRunsEnabled() ? `
    """Create a new autonomous run."""
    createAgentRun(
      goal: String!,
      runType: String,
      definitionId: ID,
      requireApproval: Boolean = true,
      metadata: JSON
    ): AgentRun!
    """Apply a control action on an autonomous run."""
    controlAgentRun(id: ID!, action: String!): AgentRun!
    """Create a reusable autonomous run definition."""
    createAgentRunDefinition(
      name: String!,
      runType: String!,
      strategyConfig: JSON,
      active: Boolean = true
    ): AgentRunDefinition!
    """Update a reusable autonomous run definition."""
    updateAgentRunDefinition(
      id: ID!,
      name: String,
      runType: String,
      strategyConfig: JSON,
      active: Boolean
    ): AgentRunDefinition!
` : '';

export const schema = `
  scalar JSON

  enum ContentTypeKind {
    collection
    singleton
  }

  enum ContentEmbeddingReadinessState {
    disabled
    unpublished
    empty
    syncing
    ready
    missing
    stale
  }

  enum FormFieldType {
    text
    textarea
    number
    checkbox
    select
  }

  enum JobKind {
    content_status_transition
    outbound_webhook
  }

  enum JobStatus {
    queued
    running
    succeeded
    failed
    cancelled
  }

  """A reusable content schema definition used to validate content items."""
  type ContentType {
    """Stable numeric identifier."""
    id: ID!
    """Human-readable content type name."""
    name: String!
    """Unique machine slug."""
    slug: String!
    """Collection or singleton document model."""
    kind: ContentTypeKind!
    """Optional description for operators and agents."""
    description: String
    """Optional editor-oriented schema manifest that compiles into the canonical schema."""
    schemaManifest: JSON
    """JSON schema string that validates content payloads."""
    schema: JSON!
    """Creation timestamp (ISO-8601)."""
    createdAt: String
    """Last update timestamp (ISO-8601)."""
    updatedAt: String
  }

  """A singleton/global content type paired with its current item, if one exists."""
  type GlobalContent {
    contentType: ContentType!
    item: ContentItem
  }

  """Summary of localized field resolution for a locale-aware read."""
  type ContentLocaleResolution {
    requestedLocale: String!
    fallbackLocale: String!
    defaultLocale: String!
    localizedFieldCount: Int!
    resolvedFieldCount: Int!
    fallbackFieldCount: Int!
    unresolvedFields: [String!]!
  }

  """Semantic indexing readiness for the latest published snapshot of a content item."""
  type ContentEmbeddingReadiness {
    enabled: Boolean!
    state: ContentEmbeddingReadinessState!
    searchable: Boolean!
    model: String
    targetVersion: Int
    indexedChunkCount: Int!
    expectedChunkCount: Int!
    inFlight: Boolean!
    queueDepth: Int!
    note: String!
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
    """Locale resolution summary when locale-aware reads are requested."""
    localeResolution: ContentLocaleResolution
    """Derived publication state for the current working copy."""
    publicationState: String!
    """Version number currently stored in the working copy head."""
    workingCopyVersion: Int!
    """Latest published version number, when one exists."""
    publishedVersion: Int
    """Semantic indexing readiness for the latest published snapshot."""
    embeddingReadiness: ContentEmbeddingReadiness!
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

  """One content-item reference discovered in live or historical data."""
  type ReferenceUsage {
    """Referencing content item identifier."""
    contentItemId: ID!
    """Referencing content type identifier."""
    contentTypeId: ID!
    """Referencing content type name."""
    contentTypeName: String!
    """Referencing content type slug."""
    contentTypeSlug: String!
    """JSON pointer path where the reference was found."""
    path: String!
    """Version where the reference was observed."""
    version: Int!
    """Current live status when the reference is active."""
    status: String
    """Historical version row id when the reference came from a prior snapshot."""
    contentItemVersionId: ID
  }

  """Summary of active and historical reverse references for an entity."""
  type ReferenceUsageSummary {
    """Count of active live references."""
    activeReferenceCount: Int!
    """Count of historical version-only references."""
    historicalReferenceCount: Int!
    """Active live references."""
    activeReferences: [ReferenceUsage!]!
    """Historical version references."""
    historicalReferences: [ReferenceUsage!]!
  }

  type FormFieldOption {
    label: String
    value: String!
  }

  type FormField {
    name: String!
    label: String
    description: String
    type: FormFieldType!
    required: Boolean!
    placeholder: String
    options: [FormFieldOption!]!
  }

  type FormDefinition {
    id: ID!
    domainId: ID!
    name: String!
    slug: String!
    description: String
    contentTypeId: ID!
    contentTypeName: String!
    contentTypeSlug: String!
    active: Boolean!
    publicRead: Boolean!
    submissionStatus: String!
    workflowTransitionId: ID
    requirePayment: Boolean!
    successMessage: String
    fields: [FormField!]!
    defaultData: JSON!
    createdAt: String
    updatedAt: String
  }

  type Job {
    id: ID!
    domainId: ID!
    kind: JobKind!
    queue: String!
    status: JobStatus!
    payload: JSON!
    result: JSON
    attempts: Int!
    maxAttempts: Int!
    runAt: String
    claimedAt: String
    startedAt: String
    completedAt: String
    lastError: String
    createdAt: String
    updatedAt: String
  }

  type JobWorkerError {
    message: String!
    at: String!
  }

  type JobWorkerStatus {
    started: Boolean!
    sweepInProgress: Boolean!
    intervalMs: Int!
    maxJobsPerSweep: Int!
    lastSweepStartedAt: String
    lastSweepCompletedAt: String
    lastSweepProcessedJobs: Int!
    totalSweeps: Int!
    totalProcessedJobs: Int!
    lastError: JobWorkerError
  }

  """A grouped read-model bucket derived from content items."""
  type ContentProjectionBucket {
    """Scalar group key from the projected schema field."""
    group: JSON
    """Computed metric value for the bucket."""
    value: Float!
    """Underlying item count that contributed to the bucket."""
    count: Int!
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
    """Canonical actor identifier such as supervisor:12 or api_key:34."""
    actorId: String
    """Actor classification such as supervisor, api_key, or mcp."""
    actorType: String
    """How the actor authenticated or entered the system."""
    actorSource: String
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
    """Actor classification such as supervisor, api_key, or mcp."""
    actorType: String
    """How the actor authenticated or entered the system."""
    actorSource: String
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

  """A formalized multi-step editorial process."""
  type Workflow {
    id: ID!
    name: String!
    contentTypeId: ID!
    active: Boolean!
    createdAt: String
    updatedAt: String
  }

  """A valid transition path between states within a workflow."""
  type WorkflowTransition {
    id: ID!
    workflowId: ID!
    fromState: String!
    toState: String!
    requiredRoles: [String!]!
  }

  """An active content review task mapping an item to a transition decision."""
  type ReviewTask {
    id: ID!
    contentItemId: ID!
    workflowTransitionId: ID!
    status: String!
    assignee: String
    assigneeActorId: String
    assigneeActorType: String
    assigneeActorSource: String
    createdAt: String
    updatedAt: String
  }

  """A conversational comment attached to a content item's review thread."""
  type ReviewComment {
    id: ID!
    contentItemId: ID!
    authorId: String!
    authorActorId: String
    authorActorType: String
    authorActorSource: String
    comment: String!
    createdAt: String
  }

${agentRunTypeDefs}

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

  type SemanticSearchResult {
    id: Int!
    contentItemId: Int!
    chunkIndex: Int!
    textChunk: String!
    similarity: Float!
    contentItemData: JSON!
    contentTypeSlug: String!
  }

  type Query {
    """Search knowledge semantically across embedded content chunks."""
    semanticSearch(query: String!, limit: Int = 5): [SemanticSearchResult!]!
    """List content types with limit/offset pagination."""
    contentTypes(limit: Int = 50, offset: Int = 0): [ContentType!]!
    """Get one content type by id."""
    contentType(id: ID!): ContentType
    """List singleton/global content types with their current item."""
    globals(draft: Boolean = true, locale: String, fallbackLocale: String): [GlobalContent!]!
    """Get one singleton/global content type by slug."""
    global(slug: String!, draft: Boolean = true, locale: String, fallbackLocale: String): GlobalContent
    """List reusable form definitions for the current domain."""
    forms: [FormDefinition!]!
    """Get one reusable form definition by id."""
    form(id: ID!): FormDefinition
    """List content items with optional filtering and pagination."""
    contentItems(
      contentTypeId: ID,
      status: String,
      draft: Boolean = true,
      locale: String,
      fallbackLocale: String,
      createdAfter: String,
      createdBefore: String,
      fieldName: String,
      fieldOp: String,
      fieldValue: String,
      sortField: String,
      includeArchived: Boolean,
      limit: Int = 50,
      offset: Int = 0,
      cursor: String
    ): [ContentItem!]!
    """Build grouped read-model buckets from content items for analytics or leaderboard-style views."""
    contentItemProjection(
      contentTypeId: ID!,
      status: String,
      createdAfter: String,
      createdBefore: String,
      fieldName: String,
      fieldOp: String,
      fieldValue: String,
      groupBy: String!,
      metric: String = "count",
      metricField: String,
      orderBy: String = "value",
      orderDir: String = "desc",
      includeArchived: Boolean,
      limit: Int = 50
    ): [ContentProjectionBucket!]!
    """Get one content item by id."""
    contentItem(id: ID!, draft: Boolean = true, locale: String, fallbackLocale: String): ContentItem
    """List historical versions for a content item."""
    contentItemVersions(id: ID!): [ContentItemVersion!]!
    """Inspect which content items reference the target content item."""
    contentItemUsedBy(id: ID!): ReferenceUsageSummary!
    """Inspect which content items reference the target asset."""
    assetUsedBy(id: ID!): ReferenceUsageSummary!
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
    """List background jobs for the current domain."""
    jobs(status: JobStatus, kind: JobKind, limit: Int = 50, offset: Int = 0): [Job!]!
    """Get one background job by id."""
    job(id: ID!): Job
    """Inspect worker health for the background jobs sweep loop."""
    jobsWorkerStatus: JobWorkerStatus!
${agentRunQueryDefs}
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
      kind: ContentTypeKind = collection,
      description: String,
      schema: JSON,
      schemaManifest: JSON,
      dryRun: Boolean = false
    ): ContentType!
    """Update a content type."""
    updateContentType(
      id: ID!,
      name: String,
      slug: String,
      kind: ContentTypeKind,
      description: String,
      schema: JSON,
      schemaManifest: JSON,
      dryRun: Boolean = false
    ): ContentType!
    """Delete a content type."""
    deleteContentType(id: ID!, dryRun: Boolean = false): DeleteResult!
    """Create or update the singleton item for a global content type."""
    updateGlobal(
      slug: String!,
      data: JSON!,
      status: String,
      dryRun: Boolean = false
    ): GlobalContent!
    """Create a reusable form definition."""
    createForm(
      name: String!,
      slug: String!,
      description: String,
      contentTypeId: ID!,
      fields: JSON!,
      defaultData: JSON,
      active: Boolean = true,
      publicRead: Boolean = true,
      submissionStatus: String,
      workflowTransitionId: ID,
      requirePayment: Boolean = false,
      webhookUrl: String,
      webhookSecret: String,
      successMessage: String
    ): FormDefinition!
    """Update a reusable form definition."""
    updateForm(
      id: ID!,
      name: String,
      slug: String,
      description: String,
      contentTypeId: ID,
      fields: JSON,
      defaultData: JSON,
      active: Boolean,
      publicRead: Boolean,
      submissionStatus: String,
      workflowTransitionId: ID,
      requirePayment: Boolean,
      webhookUrl: String,
      webhookSecret: String,
      successMessage: String
    ): FormDefinition!
    """Delete a reusable form definition."""
    deleteForm(id: ID!): DeleteResult!
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
    """Create a background job."""
    createJob(
      kind: JobKind!,
      payload: JSON!,
      queue: String,
      runAt: String,
      maxAttempts: Int
    ): Job!
    """Cancel a queued background job."""
    cancelJob(id: ID!): Job!
    """Schedule a background status transition for a content item."""
    scheduleContentStatusChange(
      contentItemId: ID!,
      targetStatus: String!,
      runAt: String!,
      maxAttempts: Int
    ): Job!
    """Rollback a content item to a previous version."""
    rollbackContentItem(id: ID!, version: Int!, dryRun: Boolean = false): RollbackResult!
    """Evaluate a policy decision without side effects."""
    policyEvaluate(operation: String!, resource: ResourceInput!): PolicyDecision!
${agentRunMutationDefs}
    
    """Create a new Workflow for a given ContentType."""
    createWorkflow(name: String!, contentTypeId: ID!, active: Boolean): Workflow!
    
    """Map a valid transition stage to a Workflow."""
    createWorkflowTransition(workflowId: ID!, fromState: String!, toState: String!, requiredRoles: [String!]!): WorkflowTransition!
    
    """Submit a Content Item into an active Review Task."""
    submitReviewTask(contentItemId: ID!, workflowTransitionId: ID!, assignee: String): ReviewTask!
    
    """Approve or Reject an active Review Task."""
    decideReviewTask(taskId: ID!, decision: String!): ReviewTask!
    
    """Attach a comment to a content item's review thread."""
    addReviewComment(contentItemId: ID!, comment: String!): ReviewComment!
  }
`;
