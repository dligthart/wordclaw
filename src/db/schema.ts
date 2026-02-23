import { pgTable, serial, text, timestamp, integer, boolean, jsonb, index, vector } from 'drizzle-orm/pg-core';

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
    paymentRequest: text('payment_request').notNull(),
    amountSatoshis: integer('amount_satoshis').notNull(),
    status: text('status').notNull().default('pending'), // 'pending' or 'paid'
    resourcePath: text('resource_path').notNull(),
    actorId: text('actor_id'),
    details: jsonb('details'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => {
    return {
        paymentStatusIdx: index('payment_status_idx').on(table.status),
        paymentCreatedAtIdx: index('payment_created_at_idx').on(table.createdAt)
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
