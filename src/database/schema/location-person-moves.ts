import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { clients } from './clients';

/** Append-only snapshots; deleting a person or unit must not erase the audit. */
export const locationPersonMoves = pgTable(
  'location_person_moves',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    personKind: varchar('person_kind', { length: 20 }).notNull(),
    personId: uuid('person_id').notNull(),
    actorUserId: text('actor_user_id').notNull(),
    sourceUnitId: uuid('source_unit_id').notNull(),
    targetUnitId: uuid('target_unit_id').notNull(),
    sourceBlockName: varchar('source_block_name', { length: 100 }).notNull(),
    sourceUnitName: varchar('source_unit_name', { length: 50 }).notNull(),
    targetBlockName: varchar('target_block_name', { length: 100 }).notNull(),
    targetUnitName: varchar('target_unit_name', { length: 50 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('location_person_moves_client_person_idx').on(
      t.clientId,
      t.personId,
      t.createdAt,
    ),
  ],
);
