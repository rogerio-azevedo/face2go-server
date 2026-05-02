import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  text,
  pgEnum,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { companies } from './companies';

export const clientTypeEnum = pgEnum('client_type', [
  'office',
  'clinic',
  'condominium',
  'other',
]);

export const clientUserRoleEnum = pgEnum('client_user_role', [
  'client_admin',
  'client_operator',
]);

export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 100 }),
    type: clientTypeEnum('type').notNull().default('other'),
    cnpj: varchar('cnpj', { length: 18 }),
    phone: varchar('phone', { length: 20 }),
    email: varchar('email', { length: 255 }),
    logoUrl: varchar('logo_url', { length: 500 }),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('clients_company_slug_unique').on(t.companyId, t.slug),
  ],
);

export const clientUsers = pgTable('client_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  role: clientUserRoleEnum('role').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  notes: text('notes'),
});
