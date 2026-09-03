import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  index,
  uuid,
} from 'drizzle-orm/pg-core';

import { clients } from './clients';
import { facialReaders } from './readers';
import { deviceSyncStatusEnum } from './registrations';

export const personReaderSync = pgTable(
  'person_reader_sync',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    faceId: integer('face_id').notNull(),
    readerId: uuid('reader_id')
      .notNull()
      .references(() => facialReaders.id, { onDelete: 'cascade' }),
    status: deviceSyncStatusEnum('status').notNull(),
    error: text('error'),
    syncedAt: timestamp('synced_at'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('person_reader_sync_client_face_reader_unique').on(
      t.clientId,
      t.faceId,
      t.readerId,
    ),
    index('person_reader_sync_client_face_idx').on(t.clientId, t.faceId),
  ],
);

export type PersonReaderSyncRow = typeof personReaderSync.$inferSelect;
