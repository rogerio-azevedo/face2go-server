import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { clients } from './clients';

export const clientBlocks = pgTable(
  'client_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('client_blocks_client_name_active_uidx')
      .on(t.clientId, sql`lower(${t.name})`)
      .where(sql`${t.isActive} = true`),
  ],
);

export const clientUnits = pgTable(
  'client_units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    blockId: uuid('block_id')
      .notNull()
      .references(() => clientBlocks.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 50 }).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('client_units_block_name_active_uidx')
      .on(t.blockId, sql`lower(${t.name})`)
      .where(sql`${t.isActive} = true`),
  ],
);

export const clientBlocksRelations = relations(clientBlocks, ({ one, many }) => ({
  client: one(clients, {
    fields: [clientBlocks.clientId],
    references: [clients.id],
  }),
  units: many(clientUnits),
}));

export const clientUnitsRelations = relations(clientUnits, ({ one }) => ({
  client: one(clients, {
    fields: [clientUnits.clientId],
    references: [clients.id],
  }),
  block: one(clientBlocks, {
    fields: [clientUnits.blockId],
    references: [clientBlocks.id],
  }),
}));
