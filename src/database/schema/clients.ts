import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  text,
  integer,
  pgEnum,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { companies } from './companies';

export const clientTypeEnum = pgEnum('client_type', [
  'office',
  'clinic',
  'condominium',
  'school',
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
    /** Cor primária da marca do cliente (hex, ex.: #00c7b7). */
    primaryColor: varchar('primary_color', { length: 7 }),
    /** Segredo público só para SSE do display TV (opcional até gerar/regenerar). */
    displayToken: uuid('display_token'),
    /** Código curto público para URL do display (ex.: /display/eA1tP). */
    displayShortCode: varchar('display_short_code', { length: 8 }),
    isActive: boolean('is_active').default(true).notNull(),
    /**
     * Diferença em minutos em relação ao UTC (UTC−4 → −240, UTC+3 → +180).
     * Atalho aceito na API: |valor|≤14 tratado como horas inteiras.
     */
    timezoneOffsetMinutes: integer('timezone_offset_minutes').default(0).notNull(),
    /** Código da filial TOTVS IENH (1–3) para integração cadastral. */
    ienhFilialCode: integer('ienh_filial_code'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('clients_company_slug_unique').on(t.companyId, t.slug),
    uniqueIndex('clients_display_token_unique').on(t.displayToken),
    uniqueIndex('clients_display_short_code_unique').on(t.displayShortCode),
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
