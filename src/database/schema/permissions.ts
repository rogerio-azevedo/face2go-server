import { relations, sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

import { companyUsers } from './companies';

export const features = pgTable('features', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const companyUserPermissions = pgTable(
  'company_user_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyUserId: uuid('company_user_id')
      .notNull()
      .references(() => companyUsers.id, { onDelete: 'cascade' }),
    featureSlug: varchar('feature_slug', { length: 100 }).notNull(),
    actions: text('actions')
      .array()
      .notNull()
      .default(sql`'{}'`),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    uniqueCompanyUserFeature: unique('unique_company_user_feature').on(
      t.companyUserId,
      t.featureSlug,
    ),
  }),
);

export const companyUsersRelations = relations(companyUsers, ({ many }) => ({
  permissions: many(companyUserPermissions),
}));

export const featuresRelations = relations(features, ({ many }) => ({
  permissions: many(companyUserPermissions),
}));

export const companyUserPermissionsRelations = relations(
  companyUserPermissions,
  ({ one }) => ({
    companyUser: one(companyUsers, {
      fields: [companyUserPermissions.companyUserId],
      references: [companyUsers.id],
    }),
  }),
);
