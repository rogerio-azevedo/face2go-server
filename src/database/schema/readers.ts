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

export const facialReaders = pgTable('facial_readers', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  brand: readerBrandEnum('brand').notNull().default('intelbras'),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  ip: varchar('ip', { length: 45 }).notNull(),
  port: integer('port').notNull().default(80),
  serialNumber: varchar('serial_number', { length: 120 }),
  model: varchar('model', { length: 120 }),
  location: text('location'),
  token: uuid('device_token').notNull().defaultRandom().unique(),
  isActive: boolean('is_active').default(true).notNull(),
  lastSeenAt: timestamp('last_seen_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
