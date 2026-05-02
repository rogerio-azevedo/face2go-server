import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  boolean,
} from 'drizzle-orm/pg-core';

import { companies, companyUserRoleEnum } from './companies';

export const inviteLinks = pgTable('invite_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  role: companyUserRoleEnum('role').notNull(),
  expiresAt: timestamp('expires_at'),
  usedCount: integer('used_count').default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const inviteLinksRelations = relations(inviteLinks, ({ one }) => ({
  company: one(companies, {
    fields: [inviteLinks.companyId],
    references: [companies.id],
  }),
}));
