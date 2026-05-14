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
  /** IPv4, IPv6 ou hostname (DNS/DDNS); FQDN até 253 caracteres (RFC 1035). */
  ip: varchar('ip', { length: 255 }).notNull(),
  port: integer('port').notNull().default(80),
  serialNumber: varchar('serial_number', { length: 120 }),
  model: varchar('model', { length: 120 }),
  location: text('location'),
  /** Login HTTP (Digest) no leitor; armazenado em texto plano (IP geralmente já é sensível no mesmo registro). */
  username: varchar('username', { length: 120 }),
  /** Senha criptografada (AES-256-GCM), texto `iv:authTag:ciphertext` em hex. */
  passwordEncrypted: text('password_encrypted'),
  token: uuid('device_token').notNull().defaultRandom().unique(),
  isActive: boolean('is_active').default(true).notNull(),
  lastSeenAt: timestamp('last_seen_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
