import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  text,
  pgEnum,
} from 'drizzle-orm/pg-core';

import { users } from './auth';

export const companyUserRoleEnum = pgEnum('company_user_role', [
  'company_admin',
  'company_operator',
]);

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).unique(),
  cnpj: varchar('cnpj', { length: 18 }),
  phone: varchar('phone', { length: 20 }),
  email: varchar('email', { length: 255 }),
  logoUrl: varchar('logo_url', { length: 500 }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const companyUsers = pgTable('company_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: companyUserRoleEnum('role').notNull(),
  jobTitle: varchar('job_title', { length: 120 }),
  phone: varchar('phone', { length: 30 }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  notes: text('notes'),
});
