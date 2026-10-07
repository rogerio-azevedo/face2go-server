import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  text,
  pgEnum,
  integer,
} from 'drizzle-orm/pg-core';

import { clients } from './clients';

export const readerBrandEnum = pgEnum('reader_brand', [
  'intelbras',
  'hikvision',
]);

export const readerDirectionEnum = pgEnum('reader_direction', ['in', 'out']);

export const readerConnectionModeEnum = pgEnum('reader_connection_mode', [
  'direct',
  'auto_register',
]);

export const facialReaders = pgTable('facial_readers', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  brand: readerBrandEnum('brand').notNull().default('intelbras'),
  direction: readerDirectionEnum('direction'),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  ip: varchar('ip', { length: 255 }).notNull(),
  port: integer('port').notNull().default(80),
  serialNumber: varchar('serial_number', { length: 120 }),
  model: varchar('model', { length: 120 }),
  location: text('location'),
  username: varchar('username', { length: 120 }),
  passwordEncrypted: text('password_encrypted'),
  token: uuid('device_token').notNull().defaultRandom().unique(),
  isActive: boolean('is_active').default(true).notNull(),
  /** Nulo = sem restrição; 1..18 = idade civil mínima para receber a face. */
  minimumAccessAge: integer('minimum_access_age'),
  agePolicyVersion: integer('age_policy_version').default(0).notNull(),
  agePolicyStatus: varchar('age_policy_status', { length: 20 })
    .$type<'applied' | 'pending' | 'failed'>()
    .default('applied')
    .notNull(),
  agePolicyError: text('age_policy_error'),
  agePolicyAppliedAt: timestamp('age_policy_applied_at'),
  /** Compatibilidade de rollout; remover após todos os workers usarem minimumAccessAge. */
  restrictMinors: boolean('restrict_minors').default(false).notNull(),
  connectionMode: readerConnectionModeEnum('connection_mode')
    .notNull()
    .default('direct'),
  autoRegisterDeviceId: varchar('auto_register_device_id', { length: 64 }),
  lastSeenAt: timestamp('last_seen_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
