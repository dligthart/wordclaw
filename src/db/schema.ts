import { pgTable, serial, text, timestamp, integer, boolean, jsonb, index, uniqueIndex, vector } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
    id: serial('id').primaryKey(),
    email: text('email').notNull().unique(),
    name: text('name'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const domains = pgTable('domains', {
    id: serial('id').primaryKey(),
    hostname: text('hostname').notNull().unique(), // e.g., default.com
    name: text('name').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const contentTypes = pgTable('content_types', {
    id: serial('id').primaryKey(),
    domainId: integer('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    description: text('description'),
    schema: text('schema').notNull(),
    basePrice: integer('base_price'), // Minimum cost in Satoshis for creating an item of this type
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const contentItems = pgTable('content_items', {
    id: serial('id').primaryKey(),
    domainId: integer('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
    contentTypeId: integer('content_type_id').notNull().references(() => contentTypes.id),
    data: text('data').notNull(),
    status: text('status').notNull().default('draft'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const contentItemVersions = pgTable('content_item_versions', {
    id: serial('id').primaryKey(),
    contentItemId: integer('content_item_id').references(() => contentItems.id, { onDelete: 'cascade' }).notNull(),
    version: integer('version').notNull(),
    data: text('data').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
    id: serial('id').primaryKey(),
    domainId: integer('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
    action: text('action').notNull(), // 'create', 'update', 'delete', 'rollback'
    entityType: text('entity_type').notNull(), // 'content_type', 'content_item'
    entityId: integer('entity_id').notNull(),
    userId: integer('user_id'), // Nullable for now
    details: text('details'), // JSON string or simple text desc
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const apiKeys = pgTable('api_keys', {
    id: serial('id').primaryKey(),
    domainId: integer('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
    name: text('name').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    scopes: text('scopes').notNull(),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at'),
    revokedAt: timestamp('revoked_at'),
    lastUsedAt: timestamp('last_used_at'),
});

export const webhooks = pgTable('webhooks', {
    id: serial('id').primaryKey(),
    domainId: integer('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
    url: text('url').notNull(),
    events: text('events').notNull(),
    secret: text('secret').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    active: boolean('active').notNull().default(true),
});

export const supervisors = pgTable('supervisors', {
    id: serial('id').primaryKey(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    lastLoginAt: timestamp('last_login_at'),
});
export const payments = pgTable('payments', {
    id: serial('id').primaryKey(),
    domainId: integer('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
    paymentHash: text('payment_hash').notNull().unique(),
    provider: text('provider').notNull().default('mock'),
    providerInvoiceId: text('provider_invoice_id'),
    paymentRequest: text('payment_request').notNull(),
    amountSatoshis: integer('amount_satoshis').notNull(),
    status: text('status').notNull().default('pending'), // 'pending', 'paid', 'consumed', 'expired', 'failed'
    expiresAt: timestamp('expires_at'),
    settledAt: timestamp('settled_at'),
    failureReason: text('failure_reason'),
    lastEventId: text('last_event_id'),
    resourcePath: text('resource_path').notNull(),
    actorId: text('actor_id'),
    details: jsonb('details'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
    return {
        paymentStatusIdx: index('payment_status_idx').on(table.status),
        paymentCreatedAtIdx: index('payment_created_at_idx').on(table.createdAt),
        paymentProviderIdx: index('payment_provider_idx').on(table.provider)
    };
});

export const paymentProviderEvents = pgTable('payment_provider_events', {
    id: serial('id').primaryKey(),
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    paymentHash: text('payment_hash').notNull(),
    status: text('status').notNull(),
    signature: text('signature'),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at').defaultNow().notNull()
}, (table) => {
    return {
        providerEventUniqueIdx: uniqueIndex('payment_provider_events_provider_event_idx').on(table.provider, table.eventId),
        paymentHashIdx: index('payment_provider_events_payment_hash_idx').on(table.paymentHash)
    };
});

export const policyDecisionLogs = pgTable('policy_decision_logs', {
    id: serial('id').primaryKey(),
    principalId: text('principal_id'),
    operation: text('operation').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    environment: text('environment').notNull(), // 'rest', 'graphql', 'mcp'
    outcome: text('outcome').notNull(), // 'allow', 'deny', 'challenge'
    remediation: text('remediation'),
    policyVersion: text('policy_version').notNull(),
    evaluationDurationMs: integer('evaluation_duration_ms').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => {
    return {
        policyOutcomeIdx: index('policy_outcome_idx').on(table.outcome),
        policyCreatedAtIdx: index('policy_created_at_idx').on(table.createdAt)
    };
});

export const workflows = pgTable('workflows', {
    id: serial('id').primaryKey(),
    domainId: integer('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
    name: text('name').notNull(),
    contentTypeId: integer('content_type_id').references(() => contentTypes.id, { onDelete: 'cascade' }).notNull(),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const workflowTransitions = pgTable('workflow_transitions', {
    id: serial('id').primaryKey(),
    workflowId: integer('workflow_id').references(() => workflows.id, { onDelete: 'cascade' }).notNull(),
    fromState: text('from_state').notNull(),
    toState: text('to_state').notNull(),
    requiredRoles: jsonb('required_roles').notNull(), // Array of scope strings
});

export const reviewTasks = pgTable('review_tasks', {
    id: serial('id').primaryKey(),
    domainId: integer('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
    contentItemId: integer('content_item_id').references(() => contentItems.id, { onDelete: 'cascade' }).notNull(),
    workflowTransitionId: integer('workflow_transition_id').references(() => workflowTransitions.id).notNull(),
    status: text('status').notNull().default('pending'), // 'pending', 'approved', 'rejected', 'changes_requested'
    assignee: text('assignee'), // API Key Hash or Supervisor ID
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const reviewComments = pgTable('review_comments', {
    id: serial('id').primaryKey(),
    domainId: integer('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
    contentItemId: integer('content_item_id').references(() => contentItems.id, { onDelete: 'cascade' }).notNull(),
    authorId: text('author_id').notNull(), // API Key Hash or Supervisor ID
    comment: text('comment').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const contentItemEmbeddings = pgTable("content_item_embeddings", {
    id: serial("id").primaryKey(),
    contentItemId: integer("content_item_id").references(() => contentItems.id, { onDelete: 'cascade' }).notNull(),
    domainId: integer("domain_id").references(() => domains.id, { onDelete: 'cascade' }).notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    textChunk: text("text_chunk").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
}, (table) => ({
    embeddingIndex: index("embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
    domainIndex: index("embedding_domain_idx").on(table.domainId)
}));

export const agentProfiles = pgTable('agent_profiles', {
    id: serial('id').primaryKey(),
    domainId: integer('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
    apiKeyId: integer('api_key_id').references(() => apiKeys.id, { onDelete: 'cascade' }).notNull(),
    payoutAddress: text('payout_address'), // RFC 0006 lightning address
});

export const offers = pgTable('offers', {
    id: serial('id').primaryKey(),
    domainId: integer('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    scopeType: text('scope_type').notNull(), // 'item', 'type', 'subscription'
    scopeRef: integer('scope_ref'), // Nullable
    priceSats: integer('price_sats').notNull(),
    active: boolean('active').default(true).notNull(),
});

export const licensePolicies = pgTable('license_policies', {
    id: serial('id').primaryKey(),
    domainId: integer('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
    offerId: integer('offer_id').references(() => offers.id, { onDelete: 'cascade' }).notNull(),
    version: integer('version').notNull().default(1),
    maxReads: integer('max_reads'), // Null means unlimited
    expiresAt: timestamp('expires_at'), // Null means never
    allowedChannels: jsonb('allowed_channels').notNull().default([]), // Array of strings
    allowRedistribution: boolean('allow_redistribution').notNull().default(false),
    termsJson: jsonb('terms_json'), // Human/Machine readable extra terms
});

export const entitlements = pgTable('entitlements', {
    id: serial('id').primaryKey(),
    domainId: integer('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
    offerId: integer('offer_id').references(() => offers.id, { onDelete: 'cascade' }).notNull(),
    policyId: integer('policy_id').references(() => licensePolicies.id, { onDelete: 'cascade' }).notNull(),
    policyVersion: integer('policy_version').notNull(),
    agentProfileId: integer('agent_profile_id').references(() => agentProfiles.id, { onDelete: 'cascade' }).notNull(),
    paymentHash: text('payment_hash').notNull().unique(), // Linked to payment completion
    status: text('status').notNull().default('active'), // 'active', 'revoked', 'expired'
    expiresAt: timestamp('expires_at'),
    remainingReads: integer('remaining_reads'),
    delegatedFrom: integer('delegated_from'), // Self-referencing FK added after export
});

export const accessEvents = pgTable('access_events', {
    id: serial('id').primaryKey(),
    domainId: integer('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull(),
    entitlementId: integer('entitlement_id').references(() => entitlements.id, { onDelete: 'cascade' }).notNull(),
    resourcePath: text('resource_path').notNull(),
    action: text('action').notNull(),
    granted: boolean('granted').notNull(),
    reason: text('reason'), // E.g., 'remaining_reads_exhausted'
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const l402OperatorConfigs = pgTable('l402_operator_configs', {
    id: serial('id').primaryKey(),
    domainId: integer('domain_id').references(() => domains.id, { onDelete: 'cascade' }).notNull().unique(),
    architecture: text('architecture').notNull().default('mock'), // 'mock', 'lnbits', 'lnd'
    webhookEndpoint: text('webhook_endpoint'),
    secretManagerPath: text('secret_manager_path'),
    checklistApprovals: jsonb('checklist_approvals').notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
