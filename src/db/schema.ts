import { pgTable, serial, text, timestamp, integer } from 'drizzle-orm/pg-core';

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
