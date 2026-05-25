import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  text,
  pgEnum,
  integer,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { clients } from './clients';

export const cameraTypeEnum = pgEnum('camera_type', ['lpr', 'ptz', 'general']);

export const cameras = pgTable(
  'cameras',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    type: cameraTypeEnum('type').notNull().default('general'),
    brand: varchar('brand', { length: 32 }).notNull().default('intelbras'),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    ip: varchar('ip', { length: 255 }).notNull(),
    port: integer('port').notNull().default(80),
    serialNumber: varchar('serial_number', { length: 120 }),
    model: varchar('model', { length: 120 }),
    location: text('location'),
    username: varchar('username', { length: 120 }),
    passwordEncrypted: text('password_encrypted'),
    /** UUID relatado pela câmera (DeviceInfo), quando disponível. */
    deviceId: varchar('device_id', { length: 64 }),
    /** Token servidor — identificação / futuro webhook. */
    deviceToken: uuid('device_token').notNull().defaultRandom().unique(),
    isActive: boolean('is_active').default(true).notNull(),
    lastSeenAt: timestamp('last_seen_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('cameras_device_id_unique').on(table.deviceId).where(
      sql`${table.deviceId} IS NOT NULL`,
    ),
  ],
);
