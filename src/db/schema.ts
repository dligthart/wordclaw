import { pgTable, serial, text, timestamp, integer, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
    id: serial('id').primaryKey(),
    email: text('email').notNull().unique(),
    name: text('name'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const contentTypes = pgTable('content_types', {
    id: serial('id').primaryKey(),
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
    action: text('action').notNull(), // 'create', 'update', 'delete', 'rollback'
    entityType: text('entity_type').notNull(), // 'content_type', 'content_item'
    entityId: integer('entity_id').notNull(),
    userId: integer('user_id'), // Nullable for now
    details: text('details'), // JSON string or simple text desc
    createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const apiKeys = pgTable('api_keys', {
    id: serial('id').primaryKey(),
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
    paymentHash: text('payment_hash').notNull().unique(),
    paymentRequest: text('payment_request').notNull(),
    amountSatoshis: integer('amount_satoshis').notNull(),
    status: text('status').notNull().default('pending'), // 'pending' or 'paid'
    resourcePath: text('resource_path').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
