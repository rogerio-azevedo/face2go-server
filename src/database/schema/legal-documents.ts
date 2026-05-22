import {
  boolean,
  date,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const legalDocuments = pgTable(
  'legal_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    version: text('version').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    effectiveDate: date('effective_date').notNull(),
    isActive: boolean('is_active').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    typeVersionUnique: uniqueIndex('legal_documents_type_version_unique').on(
      table.type,
      table.version,
    ),
  }),
);
